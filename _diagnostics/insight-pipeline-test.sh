#!/usr/bin/env bash
#
# insight-pipeline-test.sh
#
# End-to-end test for SwarmOrchestrator.extractSwarmKnowledge.
# Verifies that calling the extractor produces:
#   1. {project_root}/.synapse/knowledge/insights/{date}_{slug}.json
#   2. {project_root}/.synapse/knowledge/manifest.json with at least one insights_index entry
#
# The test:
#   - Backs up live manifest.json and insights/ directory
#   - Creates a synthetic test dashboard with one annotated progress file
#   - Calls SwarmOrchestrator.extractSwarmKnowledge programmatically via node -e
#   - Verifies an insights file exists and manifest has an insights_index entry pointing to it
#   - Restores backups (manifest, insights/, removes synthetic dashboard)
#
# Exits 0 on success, non-zero on failure (with diagnostic message).

set -u
set -o pipefail

SYNAPSE_ROOT="/Users/dean/Desktop/Synapse"
KNOWLEDGE_DIR="${SYNAPSE_ROOT}/.synapse/knowledge"
MANIFEST="${KNOWLEDGE_DIR}/manifest.json"
INSIGHTS_DIR="${KNOWLEDGE_DIR}/insights"
DASHBOARDS_DIR="${SYNAPSE_ROOT}/dashboards"
TEST_DASHBOARD_ID="test-extract-$$"
TEST_DASHBOARD_DIR="${DASHBOARDS_DIR}/${TEST_DASHBOARD_ID}"
TEST_SLUG="insight-pipeline-test"
DATE_PREFIX=$(date -u +"%Y-%m-%d")
EXPECTED_INSIGHT_FILE="${INSIGHTS_DIR}/${DATE_PREFIX}_${TEST_SLUG}.json"

BACKUP_DIR=$(mktemp -d -t insight-pipeline-test-backup.XXXXXX)
MANIFEST_BACKUP="${BACKUP_DIR}/manifest.json"
INSIGHTS_BACKUP="${BACKUP_DIR}/insights"

cleanup() {
  local exit_code=$?
  echo ""
  echo "[cleanup] Restoring backups..."

  # Restore manifest
  if [ -f "${MANIFEST_BACKUP}" ]; then
    cp "${MANIFEST_BACKUP}" "${MANIFEST}"
    echo "[cleanup] Restored manifest.json from ${MANIFEST_BACKUP}"
  elif [ -f "${MANIFEST}" ]; then
    # Manifest didn't exist before but does now -- remove it
    rm -f "${MANIFEST}"
    echo "[cleanup] Removed manifest.json (didn't exist before test)"
  fi

  # Restore insights/
  if [ -d "${INSIGHTS_DIR}" ]; then
    rm -rf "${INSIGHTS_DIR}"
  fi
  if [ -d "${INSIGHTS_BACKUP}" ]; then
    cp -R "${INSIGHTS_BACKUP}" "${INSIGHTS_DIR}"
    echo "[cleanup] Restored insights/ from ${INSIGHTS_BACKUP}"
  else
    echo "[cleanup] insights/ did not exist before test; left removed"
  fi

  # Remove synthetic dashboard
  if [ -d "${TEST_DASHBOARD_DIR}" ]; then
    rm -rf "${TEST_DASHBOARD_DIR}"
    echo "[cleanup] Removed synthetic dashboard ${TEST_DASHBOARD_DIR}"
  fi

  # Remove backup tmp
  rm -rf "${BACKUP_DIR}"
  echo "[cleanup] Removed backup tmp ${BACKUP_DIR}"

  exit ${exit_code}
}
trap cleanup EXIT

fail() {
  echo ""
  echo "FAIL: $1" >&2
  exit 1
}

echo "=== Insight Pipeline Test ==="
echo "Synapse root: ${SYNAPSE_ROOT}"
echo "Test dashboard: ${TEST_DASHBOARD_ID}"
echo "Expected insight file: ${EXPECTED_INSIGHT_FILE}"
echo ""

# Step 1 — Back up
echo "[1/6] Backing up live manifest and insights..."
if [ -f "${MANIFEST}" ]; then
  cp "${MANIFEST}" "${MANIFEST_BACKUP}"
  echo "  Backed up manifest.json -> ${MANIFEST_BACKUP}"
else
  echo "  manifest.json did not exist; nothing to back up"
fi
if [ -d "${INSIGHTS_DIR}" ]; then
  cp -R "${INSIGHTS_DIR}" "${INSIGHTS_BACKUP}"
  echo "  Backed up insights/ -> ${INSIGHTS_BACKUP}"
else
  echo "  insights/ did not exist; nothing to back up"
fi

# Step 2 — Create synthetic dashboard with one task that has an annotation
echo ""
echo "[2/6] Creating synthetic dashboard ${TEST_DASHBOARD_ID}..."
mkdir -p "${TEST_DASHBOARD_DIR}/progress"

cat > "${TEST_DASHBOARD_DIR}/initialization.json" <<EOF
{
  "task": {
    "name": "${TEST_SLUG}",
    "type": "Waves",
    "directory": "test",
    "prompt": "synthetic test for insight extraction",
    "project_root": "${SYNAPSE_ROOT}",
    "created": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
    "total_tasks": 1,
    "total_waves": 1,
    "dashboard_id": "${TEST_DASHBOARD_ID}"
  },
  "agents": [
    {
      "id": "t1",
      "title": "Synthetic test task",
      "wave": 1,
      "layer": "backend",
      "directory": "test",
      "depends_on": []
    }
  ]
}
EOF

