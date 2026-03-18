# Multi-Repository Operations

## Cross-Repo Context Gathering

Many tasks span multiple repositories (e.g., a frontend change that requires a backend API update). The master agent's primary advantage is the ability to read and coordinate across repo boundaries.

**Workflow for cross-repo tasks:**

1. **Read `TableOfContentsMaster.md`** if the task spans repos or the relevant files aren't obvious — otherwise use Glob/Grep
2. **Read the CLAUDE.md** of every repo you will touch
3. **Gather context from all repos in parallel** — read relevant files across repos simultaneously, not sequentially
4. **Identify cross-repo dependencies** — what must change in repo A before repo B can be updated?
5. **Plan the work** with explicit dependency ordering across repos
6. **Execute** — either directly or by dispatching agents with full cross-repo context

## Cross-Repo Agent Dispatch

When dispatching agents for cross-repo work:

- Each agent's prompt must include the relevant context from **all** repos it needs to understand, not just the one it's modifying
- Agents modifying different repos can run in parallel (no file conflicts)
- Agents modifying the same repo must have non-overlapping file scopes or be sequenced via dependencies
- Include relevant excerpts from each repo's `CLAUDE.md` in the agent's prompt so it follows repo-specific conventions

## Shared Types and Interfaces

When repos share types, schemas, or interfaces (e.g., API contracts between frontend and backend):

- Identify the **source of truth** for each shared definition
- When modifying a shared interface, trace all consumers across repos via Grep or the TableOfContentsMaster
- Update all consumers in the same task or mark them as dependent tasks

---

## Context Efficiency

The master agent's most critical skill is **context efficiency** — gathering exactly the right information with minimal reads, and preserving context window space for reasoning and execution.

### Principles

1. **Glob/Grep first for targeted searches.** They cost zero context tokens and are always current. Use them before reaching for the TableOfContentsMaster.

2. **TableOfContentsMaster for semantic discovery.** When filenames don't reveal purpose, or you need to understand cross-repo relationships, read `TableOfContentsMaster.md`.

3. **Read with purpose.** Before reading any file, know what you expect to find. If you're reading "just in case," you're wasting context.

4. **Parallel reads.** When you need to read multiple files, read them all in a single parallel call. Never read files sequentially when they have no dependency between them.

5. **Targeted line ranges.** For large files where you only need a specific section, use line offsets rather than reading the entire file.

6. **Cache awareness.** After context compaction, you lose file contents from earlier reads. Re-read critical files rather than working from stale memory.

7. **Summarize, don't hoard.** After reading a file for context, extract the relevant facts and move on. You don't need to keep the entire file contents in working memory.

---

## Workspace Discovery

When you first start a session or when the workspace structure is unknown:

1. **List the parent directory** to discover all child repos and top-level files
2. **Check for `TableOfContentsMaster.md`** — if it exists, read it; if not, run `!generate_toc` to create it
3. **Scan each child directory** for `CLAUDE.md` and `_commands/` to build your mental map
4. **Populate or update `TableOfContentsMaster.md`** with what you find, or run `!generate_toc` for a full rebuild
5. **Report to the user** what you discovered — how many repos, which have CLAUDE.md files, what commands are available

This discovery process should happen automatically at the start of any session where the TableOfContents is missing or the user is working in an unfamiliar part of the workspace.
