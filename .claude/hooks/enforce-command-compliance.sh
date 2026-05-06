#!/bin/bash
# enforce-command-compliance.sh — PostToolUse hook on Read
# When the agent reads a _commands/ file, injects a reminder to follow it exactly.
# Non-blocking — just a message nudge.

set -o pipefail

ok() { exit 0; }

if ! command -v jq &>/dev/null; then ok; fi

INPUT=$(cat 2>/dev/null) || ok
[ -z "$INPUT" ] && ok

FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null) || ok
[ -z "$FILE_PATH" ] && ok

# Only fire for _commands/ files (markdown)
case "$FILE_PATH" in
  */_commands/*.md) ;;
  *) ok ;;
esac

# Extract the command name from the path
CMD_NAME=$(basename "$FILE_PATH" .md)

echo "{\"message\":\"COMMAND LOADED: '!${CMD_NAME}' — This is a NON-NEGOTIABLE directive. Follow every step in the file exactly as written. No skipping, no improvisation, no partial execution. Execute now.\"}"
exit 0
