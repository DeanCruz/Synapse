Build a structured context budget tracking system for Synapse that estimates token usage per prompt section, prevents bloated worker prompts, and adds convention relevance filtering. This is a planning-time improvement — it helps the master agent produce leaner, more focused worker prompts.

The target project is Synapse itself at `/Users/dean/Desktop/Working/Repos/Synapse`. All file paths below are relative to that root.

---

TASK 1 — Create token estimation utility

Create a new file: `agent/utils/token_estimate.js`

This is a simple planning-time budget tool, not a billing calculator. It does NOT need to be precise — it provides rough estimates so the master agent can identify bloated prompt sections before dispatch.

The file must export three functions:

```javascript
/**
 * Estimate token count for a string.
 * Heuristic: ~4 chars/token for English prose, ~3 chars/token for code.
 * @param {string} text - The text to estimate
 * @param {'prose'|'code'|'mixed'} type - Content type (default: 'mixed')
 * @returns {number} Estimated token count
 */
function estimateTokens(text, type = 'mixed') { ... }

/**
 * Format a budget breakdown as a markdown table.
 * @param {Object<string, {text: string, type?: string}>} sections
 *   Keys are section names, values have the text content and optional type.
 * @returns {string} Markdown table: Section | Est. Tokens | % of Budget
 */
function formatBudget(sections, budgetLimit = 8000) { ... }

/**
 * Check if total estimated tokens exceed the budget.
 * @param {Object<string, {text: string, type?: string}>} sections
 * @param {number} budgetLimit - Token budget (default 8000)
 * @returns {{total: number, overBudget: boolean, sections: Object<string, number>}}
 */
function checkBudget(sections, budgetLimit = 8000) { ... }
```

Implementation details:
- `estimateTokens`: For `prose`, divide char count by 4. For `code`, divide by 3. For `mixed`, divide by 3.5. Round up.
- `formatBudget`: Return a markdown table with columns: Section, Est. Tokens, % of Budget, and a total row. Flag any section exceeding 40% of the budget with a `[!]` marker. If total exceeds budget, add a warning line below the table.
- `checkBudget`: Return a summary object with per-section token counts and whether the total exceeds the limit.
- Use `module.exports` (CommonJS) since Synapse's server-side code uses require().
- Zero dependencies. Pure functions only.
- Add a JSDoc header at the top of the file explaining purpose: "Planning-time token budget estimator for master agent worker prompts."

Read `src/server/utils/constants.js` and `src/server/utils/json.js` for code style conventions (CommonJS, JSDoc comments, named exports).

---

TASK 2 — Add context budget tracking to p_track.md planning phase

File: `_commands/Synapse/p_track.md`

Read the full file first. The planning phase is "Phase 1: Planning" with Steps 1 through ~16. Worker prompt construction happens in Step 14 (or the step titled "Construct agent prompts" / "Write dispatch prompts").

Add a new step immediately after the worker prompt construction step, titled "Context Budget Check". Content:

After constructing each worker's dispatch prompt, the master should mentally (or explicitly) estimate the token budget of the prompt by breaking it into sections:

| Section | Description | Typical range |
|---|---|---|
| Task description | What the worker must do | 200-500 tokens |
| File context | Code snippets the worker needs to see | 500-2000 tokens |
| Conventions | Extracted CLAUDE.md sections | 300-800 tokens |
| Upstream results | Summaries from completed dependency tasks | 200-600 tokens |
| Critical details | Edge cases, gotchas, constraints | 200-400 tokens |
| Instructions | Worker protocol, progress file path, return format | 400-600 tokens |

**Budget limit: 8000 tokens (~32KB of text).** If a worker prompt exceeds this estimate:

1. **Split the task** — If the prompt is large because the task touches too many files, decompose it into smaller tasks.
2. **Summarize conventions** — Instead of quoting full CLAUDE.md sections, extract only the 3-5 most relevant rules as bullet points.
3. **Trim reference code** — Include only the specific functions/types the worker needs, not entire files. Use line ranges.
4. **Condense upstream results** — One-line summaries per completed task, not full progress file contents.

Add a callout box:

> **Prompt bloat is the #1 cause of worker context exhaustion.** A worker that receives a 15,000-token prompt has already consumed 15% of its context window before writing a single line of code. Keep prompts lean — every token should earn its place.

This is guidance for the master agent, not a hard enforcement mechanism. The master should develop an intuition for prompt size and err on the side of leaner prompts.

---

TASK 3 — Add convention relevance filtering to p_track.md

File: `_commands/Synapse/p_track.md`

In the same step where conventions are injected into worker prompts (Step 14 or equivalent — the step that extracts sections from `{project_root}/CLAUDE.md`), add a "Convention Relevance Checklist" subsection:

Before extracting CLAUDE.md content for a worker prompt, assess which convention categories are relevant to THIS specific task:

