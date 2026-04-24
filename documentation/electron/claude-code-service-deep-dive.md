# ClaudeCodeService — Deep Dive

How the agent chat works end-to-end: process lifecycle, IPC plumbing, event parsing, session management, and known failure modes.

---

## Architecture Overview

```
ClaudeView.jsx (renderer)
  │
  │  api.spawnWorker(opts)          ← IPC invoke
  │
  ▼
ipc-handlers.js (main process)
  │
  │  ClaudeCodeService.spawnWorker(opts)
  │
  ▼
ClaudeCodeService.js (main process)
  │
  │  spawn('claude', [...args])     ← child_process.spawn
  │
  ▼
Claude CLI process (PID)
  │
  │  stdout → NDJSON lines          ← one JSON object per line
  │  stderr → status/activity text
  │
  ▼
broadcastFn('worker-output', data)  ← IPC push to renderer
  │
  ▼
ClaudeView.jsx worker-output listener
  │
  │  handleChunk() → processEvent()
  │
  ▼
React state (messages, status, streaming refs)
```

Each user message spawns a **new CLI process**. There is no persistent connection. Session continuity across messages is maintained by `--resume <sessionId>`.

---

## 1. Process Spawning (`ClaudeCodeService.spawnWorker`)

**File:** `electron/services/ClaudeCodeService.js`

### CLI Arguments

Every spawn includes these base args:

```
claude --print --output-format stream-json --verbose
```

Optional args based on `opts`:

| Arg | When | Purpose |
|---|---|---|
| `--model <model>` | `opts.model` set | Model selection |
| `--dangerously-skip-permissions` | `opts.dangerouslySkipPermissions` | Skip permission prompts |
| `--permission-prompt-tool stdio` | NOT skip permissions | Relay permissions via stdin JSON |
| `--input-format stream-json` | NOT skip permissions | Accept stdin as NDJSON |
| `--resume <sessionId>` | `opts.resumeSessionId` set | Resume existing conversation |
| `--add-dir <path>` | Always (Synapse dir) + project dir + extras | Additional context directories |
| `--append-system-prompt <text>` | `opts.systemPrompt` set | System prompt injection |

### Two Modes

**Bypass mode** (`dangerouslySkipPermissions: true`):
- Prompt written to stdin as plain text, then `stdin.end()`
- No permission relay
- Process runs to completion autonomously

**Permission mode** (`dangerouslySkipPermissions: false`):
- Prompt wrapped in NDJSON envelope: `{"type":"user","message":{"role":"user","content":"..."}}`
- stdin left **open** for permission relay
- CLI sends `control_request` events when it needs permission
- Renderer responds via `writeToWorker(pid, JSON.stringify(control_response))`

### Environment

- `ELECTRON_RUN_AS_NODE` and `CLAUDECODE` are stripped from env
- `SYNAPSE_DASHBOARD_ID` is injected if `opts.dashboardId` is set (used by PreToolUse hooks)
- CWD is set to `opts.projectDir` or `process.cwd()`

### Worker Tracking

Active workers are tracked in a module-level map:

```javascript
activeWorkers[pid] = {
  provider: 'claude',
  taskId, dashboardId, process, pid,
  startedAt: ISO string,
  output: '',        // accumulated stdout
  errorOutput: '',   // accumulated stderr
  lineBuffer: '',    // incomplete NDJSON line buffer
};
```

---

## 2. stdout Processing (NDJSON Line Buffering)

**File:** `electron/services/ClaudeCodeService.js`, lines 142-177

stdout arrives in arbitrary-sized chunks that may split across JSON line boundaries.

```
Chunk 1: '{"type":"system","subtype":"init"...}\n{"type":"ass'
Chunk 2: 'istant","message":...}\n'
```

The service maintains a `lineBuffer` per worker:

1. Append chunk to `lineBuffer`
2. Split on `\n`
3. Last element (possibly incomplete) goes back into `lineBuffer`
4. Complete lines are JSON-parsed and broadcast

**Critical edge case:** On process close, any remaining data in `lineBuffer` is flushed. Without this, the final `result` event can be silently lost if the CLI's last chunk doesn't end with `\n`.

### Broadcast

Each complete line is broadcast to the renderer via IPC:

```javascript
broadcastFn('worker-output', {
  pid,
  provider: 'claude',
  taskId,
  dashboardId,
  chunk: line + '\n',     // the raw JSON line
  parsed: parsedObj,       // JSON.parse result (or null)
});
```

stderr is broadcast separately with `isStderr: true`. The renderer uses this for status bar activity updates.

---

## 3. IPC Bridge

### Main → Renderer (Push Channels)

**File:** `electron/preload.js`

Three channels carry chat events:

| Channel | When | Payload |
|---|---|---|
| `worker-output` | Each stdout line or stderr chunk | `{ pid, taskId, dashboardId, chunk, parsed, isStderr }` |
| `worker-complete` | Process exits | `{ pid, taskId, dashboardId, exitCode, output, errorOutput }` |
| `worker-error` | Process spawn fails | `{ pid, taskId, dashboardId, error }` |

The renderer subscribes via `api.on(channel, callback)` which returns an unsubscribe function. Listeners are set up in a `useEffect` in ClaudeView.

### Renderer → Main (Invoke Channels)

| Channel | Purpose |
|---|---|
| `spawn-worker` | Start a new CLI process |
| `kill-worker` | Kill a specific process by PID |
| `get-active-workers` | List active processes (for health checks) |
| `write-to-worker` | Write to a process's stdin (permission relay) |

### Broadcast Safety

`broadcastFn` checks `win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()` before sending. If the check fails, the event is silently dropped with a console warning. **There is no retry or queue.**

---

## 4. Renderer Event Processing

**File:** `src/ui/components/ClaudeView.jsx`

### Listener Setup (lines ~1134-1378)

A single `useEffect` sets up listeners for `worker-output`, `worker-complete`, and `worker-error`. The dependency array is `[api, dispatch]`.

The `worker-output` listener routes events based on which dashboard/tab the task belongs to:

```
worker-output arrives
  │
  ├─ Is it for the current dashboard?
  │   ├─ Is it for the active tab?
  │   │   └─ handleChunk() → processEvent()     ← full streaming
  │   └─ Different tab on same dashboard
  │       └─ routeToTabStash()                   ← buffered
  │
  └─ Different dashboard entirely
      └─ route to dashboard stash                ← buffered
```

### handleChunk() (lines ~1668-1710)

Processes raw `worker-output` data:

1. **stderr** → strip ANSI, update status bar, append as activity lines
2. **stdout** → split on `\n`, JSON-parse each line, call `processEvent()`
3. **Non-JSON stdout** → check for compaction messages, otherwise append as text

### processEvent() — The Event State Machine (lines ~1712-1936)

This is the core event processor. Events from the CLI and how they're handled:

| Event Type | Handling |
|---|---|
| `system` (subtype: `init`) | Show "Connected" message, **clear `isResumedSessionRef`** |
| `system` (subtype: `auto_compact`) | Show compaction banner, reset streaming state |
| `system` (other) | Show as system message |
| `assistant` | **Skipped if** `sawStreamingRef` or `isResumedSessionRef` is true. Otherwise render text/tool_use/thinking blocks |
| `content_block_start` | Mark streaming active, set `isResumedSessionRef = false`, init block accumulator |
| `content_block_delta` | Append text/thinking/tool_input deltas to accumulators |
| `content_block_stop` | Flush accumulated block content |
| `message_start` | Reset pending tool counter |
| `message_stop` | Flush all buffers, reset streaming refs |
| `result` | Flush all buffers, capture `session_id`, set status to Ready |
| `user` | **Skipped if** `isResumedSessionRef` is true. Otherwise process tool_result blocks |
| `control_request` | Show permission modal |
| `error` | Show error message |
| `rate_limit_event` / `ping` | Ignored |

### Streaming vs Non-Streaming Responses

The CLI can respond in two formats:

**Streaming** (tool use, long responses):
```
content_block_start → content_block_delta (×N) → content_block_stop → message_stop → result
```

**Non-streaming** (short responses, bypass mode):
```
assistant → result
```

The `sawStreamingRef` flag prevents duplicate rendering when both formats arrive for the same turn (streaming events come first, then the `assistant` summary).

### The `isResumedSessionRef` Guard

When sending a follow-up message to an existing session:

1. `sendText()` sets `isResumedSessionRef = true` (because `sessionIdRef.current` exists)
2. This was originally meant to skip history replay events from `--resume`
3. **In practice, `--resume` with `--print` does NOT replay history** — the CLI loads context internally
4. The flag is cleared by `system init` (safest), `content_block_start`, `message_stop`, or `result`

**If the flag isn't cleared before the `assistant` event, the response is silently dropped.** This was the root cause of the "no response after N messages" bug (fixed by clearing on `system init`).

---

## 5. Session Management

### Session ID Flow

```
Message 1:  sendText() → spawn (no --resume) → CLI responds → result event has session_id
                                                                  → sessionIdRef.current = session_id

Message 2+: sendText() → spawn (--resume session_id) → CLI responds → result event has session_id
                                                                         → sessionIdRef.current updated
```

The session ID is a UUID assigned by the CLI on first run. It identifies the conversation for `--resume`.

### Conversation Context (for fresh sessions)

When `sessionIdRef.current` is null (first message or new tab), `sendText()` builds conversation context from the current UI messages via `buildConversationContext()`:

