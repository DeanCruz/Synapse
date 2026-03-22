# Profile System

Profiles are role-based persona modifiers that change how the Synapse agent prioritizes, frames, and delivers its output. A profile does not replace the agent's core instructions -- it layers on top of them, adjusting what the agent optimizes for, how it communicates, and what success looks like for the duration of a task.

---

## What Profiles Do

When a profile is active, the agent adopts a specific professional role. This affects:

- **Priorities** -- What the agent optimizes for, in ranked order
- **Constraints** -- What the agent avoids or deprioritizes
- **Output Style** -- Tone, format, structure, and length expectations
- **Success Criteria** -- What a good output looks like for this role
- **Context Gathering** -- What the agent reads before producing output

The agent's technical capabilities, tool access, and orchestration protocols remain unchanged. Only the persona, priorities, and deliverable style shift.

---

## How to Invoke Profiles

Profiles are invoked with `!{profile_name}` placed before or alongside other commands:

```
!{profile_name} {prompt}                    -- Profile + direct task
!{profile_name} !{command} {prompt}         -- Profile + command + task
!p !{profile_name} {prompt}                 -- Parallel dispatch under profile
!p_track !{profile_name} {prompt}           -- Tracked swarm under profile
```

### Examples

```
!marketing write landing page copy for our new dashboard feature
!architect review the current API design and propose improvements
!qa create a comprehensive test plan for the checkout flow
!product write a PRD for user profile picture uploads
!founder !plan pitch deck structure for Series A
!p !security audit all external-facing endpoints
```

---

## Profile Resolution

Profiles are resolved from a single location:

```
{tracker_root}/_commands/profiles/{profile_name}.md
```

If the profile file is found, it is read in full and applied. If not found, the agent informs the user and lists available profiles.

---

## Profile File Structure

Every profile file defines five sections:

### Role

Who the agent becomes. A one-paragraph description of the professional role, expertise areas, and thinking style.

### Priorities (Ranked)

An ordered list of what the agent optimizes for. The first priority always takes precedence over later ones when they conflict. Typically 4-5 priorities, each with a name and explanation.

### Constraints

What the agent must avoid. These are explicit "do NOT" rules that prevent common failure modes for the role. Typically 4-5 constraints.

### Output Style

How the agent communicates:
- **Tone** -- The voice and register (e.g., "direct, strategic, founder-to-founder")
- **Format** -- Document structure patterns (e.g., "comparison tables with weighted criteria")
- **Length** -- Expectations per artifact type
- **Structure** -- Template patterns for common deliverables

### Success Criteria

What a good output looks like. Concrete, verifiable conditions that define quality for this role.

---

## Profile Scope

Profiles are **task-scoped** -- they apply for the duration of the current task only. Once the task is complete, the agent returns to its default behavior unless a new profile is invoked.

---

## Profiles in Swarm Mode

When profiles are combined with parallel dispatch commands (`!p` or `!p_track`), the profile context is included in every worker agent's prompt. This ensures all workers in the swarm operate under the same role, priorities, and output style as the master agent would.

For example, `!p_track !security audit the entire codebase for vulnerabilities` would:

1. The master agent reads the `security` profile
2. The master plans the audit, decomposing it into parallel tasks
3. Each worker agent receives the security profile content in its prompt
4. All workers produce output in the security engineer's style with security priorities

---

## Available Profiles

Synapse ships with 15 built-in profiles covering business strategy, engineering, marketing, and operations. See [Available Profiles](available-profiles.md) for the full list with descriptions.

| Profile | Role |
|---------|------|
| `!analyst` | Senior Data Analyst -- SaaS metrics, KPI frameworks, dashboard design |
| `!architect` | Senior Systems Architect -- distributed systems, API design, scalability |
| `!copywriter` | Conversion Copywriter -- landing pages, emails, CTAs |
| `!customer-success` | Head of Customer Success -- onboarding, retention, health scoring |
| `!devops` | Senior Platform Engineer -- CI/CD, infrastructure, monitoring |
| `!founder` | Startup Strategist -- go-to-market, fundraising, competitive analysis |
| `!growth` | Growth Engineer -- acquisition, conversion, SEO, experiments |
| `!legal` | Legal & Compliance Advisor -- privacy regulations, ToS, compliance |
| `!marketing` | Senior Marketing Strategist -- positioning, copywriting, go-to-market |
| `!pricing` | Pricing Strategist -- pricing models, tier design, value metrics |
| `!product` | Senior Product Manager -- PRDs, user stories, prioritization |
| `!qa` | Senior QA Engineer -- test strategy, edge cases, regression prevention |
| `!sales` | Senior Sales Strategist -- outreach, objection handling, battlecards |
| `!security` | Senior Security Engineer -- threat modeling, vulnerability assessment |
| `!technical-writer` | Senior Technical Writer -- API docs, developer guides, tutorials |

---

## Creating Custom Profiles

To create a new profile, add a `.md` file to `{tracker_root}/_commands/profiles/` following the standard structure (Role, Priorities, Constraints, Output Style, Success Criteria). Before creating a new profile, Synapse checks for duplicates -- if a profile with the same name already exists, it will alert you and ask whether to overwrite, rename, or cancel.
