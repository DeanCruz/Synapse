# Common Pitfalls — Swarm Orchestration Reference

Common mistakes that cause swarm failures, broken output, or wasted context. Each row is a distinct pitfall not fully covered in other instruction files. Review before every swarm dispatch.

---

## Pitfall Reference

| Mistake | Effect | Fix |
|---|---|---|
| File overlap in waves — two agents modify the same file in parallel | Merge conflicts, overwritten work, or corrupted files. One agent's writes silently erase the other's. | Always check for file overlaps before dispatching. No two concurrent agents may modify the same file. Use shared file accumulation patterns (Pattern A/B/C) from the core principles. |
| Missing file paths in prompts — telling the worker *what* to change but not *where* | Workers waste context searching for files, guess wrong paths, or fail outright. They cannot find files you do not specify. | Always include full relative paths (from the project root) for every file the worker needs to read or modify. Never assume the worker knows the project layout. |
| Modifying `initialization.json` during execution | Dashboard derives stats from progress files; stale or conflicting data in `initialization.json` causes confusion, double-counting, or rendering errors. | `initialization.json` is write-once. The master writes it during planning and never touches it again. All lifecycle data flows through worker progress files. |
| Forgetting to clear `progress/` before a new swarm | Stale progress files from the previous swarm appear as ghost agents — completed cards from old tasks, wrong stats, phantom in-progress indicators. | Always run `rm -f {tracker_root}/dashboards/{dashboardId}/progress/*.json` before writing `initialization.json` for a new swarm. |
| Not including `CLAUDE.md` conventions in worker prompts | Workers produce non-standard code — wrong naming conventions, incorrect file structure, missing patterns, broken style. Requires rework or manual fixes. | Quote the relevant sections of each target repo's `CLAUDE.md` directly in the worker prompt. Do not paraphrase — include the exact conventions the worker must follow. |
| Dispatching before planning is approved by the user | Workers execute a plan the user hasn't reviewed. Wasted compute if the user rejects the approach, wrong scope, or missed requirements. | Always present the full plan on the dashboard and wait for explicit user approval before dispatching any agents. The plan review step is mandatory, not optional. |
| Large tasks that exhaust worker context | Workers reading 10+ files or modifying 5+ files run out of context window, produce truncated output, forget earlier instructions, or silently drop work. | Decompose further. A well-sized task reads 2-3 files and modifies 1-2 files. If a task touches more than 5 files, split it into smaller, focused subtasks. |
| Not caching upstream results in downstream prompts | After context compaction, upstream task results are lost. Downstream workers operate on stale planning assumptions instead of actual outputs. | When dispatching downstream tasks, include the upstream task's summary, files changed, new exports, and any deviations. Reconstruct from XML summaries if context was compacted. |
