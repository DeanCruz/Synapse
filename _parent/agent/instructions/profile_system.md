# Profile System — `!profile` Modifier

Profiles override the agent's default priorities, goals, tone, and output style to match a specific role. They are defined as markdown files in `{parent_directory}/_commands/_profiles/` and are applied as a **modifier on top of any command**, not as a standalone command.

## How Profiles Work

A profile does not replace the agent's core instructions (the parent CLAUDE.md). It layers on top of them — adjusting **what the agent prioritizes**, **how it frames its output**, and **what success looks like** for the duration of the task. The agent's technical capabilities, tool access, and orchestration protocols remain unchanged. The profile shapes the agent's persona, priorities, and deliverables.

## Syntax

Profiles are invoked with `!{profile_name}` placed before or alongside other commands and prompts:

```
!{profile_name} {prompt}                         <- Profile + direct task
!{profile_name} !{command} {prompt}              <- Profile + command + task
!p !{profile_name} {prompt}                      <- Parallel + profile + task
!p_track !{profile_name} {prompt}                <- Tracked swarm + profile + task
```

**Examples:**
- `!marketing create variations of marketing angles for this product`
- `!marketing !p create 5 different ad copy variations`
- `!developer !review audit the authentication module`

## Profile Resolution

Profiles are stored in `{parent_directory}/_commands/_profiles/` and follow a simpler resolution than commands:

```
1. {parent_directory}/_commands/_profiles/{profile_name}.md    <- Primary location
```

Resolution rules:
1. **Check `{parent_directory}/_commands/_profiles/` for `{profile_name}.md`**
2. **If found**, read the profile file in full and apply it to the current task
3. **If not found**, inform the user that no profile named `{profile_name}` exists and list all available profiles from the `_profiles/` directory

## Profile File Structure

Every profile file must define:

- **Role** — Who the agent becomes (e.g., "Senior Marketing Strategist")
- **Priorities** — What the agent optimizes for, in ranked order
- **Constraints** — What the agent avoids or deprioritizes
- **Output Style** — Tone, format, structure, and length expectations
- **Success Criteria** — What a good output looks like for this role

## Applying Profiles

When a profile is active:

1. **Read the profile file in full** before beginning any work
2. **Adopt the role's priorities and output style** for all work in the current task
3. **Combine with command protocols seamlessly** — if `!p` is also invoked, the swarm protocol still applies in full, but each agent receives the profile context in its prompt so it operates under the same role
4. **When dispatching agents with a profile**, include the full profile content in each agent's prompt — agents must adopt the same role, priorities, and output style as the master agent would
5. **Profile scope is task-scoped** — the profile applies for the duration of the current task only. Once the task is complete, the agent returns to its default mode

## Profile + Command Interaction

Profiles compose cleanly with all existing commands:

| Invocation | Behavior |
|---|---|
| `!{profile} {prompt}` | Serial execution under profile persona |
| `!{profile} !{command} {prompt}` | Execute command with profile priorities applied |
| `!p !{profile} {prompt}` | Parallel dispatch — all agents adopt the profile |
| `!p_track !{profile} {prompt}` | Tracked swarm — all agents adopt the profile |

The profile modifies **how** work is done and **what** is prioritized. Commands define **what protocol** to follow. They are orthogonal and compose without conflict.

## Duplicate Detection — Creating New Profiles

When the user asks to create a new profile, you **must check for duplicates before creating anything.**

1. **Check `{parent_directory}/_commands/_profiles/` for `{profile_name}.md`**
2. **If a profile with the same name already exists:**
   - Alert the user: *"A profile named `!{profile_name}` already exists at `{path}`."*
   - Read the existing profile file and provide a brief summary of its role, priorities, and output style
   - Ask the user whether they want to **overwrite it**, **rename the new profile**, or **cancel**
3. **If no duplicate exists**, proceed with creating the profile

This duplicate check is **mandatory** — never silently overwrite an existing profile.
