# Chat System Architecture

## Overview

The Synapse Chat system provides an in-app interface for interacting with Claude (and Codex) agents directly from within the Electron desktop application. It supports multiple concurrent project-scoped conversations, persistent message history, streaming responses with tool call visualization, and a dashboard view for monitoring agent task progress.

## High-Level Architecture

```
+-------------------+     +--------------------+     +---------------------+
|   React UI Layer  |     |   Electron IPC     |     |   Backend Services  |
|                   |     |    (preload.js)     |     |                     |
| ChatPage.jsx      | <-> | electronAPI bridge  | <-> | ClaudeCodeService   |
| ChatSidebar.jsx   |     | ~26 push channels   |     | ConversationService |
| ChatInstanceView  |     | ~140 pull methods   |     | ipc-handlers.js     |
| ChatDashboardView |     +--------------------+     +---------------------+
| ClaudeView.jsx    |                                         |
+-------------------+                                         v
        ^                                           +---------------------+
        |                                           |   File System       |
        v                                           |                     |
+-------------------+                               | conversations/*.json|
| AppContext.jsx    |                               | Chat/chat{N}/       |
| (Global State)    |                               | dashboards/         |
+-------------------+                               |   chat-agent-XXXX/  |
                                                    +---------------------+
```

## Component Hierarchy

```
ChatPage
  +-- ChatSidebar (project list, view switching)
  +-- ChatTabBar (subtab navigation within a project)
  +-- ChatInstanceView (active chat, stays mounted)
  |     +-- ClaudeView (core chat interface)
  |           +-- ConversationMessage (per-message renderer)
  |                 +-- ThinkingBubble
  |                 +-- ToolCallBlock
  |                 +-- ActivityBlock
  |                 +-- MarkdownContent
  |                 +-- AskUserQuestionBlock
  |                 +-- TaskEventMessage
  |                 +-- CompactionMessage
  +-- ChatDashboardView (agent task lanes)
  +-- ChatMakePage (creation interface)
```

## Data Flow

### Sending a Message

1. User types in the textarea within `ClaudeView` and submits.
2. `ClaudeView` calls `api.getChatSystemPrompt(projectDir, dashboardId, additionalContextDirs)` to build the system prompt (includes CLAUDE.md files, response priority protocol, directory references).
3. `ClaudeView` calls `api.spawnWorker(opts)` which invokes `ClaudeCodeService.spawnWorker()` in the main process.
4. The CLI process is spawned with `--print --output-format stream-json --verbose` and the prompt is written to stdin.
5. The user message is added to AppContext state via a dispatch.

### Receiving Streaming Output

1. `ClaudeCodeService` reads stdout line-by-line (NDJSON format) and broadcasts each parsed event via `broadcastFn('worker-output', { pid, taskId, dashboardId, chunk, parsed })`.
2. The `worker-output` push event arrives at the renderer via the IPC bridge.
3. `ClaudeView`'s `useEffect` listener routes the event based on which dashboard/tab owns the task:
   - **Active tab**: Processed by `handleChunkRef.current` for live streaming (text accumulation, tool call blocks, thinking bubbles).
   - **Inactive tab (same dashboard)**: Routed to tab stash via `routeToTabStash()`.
   - **Inactive dashboard**: Buffered into stashed messages via `CLAUDE_STASH_APPEND_MSG` dispatches.
4. On process close, a `worker-complete` event fires, triggering `finishRef.current` which finalizes the conversation and auto-saves.

### Event Types in Stream

| Event Type | Handling |
|---|---|
| `system` (subtype: `init`) | Shows connected model info |
| `assistant` | Extracts text/tool_use/thinking content blocks |
| `content_block_start` | Begins streaming accumulation for a block |
| `content_block_delta` | Appends text/input_json deltas |
| `content_block_stop` | Finalizes the streaming block |
| `message_stop` | Resets streaming flags |
| `user` (tool_result) | Attaches results to their tool_call messages |
| `result` | Captures session_id for resume capability |
| `error` | Displays error in chat |
| `thread.started` | Captures Codex thread_id |

### Conversation Persistence

1. **Auto-save**: A debounced (500ms) effect in `ClaudeView` saves the current messages array to disk via `api.saveConversation()` on every message change.
2. **Session resume**: The CLI session_id is captured from `result` events and stored in `sessionMapRef`. On subsequent messages, `--resume {sessionId}` is passed to the CLI to continue the conversation natively.
3. **History browsing**: Users can open past conversations from a history panel that calls `api.listConversations(dashboardId, surface)`.

## Surfaces

The Chat system supports two independent surfaces that share the same `ClaudeView` component but maintain separate state:

| Surface | Context | Dashboard Resolution |
|---|---|---|
| `'chat'` | ChatInstanceView in the Chat page | Uses `chatAgentId` (e.g., `chat-agent-a1b2`) |
| `'code'` | ClaudeFloatingPanel in the Code page | Uses `currentDashboardId` (rejects `chat-agent-*` ids) |

Each surface has its own messages, processing state, tabs, and attachments in AppContext, preventing cross-contamination.

## Agent Identity

Each chat agent is identified by a unique 4-hex string (e.g., `a1b2`). This maps to:
- **Dashboard directory**: `dashboards/chat-agent-a1b2/` (logs, progress files)
- **Agent directory**: `Chat/chat{N}/agent{hex}/` (project.json metadata)
- **Context key**: `chat-agent-a1b2` (used for state keying throughout the UI)

## Project-Tab Architecture

The Chat page uses a two-level tab structure:

1. **Project Tabs** (shown in sidebar): Each represents a target project. Contains metadata like `projectPath` and an array of subtabs.
2. **Subtabs** (shown in the tab bar above the chat): Each is an independent Claude agent session within that project. Multiple agents can run simultaneously on the same project.

This allows users to have parallel conversations about the same codebase, each with its own session history and agent process.