- **Recent messages** (last N): full text
- **Older messages**: condensed summaries (truncated text, tool name only)
- **Max context**: capped at `MAX_CONTEXT_CHARS`

This context is prepended to the user's prompt in `<conversation_history>` tags. It is **NOT** sent for resumed sessions (the CLI already has the full history).

### System Prompt

Injected via `--append-system-prompt` only on fresh sessions (not resumed). Built by `api.getChatSystemPrompt()` which combines project context, Synapse commands, and other relevant instructions.

---

## 6. Process Lifecycle Events

### Normal completion:

```
spawn → stdout events → result event → process close (exit 0) → worker-complete
```

### Error during execution:

```
spawn → stdout events → error event → process close (exit non-zero) → worker-complete
```

### Spawn failure:

```
spawn fails → process error event → worker-error
```

### Process killed:

```
spawn → stdout events → SIGTERM → process close (exit signal) → worker-complete
```

Kill sends SIGTERM, then SIGKILL after 5s if still running.

---

## 7. Health Check System

**File:** `src/ui/components/ClaudeView.jsx`, lines ~1384-1479

An 8-second interval polls `api.getActiveWorkers()` and compares against locally tracked tasks.

**Orphan detection:** If a locally tracked task's PID is no longer in the active workers list, the process died without sending `worker-complete`. The health check:
1. Shows "Connection lost" message
2. Cleans up task tracking refs
3. Sets processing state to false

**IPC failure detection:** If `getActiveWorkers()` throws 3 consecutive times, assume the main process is unreachable and do a hard reset of all task tracking.

---

## 8. Permission Relay

When `dangerouslySkipPermissions` is false:

```
CLI needs permission
  │
  ▼
CLI writes control_request to stdout
  │
  ▼
processEvent() shows PermissionModal
  │
  ├─ User approves → write control_response {behavior:'allow'} to stdin
  └─ User denies  → write control_response {behavior:'deny'} to stdin
  │
  ▼
CLI continues (or aborts tool use)
```

**Auto-approve:** Tools the user has chosen "always allow" for (tracked in `allowedToolsRef`) are auto-approved without showing the modal.

---

## 9. Debugging Guide

### Log Prefixes

All ClaudeCodeService logs use `[ClaudeCodeService]` prefix. Key log lines:

| Log | What It Tells You |
|---|---|
| `Spawning cliPath: ...` | Process is about to spawn |
| `Full args: [...]` | Exact CLI arguments (check for `--resume`, model, dirs) |
| `Process spawned, PID: N` | Spawn succeeded |
| `stdout chunk (N bytes) from PID: N` | Data received from CLI |
| `Broadcasting worker-output, event type: X` | Event being sent to renderer |
| `broadcastFn is NULL` | **BUG** — events are being lost |
| `WARNING: No stdout received after 10s` | CLI may be hanging |
| `Process closed, PID: N exit code: N` | Process finished |

### Common Failure Patterns

#### "No response after first message"
**Symptom:** First message works, subsequent messages show nothing.
**Cause:** `isResumedSessionRef` stuck at `true`, blocking `assistant` events.
**Debug:** Check that `system init` event arrives. Log shows `event type: system` then `event type: assistant` — if `assistant` arrives but UI shows nothing, the event is being dropped in `processEvent()`.
**Fixed in:** Clearing `isResumedSessionRef` on `system init`.

#### "Response cut off mid-stream"
**Symptom:** Partial response, then silence.
**Cause:** Line buffer not flushed on process close, or IPC broadcast failed.
**Debug:** Check for `Process closed` log — if it fires but no `worker-complete` reaches the renderer, the broadcast failed. Check that `lineBuffer` flush logic at close time produced valid JSON.

#### "Stuck in processing state"
**Symptom:** Spinner never stops, can't send new messages.
**Cause:** `worker-complete` or `worker-error` never received. Process may still be running, or event was lost.
**Debug:** Check `getActiveWorkers()` — if the PID is still there, the process is alive. If not, the health check should clean up within 8s. If health check isn't running, check that `activeTaskIdsRef` isn't empty (health check skips when no tasks tracked).

#### "Duplicate messages on resumed session"
**Symptom:** Historical messages appear twice after sending a follow-up.
**Cause:** `isResumedSessionRef` was cleared too early (e.g., by a `message_stop` during replay), allowing replayed `assistant` events to render.
**Debug:** This should not happen with `--print` mode since the CLI doesn't replay history. If it does, check whether the CLI output format changed.

#### "Permission modal never appears"
**Symptom:** CLI is waiting for permission but UI shows nothing.
**Cause:** `control_request` event not reaching `processEvent()`, or not matching the `control_request` case.
**Debug:** Check that `dangerouslySkipPermissions` is false. Check stdout logs for `control_request` event type. Verify the event has `request.subtype === 'can_use_tool'`.

