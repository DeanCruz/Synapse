# Conversation Persistence

## Overview

The Synapse Chat system persists conversations as individual JSON files in the `{tracker_root}/conversations/` directory. Each conversation maps to one file named `{id}.json`. Persistence is handled by `ConversationService.js` on the backend and auto-save logic in `ClaudeView.jsx` on the frontend.

## Storage Location

```
Synapse/
  conversations/
    conv_1714000000000.json
    conv_1714000001234.json
    ...
```

The directory path is defined in `src/server/utils/constants.js` as `CONVERSATIONS_DIR`.

## File Format

Each conversation file contains a single JSON object:

```json
{
  "id": "conv_1714000000000",
  "name": "Implement auth middleware",
  "created": "2026-04-25T10:00:00.000Z",
  "updated": "2026-04-25T10:15:30.000Z",
  "dashboardId": "chat-agent-a1b2",
  "surface": "chat",
  "sessionId": "sess_abc123...",
  "sessionProvider": "claude",
  "messages": [
    { "id": "msg-1", "type": "user", "text": "Add JWT auth middleware" },
    { "id": "msg-2", "type": "system", "text": "Connected -- model: claude-opus-4-6, 15 tools available" },
    { "id": "msg-3", "type": "thinking", "text": "Let me analyze the project structure..." },
    { "id": "msg-4", "type": "tool_call", "block": { "id": "tu_1", "name": "Read", "input": { "file_path": "/project/src/index.js" }, "_result": "..." } },
    { "id": "msg-5", "type": "assistant", "text": "I've read the entry point. Here's the implementation plan..." }
  ]
}
```

### Field Descriptions

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | Yes | Unique identifier (`conv_` + timestamp) |
| `name` | string | Yes | Display name (auto-derived from first user message, truncated to 50 chars) |
| `created` | string | Yes | ISO 8601 creation timestamp |
| `updated` | string | Yes | ISO 8601 last-modified timestamp (auto-set on save) |
| `dashboardId` | string | No | The dashboard/agent this conversation belongs to |
| `surface` | string | No | `'chat'` or `'code'` — which UI surface created it |
| `sessionId` | string | No | Claude CLI session ID (for resume) |
| `sessionProvider` | string | No | `'claude'` or `'codex'` |
| `messages` | array | Yes | Ordered array of message objects |

### Message Types

| Type | Fields | Description |
|---|---|---|
| `user` | `text`, `attachments?` | User-submitted message |
| `assistant` | `text` | Claude's text response |
| `thinking` | `text` | Extended thinking content |
| `tool_call` | `block: { id, name, input, _result?, _streaming? }` | Tool invocation |
| `system` | `text`, `isError?`, `isTaskEvent?`, `taskEventData?`, `isCompaction?`, `compactionSummary?` | System messages |
| `activity` | `lines: string[]` | Batched stderr activity |
| `tool_result_standalone` | `content` | Orphaned tool result |

## Auto-Save Mechanism

`ClaudeView` implements continuous auto-saving via a debounced `useEffect`:

```
messages change -> wait 500ms -> saveConversation()
```

**Trigger conditions:**
- At least one message beyond the welcome message exists
- At least one user message exists in the conversation
- The conversation has changed since last save

**Behavior:**
1. If no `convId` exists yet, generates one: `'conv_' + Date.now()`
2. Derives the conversation name from the first user message (first 50 chars + `...`)
3. Calls `api.saveConversation()` with the full messages array plus metadata

This ensures that:
- Partial responses are saved (even if the agent errors or is killed)
- Every user message is immediately persisted
- The conversation file is always up to date

## Session Resume

When a conversation is loaded from history or when a follow-up message is sent, the system uses the stored `sessionId` to resume the existing CLI session:

1. `sessionIdRef` holds the current session's CLI-native session ID
2. On spawn, if `sessionIdRef.current` is set, `--resume {sessionId}` is passed to the CLI
3. The session ID is captured from `result` events in the stream and stored in both the ref and the saved conversation

This provides continuity across app restarts and tab switches.

## Surface Filtering

Conversations are tagged with a `surface` field (`'chat'` or `'code'`):

- **Chat surface**: Conversations created from the Chat page's ClaudeView instances
- **Code surface**: Conversations created from the Code page's floating panel

When listing conversations:
- `surface='code'` includes legacy entries (no surface field) for backward compatibility
- `surface='chat'` excludes legacy entries
- No surface filter returns all entries matching the dashboardId

This prevents chat conversations from appearing in the code panel's history and vice versa.

## Per-Dashboard:Tab Isolation

Conversations are keyed by `dashboardId`, so each chat agent maintains its own independent history. The `sessionMapRef` in ClaudeView stores session state per `{dashboardId}:{tabId}` composite key, allowing:

- Multiple tabs within a project to have independent conversations
- Tab switches to preserve and restore session state
- Dashboard switches to preserve running workers and their output routing

## ConversationService API

The backend service (`electron/services/ConversationService.js`) provides:

| Method | Description |
|---|---|
| `listConversations(dashboardId?, surface?)` | List conversations with optional filters, sorted newest-first |
| `loadConversation(id)` | Load full conversation by ID |
| `saveConversation(data)` | Create or update a conversation (auto-sets `updated` timestamp) |
| `createConversation(name?)` | Create an empty named conversation |
| `deleteConversation(id)` | Remove a conversation file |
| `renameConversation(id, name)` | Rename an existing conversation |

All methods are synchronous filesystem operations using `fs.readFileSync`/`writeFileSync`. Errors are caught and returned as `{ error: message }` rather than thrown.

## Data Lifecycle

```
User sends message
  -> messages state updated (AppContext dispatch)
  -> auto-save timer starts (500ms debounce)
  -> agent starts streaming
  -> messages accumulate (assistant text, tool calls, results)
  -> auto-save fires periodically as messages change
  -> agent completes (result event with session_id)
  -> final auto-save persists complete conversation
  -> conversation appears in history panel on next open
```

## Cleanup

When a chat agent is deleted (via sidebar or tab close):
1. `api.deleteChatAgent(hex)` removes the dashboard and agent directories
2. **Conversation files are NOT automatically deleted** — they persist in `conversations/` for historical reference
3. The conversations become orphaned (their `dashboardId` no longer maps to an active agent) but remain accessible if the user navigates to the history panel without a dashboard filter