| Category | Include when... | Skip when... |
|---|---|---|
| Naming conventions | Task creates new files, functions, variables, or types | Task only modifies existing code |
| File structure / organization | Task creates new files or moves files | Task modifies existing files in-place |
| Import conventions | Task adds new imports or creates new modules | Task doesn't touch imports |
| Testing patterns | Task involves writing or modifying tests | Task has no test component |
| Error handling | Task involves error paths, try/catch, or validation | Task is purely additive/cosmetic |
| API conventions | Task creates or modifies API endpoints | Task doesn't touch APIs |
| Styling conventions | Task involves UI/CSS/component styling | Task is backend-only |
| Git conventions | Never — workers don't commit | Always skip |

**Rules:**
1. Only extract CLAUDE.md sections that match checked categories above
2. If the project CLAUDE.md exceeds 500 lines, ALWAYS summarize rather than quote — extract the 5-10 most relevant rules as bullet points
3. Cap convention content at ~200 lines in the worker prompt
4. If no categories apply (rare), include a 3-line summary of the project's tech stack and primary patterns

This filtering should be applied per-worker, not globally — different tasks need different convention subsets.

Read the current p_track.md Step 14 (or equivalent prompt construction step) to understand where conventions are currently injected, then add this checklist as a subsection within that step.

---

TASK 4 — Add prompt size metrics to worker progress files

Files:
- `agent/instructions/tracker_worker_instructions.md` — Add optional `prompt_size` field to the progress file schema
- `agent/instructions/tracker_master_instructions.md` — Add `prompt_size` to the progress file field reference

In `tracker_worker_instructions.md`:

1. In the "Progress File Schema" section (the JSON example near the top), add an optional field after `"logs"`:
   ```json
   "prompt_size": {
     "total_chars": 12500,
     "estimated_tokens": 3571
   }
   ```

2. In the "Field Definitions" table, add a row:
   | `prompt_size` | object \| null | Optional. Size metrics of the dispatch prompt received. |

3. In the "When You MUST Write" section, under "1. Before starting work", add: "Optionally, measure the size of your dispatch prompt and include it as `prompt_size` in your initial write. This helps the master agent calibrate future prompt budgets."

4. Add a brief note explaining how to measure: "To calculate prompt size, count the total characters of your full dispatch prompt (everything the master sent you). Estimate tokens as `Math.ceil(totalChars / 3.5)`. This is approximate — precision is not required."

In `tracker_master_instructions.md`:

1. In the "Progress file fields" table (the reference cheat sheet near the bottom), add a row:
   | `prompt_size` | object \| null | Optional | Worker-reported size of the dispatch prompt. `total_chars` and `estimated_tokens`. |

2. In the "Common Mistakes" table, do NOT add anything — this is an optional field and omitting it is not a mistake.

Read both files in full before editing. The schema section in tracker_worker_instructions.md is near lines 33-55. The field reference in tracker_master_instructions.md is near lines 630-644.

---

TASK 5 — Update CLAUDE.md context efficiency section

File: `CLAUDE.md`

In the "Context Efficiency Principles" section (under "Project Discovery and Context Gathering"), add two new numbered principles at the end of the existing list:

9. **Budget worker prompts.** Each worker prompt should target ~8000 tokens or less. Break down the prompt into sections (description, context, conventions, upstream results, instructions) and estimate each. If total exceeds the budget, split the task or summarize conventions. Bloated prompts are the primary cause of worker context exhaustion.

10. **Filter conventions by relevance.** When injecting project CLAUDE.md content into worker prompts, include only the convention categories that apply to the specific task. A worker creating a backend utility function does not need frontend styling conventions. For large CLAUDE.md files (500+ lines), always summarize rather than quote.

Read the existing CLAUDE.md context efficiency section before editing. It currently has 8 numbered principles (items 1-8). Add items 9 and 10 after item 8, maintaining the same formatting style.

---

SUCCESS CRITERIA:

1. `agent/utils/token_estimate.js` exists with three exported functions: `estimateTokens`, `formatBudget`, `checkBudget` — all pure functions, zero dependencies, CommonJS exports
2. `_commands/Synapse/p_track.md` has a "Context Budget Check" step with the budget table, 8000-token limit, and bloat mitigation strategies
3. `_commands/Synapse/p_track.md` has a "Convention Relevance Checklist" in the prompt construction step with the category/include/skip table
4. `agent/instructions/tracker_worker_instructions.md` has the optional `prompt_size` field in the schema, field definitions, and measurement instructions
5. `agent/instructions/tracker_master_instructions.md` has `prompt_size` in the progress file field reference table
6. `CLAUDE.md` has two new context efficiency principles (items 9-10) about prompt budgeting and convention filtering
7. All edits are additive — no existing content is removed or broken
8. The token estimation utility uses the same code style as other Synapse server utilities (CommonJS, JSDoc, named exports)