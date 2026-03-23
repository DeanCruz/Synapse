# Worker Guide — Reading Upstream Dependency Results

**Who this is for:** Worker agents dispatched during a `!p_track` swarm whose tasks have upstream dependencies. This document is your complete reference for reading, interpreting, and adapting to upstream task results before you begin your own implementation.

---

## Reading Upstream Results — NON-NEGOTIABLE for Dependent Tasks

If your task has upstream dependencies (listed in your dispatch prompt), you **MUST read the progress files of every upstream dependency** before starting implementation. This is not optional — the master's dispatch prompt may contain a summary, but the progress files contain the **ground truth**: what actually happened, what deviated, what failed, and what the upstream worker logged.

---

## Step 1: Read Upstream Progress Files

For each dependency task ID listed in your dispatch prompt, read:

```
{tracker_root}/dashboards/{dashboardId}/progress/{dependency_task_id}.json
```

For example, if your task depends on `1.1` and `1.3`, read both:
- `{tracker_root}/dashboards/{dashboardId}/progress/1.1.json`
- `{tracker_root}/dashboards/{dashboardId}/progress/1.3.json`

**Read these files in parallel** — they have no dependency on each other.

---

## Step 2: Extract Critical Information

From each upstream progress file, extract:

| Field | What to look for |
|---|---|
| **`status`** | Did it complete successfully or fail? If `"failed"`, assess whether your task can still proceed. |
| **`summary`** | What the upstream task accomplished — the definitive one-line result. |
| **`deviations[]`** | Every plan divergence. Pay special attention to `CRITICAL` severity — these may change your assumptions about interfaces, file locations, or APIs. |
| **`milestones[]`** | What was actually built, in order. Cross-reference with what your dispatch prompt expects to exist. |
| **`logs[]`** | The full narrative of what happened. Scan for `"error"` and `"warn"` level entries — these reveal issues that may affect your work. |
| **`message`** | Final state message — useful for understanding the last thing the upstream worker did. |

---

## Step 3: Adapt Your Approach

- **If an upstream task failed:** Log a `"warn"` entry explaining which dependency failed and how you're proceeding. If the failure means a file or API you need doesn't exist, attempt to work around it or set your own status to `"failed"` with a clear explanation.

- **If an upstream task has `CRITICAL` deviations:** The upstream worker changed something your dispatch prompt assumed would be a certain way. Adapt your implementation to match what was *actually* built, not what was *planned*. Log every adaptation as a deviation in your own progress file.

- **If an upstream task has `MODERATE` deviations:** Note them but they likely don't affect your work. Log that you reviewed them.

- **If an upstream task's logs contain `"error"` entries:** Even if the task completed, errors may indicate partial issues. Review them to ensure nothing impacts your work.

---

## Step 4: Log What You Learned

After reading upstream progress files, add a log entry summarizing what you found:

```json
{ "at": "...", "level": "info", "msg": "Read upstream dependencies: 1.1 (completed, no deviations), 1.3 (completed, 1 MODERATE deviation — used alternative API pattern)" }
```

If any upstream deviation requires you to adapt, log it immediately:

```json
{ "at": "...", "level": "deviation", "msg": "Adapting to upstream 1.3 deviation: using fetchUsers() instead of planned getUsers() — upstream changed the export name" }
```

---

## Why This Matters

The master agent writes dispatch prompts during the **planning phase** — before any work is done. By the time your task runs, upstream workers may have deviated from the plan, encountered errors, used different file names, or changed interfaces. If you only rely on the master's dispatch prompt, you're working from a stale snapshot. Reading the progress files gives you the **actual state of the world** as left by the workers before you.
