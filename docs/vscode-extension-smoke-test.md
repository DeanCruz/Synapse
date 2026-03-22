# Synapse VS Code Extension - Smoke Test Checklist

Manual validation checklist for the Synapse VS Code extension. Run through these steps after building the extension or before publishing a new VSIX.

## Prerequisites

1. Build the extension TypeScript:
   ```bash
   npm run build:extension
   ```
2. Build the webview React app:
   ```bash
   npm run build:webview
   ```
3. Open the project in VS Code and launch via **Run and Debug > Run Extension** (F5), or install a packaged VSIX.

---

## 1. Extension Activation and Output Channel

- [ ] Extension activates on startup (check for `[Synapse] Extension activated.` in the Output panel)
- [ ] Run command **Synapse: Show Extension Log** (`Ctrl+Shift+P` / `Cmd+Shift+P` > type "Synapse: Show Extension Log")
- [ ] Output channel named "Synapse" appears and shows initialization messages:
  - `Extension activated.`
  - `Initializing services and command routing.`
  - `Core services initialized: orchestrator, watcher bridge, CLI runners.`
  - `Swarm commands registered: pTrack, p, status, logs, inspect, retry.`
  - `Sidebar view provider registered: synapse.swarmSidebar`
  - `Extension fully activated with swarm orchestration support.`

## 2. Sidebar View in Activity Bar

- [ ] Synapse icon appears in the VS Code Activity Bar (left sidebar)
- [ ] Clicking the Synapse icon opens the **Swarm Control** sidebar panel
- [ ] Sidebar renders without errors (no blank panel or error messages)
- [ ] Sidebar shows dashboard stats summary (or empty state if no swarm is active)
- [ ] Sidebar includes an inspect button for task detail navigation

## 3. Dashboard Webview

- [ ] Run command **Synapse: Open Dashboard** (`Cmd+Shift+P` > "Synapse: Open Dashboard")
- [ ] Dashboard webview panel opens in the editor area (or output channel shows with info message)
- [ ] If webview renders: header, sidebar navigation, stats bar, and empty state are all visible
- [ ] No console errors in the webview Developer Tools (`Cmd+Shift+I` in the webview panel, or Help > Toggle Developer Tools)

## 4. Swarm Commands

Test each command is accessible and responds correctly:

### 4a. Tracked Swarm (`synapse.pTrack`)
- [ ] Run **Synapse: Tracked Swarm (!p_track)** from the Command Palette
- [ ] Input box appears prompting for a task description
- [ ] Entering a prompt and pressing Enter shows a confirmation message (or an appropriate error if no workspace folder is open)
- [ ] Pressing Escape cancels cleanly (no error, log shows "cancelled")

### 4b. Parallel Swarm (`synapse.p`)
- [ ] Run **Synapse: Parallel Swarm (!p)** from the Command Palette
- [ ] Input box appears prompting for a task description
- [ ] Behavior matches pTrack (confirmation or error)

### 4c. Show Status (`synapse.status`)
- [ ] Run **Synapse: Show Status** from the Command Palette
- [ ] If no active swarms: information message "No active swarms" appears
- [ ] If swarms are active: QuickPick list shows dashboard IDs with state, dispatched/completed/failed counts

### 4d. Show Logs (`synapse.logs`)
- [ ] Run **Synapse: Show Logs** from the Command Palette
- [ ] If no active swarm: information message "No active swarm" appears
- [ ] If logs exist: QuickPick list shows recent entries with level icons (info/warn/error/deviation)

### 4e. Inspect Task (`synapse.inspect`)
- [ ] Run **Synapse: Inspect Task** from the Command Palette
- [ ] If no active swarm: information message appears
- [ ] If tasks exist: QuickPick shows all tasks with status icons, selecting one opens a detailed output channel

### 4f. Retry Task (`synapse.retry`)
- [ ] Run **Synapse: Retry Task** from the Command Palette
- [ ] If no active swarm: information message appears
- [ ] If failed tasks exist: QuickPick shows only failed tasks, selecting one triggers retry

