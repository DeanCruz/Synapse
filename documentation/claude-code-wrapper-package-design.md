# claude-code-wrapper — Package Design

A Node.js wrapper for the Claude Code CLI that handles process management, NDJSON parsing, streaming assembly, session continuity, and permission relay — so consumers get clean, high-level events instead of raw stdout.

---

## API Surface

### `createSession(options): Session`

Factory function. Returns a `Session` instance bound to a working directory.

```javascript
import { createSession } from 'claude-code-wrapper';

const session = createSession({
  cwd: '/path/to/project',
  model: 'claude-sonnet-4-20250514',
  cli: '/usr/local/bin/claude',  // optional, defaults to 'claude'
  permissions: 'prompt',          // 'prompt' | 'skip' | 'auto'
  dirs: ['/extra/context/dir'],   // additional --add-dir paths
  env: { CUSTOM_VAR: 'value' },   // extra env vars (merged with process.env)
});
```

| Option | Type | Default | Description |
|---|---|---|---|
| `cwd` | `string` | `process.cwd()` | Working directory for the CLI process |
| `model` | `string` | CLI default | Model to use |
| `cli` | `string` | `'claude'` | Path to Claude CLI binary |
| `permissions` | `'prompt' \| 'skip' \| 'auto'` | `'prompt'` | Permission handling mode |
| `dirs` | `string[]` | `[]` | Additional context directories |
| `env` | `object` | `{}` | Extra environment variables |
| `systemPrompt` | `string` | none | Appended system prompt |

### `session.send(prompt): Turn`

Send a message. Returns a `Turn` object representing the in-flight response.

```javascript
const turn = session.send('Refactor the auth module to use JWT');
```

