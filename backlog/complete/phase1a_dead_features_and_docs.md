Clean up documentation-reality drift across Synapse's instruction files and command specs. The target project is Synapse itself at {tracker_root} = /Users/dean/Desktop/Working/Repos/Synapse (also {project_root} for this swarm, since we are working on Synapse's own codebase).

This swarm addresses four specific documentation-reality mismatches that cause confusion for agents reading Synapse's instructions. Each task has clear scope and verifiable success criteria.

---

TASK 1: Remove all references to `.synapse/context_cache.json`

Both `CLAUDE.md` and `AGENTS.md` reference `.synapse/context_cache.json` as "Key facts discovered during swarms, persisted across sessions." This file is a dead feature — no command in `_commands/Synapse/`, `_commands/project/`, or any agent instruction file ever creates, reads, writes, or references `context_cache.json`. It exists only in documentation tables and directory trees.

Files to audit and modify:
- `/Users/dean/Desktop/Working/Repos/Synapse/CLAUDE.md` — Remove from the "Project `.synapse/` Directory" table (lines ~207-208) AND from the "Target project structure" directory tree (lines ~603-604). Both locations reference it.
- `/Users/dean/Desktop/Working/Repos/Synapse/AGENTS.md` — Remove from the identical "Project `.synapse/` Directory" table (lines ~195-196) AND from the directory tree (lines ~584-585).

Do NOT remove the `.synapse/` directory itself or any other files listed there — only remove `context_cache.json` entries. Verify the tables and directory trees still render correctly (no trailing pipes, no blank rows, no orphaned comments) after removal.

Success criteria: Zero mentions of `context_cache.json` anywhere in the repository. Grep for `context_cache` returns no results.

---

TASK 2: Fix the `profile.json` vs `config.json` discrepancy in `.synapse/` documentation

`CLAUDE.md` (lines ~207, ~603) and `AGENTS.md` (lines ~195, ~584) both document `.synapse/profile.json` as "Auto-generated project profile (tech stack, key directories, git info)." However, the actual `!initialize` command at `_commands/project/initialize.md` creates `.synapse/config.json` instead — with a different schema containing `project_name`, `project_root`, `tracker_root`, `tech_stack`, `initialized_at`, and `toc_path`.

The correct fix is: update `CLAUDE.md` and `AGENTS.md` to reference `config.json` instead of `profile.json`, and update the description to match what `initialize.md` actually creates. The description should be: "Project-Synapse configuration (project name, paths, tech stack, initialization timestamp)."

Files to modify:
- `/Users/dean/Desktop/Working/Repos/Synapse/CLAUDE.md` — Update the `.synapse/` table entry and directory tree to show `config.json` with the corrected description.
- `/Users/dean/Desktop/Working/Repos/Synapse/AGENTS.md` — Same changes as CLAUDE.md.

Do NOT modify `_commands/project/initialize.md` — it is already correct. The docs must match the implementation, not the other way around.

Success criteria: Both `CLAUDE.md` and `AGENTS.md` reference `config.json` (not `profile.json`) with an accurate description. The description matches what `initialize.md` actually writes. Grep for `profile.json` in CLAUDE.md and AGENTS.md returns zero results.

---

TASK 3: Unify repair vs retry documentation with a decision tree

Two files provide overlapping but inconsistent guidance on handling failed tasks:

- `_commands/Synapse/retry.md` — The `!retry` command spec. Focuses on re-dispatching a failed task with root cause analysis and remediation guidance injected into the retry prompt. Steps 9-11 describe analyzing the failure and enriching the retry prompt.
- `agent/instructions/failed_task.md` — The "Repair Worker" protocol. Describes a diagnostic-first approach where the repair worker reads the previous failure's progress file, diagnoses root cause, plans the fix, then implements. Includes a "Major Deviation Gate" for cases requiring user input.

The problem: there is no clear guidance on WHEN to use `!retry` (simple re-dispatch with enhanced prompt) vs WHEN to use a repair task (diagnostic-first approach with the full failed_task.md protocol). An agent encountering a failure doesn't know which path to take.

