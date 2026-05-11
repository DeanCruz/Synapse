# Legacy index search command

This legacy command is deprecated. Execute `!context` against the project knowledge graph instead.

## Required Behavior

1. Preserve the user's query text after the command name.
2. Read `{tracker_root}/_commands/project/context.md` in full.
3. Execute it exactly as if the user had typed `!context {query}`.
4. In the final response, state that results came from `{project_root}/.synapse/knowledge/` when PKI data was available, supplemented by grep/glob.

Do not read the legacy markdown index as part of this compatibility command. Query `{project_root}/.synapse/knowledge/` instead.
