# Command: `!profiles`

## Purpose

Display a formatted table of all available agent profiles, their roles, and when to use them.

## Execution

1. **Scan `{tracker_root}/_commands/profiles/`** for all `.md` files
2. **For each profile found**, extract:
   - The profile name (filename without `.md`)
   - The role title (from the `## Role` section heading or first line)
   - A one-line summary of when to use it (derived from the role description and priorities)
3. **Display a formatted table** with the following columns:

| Column | Description |
|---|---|
| **Profile** | The invocation name (e.g., `!marketing`) |
| **Role** | The role title from the profile file |
| **Best Used For** | A concise description of when to invoke this profile |

4. **Sort alphabetically** by profile name
5. **Include a usage reminder** after the table showing the composition syntax:
   ```
   Usage:
     !{profile} {prompt}                    — Profile + direct task
     !{profile} !{command} {prompt}         — Profile + command + task
     !{profile} !p {prompt}                 — Profile + parallel dispatch
     !{profile} !p_track {prompt}           — Profile + tracked swarm
   ```

## Rules

- **Always scan the directory live** — do not hardcode the profile list. New profiles added to `_profiles/` should appear automatically.
- **Read each profile file** to extract accurate role and usage information. Do not guess from filenames alone.
- If the `profiles/` directory is empty or missing, inform the user: *"No profiles found. Create one with: `create a new profile called {name}`"*
