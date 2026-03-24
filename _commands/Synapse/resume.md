# `!resume`

**Purpose:** Resume a chat session after the agent process was interrupted, crashed, or the connection was lost. Reviews the full conversation history, reconstructs context, and picks up where the agent left off.

> This is for **chat session resumption** — the agent reviews what it was doing and continues.
> For **swarm/dashboard resumption** (re-dispatching incomplete worker tasks), use `!track_resume` instead.

---

## Behavior

When `!resume` is invoked, follow these steps exactly:

### Step 1: Reconstruct Context from Conversation History

Review the **full conversation history** available in this session. Work backwards from the most recent messages to understand:

1. **What was the user's original request?** — Find the root task or instruction.
2. **What progress was made?** — Identify all completed steps, files modified, decisions made.
3. **Where did it stop?** — Determine the exact point of interruption. Look for:
   - The last tool call or action taken
   - Any in-progress work (partial edits, uncommitted changes)
   - Error messages or warnings before the interruption
4. **What was the plan?** — If the agent had outlined steps or a todo list, reconstruct it.

### Step 2: Gather Additional Context If Needed

If the conversation history is insufficient to understand the full picture:

1. **Check for todo lists or plans** — Look for any structured task tracking in the conversation.
2. **Read files that were being modified** — Check the current state of any files the agent was working on to see what was completed vs. what's still pending.
3. **Check git status** — Run `git status` and `git diff` in the project directory to see uncommitted changes that may represent in-progress work.
4. **Read earlier conversation history** — If the available history doesn't go back far enough, look at the conversation messages. Scan as far back as needed until you have a complete understanding of the task, the approach, and the progress.

### Step 3: Present a Status Summary

Before resuming work, present a brief summary to the user:

```
## Resuming Session

**Original task:** {one-line description of what the user asked for}

**Progress so far:**
- {completed step 1}
- {completed step 2}
- ...

**Interrupted at:** {what was happening when it stopped}

**Remaining work:**
- {next step to do}
- {subsequent steps}

Continuing now...
```

### Step 4: Resume Execution

Pick up exactly where the agent left off:

1. **If mid-edit:** Check the current file state and complete the edit.
2. **If mid-plan:** Continue with the next planned step.
3. **If the previous approach failed:** Analyze why and try an alternative approach.
4. **If work was completed but not verified:** Run any pending verification (tests, builds, etc.).

Continue working through all remaining steps until the original task is fully complete.

---

## Key Principles

- **Read before assuming** — Always check the actual current state of files and git. Don't assume the codebase matches what the conversation history describes. Another agent or the user may have made changes.
- **Don't redo completed work** — Skip steps that are already done. Verify by checking file contents, not by relying on conversation claims.
- **Preserve the original approach** — Unless the previous approach clearly failed, continue with the same strategy. Don't switch approaches unnecessarily.
- **Be thorough with context** — Read as far back in the history as needed. It's better to spend time understanding the full picture than to miss critical context and make mistakes.
