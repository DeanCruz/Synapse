# Profile System — `!profile` Modifier

This module defines how agent role profiles work in Synapse. Profiles override the agent's default priorities, goals, tone, and output style to match a specific role. They are defined as markdown files in `{tracker_root}/_commands/profiles/` and are applied as a **modifier on top of any command**, not as a standalone command.

---

## How Profiles Work

A profile does not replace the agent's core instructions (CLAUDE.md). It layers on top of them — adjusting **what the agent prioritizes**, **how it frames its output**, and **what success looks like** for the duration of the task. The agent's technical capabilities, tool access, and orchestration protocols remain unchanged. The profile shapes the agent's persona, priorities, and deliverables.

---

## Syntax

Profiles are invoked with `!{profile_name}` placed before or alongside other commands and prompts:

```
!{profile_name} {prompt}                         <- Profile + direct task
!{profile_name} !{command} {prompt}              <- Profile + command + task
!p !{profile_name} {prompt}                      <- Parallel + profile + task
!p_track !{profile_name} {prompt}                <- Tracked swarm + profile + task
```

---

## Profile Resolution

```
{tracker_root}/_commands/profiles/{profile_name}.md
```

If found, read the profile file in full and apply it. If not found, inform the user and list available profiles.

---

## Profile File Structure

Every profile file must define:

- **Role** — Who the agent becomes (e.g., "Senior Marketing Strategist")
- **Priorities** — What the agent optimizes for, in ranked order
- **Constraints** — What the agent avoids or deprioritizes
- **Output Style** — Tone, format, structure, and length expectations
- **Success Criteria** — What a good output looks like for this role

---

## Applying Profiles

When a profile is active:

1. **Read the profile file in full** before beginning any work
2. **Adopt the role's priorities and output style** for all work in the current task
3. **Combine with command protocols seamlessly** — if `!p` is also invoked, the swarm protocol still applies in full, but each agent receives the profile context in its prompt so it operates under the same role
4. **When dispatching agents with a profile**, include the full profile content in each agent's prompt — agents must adopt the same role, priorities, and output style as the master agent would
5. **Profile scope is task-scoped** — the profile applies for the duration of the current task only

---

## Profile + Command Interaction

| Invocation | Behavior |
|---|---|
| `!{profile} {prompt}` | Serial execution under profile persona |
| `!{profile} !{command} {prompt}` | Execute command with profile priorities applied |
| `!p !{profile} {prompt}` | Parallel dispatch — all agents adopt the profile |
| `!p_track !{profile} {prompt}` | Tracked swarm — all agents adopt the profile |
