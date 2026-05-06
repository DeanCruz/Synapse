# Chat System Components

## Page-Level Components

### ChatPage (`src/ui/pages/chat/ChatPage.jsx`)

The top-level shell for the Chat mode. Composes the sidebar and content area, routing between views.

**Behavior:**
- Renders `ChatSidebar` for navigation
- Renders `ChatTabBar` for subtab switching
- Keeps `ChatInstanceView` always mounted (hidden when not active) to preserve agent processes and React state across view switches
- Routes to `ChatMakePage` or `ChatDashboardView` based on `chatActiveView` state

**State consumed:**
- `chatActiveView` — `'dashboard'` | `'make'` | `'chat-instance'`

### ChatTabBar (internal to ChatPage)

Horizontal tab strip showing subtabs within the active project tab.

**Props:** None (reads from AppContext)

**Behavior:**
- Shows one tab per subtab in the active project tab
- "+" button creates a new subtab (calls `api.createChatAgent()`, dispatches `CHAT_SUBTAB_CREATE`)
- Close button on each tab deletes the subtab (calls `api.deleteChatAgent()`, dispatches `CHAT_SUBTAB_DELETE`)
- Only rendered when `chatActiveView === 'chat-instance'` and subtabs exist

---

## Sidebar

### ChatSidebar (`src/ui/pages/chat/components/ChatSidebar.jsx`)

The left sidebar for the Chat page. Lists project tabs, provides navigation, and handles project creation.

**State consumed:**
- `chatActiveView`, `chatTabs`, `chatActiveTabId`
- `chatClaudeDashboardId`, `chatClaudeIsProcessing`, `chatClaudeProcessingStash` — for status indicators
- `unreadChatCounts` — for badge counts

**Features:**
- **Dashboard/Make buttons**: Switch to the dashboard or make view
- **New project button**: Opens `ProjectModal` to create a new project tab
- **Project tab list**: Shows each project with:
  - Status dot (idle/processing/unread)
  - Name (double-click to rename inline)
  - Chat count badge
  - Context menu (settings, rename, delete)
  - Unread message badge
- **Collapsible**: Sidebar can collapse to 52px width
- **Delete confirmation**: Popup dialog before deleting; cleans up all subtab agents
- **Settings footer**: Opens the global settings modal

**Key Actions:**
| Action | Dispatch Type | Side Effects |
|---|---|---|
| Create project | `CHAT_TAB_CREATE` | `api.createChatAgent()`, `saveDashboardProject()` |
| Switch tab | `CHAT_TAB_SWITCH` | — |
| Delete tab | `CHAT_TAB_DELETE` | `api.deleteChatAgent()` for each subtab |
| Rename tab | `CHAT_TAB_RENAME` | — |

---

## Content Views

### ChatInstanceView (`src/ui/pages/chat/components/ChatInstanceView.jsx`)

Thin wrapper that resolves the active agent ID and passes it to `ClaudeView`.

**Props:**
| Prop | Type | Default | Description |
|---|---|---|---|
| `tab` | string | `'chat'` | View context identifier |
| `surface` | string | `'chat'` | State surface (determines which AppContext slice to use) |

**Behavior:**
- Finds the active project tab, then its active subtab
- Derives `chatAgentId` as `'chat-agent-' + subtab.agentHex`
- Renders `<ClaudeView tab="chat" chatAgentId={id} surface="chat" />`

### ChatDashboardView (`src/ui/pages/chat/components/ChatDashboardView.jsx`)

Visual dashboard showing all chat-agent task pipelines. Displays agent progress as horizontal card lanes.

**State:** Local (`agentLanes`, `loading`, `selectedAgent`)

**Data source:** `api.getChatDashboardData()` — reads all `dashboards/chat-agent-*` directories

**Live updates:** Subscribes to `chat_dashboard_changed` push event

**Sub-components:**
- `AgentRow` — One horizontal lane per agent, showing task cards grouped by topological wave
- Uses `AgentCard` and `AgentDetails` from the code dashboard for consistent UI
- Draws SVG dependency lines between cards in multi-wave agents

**Key functions:**
- `shapeAgent(name, tasks)` — Derives aggregate status (pending/in_progress/completed/failed)
- `computeWavesForAgent(tasks)` — Groups tasks by longest-path topological level using BFS
- `taskToAgent(task)` — Maps progress task data to AgentCard-compatible format

---

## Core Chat Interface

### ClaudeView (`src/ui/shared/claude/ClaudeView.jsx`)

