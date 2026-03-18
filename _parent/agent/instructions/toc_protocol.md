# TableOfContents Protocol

## `TableOfContentsMaster.md`

`{parent_directory}/TableOfContentsMaster.md` is the workspace's semantic index — a compact markdown file listing every repo, directory, and key file with descriptions and tags. It captures meaning and relationships that filenames alone cannot convey.

### When to Read It

- **Cross-repo tasks** — to understand which repos and directories are involved
- **Ambiguous tasks** — when you don't know where the relevant code lives
- **Semantic discovery** — when filenames don't reveal purpose (e.g., `handler.ts`, `utils.js`, `index.ts`)
- **Relationship mapping** — to understand how components connect across repos

### When to Skip It

- **Targeted tasks** — you already know the file or can find it with Glob/Grep
- **Single-repo work** — the child repo's `CLAUDE.md` gives you enough orientation
- **Follow-up work** — you already have the relevant context from earlier in the session

### Child Repository TOCs

Some child repos maintain their own internal TOC (referenced in their `CLAUDE.md`). When working in a child repo, check for and use its local TOC — it may be more current or detailed than the master index.

### Maintenance

1. **Run `!generate_toc`** to rebuild from scratch
2. **After small changes**, update `TableOfContentsMaster.md` directly
3. **Descriptions must be useful.** "A file" is worthless. "Payment retry queue consumed by the billing cron" is useful
4. **Tags must be searchable.** Use consistent, lowercase tags — technology, domain, and role