cat > "${TEST_DASHBOARD_DIR}/progress/t1.json" <<EOF
{
  "task_id": "t1",
  "dashboard_id": "${TEST_DASHBOARD_ID}",
  "status": "completed",
  "started_at": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "completed_at": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "summary": "Synthetic test completed",
  "assigned_agent": "TestAgent",
  "stage": "completed",
  "message": "Synthetic test data for extractSwarmKnowledge",
  "milestones": [],
  "deviations": [
    {
      "at": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
      "severity": "CRITICAL",
      "description": "Synthetic critical deviation for test",
      "affected_files": ["test/synthetic.js"]
    }
  ],
  "logs": [],
  "files_changed": [
    { "path": "test/synthetic.js", "action": "created" }
  ],
  "annotations": {
    "test/synthetic.js": {
      "gotchas": ["synthetic-gotcha-from-test"],
      "patterns": ["synthetic-pattern-from-test"],
      "conventions": ["synthetic-convention-from-test"]
    }
  }
}
EOF

cat > "${TEST_DASHBOARD_DIR}/logs.json" <<EOF
{ "entries": [] }
EOF

echo "  Wrote initialization.json, progress/t1.json, logs.json"

# Step 3 — Invoke extractSwarmKnowledge programmatically
echo ""
echo "[3/6] Invoking SwarmOrchestrator.extractSwarmKnowledge..."
cd "${SYNAPSE_ROOT}"

INVOKE_OUTPUT=$(node -e "
const orch = require('./electron/services/SwarmOrchestrator');
if (typeof orch.extractSwarmKnowledge !== 'function') {
  console.error('extractSwarmKnowledge is not exported');
  process.exit(2);
}
try {
  const r = orch.extractSwarmKnowledge('${TEST_DASHBOARD_ID}', '${SYNAPSE_ROOT}');
  console.log('extractSwarmKnowledge returned:', JSON.stringify(r));
} catch (e) {
  console.error('extractSwarmKnowledge threw:', e.message);
  console.error(e.stack);
  process.exit(3);
}
" 2>&1)
INVOKE_RC=$?
echo "  Output: ${INVOKE_OUTPUT}"
if [ ${INVOKE_RC} -ne 0 ]; then
  fail "extractSwarmKnowledge invocation failed (rc=${INVOKE_RC}): ${INVOKE_OUTPUT}"
fi

# Step 4 — Verify insights file exists
echo ""
echo "[4/6] Verifying insights file at ${EXPECTED_INSIGHT_FILE}..."
if [ ! -f "${EXPECTED_INSIGHT_FILE}" ]; then
  echo "  insights/ contents:"
  ls -la "${INSIGHTS_DIR}" 2>/dev/null || echo "  (insights/ does not exist)"
  fail "Expected insights file not found: ${EXPECTED_INSIGHT_FILE}"
fi
echo "  OK — insights file exists"

# Sanity-check the file contains expected fields
INSIGHT_CHECK=$(node -e "
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('${EXPECTED_INSIGHT_FILE}', 'utf-8'));
const required = ['swarm_name', 'completed_at', 'dashboard_id', 'insights', 'worker_annotations_harvested'];
for (const k of required) {
  if (!(k in data)) { console.error('Missing field:', k); process.exit(1); }
}
if (data.dashboard_id !== '${TEST_DASHBOARD_ID}') {
  console.error('dashboard_id mismatch:', data.dashboard_id);
  process.exit(1);
}
if (data.insights.dependency_insights.length === 0) {
  console.error('Expected at least one dependency_insights entry from CRITICAL deviation');
  process.exit(1);
}
console.log('Insights file shape OK. annotations harvested =', data.worker_annotations_harvested);
" 2>&1)
INSIGHT_CHECK_RC=$?
echo "  ${INSIGHT_CHECK}"
if [ ${INSIGHT_CHECK_RC} -ne 0 ]; then
  fail "Insights file shape check failed: ${INSIGHT_CHECK}"
fi

# Step 5 — Verify manifest.insights_index has new entry
echo ""
echo "[5/6] Verifying manifest.insights_index..."
MANIFEST_CHECK=$(node -e "
const fs = require('fs');
const m = JSON.parse(fs.readFileSync('${MANIFEST}', 'utf-8'));
if (!Array.isArray(m.insights_index) || m.insights_index.length === 0) {
  console.error('manifest.insights_index missing or empty');
  process.exit(1);
}
const expectedFile = 'insights/${DATE_PREFIX}_${TEST_SLUG}.json';
const found = m.insights_index.find(e => e && e.file === expectedFile);
if (!found) {
  console.error('No insights_index entry for', expectedFile);
  console.error('Found entries:', JSON.stringify(m.insights_index.slice(-3)));
  process.exit(1);
}
if (!m.last_updated) {
  console.error('manifest.last_updated missing — schema fix not applied');
  process.exit(1);
}
if (m.updated_at) {
  console.error('manifest.updated_at present — schema drift NOT fixed');
  process.exit(1);
}
console.log('manifest.insights_index entry found:', JSON.stringify(found));
console.log('manifest.last_updated =', m.last_updated);
" 2>&1)
MANIFEST_CHECK_RC=$?
echo "  ${MANIFEST_CHECK}"
if [ ${MANIFEST_CHECK_RC} -ne 0 ]; then
  fail "manifest verification failed: ${MANIFEST_CHECK}"
fi

# Step 6 — Done. Cleanup runs via trap.
echo ""
echo "[6/6] All checks passed."
echo ""
echo "PASS: insights file written, manifest.insights_index updated, schema uses last_updated/last_annotated."
exit 0