The primary chat component (~1600+ lines). Handles all streaming, message rendering, session management, and conversation persistence.

**Props:**
| Prop | Type | Default | Description |
|---|---|---|---|
| `onClose` | function | — | Close callback (floating panel mode) |
| `hideHeader` | boolean | — | Hide the header bar |
| `viewMode` | string | — | `'minimized'`/`'expanded'`/etc. |
| `tab` | string | `'code'` | Context: `'chat'` or `'code'` |
| `chatAgentId` | string | `null` | Agent context ID (chat surface only) |
| `surface` | string | `'code'` | State surface selector |

**State Management:**

ClaudeView uses `getClaudeSlice(state, surface)` to pull the correct slice of AppContext based on the surface. Each surface maintains independent:
- `messages` — Current conversation messages array
- `isProcessing` — Whether an agent is currently running
- `status` — Status string for display
- `tabs` — Per-dashboard tab configurations
- `activeTabId` — Which tab within the dashboard is active
- `pendingAttachments` — Files attached to next message

**Key Refs:**
| Ref | Purpose |
|---|---|
| `sessionIdRef` | CLI session ID for resume |
| `convIdRef` | Conversation persistence ID |
| `activeTaskIdsRef` | Set of currently running task IDs |
| `taskPidMapRef` | Maps taskId to process PID |
| `toolCallIndexRef` | Maps tool_use_id to message index |
| `currentTextIndexRef` | Index of the accumulating assistant text message |
| `streamingBlocksRef` | Accumulator for streaming content blocks |
| `sessionMapRef` | Per-dashboard:tab session state stash |
| `promptStashRef` | Per-dashboard:tab input text preservation |
| `allowedToolsRef` | Tools auto-approved for this session |

**Features:**
- Model selection (Claude Opus 4.7/4.6, Sonnet 4.6, Haiku 4.5; Codex GPT-5.x)
- Image/file attachments via drag-drop or file picker
- Conversation history browser (filtered by dashboard + surface)
- Session resume via CLI `--resume` flag
- Permission modal for tool approval/denial
- Smart auto-scroll with "new messages" indicator
- Auto-save on every message change (debounced 500ms)
- Multi-dashboard/multi-tab stashing (preserves running workers across switches)
- Quick access editor for system prompt customization

---

## Message Sub-Components

### ConversationMessage

Router component that renders the appropriate sub-component based on `msg.type`:

| Type | Rendered As |
|---|---|
| `'thinking'` | `ThinkingBubble` |
| `'user'` | User message bubble with copy button |
| `'assistant'` | Assistant bubble with markdown rendering |
| `'tool_call'` | `ToolCallBlock` or `AskUserQuestionBlock` |
| `'system'` | System message (or `TaskEventMessage`/`CompactionMessage`) |
| `'activity'` | `ActivityBlock` |
| `'tool_result_standalone'` | Orphaned tool result display |

### ThinkingBubble

Collapsible indicator for extended thinking blocks. Shows animated dots for the most recent thinking block, static for older ones.

### ToolCallBlock

Collapsible card showing a tool invocation. Header shows tool name + summary; body shows `ToolInputFormatted` with rich rendering per tool type (Read, Edit, Write, Bash, Grep, Glob, Task, WebFetch, WebSearch, TodoWrite, NotebookEdit). Displays result when available.

### ToolInputFormatted

Rich formatting for tool inputs. Examples:
- **Read**: File path (clickable) + line range
- **Edit**: File path + diff view (old/new with +/- markers)
- **Bash**: Command with `$` prompt + description
- **Grep**: Pattern + path + options

### AskUserQuestionBlock

Interactive card for `AskUserQuestion` tool_use events. Renders questions with selectable options (single or multi-select), a submit button, and sends the answers as a follow-up message.

### ActivityBlock

Collapsible block showing batched stderr activity (tool execution background work). Shows count when collapsed, full list when expanded.

### ProcessingIndicator

Animated dots shown at the bottom of conversation while the agent is running.

### CompactionMessage

Yellow banner indicating context was compacted. Expandable to show the compaction summary.

### MarkdownContent

Renders markdown with file-path linkification. If the entire text is a JSON document, renders a pretty-printed `JsonBlock` instead.

### CopyBubbleButton

Clipboard copy button shown on hover over message bubbles.

### TaskEventMessage

Expandable card for task lifecycle events (task_started, task_progress, task_completed, task_failed). Shows key fields like duration, tokens, tool uses.