Each `send()` spawns a new CLI process. If the session has a prior `sessionId` (from a previous turn's `result` event), it automatically passes `--resume`. The consumer never thinks about process lifecycle.

### `Turn` — EventEmitter

```javascript
turn.on('text', (chunk) => {
  // Incremental text content (already assembled from content_block_delta events)
  process.stdout.write(chunk);
});

turn.on('thinking', (chunk) => {
  // Extended thinking content (streamed)
});

turn.on('tool_use', (tool) => {
  // { id, name, input }
  // Fires once input is fully assembled (after content_block_stop)
  console.log(`Using tool: ${tool.name}`);
});

turn.on('tool_result', (result) => {
  // { toolUseId, content }
  // The result returned to the model from a tool execution
});

turn.on('permission', (request, respond) => {
  // request: { id, toolName, input }
  // respond: (decision) => void  where decision is 'allow' | 'deny'
  //
  // Only fires when permissions: 'prompt'
  // If permissions: 'skip', never fires (--dangerously-skip-permissions)
  // If permissions: 'auto', auto-allows everything (respond called internally)
  respond('allow');
});

turn.on('activity', (line) => {
  // stderr lines — tool execution status, progress indicators
  // Already stripped of ANSI codes and progress bar noise
});

turn.on('compaction', (summary) => {
  // Context was compacted. summary may be empty string.
});

turn.on('error', (err) => {
  // { message, code? }
});

turn.on('done', (result) => {
  // { sessionId, cost?, duration?, exitCode }
  // Fires after process exits cleanly
});

// Aggregated result (Promise-based alternative to events)
const result = await turn.result;
// { text, thinking, toolCalls, sessionId, cost, exitCode }
```

### `session.abort()`

Kill the active process (SIGTERM, then SIGKILL after 5s).

```javascript
session.abort();
```

### `session.sessionId`

The current session ID. `null` before the first turn completes. Automatically used for `--resume` on subsequent `send()` calls.

```javascript
console.log(session.sessionId); // '365cd906-aa72-4cf0-...'
```

### `session.isActive`

Whether a turn is currently in flight.

---

## Usage Examples

### Simple one-shot

```javascript
import { createSession } from 'claude-code-wrapper';

const session = createSession({ cwd: './my-project', permissions: 'skip' });
const turn = session.send('Add input validation to the signup form');
const result = await turn.result;

console.log(result.text);
```

### Multi-turn conversation

```javascript
const session = createSession({ cwd: './my-project', permissions: 'skip' });

const t1 = session.send('What does the auth module do?');
await t1.result;

// Automatically resumes the session — CLI has full conversation context
const t2 = session.send('Now refactor it to use JWT');
await t2.result;

const t3 = session.send('Add tests for the new JWT flow');
await t3.result;
```

### Streaming to terminal

```javascript
const session = createSession({ cwd: './my-project', permissions: 'skip' });
const turn = session.send('Explain the database schema');

turn.on('thinking', (chunk) => {
  process.stderr.write(chalk.dim(chunk));
});

turn.on('text', (chunk) => {
  process.stdout.write(chunk);
});

turn.on('tool_use', (tool) => {
  console.log(chalk.yellow(`\n[tool: ${tool.name}]`));
});

await turn.result;
```

### With permission handling

```javascript
const session = createSession({ cwd: './my-project', permissions: 'prompt' });
const turn = session.send('Delete all .tmp files and fix the build');

turn.on('permission', (req, respond) => {
  if (req.toolName === 'Bash' && req.input.command?.includes('rm')) {
    // Ask your UI for confirmation
    const ok = await showConfirmDialog(`Allow: ${req.toolName}?`, req.input);
    respond(ok ? 'allow' : 'deny');
  } else {
    respond('allow');
  }
});

await turn.result;
```

### Parallel workers (swarm-style)

```javascript
import { createSession } from 'claude-code-wrapper';

const tasks = [
  { prompt: 'Add input validation to signup form', cwd: './frontend' },
  { prompt: 'Add rate limiting to /api/auth', cwd: './backend' },
  { prompt: 'Write integration tests for auth flow', cwd: './tests' },
];

const results = await Promise.all(
  tasks.map(task => {
    const session = createSession({ cwd: task.cwd, permissions: 'skip' });
    return session.send(task.prompt).result;
  })
);
```

### Activity monitoring (for UI status bars)

```javascript
const turn = session.send('Refactor the payment module');

turn.on('activity', (line) => {
  statusBar.update(line);  // "Reading src/payments/index.ts", "Running npm test", etc.
});

turn.on('tool_use', (tool) => {
  statusBar.update(`Tool: ${tool.name}`);
});

turn.on('done', () => {
  statusBar.update('Ready');
});
```

---

## Internal Architecture

### What the package hides

These are the implementation details that consumers never see:

```
Consumer calls session.send(prompt)
  │
  ▼
Package internals:
  ├── Build CLI args (--print, --output-format stream-json, --verbose, --resume, etc.)
  ├── Spawn child process with piped stdio
  ├── Write prompt to stdin (NDJSON envelope or plain text, depending on mode)
  ├── NDJSON line buffer on stdout (split chunks on \n, accumulate partials)
  ├── Parse each JSON line into typed events
  ├── Assemble streaming blocks:
  │     content_block_start → content_block_delta (×N) → content_block_stop
  │     into a single complete text/tool_use/thinking block
  ├── Strip ANSI from stderr, filter progress bar noise
  ├── Detect compaction events (JSON system event or raw text), reset state
  ├── Handle permission relay (control_request → callback → control_response via stdin)
  ├── Capture session_id from result event for next --resume
  ├── Flush line buffer on process close (critical edge case)
  ├── Track process lifecycle (spawn, running, exited, killed)
  │
  ▼
Consumer receives clean events: text, thinking, tool_use, tool_result, permission, done
```

### Layer breakdown

```
┌─────────────────────────────────────────────┐
│  Session API                                │  session.send(), session.abort()
│  Turn API (EventEmitter + Promise)          │  turn.on('text'), await turn.result
├─────────────────────────────────────────────┤
│  Event Assembler                            │  content_block_* → assembled blocks
│  Streaming Buffer (32ms flush)              │  batch deltas for perf
├─────────────────────────────────────────────┤
│  NDJSON Parser                              │  line buffering, JSON.parse, flush-on-close
│  Stderr Filter                              │  ANSI strip, progress bar detection
├─────────────────────────────────────────────┤
│  Process Manager                            │  spawn, kill, stdin write, env setup
│  Session State                              │  sessionId tracking, --resume wiring
├─────────────────────────────────────────────┤
│  Claude CLI (child process)                 │  --print --output-format stream-json
└─────────────────────────────────────────────┘
```

### CLI Event → Package Event Mapping

| CLI Event(s) | Package Event | Notes |
|---|---|---|
| `content_block_delta` (type: text_delta) | `text` | Streamed incrementally |
| `assistant` (non-streaming, text blocks) | `text` | Emitted as single chunk |
| `content_block_delta` (type: thinking_delta) | `thinking` | Streamed incrementally |
| `content_block_start/delta/stop` (tool_use) | `tool_use` | Emitted once fully assembled |
| `user` (tool_result blocks) | `tool_result` | Paired with prior tool_use by ID |
| `control_request` | `permission` | Includes respond() callback |
| `system` (subtype: init) | (internal) | Marks CLI ready, resets internal state |
| `system` (compaction) | `compaction` | Resets streaming accumulators |
| `message_stop` | (internal) | Flushes buffers between turns |
| `result` | `done` | Captures sessionId, cost |
| `error` | `error` | |
| `rate_limit_event`, `ping` | (suppressed) | |
| stderr lines | `activity` | Filtered and cleaned |

### Edge Cases Handled Internally

| Edge Case | How It's Handled |
|---|---|
| stdout chunk splits mid-JSON line | Line buffer accumulates until `\n` |
| Final chunk has no trailing `\n` | Buffer flushed on process `close` event |
| Non-streaming `assistant` event (bypass mode) | Detected and emitted as `text` directly |
| Both streaming + `assistant` summary for same turn | `assistant` suppressed if streaming blocks already rendered |
| Compaction mid-response | All streaming accumulators reset, new content rendered fresh |
| `--resume` with `--print` doesn't replay history | No skip logic needed — `init` event marks start of real content |
| Process dies without emitting `result` | `done` still fires (from `close` event) with exitCode |
| Permission callback never called | Timeout after 5 min, auto-deny, continue |
| Multiple rapid `send()` calls | Second call queued until first turn completes (or throws if not) |

---

## Package Scope

### In scope

- Claude Code CLI process lifecycle
- NDJSON stdout parsing and streaming assembly
- Session continuity (--resume)
- Permission relay
- Clean event interface
- Promise-based result aggregation
- Stderr activity filtering

### Out of scope (consumer's responsibility)

- UI rendering
- Conversation history display
- Multi-dashboard routing
- Tab/stash management
- System prompt construction
- Project detection
- Swarm orchestration
- Conversation persistence

---

## Package Metadata

```json
{
  "name": "claude-code-wrapper",
  "description": "Node.js wrapper for the Claude Code CLI — process management, event parsing, session continuity, and permission relay",
  "keywords": ["claude", "claude-code", "cli", "wrapper", "ai", "agent", "anthropic"],
  "engines": { "node": ">=18" },
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "dependencies": {},
  "peerDependencies": {}
}
```

Zero dependencies. Just Node.js `child_process` and `EventEmitter`.

---

## Test Suite

Tests use a **mock CLI** — a small Node script that replays canned NDJSON sequences to stdout — so the full suite runs in seconds with no network, no API key, and no real Claude process.

### Mock CLI (`test/fixtures/mock-cli.js`)

A script that reads a scenario file and writes NDJSON to stdout with configurable timing:

```javascript
// Invoked as: node mock-cli.js <scenario.json>
// Scenario file defines what to emit on stdout/stderr and when
//
// scenario.json:
// {
//   "steps": [
//     { "stream": "stdout", "delay": 0,   "line": "{\"type\":\"system\",\"subtype\":\"init\",\"model\":\"claude-sonnet-4-20250514\",\"tools\":[]}" },
//     { "stream": "stdout", "delay": 50,  "line": "{\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\"}}" },
//     { "stream": "stdout", "delay": 10,  "line": "{\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"Hello \"}}" },
//     { "stream": "stdout", "delay": 10,  "line": "{\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"world\"}}" },
//     { "stream": "stdout", "delay": 10,  "line": "{\"type\":\"content_block_stop\",\"index\":0}" },
//     { "stream": "stdout", "delay": 10,  "line": "{\"type\":\"message_stop\"}" },
//     { "stream": "stdout", "delay": 10,  "line": "{\"type\":\"result\",\"session_id\":\"test-session-001\"}" }
//   ],
//   "exitCode": 0,
//   "stdinCapture": true
// }
```

This lets every test be a deterministic replay of a real CLI interaction. Scenarios are captured from actual sessions (sanitized) so they reflect real behavior.

### Scenario Fixtures (`test/fixtures/scenarios/`)

| Scenario File | What It Tests |
|---|---|
| `simple-text-response.json` | Basic streaming text response |
| `non-streaming-response.json` | Single `assistant` event (no streaming blocks) |
| `tool-use-single.json` | One tool call with result |
| `tool-use-chained.json` | Multiple sequential tool calls in one turn |
| `tool-use-parallel.json` | Multiple tool calls started before results return |
| `thinking-then-response.json` | Extended thinking block followed by text |
| `permission-request.json` | `control_request` → waits for stdin → continues |
| `permission-denied.json` | Permission denied, CLI adjusts |
| `multi-turn-resume.json` | Second turn with `--resume`, verify args |
| `compaction-mid-response.json` | Compaction event fires mid-stream |
| `compaction-json-system-event.json` | Compaction via JSON system event (not raw text) |
| `error-mid-stream.json` | Error event during response |
| `crash-no-result.json` | Process exits without `result` event |
| `crash-nonzero-exit.json` | Process exits with non-zero code |
| `empty-response.json` | CLI responds with no content blocks |
| `split-chunks.json` | JSON lines split across multiple stdout chunks |
| `no-trailing-newline.json` | Final line has no `\n` (tests flush-on-close) |
| `stderr-activity.json` | Stderr with tool activity, progress bars, ANSI codes |
| `rate-limit-event.json` | Rate limit events interspersed with response |
| `large-response.json` | Very long response (tests buffering at scale) |
| `init-event-fields.json` | Verify all `system init` fields are parsed |
| `session-id-capture.json` | Verify session_id extracted from `result` |

### Test Categories

#### 1. NDJSON Parser (`test/parser.test.js`)

Unit tests for the line buffer — the lowest layer. No process spawning.

```javascript
describe('NDJSONParser', () => {
  test('parses complete lines', () => {
    const parser = new NDJSONParser();
    const events = [];
    parser.on('event', (evt) => events.push(evt));

    parser.write('{"type":"system","subtype":"init"}\n');

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('system');
  });

  test('buffers partial lines across chunks', () => {
    const parser = new NDJSONParser();
    const events = [];
    parser.on('event', (evt) => events.push(evt));

    parser.write('{"type":"ass');
    parser.write('istant","message":{"content":[]}}\n');

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('assistant');
  });

  test('handles multiple lines in one chunk', () => {
    const parser = new NDJSONParser();
    const events = [];
    parser.on('event', (evt) => events.push(evt));

    parser.write('{"type":"system","subtype":"init"}\n{"type":"assistant","message":{"content":[]}}\n');

    expect(events).toHaveLength(2);
  });

  test('flush() emits buffered partial line', () => {
    const parser = new NDJSONParser();
    const events = [];
    parser.on('event', (evt) => events.push(evt));

    parser.write('{"type":"result","session_id":"abc"}');
    expect(events).toHaveLength(0);

    parser.flush();
    expect(events).toHaveLength(1);
    expect(events[0].session_id).toBe('abc');
  });

  test('ignores empty lines', () => {
    const parser = new NDJSONParser();
    const events = [];
    parser.on('event', (evt) => events.push(evt));

    parser.write('\n\n{"type":"system","subtype":"init"}\n\n');

    expect(events).toHaveLength(1);
  });

  test('emits raw event for non-JSON lines', () => {
    const parser = new NDJSONParser();
    const raws = [];
    parser.on('raw', (line) => raws.push(line));

    parser.write('Auto-compacting conversation...\n');

    expect(raws).toHaveLength(1);
    expect(raws[0]).toContain('compacting');
  });
});
```

#### 2. Event Assembler (`test/assembler.test.js`)

Tests the streaming block assembly layer — `content_block_start/delta/stop` → assembled events.

```javascript
describe('EventAssembler', () => {
  test('assembles text from streaming deltas', () => {
    const assembler = new EventAssembler();
    const texts = [];
    assembler.on('text', (chunk) => texts.push(chunk));

    assembler.process({ type: 'content_block_start', index: 0, content_block: { type: 'text' } });
    assembler.process({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello ' } });
    assembler.process({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'world' } });
    assembler.process({ type: 'content_block_stop', index: 0 });

    expect(texts.join('')).toBe('Hello world');
  });

  test('assembles tool_use input from JSON deltas', () => {
    const assembler = new EventAssembler();
    const tools = [];
    assembler.on('tool_use', (tool) => tools.push(tool));

    assembler.process({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tool_1', name: 'Read' } });
    assembler.process({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"file' } });
    assembler.process({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '":"foo.js"}' } });
    assembler.process({ type: 'content_block_stop', index: 0 });

    expect(tools).toHaveLength(1);
    expect(tools[0]).toEqual({ id: 'tool_1', name: 'Read', input: { file: 'foo.js' } });
  });

  test('emits text from non-streaming assistant event', () => {
    const assembler = new EventAssembler();
    const texts = [];
    assembler.on('text', (chunk) => texts.push(chunk));

    assembler.process({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Direct response' }] },
    });

    expect(texts.join('')).toBe('Direct response');
  });

  test('suppresses assistant event when streaming already rendered', () => {
    const assembler = new EventAssembler();
    const texts = [];
    assembler.on('text', (chunk) => texts.push(chunk));

    // Streaming first
    assembler.process({ type: 'content_block_start', index: 0, content_block: { type: 'text' } });
    assembler.process({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Streamed' } });
    assembler.process({ type: 'content_block_stop', index: 0 });

    // Then assistant summary (should be suppressed)
    assembler.process({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Streamed' }] },
    });

    expect(texts).toEqual(['Streamed']);
  });

  test('resets state on compaction', () => {
    const assembler = new EventAssembler();
    const compactions = [];
    assembler.on('compaction', (summary) => compactions.push(summary));

    // Start streaming
    assembler.process({ type: 'content_block_start', index: 0, content_block: { type: 'text' } });

    // Compaction interrupts
    assembler.process({ type: 'system', subtype: 'auto_compact', message: 'Context compacted' });

    expect(compactions).toHaveLength(1);

    // New content after compaction should work (not be suppressed)
    const texts = [];
    assembler.on('text', (chunk) => texts.push(chunk));
    assembler.process({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Post-compaction response' }] },
    });

    expect(texts).toEqual(['Post-compaction response']);
  });

  test('handles thinking blocks', () => {
    const assembler = new EventAssembler();
    const thoughts = [];
    assembler.on('thinking', (chunk) => thoughts.push(chunk));

    assembler.process({ type: 'content_block_start', index: 0, content_block: { type: 'thinking' } });
    assembler.process({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Let me think...' } });
    assembler.process({ type: 'content_block_stop', index: 0 });

    expect(thoughts.join('')).toBe('Let me think...');
  });

  test('handles parallel content blocks (text + tool_use)', () => {
    const assembler = new EventAssembler();
    const texts = [];
    const tools = [];
    assembler.on('text', (chunk) => texts.push(chunk));
    assembler.on('tool_use', (tool) => tools.push(tool));

    // Block 0: text
    assembler.process({ type: 'content_block_start', index: 0, content_block: { type: 'text' } });
    assembler.process({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'I will read the file.' } });
    assembler.process({ type: 'content_block_stop', index: 0 });

    // Block 1: tool_use
    assembler.process({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 't1', name: 'Read' } });
    assembler.process({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"file":"x.js"}' } });
    assembler.process({ type: 'content_block_stop', index: 1 });

    expect(texts.join('')).toBe('I will read the file.');
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('Read');
  });
});
```

#### 3. Session Lifecycle (`test/session.test.js`)

Integration tests using the mock CLI.

```javascript
describe('Session', () => {
  test('simple text response', async () => {
    const session = createSession({
      cli: mockCli('simple-text-response.json'),
      cwd: tmpDir,
    });

    const turn = session.send('Hello');
    const result = await turn.result;

    expect(result.text).toBe('Hello world');
    expect(result.exitCode).toBe(0);
    expect(result.sessionId).toBe('test-session-001');
  });

  test('captures session ID and passes --resume on second turn', async () => {
    const spawns = [];
    const session = createSession({
      cli: mockCli('multi-turn-resume.json', { captureSpawns: spawns }),
      cwd: tmpDir,
    });

    await session.send('First message').result;
    expect(session.sessionId).toBe('test-session-001');

    await session.send('Second message').result;

    // Verify --resume was passed on second spawn
    expect(spawns[1].args).toContain('--resume');
    expect(spawns[1].args).toContain('test-session-001');
  });

  test('non-streaming response (bypass mode)', async () => {
    const session = createSession({
      cli: mockCli('non-streaming-response.json'),
      cwd: tmpDir,
      permissions: 'skip',
    });

    const turn = session.send('Quick question');
    const result = await turn.result;

    expect(result.text).toBeTruthy();
    expect(result.exitCode).toBe(0);
  });

  test('process crash emits error and done', async () => {
    const session = createSession({
      cli: mockCli('crash-nonzero-exit.json'),
      cwd: tmpDir,
    });

    const turn = session.send('This will fail');
    const errors = [];
    turn.on('error', (err) => errors.push(err));

    const result = await turn.result;

    expect(result.exitCode).not.toBe(0);
  });

  test('abort kills the process', async () => {
    const session = createSession({
      cli: mockCli('large-response.json'),  // slow, so we can abort mid-stream
      cwd: tmpDir,
    });

    const turn = session.send('Generate a very long response');
    const texts = [];
    turn.on('text', (chunk) => texts.push(chunk));

    // Abort after a short delay
    await new Promise(r => setTimeout(r, 100));
    session.abort();

    const result = await turn.result;
    expect(result.exitCode).not.toBe(0);
  });

  test('concurrent send() throws', async () => {
    const session = createSession({
      cli: mockCli('large-response.json'),
      cwd: tmpDir,
    });

    session.send('First');

    expect(() => session.send('Second while first is running'))
      .toThrow(/already active/i);
  });
});
```

#### 4. Permission Relay (`test/permissions.test.js`)

```javascript
describe('Permission Relay', () => {
  test('permission callback writes to stdin', async () => {
    const stdinWrites = [];
    const session = createSession({
      cli: mockCli('permission-request.json', { captureStdin: stdinWrites }),
      cwd: tmpDir,
      permissions: 'prompt',
    });

    const turn = session.send('Delete some files');

    turn.on('permission', (req, respond) => {
      expect(req.toolName).toBe('Bash');
      expect(req.input.command).toContain('rm');
      respond('allow');
    });

    await turn.result;

    // Verify control_response was written to stdin
    const response = JSON.parse(stdinWrites[stdinWrites.length - 1]);
    expect(response.type).toBe('control_response');
    expect(response.response.response.behavior).toBe('allow');
  });

  test('denied permission sends deny response', async () => {
    const stdinWrites = [];
    const session = createSession({
      cli: mockCli('permission-denied.json', { captureStdin: stdinWrites }),
      cwd: tmpDir,
      permissions: 'prompt',
    });

    const turn = session.send('Delete some files');

    turn.on('permission', (req, respond) => {
      respond('deny');
    });

    await turn.result;

    const response = JSON.parse(stdinWrites[stdinWrites.length - 1]);
    expect(response.response.response.behavior).toBe('deny');
  });

  test('permissions: skip passes --dangerously-skip-permissions', async () => {
    const spawns = [];
    const session = createSession({
      cli: mockCli('simple-text-response.json', { captureSpawns: spawns }),
      cwd: tmpDir,
      permissions: 'skip',
    });

    await session.send('Do something').result;

    expect(spawns[0].args).toContain('--dangerously-skip-permissions');
  });

  test('permissions: auto responds allow without emitting event', async () => {
    const session = createSession({
      cli: mockCli('permission-request.json'),
      cwd: tmpDir,
      permissions: 'auto',
    });

    const turn = session.send('Do something');
    const permissionEvents = [];
    turn.on('permission', () => permissionEvents.push(true));

    await turn.result;

    // Event should NOT have fired — auto-approved internally
    expect(permissionEvents).toHaveLength(0);
  });
});
```

#### 5. Stderr & Activity (`test/stderr.test.js`)

```javascript
describe('Stderr Handling', () => {
  test('strips ANSI codes from activity lines', async () => {
    const session = createSession({
      cli: mockCli('stderr-activity.json'),
      cwd: tmpDir,
    });

    const turn = session.send('Run tests');
    const activities = [];
    turn.on('activity', (line) => activities.push(line));

    await turn.result;

    // Should be clean text, no escape sequences
    for (const line of activities) {
      expect(line).not.toMatch(/\x1b\[/);
    }
  });

  test('filters out progress bar lines', async () => {
    const session = createSession({
      cli: mockCli('stderr-activity.json'),
      cwd: tmpDir,
    });

    const turn = session.send('Install packages');
    const activities = [];
    turn.on('activity', (line) => activities.push(line));

    await turn.result;

    // Progress bars (braille, box-drawing, spinners) should not appear
    for (const line of activities) {
      expect(line).not.toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏█▓▒░]/);
    }
  });
});
```

#### 6. Compaction (`test/compaction.test.js`)

```javascript
describe('Compaction', () => {
  test('compaction event resets state and allows subsequent response', async () => {
    const session = createSession({
      cli: mockCli('compaction-mid-response.json'),
      cwd: tmpDir,
    });

    const turn = session.send('Long conversation message');
    const compactions = [];
    const texts = [];
    turn.on('compaction', (summary) => compactions.push(summary));
    turn.on('text', (chunk) => texts.push(chunk));

    await turn.result;

    expect(compactions).toHaveLength(1);
    // Text after compaction should still be captured
    expect(texts.join('')).toBeTruthy();
  });

  test('compaction via JSON system event', async () => {
    const session = createSession({
      cli: mockCli('compaction-json-system-event.json'),
      cwd: tmpDir,
    });

    const turn = session.send('Another long conversation');
    const compactions = [];
    turn.on('compaction', (summary) => compactions.push(summary));

    await turn.result;

    expect(compactions).toHaveLength(1);
  });
});
```

#### 7. Edge Cases (`test/edge-cases.test.js`)

```javascript
describe('Edge Cases', () => {
  test('flush-on-close captures final event without trailing newline', async () => {
    const session = createSession({
      cli: mockCli('no-trailing-newline.json'),
      cwd: tmpDir,
    });

    const turn = session.send('Hello');
    const result = await turn.result;

    // result event was in the final chunk without \n — should still be captured
    expect(result.sessionId).toBeTruthy();
  });

  test('split chunks across JSON boundary', async () => {
    const session = createSession({
      cli: mockCli('split-chunks.json'),
      cwd: tmpDir,
    });

    const turn = session.send('Hello');
    const result = await turn.result;

    expect(result.text).toBeTruthy();
  });

  test('empty response produces done event with empty text', async () => {
    const session = createSession({
      cli: mockCli('empty-response.json'),
      cwd: tmpDir,
    });

    const turn = session.send('Hello');
    const result = await turn.result;

    expect(result.text).toBe('');
    expect(result.exitCode).toBe(0);
  });

  test('rate limit events are suppressed', async () => {
    const session = createSession({
      cli: mockCli('rate-limit-event.json'),
      cwd: tmpDir,
    });

    const turn = session.send('Hello');
    const allEvents = [];
    const original = turn.emit.bind(turn);
    turn.emit = (event, ...args) => {
      allEvents.push(event);
      return original(event, ...args);
    };

    await turn.result;

    expect(allEvents).not.toContain('rate_limit');
  });

  test('handles process error (spawn failure)', async () => {
    const session = createSession({
      cli: '/nonexistent/path/to/claude',
      cwd: tmpDir,
    });

    const turn = session.send('Hello');
    const errors = [];
    turn.on('error', (err) => errors.push(err));

    const result = await turn.result;

    expect(errors.length).toBeGreaterThan(0);
  });
});
```

---

## Documentation System

The package ships with structured docs that map to how developers actually discover and use a library: quick start → guides by use case → reference → troubleshooting.

### Structure

```
docs/
├── README.md                      ← Package overview, install, 30-second example
├── getting-started.md             ← First session, first response, what to expect
│
├── guides/
│   ├── streaming-responses.md     ← Working with text/thinking/tool_use events
│   ├── multi-turn-sessions.md     ← Session continuity, --resume mechanics
│   ├── permission-handling.md     ← The three permission modes, building approval UIs
│   ├── tool-use-integration.md    ← Processing tool calls, displaying results
│   ├── error-handling.md          ← Crashes, timeouts, rate limits, recovery patterns
│   ├── parallel-workers.md        ← Running multiple sessions concurrently
│   ├── electron-integration.md    ← Using in Electron (IPC patterns, window lifecycle)
│   ├── terminal-ui.md             ← Building CLI tools on top of the wrapper
│   └── web-server-integration.md  ← SSE/WebSocket bridge for browser clients
│
├── reference/
│   ├── api.md                     ← Complete API reference (auto-generated from types)
│   ├── events.md                  ← Every event, when it fires, payload shape
│   ├── cli-flags.md               ← Which Claude CLI flags the package uses and why
│   └── types.md                   ← TypeScript type definitions
│
├── internals/
│   ├── architecture.md            ← Layer diagram, data flow, design decisions
│   ├── ndjson-parser.md           ← How line buffering works, edge cases
│   ├── event-assembler.md         ← How streaming blocks become high-level events
│   ├── session-state-machine.md   ← State transitions, ref lifecycle
│   └── known-cli-behaviors.md     ← Documented quirks of the Claude CLI
│
└── troubleshooting/
    ├── no-response.md             ← "I sent a message but nothing came back"
    ├── duplicate-messages.md       ← "I'm seeing the same response twice"
    ├── stuck-processing.md         ← "isActive is true but nothing is happening"
    ├── permission-hang.md          ← "The process is waiting but no permission event fired"
    └── debug-logging.md            ← How to enable verbose logging, what to look for
```

### README.md

```markdown
# claude-code-wrapper

Node.js wrapper for the [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code).
Handles process lifecycle, NDJSON parsing, streaming assembly, session continuity,
and permission relay — so you get clean events instead of raw stdout.

## Install

npm install claude-code-wrapper

## Quick Start

import { createSession } from 'claude-code-wrapper';

const session = createSession({
  cwd: './my-project',
  permissions: 'skip',
});

// One-shot
const { text } = await session.send('Explain the auth module').result;
console.log(text);

// Multi-turn (automatically resumes session)
await session.send('Now refactor it to use JWT').result;
await session.send('Add tests for the new flow').result;

// Streaming
const turn = session.send('Build a REST API for users');

turn.on('text', (chunk) => process.stdout.write(chunk));
turn.on('tool_use', (tool) => console.log(`Using: ${tool.name}`));
turn.on('activity', (line) => console.log(`  ${line}`));

await turn.result;

## Why This Exists

The Claude CLI outputs NDJSON with 15+ event types, streaming content blocks that
need assembly, session IDs for conversation continuity, and permission requests that
need stdin relay. Every app that wraps the CLI reimplements this parsing layer — and
gets bitten by the same edge cases:

- stdout chunks that split mid-JSON line
- Final events stuck in a buffer because the last chunk had no trailing newline
- Non-streaming `assistant` events in bypass mode vs streaming `content_block_*` events
- Compaction resetting streaming state mid-response
- `--resume` session mechanics

This package absorbs all of that. You get `text`, `tool_use`, `thinking`, `permission`,
`error`, and `done` events. That's it.

## Guides

- [Streaming Responses](docs/guides/streaming-responses.md)
- [Multi-Turn Sessions](docs/guides/multi-turn-sessions.md)
- [Permission Handling](docs/guides/permission-handling.md)
- [Tool Use Integration](docs/guides/tool-use-integration.md)
- [Error Handling](docs/guides/error-handling.md)
- [Parallel Workers](docs/guides/parallel-workers.md)
- [Electron Integration](docs/guides/electron-integration.md)

## API Reference

→ [Full API docs](docs/reference/api.md)
→ [Event reference](docs/reference/events.md)
→ [TypeScript types](docs/reference/types.md)
```

### Key Guide: `guides/streaming-responses.md`

```markdown
# Streaming Responses

The Claude CLI sends responses as a sequence of streaming events. This package
assembles them into clean `text`, `thinking`, and `tool_use` events so you don't
deal with `content_block_start`, `content_block_delta`, and `content_block_stop`.

## Text Streaming

const turn = session.send('Explain recursion');

turn.on('text', (chunk) => {
  // Called for each text delta — typically a few words at a time.
  // Chunks arrive in order. Concatenating all chunks gives the full response.
  process.stdout.write(chunk);
});

const result = await turn.result;
console.log(result.text); // Full assembled text

## Thinking

Extended thinking content streams the same way:

turn.on('thinking', (chunk) => {
  // Internal reasoning — often longer than the final response.
  // Not all responses include thinking blocks.
  debugPanel.append(chunk);
});

## How It Works Internally

The CLI sends:
1. `content_block_start` — declares a new block (text, thinking, or tool_use)
2. `content_block_delta` (×N) — incremental content for that block
3. `content_block_stop` — block is complete

The wrapper tracks active blocks by index and routes deltas to the right event.
For `text` and `thinking`, deltas are emitted immediately. For `tool_use`, input
JSON deltas are accumulated and the complete tool call is emitted on `content_block_stop`.

## Non-Streaming Mode

In bypass mode (`permissions: 'skip'`), the CLI sometimes sends a single `assistant`
event instead of streaming blocks. The wrapper detects this and emits the text as a
single `text` event. Your code works identically either way.

## Buffering

Text deltas are flushed as they arrive — no internal batching. If you need to batch
for UI rendering (e.g., 30fps updates), throttle on your side:

let buffer = '';
let timer = null;

turn.on('text', (chunk) => {
  buffer += chunk;
  if (!timer) {
    timer = setTimeout(() => {
      renderToScreen(buffer);
      buffer = '';
      timer = null;
    }, 33); // ~30fps
  }
});
```

### Key Guide: `guides/permission-handling.md`

```markdown
# Permission Handling

When the CLI needs to use a tool (read a file, run a command, edit code), it can
ask for permission first. The wrapper supports three modes.

## Modes

### `permissions: 'skip'`

Passes `--dangerously-skip-permissions` to the CLI. No permission events fire.
The agent runs autonomously. Use for trusted automation.

const session = createSession({ cwd: './project', permissions: 'skip' });

### `permissions: 'prompt'`

The wrapper emits `permission` events with a `respond` callback. Your code decides.

const session = createSession({ cwd: './project', permissions: 'prompt' });
const turn = session.send('Fix the build');

turn.on('permission', (request, respond) => {
  // request: { id, toolName, input }
  console.log(`Tool: ${request.toolName}`);
  console.log(`Input: ${JSON.stringify(request.input)}`);

  // Your logic here — show a UI, check an allowlist, etc.
  if (isSafe(request)) {
    respond('allow');
  } else {
    respond('deny');
  }
});

### `permissions: 'auto'`

All permissions are auto-approved without emitting events. The agent runs
autonomously but the CLI still validates internally (safer than 'skip').

## How It Works

1. CLI sends a `control_request` event on stdout
2. Wrapper parses it, calls your `permission` callback
3. You call `respond('allow')` or `respond('deny')`
4. Wrapper writes a `control_response` JSON message to the CLI's stdin
5. CLI continues (or adjusts its plan if denied)

## Building an Approval UI

For Electron or web apps, the permission event gives you everything needed:

turn.on('permission', (req, respond) => {
  showModal({
    title: `Allow ${req.toolName}?`,
    detail: formatToolInput(req.toolName, req.input),
    onApprove: () => respond('allow'),
    onDeny: () => respond('deny'),
  });
});

## Timeout

If `respond()` is not called within 5 minutes, the wrapper auto-denies and
logs a warning. This prevents hung processes when the permission callback is
not wired up correctly.
```

### Key Guide: `troubleshooting/no-response.md`

```markdown
# Troubleshooting: No Response

"I sent a message but nothing came back."

## Quick Checks

1. **Is the CLI installed?** Run `claude --version` in your terminal.
2. **Is the process spawning?** Enable debug logging:

   import { createSession } from 'claude-code-wrapper';
   const session = createSession({ cwd: '.', debug: true });
   // Look for: [ccw] spawn: claude --print --output-format stream-json ...
   // Look for: [ccw] stdout: N bytes
   // Look for: [ccw] close: exit code N

3. **Is stdout arriving?** If you see `spawn` but no `stdout` lines, the CLI
   is hanging. Check stderr for auth errors or rate limits.

4. **Is the exit code non-zero?** A failed process may produce no stdout.
   Check `result.exitCode` and the `error` event.

## Common Causes

### Auth failure
The CLI exits immediately with no stdout. Check `result.exitCode` (usually 1)
and enable debug logging to see stderr.

### Multi-turn: non-streaming response dropped
If the first message works but follow-ups don't, the CLI may be sending a
non-streaming `assistant` event instead of `content_block_*` events. The
wrapper handles this automatically since v1.0 — upgrade if on an older version.

**History:** This was the first major bug found during development. The `--resume`
flag with `--print` does NOT replay conversation history — the CLI loads context
internally. But an earlier implementation assumed replay would happen and set a
skip flag that blocked the actual response. See `internals/known-cli-behaviors.md`.

### Compaction mid-response
When the CLI compacts context mid-response, streaming state must be reset.
The wrapper handles this for both JSON system events and raw text compaction
messages. If you're on an old version, upgrade.

### Process killed externally
If something kills the Claude process (OOM, user signal), the wrapper emits
`done` with a non-zero exit code but may not emit any text. Check `result.exitCode`.

## Debug Logging

const session = createSession({ cwd: '.', debug: true });

This logs to stderr:
- [ccw] spawn: full CLI command and args
- [ccw] stdout: byte count for each chunk
- [ccw] event: parsed event type for each NDJSON line
- [ccw] stderr: raw stderr output
- [ccw] close: exit code
- [ccw] flush: line buffer contents flushed on close

For even more detail:

const session = createSession({ cwd: '.', debug: 'verbose' });

This additionally logs:
- [ccw] raw: every raw NDJSON line before parsing
- [ccw] stdin: every write to the process stdin
- [ccw] buffer: line buffer state after each chunk
```

### Reference: `reference/events.md`

```markdown
# Event Reference

Every event emitted by a `Turn` instance.

## `text`

Incremental text content from the model's response.

turn.on('text', (chunk: string) => {})

- **When:** Each text delta arrives (streaming) or the full text at once (non-streaming)
- **Frequency:** Many times per turn (streaming) or once (non-streaming)
- **Concatenation:** Joining all chunks gives the complete response text
- **Also available as:** `result.text` (full assembled text after `done`)

## `thinking`

Extended thinking content.

turn.on('thinking', (chunk: string) => {})

- **When:** Each thinking delta arrives
- **Frequency:** Many times if thinking is enabled, zero if not
- **Also available as:** `result.thinking`

## `tool_use`

A complete tool call (input fully assembled).

turn.on('tool_use', (tool: { id: string, name: string, input: object }) => {})

- **When:** After the tool's input JSON is fully streamed and parsed
- **Frequency:** Zero to many per turn
- **Note:** Input is the parsed JSON object, not a string
- **Also available as:** `result.toolCalls[]`

## `tool_result`

The result returned from a tool execution.

turn.on('tool_result', (result: { toolUseId: string, content: any }) => {})

- **When:** After the CLI processes a tool result
- **Frequency:** One per tool_use (paired by toolUseId)

## `permission`

The CLI is asking for permission to use a tool.

turn.on('permission', (request: { id: string, toolName: string, input: object }, respond: (decision: 'allow' | 'deny') => void) => {})

- **When:** Only in `permissions: 'prompt'` mode
- **Frequency:** Zero to many per turn
- **Action required:** Call `respond()` or the process will hang (5m timeout)

## `activity`

Status line from stderr (tool execution progress, file operations, etc.)

turn.on('activity', (line: string) => {})

- **When:** The CLI writes meaningful content to stderr
- **Frequency:** Many times per turn
- **Filtering:** ANSI codes stripped, progress bars/spinners filtered out

## `compaction`

The CLI compacted its context window.

turn.on('compaction', (summary: string) => {})

- **When:** Context is auto-compacted mid-turn
- **Frequency:** Zero or one per turn (rare)
- **Note:** Internal streaming state is automatically reset

## `error`

An error event from the CLI (not a process crash — that's a non-zero exitCode on `done`).

turn.on('error', (err: { message: string, code?: string }) => {})

- **When:** The CLI reports an error mid-turn
- **Frequency:** Zero to many

## `done`

The turn is complete. The process has exited.

turn.on('done', (result: TurnResult) => {})

- **When:** Always fires exactly once, after the process exits
- **Guaranteed:** Even on crashes, kills, and errors
- **Payload:**

interface TurnResult {
  text: string;           // Full assembled text
  thinking: string;       // Full assembled thinking
  toolCalls: ToolCall[];  // All tool calls
  sessionId: string | null;
  cost: number | null;    // USD cost if reported
  exitCode: number;
  duration: number;       // ms from send() to done
}
```
