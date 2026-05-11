# Project Knowledge Graph

Synapse now uses the Project Knowledge Index at `{project_root}/.synapse/knowledge/` as the semantic project graph.

Use:

```bash
!learn
!context "auth middleware"
!learn_update
```

The knowledge graph stores routing indexes, per-file annotations, domains, concepts, relationships, gotchas, conventions, and patterns. It replaces the older markdown file-index workflow for project discovery.

Primary artifacts:

| Artifact | Purpose |
|---|---|
| `.synapse/knowledge/manifest.json` | Per-file routing index with hashes, staleness, and insight references |
| `.synapse/knowledge/domain_index.json` | Domain-to-file lookup |
| `.synapse/knowledge/tag_index.json` | Tag-to-file lookup |
| `.synapse/knowledge/concept_map.json` | Concept-to-file routing |
| `.synapse/knowledge/annotations/*.json` | Per-file operational knowledge |
| `.synapse/knowledge/domains.json` | Domain taxonomy |
| `.synapse/knowledge/patterns.json` | Cross-cutting patterns and conventions |

For the full current workflow, see [PKI Overview](./pki-overview.md).