## 5. Live Progress Updates in Dashboard

This test requires a running swarm (real or simulated via manually writing progress files).

### Setup (simulated)
Write a test progress file to simulate a running agent:
```bash
mkdir -p dashboards/dashboard1/progress
cat > dashboards/dashboard1/progress/1.1.json << 'EOF'
{
  "task_id": "1.1",
  "status": "in_progress",
  "started_at": "2026-01-01T00:00:00Z",
  "completed_at": null,
  "summary": null,
  "assigned_agent": "Agent 1",
  "stage": "implementing",
  "message": "Test progress update",
  "milestones": [],
  "deviations": [],
  "logs": [{"at": "2026-01-01T00:00:00Z", "level": "info", "msg": "Test log"}]
}
EOF
```

### Validation
- [ ] Sidebar reflects the progress update (agent card shows "implementing" stage)
- [ ] Dashboard webview (if open) shows the agent card with live status
- [ ] Modifying the progress file triggers a real-time update (within ~1 second)
- [ ] Agent detail modal shows milestones and log entries when clicked

## 6. Chat Panel Integration

- [ ] Click the **Agent** button in the dashboard action bar
- [ ] Claude/Agent chat floating panel opens
- [ ] Panel has minimize, maximize, and close controls
- [ ] Panel shows provider label (Claude Code or Codex)
- [ ] Closing the panel returns to the dashboard view
- [ ] Minimized state shows a pill button that can restore the panel

## 7. Multi-Dashboard Switching

- [ ] Sidebar shows dashboard list (dashboard1 through dashboard5)
- [ ] Clicking a different dashboard switches the active view
- [ ] Each dashboard shows its own independent state (initialization, progress, logs)
- [ ] Dashboard switching notifies the extension host (check output channel for any switch-related messages)

## 8. VSIX Packaging

- [ ] Run `npm run package:extension` from the terminal
- [ ] Script completes without errors
- [ ] A `.vsix` file is produced in the project root
- [ ] Install the VSIX in a separate VS Code instance:
  ```bash
  code --install-extension synapse-*.vsix
  ```
- [ ] Extension activates correctly in the installed instance
- [ ] Repeat steps 1-4 in the installed instance to verify basic functionality

---

## Build Verification Summary

These automated checks should all pass before manual testing:

| Check | Command | Expected Result |
|-------|---------|-----------------|
| TypeScript compilation | `npm run build:extension` | Zero errors |
| Webview build | `npm run build:webview` | Clean build to dist/webview/ |
| Type checking | `npx tsc -p src/extension/tsconfig.json --noEmit` | Zero errors |
| Manifest fields | See package.json | publisher, engines.vscode, main, activationEvents, contributes all present |
| Command count | package.json contributes.commands | 8 commands declared |
| Activation events | package.json activationEvents | 4 events (onStartupFinished, onView, 2x onCommand) |
| Icon present | synapse-logo.svg at root | File exists |
| .vscodeignore | .vscodeignore at root | Excludes src/, node_modules/, includes dist/ |

---

## Troubleshooting

**Extension does not activate:**
- Check the "Synapse" output channel for error messages
- Verify `dist/extension/extension.js` exists (run `npm run build:extension`)
- Check `engines.vscode` in package.json matches your VS Code version (currently `^1.74.0`)

**Sidebar is blank:**
- Check the webview Developer Tools console for errors
- Verify `dist/webview/` contains the built assets (run `npm run build:webview`)
- Check that the `webviewOptions.retainContextWhenHidden` is set in the sidebar registration

**Commands not appearing:**
- Verify all 8 commands are listed in package.json under `contributes.commands`
- Check that `activationEvents` includes `onStartupFinished` for eager activation
- Reload the Extension Development Host window (`Ctrl+R` / `Cmd+R`)

**VSIX packaging fails:**
- Ensure both `dist/extension/extension.js` and `dist/webview/` exist
- Ensure `synapse-logo.svg` is at the project root
- Check that `@vscode/vsce` can be resolved (`npx @vscode/vsce --version`)