Fix: Add a decision tree to `agent/instructions/failed_task.md` at the top of the file (after the overview paragraph, before "Your Mission" section) that clearly delineates the two approaches:

```
## When to Use Retry vs Repair

| Scenario | Approach | Command/Protocol |
|---|---|---|
| Transient failure (timeout, flaky test, network error) | Simple retry | `!retry {id}` — re-dispatch with same approach + failure context |
| Clear, fixable root cause (wrong path, missing import, typo) | Retry with guidance | `!retry {id}` — master adds specific remediation to prompt |
| Unknown root cause or complex failure | Repair task | Dispatch with `failed_task.md` protocol — worker diagnoses first |
| Previous worker left partial/broken state | Repair task | Needs cleanup phase before re-implementation |
| Failure affects downstream task contracts | Repair task | Needs Major Deviation Gate assessment |

**Decision flow:**
1. Can you identify the exact root cause from the failure logs?
   - YES and it's a simple fix -> `!retry` with remediation guidance
   - YES but it requires cleanup of partial work -> Repair task
   - NO -> Repair task (worker will diagnose)
2. Did the previous worker write partial files that need cleanup?
   - YES -> Repair task (cleanup phase required)
   - NO -> Either approach works; prefer `!retry` for speed
3. Does the fix potentially change the task's output contract (interfaces, exports, file structure)?
   - YES -> Repair task (Major Deviation Gate applies)
   - NO -> `!retry` is safe
```

Also add a one-line cross-reference at the bottom of `_commands/Synapse/retry.md` (after step 13): "For complex failures requiring diagnostic-first approach, dispatch a repair worker using the protocol at `{tracker_root}/agent/instructions/failed_task.md` instead of `!retry`."

Files to modify:
- `/Users/dean/Desktop/Working/Repos/Synapse/agent/instructions/failed_task.md` — Add the decision tree section after the opening paragraph.
- `/Users/dean/Desktop/Working/Repos/Synapse/_commands/Synapse/retry.md` — Add cross-reference line at the end.

Success criteria: An agent reading either file can determine which approach to use without consulting the other file. The decision tree covers all common failure scenarios. No contradictions between the two files.

---

TASK 4: Audit all `.synapse/` file references across documentation and commands

After Tasks 1-3 complete, perform a comprehensive audit of every `.synapse/` file reference across the entire Synapse repository. This is a verification and cleanup task.

Scope: Every `.md` file in the repository that references `.synapse/` — this includes at minimum:
- `CLAUDE.md`, `AGENTS.md`, `README.md`
- All files in `_commands/Synapse/` (especially `p_track.md`, `p.md`, `master_plan_track.md`, `resume.md`, `guide.md`, `project.md`)
- All files in `_commands/project/` (especially `initialize.md`, `onboard.md`, `health.md`, `toc.md`, `toc_generate.md`, `toc_update.md`, `context.md`, `scope.md`, `plan.md`)
- All files in `agent/instructions/`
- All files in `skills/` subdirectories

For each `.synapse/` file reference found, verify:
1. The referenced file is actually created by at least one command (check `_commands/project/initialize.md`, `_commands/project/toc_generate.md`, etc.)
2. The description matches what the creating command actually writes
3. No file is referenced that was removed in Tasks 1-2

Compile a report listing:
- Every `.synapse/` file referenced and which documents reference it
- Whether each file has a creating command (and which command)
- Any remaining dead references discovered beyond Tasks 1-2

If any additional dead references are found, fix them in the same pass. If all references are now consistent, confirm that in the report summary.

Files to read: All `.md` files that reference `.synapse/` (use grep to find them)
Files to potentially modify: Any file containing a dead `.synapse/` reference discovered during audit

Success criteria: Every `.synapse/` file mentioned in any documentation has a corresponding command that creates it. Every description matches the actual file contents/schema. Zero orphaned or dead references remain. A verification report is included in the task summary.