#### "Process spawns but immediately exits"
**Symptom:** `worker-complete` with non-zero exit code, no output.
**Cause:** Invalid CLI args, missing `claude` binary, or auth failure.
**Debug:** Check `errorOutput` in the `worker-complete` event. Check stderr logs for error messages.

### Tracing a Message End-to-End

1. **Renderer sends:** Look for `CLAUDE_SET_PROCESSING: true` and the `spawn-worker` IPC call
2. **Main process spawns:** `[ClaudeCodeService] Spawning cliPath:` + `Process spawned, PID:`
3. **CLI responds:** `stdout chunk (N bytes)` + `Broadcasting worker-output, event type: X`
4. **Renderer receives:** Events hit `handleChunk()` → `processEvent()`
5. **UI updates:** Check React state dispatches (`CLAUDE_APPEND_MSG`, `CLAUDE_SET_STATUS`)
6. **Process ends:** `Process closed` + `worker-complete` broadcast
7. **Cleanup:** `finishProcessing()` clears task refs, saves conversation

### Key Refs to Watch

| Ref | Purpose | Stuck Value = Bug |
|---|---|---|
| `isResumedSessionRef` | Skip history replay | `true` after `system init` → responses dropped |
| `sawStreamingRef` | Skip duplicate `assistant` event after streaming | `true` across turns → next turn's non-streaming response dropped |
| `activeTaskIdsRef` | Track running tasks | Non-empty after process exits → stuck processing state |
| `sessionIdRef` | Session continuity | `null` when it should be set → context lost between messages |
| `currentTextIndexRef` | Which message index to append streaming text to | Stale index → text appended to wrong message |

---

## 10. Data Flow Diagram — Complete Message Lifecycle

```
User types message, hits Enter
  │
  ▼
sendMessage() → sendText(prompt)
  │
  ├── appendMsg({ type: 'user', text })          → user message in UI
  ├── dispatch CLAUDE_SET_PROCESSING: true        → disable input
  ├── dispatch CLAUDE_SET_STATUS: 'Thinking...'   → status bar
  ├── isResumedSessionRef = !!sessionIdRef        → history skip flag
  ├── activeTaskIdsRef.add(taskId)                → track this task
  │
  ├── api.getSettings()                           → get project path, model, etc.
  ├── api.getChatSystemPrompt()                   → build system prompt (fresh only)
  ├── buildConversationContext()                   → history context (fresh only)
  │
  └── api.spawnWorker({                           → IPC to main process
        prompt, systemPrompt, resumeSessionId,
        model, projectDir, ...
      })
        │
        ▼
      ClaudeCodeService.spawnWorker()
        │
        ├── Build CLI args
        ├── spawn('claude', args, { cwd, env, stdio: ['pipe','pipe','pipe'] })
        ├── Write prompt to stdin
        ├── Register stdout/stderr/close/error handlers
        └── Return { pid }
              │
              ▼
            CLI runs...
              │
              ├── stdout: {"type":"system","subtype":"init","model":"...","tools":[...]}
              │     → broadcast 'worker-output'
              │     → renderer: processEvent() → appendMsg "Connected"
              │     → isResumedSessionRef = false  ← CRITICAL
              │
              ├── stdout: {"type":"content_block_start","content_block":{"type":"text"}}
              │     → broadcast 'worker-output'
              │     → renderer: processEvent() → sawStreamingRef = true
              │     → dispatch CLAUDE_SET_STATUS: 'Responding...'
              │
              ├── stdout: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}
              │     → broadcast 'worker-output'
              │     → renderer: processEvent() → appendTextContent("Hello")
              │     → (buffered, flushed every 32ms for performance)
              │
              ├── stdout: {"type":"content_block_stop"}
              │     → broadcast 'worker-output'
              │     → renderer: processEvent() → flush text buffer
              │
              ├── stdout: {"type":"message_stop"}
              │     → broadcast 'worker-output'
              │     → renderer: processEvent() → flush all, reset sawStreamingRef
              │
              ├── stdout: {"type":"result","session_id":"uuid-here","cost_usd":0.01}
              │     → broadcast 'worker-output'
              │     → renderer: processEvent() → sessionIdRef = session_id
              │     → dispatch CLAUDE_SET_STATUS: 'Ready'
              │
              └── process exits (code 0)
                    → flush lineBuffer
                    → delete activeWorkers[pid]
                    → broadcast 'worker-complete' { exitCode: 0 }
                    → renderer: finishProcessing(taskId)
                        ├── activeTaskIdsRef.delete(taskId)
                        ├── dispatch CLAUDE_SET_PROCESSING: false
                        ├── dispatch CLAUDE_SET_STATUS: 'Ready'
                        └── api.saveConversation(...)  ← persist to disk
```
