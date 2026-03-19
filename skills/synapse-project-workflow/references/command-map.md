# Synapse Project Workflow Command Map

Use these project-oriented command specs as the canonical procedures.

| Command | Use When | Source File |
|---|---|---|
| `!project` | Show, set, or clear the current target project | `/_commands/project.md` |
| `!initialize` | Bootstrap Synapse metadata in a target project | `/_commands/project/initialize.md` |
| `!onboard` | Get oriented in a target project | `/_commands/project/onboard.md` |
| `!context {query}` | Gather focused project context | `/_commands/project/context.md` |
| `!review` | Review recent code changes with project-wide awareness | `/_commands/project/review.md` |
| `!health` | Audit overall project health | `/_commands/project/health.md` |
| `!scaffold` | Generate a project `CLAUDE.md` | `/_commands/project/scaffold.md` |
| `!plan {task}` | Produce an implementation plan without execution | `/_commands/project/plan.md` |
| `!scope {task}` | Analyze blast radius and sequencing | `/_commands/project/scope.md` |
| `!trace {target}` | Trace a function, endpoint, type, or flow end to end | `/_commands/project/trace.md` |
| `!contracts` | Audit project API and type contracts | `/_commands/project/contracts.md` |
| `!env_check` | Audit environment variable consistency | `/_commands/project/env_check.md` |
| `!toc {query}` | Search the semantic table of contents | `/_commands/project/toc.md` |
| `!toc_generate` | Rebuild the TOC from scratch | `/_commands/project/toc_generate.md` |
| `!toc_update` | Incrementally refresh the TOC | `/_commands/project/toc_update.md` |
| `!commands` | List all available commands dynamically | `/_commands/project/commands.md` |
| `!profiles` | List available Synapse profiles dynamically | `/_commands/project/profiles.md` |
| `!help` | Show the quick-reference guide | `/_commands/project/help.md` |

## Profile Source Files

When a request is role-shaped rather than workflow-shaped, inspect `/Users/andrewdimarogonas/Desktop/Huxli-parent/Synapse/_commands/_profiles/*.md` and apply the matching profile guidance.

## Common Project Inputs

- `{project_root}/AGENTS.md`
- `{project_root}/CLAUDE.md`
- `{project_root}/.synapse/toc.md`
- `{project_root}/_commands/*.md`

