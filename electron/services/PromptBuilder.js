// electron/services/PromptBuilder.js — Constructs worker prompts with full context
// Combines task description, project context, upstream results, and worker instructions.

const fs = require('fs');
const path = require('path');

const { ROOT } = require('../../src/server/utils/constants');

var WORKER_INSTRUCTIONS_PATH = path.join(ROOT, 'agent', 'instructions', 'tracker_worker_instructions.md');

/**
 * Build the system prompt for a worker agent.
 * This is appended via --append-system-prompt and contains the progress reporting protocol.
 *
 * @param {object} opts
 * @param {string} opts.taskId
 * @param {string} opts.dashboardId
 * @param {string} opts.trackerRoot — path to Synapse root
 * @param {string} [opts.projectPath] — target project directory
 * @param {string[]} [opts.additionalContextDirs] — additional read-only context directories
 * @returns {string}
 */
// Known dashboard-ID shapes: `ide` (reserved), 6-char hex, or legacy `dashboardN`.
// Garbage values here mean something upstream (master planning or IPC handler)
// passed a made-up path instead of the assigned dashboard ID.
var DASHBOARD_ID_SHAPE = /^(ide|[a-f0-9]{6}|dashboard[0-9]+)$/;

function buildSystemPrompt(opts) {
  // Defensive: the dashboardId threaded into the worker's system prompt must be
  // a real dashboard ID. If the master picked a wrong or made-up ID during
  // planning, we fail loudly here instead of silently routing every progress
  // file into the wrong dashboard directory.
  if (!opts || !opts.dashboardId) {
    throw new Error('PromptBuilder.buildSystemPrompt: opts.dashboardId is required');
  }
  if (!DASHBOARD_ID_SHAPE.test(opts.dashboardId)) {
    throw new Error(
      'PromptBuilder.buildSystemPrompt: opts.dashboardId=' + JSON.stringify(opts.dashboardId) +
      ' does not match a known dashboard ID shape (ide | 6-char hex | dashboardN). ' +
      'Refusing to dispatch a worker bound to a non-existent dashboard.'
    );
  }

  var parts = [];

  // Load worker instructions
  try {
    var instructions = fs.readFileSync(WORKER_INSTRUCTIONS_PATH, 'utf-8');
    parts.push(instructions);
  } catch (e) {
    parts.push('# Worker Progress Reporting\nWrite progress to: ' + opts.trackerRoot + '/dashboards/' + opts.dashboardId + '/progress/' + opts.taskId + '.json');
  }

  // Add concrete paths
  parts.push('\n---\n');
  parts.push('## Your Dispatch Context\n');
  parts.push('- **Synapse_Instance_Location:** `' + opts.trackerRoot + '`');
  parts.push('- **DashboardID:** `' + opts.dashboardId + '`');
  parts.push('- **Synapse_Dashboard:** `' + opts.trackerRoot + '/dashboards/' + opts.dashboardId + '`');
  parts.push('- **Target_Directory:** `' + (opts.projectPath || 'N/A') + '`');

  var ctxDirs = opts.additionalContextDirs || [];
  if (ctxDirs.length > 0) {
    parts.push('- **Context_Directories:** `[' + ctxDirs.map(function(d) { return '"' + d + '"'; }).join(', ') + ']`');
  } else {
    parts.push('- **Context_Directories:** `[]`');
  }

  parts.push('');
  parts.push('### Path References (derived from above)');
  parts.push('- **tracker_root:** `' + opts.trackerRoot + '`');
  parts.push('- **dashboard_id:** `' + opts.dashboardId + '` — include this value as `"dashboard_id"` in every progress file write');
  parts.push('- **task_id:** `' + opts.taskId + '`');
  parts.push('- **progress_file:** `' + opts.trackerRoot + '/dashboards/' + opts.dashboardId + '/progress/' + opts.taskId + '.json`');
  parts.push('- **plan_file:** `' + opts.trackerRoot + '/dashboards/' + opts.dashboardId + '/plan.json` — your canonical task spec. Read `context` (shared prompt + conventions) and `tasks[]` entry where `id == "' + opts.taskId + '"` (deeply-thought approach + files) before implementing.');
  parts.push('- **ide_dashboard:** `ide` (reserved — always exists, never use for swarms)');
  parts.push('');
  parts.push('**IMPORTANT:** Always use the Synapse_Instance_Location and Synapse_Dashboard paths above when writing progress files or updating dashboard state. Never assume a different Synapse directory.');

  // Additional context directories (read-only reference)
  var additionalDirs = opts.additionalContextDirs || [];
  if (additionalDirs.length > 0) {
    parts.push('');
    parts.push('## Additional Context Directories (READ-ONLY)');
    parts.push('The following directories are available as **read-only** reference material.');
    parts.push('You may read files in these directories for context, but you must **NEVER modify, create, or delete** any files in them.');
    parts.push('All code changes must happen in the project directory only.');
    parts.push('');
    for (var i = 0; i < additionalDirs.length; i++) {
      parts.push('- `' + additionalDirs[i] + '`');
    }
  }

  return parts.join('\n');
}

// ---- PKI retrieval: module-level cache ----
// Per-projectPath cache for the PKI corpus (manifest + split indices + rules + annotations).
// 60-second TTL means a long-running master-planning pass stays warm without permanent
// staleness risk. Keys are absolute projectPath strings so multi-project mode does not
// corrupt across projects.
var _PKI_CACHE_TTL_MS = 60 * 1000;
var _pkiCache = Object.create(null);

// Stopwords for token extraction. Anything <4 chars is also dropped, so very short
// commons ("a", "an", "is") are redundant here but listed for readability.
var _STOPWORDS = {
  the: 1, and: 1, a: 1, of: 1, to: 1, for: 1, with: 1, in: 1, on: 1, this: 1,
  that: 1, is: 1, are: 1, by: 1, from: 1, as: 1, an: 1, it: 1, be: 1, or: 1,
};

/**
 * Strip the _metadata key from a sibling-index object so iteration only walks
 * real entries. Manifest fallback path also passes through here harmlessly
 * (legacy manifests had no _metadata sentinel).
 */
function _stripMetadata(obj) {
  if (!obj || typeof obj !== 'object') return {};
  if (!obj._metadata) return obj;
  var out = {};
  for (var k in obj) {
    if (k !== '_metadata' && Object.prototype.hasOwnProperty.call(obj, k)) {
      out[k] = obj[k];
    }
  }
  return out;
}

/**
 * Read a sibling index file. On miss/parse-error, fall back to the named
 * manifest field (legacy shape). On second miss, return {}.
 */
function _readIndex(projectPath, fileName, manifestField, manifest) {
  var siblingPath = path.join(projectPath, '.synapse', 'knowledge', fileName);
  try {
    var parsed = JSON.parse(fs.readFileSync(siblingPath, 'utf-8'));
    return _stripMetadata(parsed);
  } catch (e) {
    if (manifest && manifest[manifestField]) {
      return _stripMetadata(manifest[manifestField]);
    }
    return {};
  }
}

/**
 * Read all rule JSON files in .synapse/knowledge/rules/. Fail-open: missing
 * directory or unreadable files return [].
 */
function _readRules(projectPath) {
  var rulesDir = path.join(projectPath, '.synapse', 'knowledge', 'rules');
  var rules = [];
  var entries;
  try {
    entries = fs.readdirSync(rulesDir);
  } catch (e) {
    return rules;
  }
  for (var i = 0; i < entries.length; i++) {
    if (!/\.json$/i.test(entries[i])) continue;
    try {
      var rule = JSON.parse(fs.readFileSync(path.join(rulesDir, entries[i]), 'utf-8'));
      if (rule && rule.binding) rules.push(rule);
    } catch (e) {
      // skip unparseable rule files (fail-open)
    }
  }
  return rules;
}

/**
 * Load the full PKI corpus for a project, with per-projectPath caching at 60s TTL.
 * Returns { manifest, domain_index, tag_index, concept_map, rules, annotations: Map }.
 * Fail-open: any layer that errors returns its empty equivalent.
 */
function _loadPKI(projectPath) {
  var key = path.resolve(projectPath);
  var now = Date.now();
  var cached = _pkiCache[key];
  if (cached && (now - cached.loadedAt) < _PKI_CACHE_TTL_MS) {
    return cached.data;
  }

  var manifest = null;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(projectPath, '.synapse', 'knowledge', 'manifest.json'), 'utf-8'));
  } catch (e) {
    manifest = null;
  }

  var data = {
    manifest: manifest,
    domain_index: _readIndex(projectPath, 'domain_index.json', 'domain_index', manifest),
    tag_index: _readIndex(projectPath, 'tag_index.json', 'tag_index', manifest),
    concept_map: _readIndex(projectPath, 'concept_map.json', 'concept_map', manifest),
    rules: _readRules(projectPath),
    annotations: new Map(),
  };

  _pkiCache[key] = { loadedAt: now, data: data };
  return data;
}

/**
 * Tokenize task text: lowercase, split on non-alnum, drop stopwords, require length >= 4.
 */
function _tokenize(text) {
  if (!text) return [];
  var raw = String(text).toLowerCase().split(/[^a-z0-9]+/);
  var seen = Object.create(null);
  var tokens = [];
  for (var i = 0; i < raw.length; i++) {
    var t = raw[i];
    if (!t || t.length < 4) continue;
    if (_STOPWORDS[t]) continue;
    if (seen[t]) continue;
    seen[t] = 1;
    tokens.push(t);
  }
  return tokens;
}

/**
 * Read a single annotation file (with intra-call memoization on the loaded PKI bag).
 */
function _readAnnotation(projectPath, hash, pki) {
  if (!hash) return null;
  if (pki.annotations.has(hash)) return pki.annotations.get(hash);
  var annPath = path.join(projectPath, '.synapse', 'knowledge', 'annotations', hash + '.json');
  var ann = null;
  try {
    ann = JSON.parse(fs.readFileSync(annPath, 'utf-8'));
  } catch (e) {
    ann = null;
  }
  pki.annotations.set(hash, ann);
  return ann;
}

/**
 * Match rules against the matched-file set (via binding.globs) OR the token set
 * (via binding.symbols). Return up to `cap` rules, severity-ordered.
 */
function _matchRules(rules, matchedFiles, tokens, cap) {
  if (!rules || rules.length === 0) return [];

  var fileSet = matchedFiles || [];
  var tokenSet = Object.create(null);
  for (var t = 0; t < (tokens || []).length; t++) tokenSet[tokens[t]] = 1;

  var matched = [];
  for (var i = 0; i < rules.length; i++) {
    var rule = rules[i];
    var binding = rule.binding || {};
    var globs = binding.globs || [];
    var symbols = binding.symbols || [];
    var hit = false;

    // Glob match against matched-file set
    for (var g = 0; g < globs.length && !hit; g++) {
      var rx = _globToRegex(globs[g]);
      for (var f = 0; f < fileSet.length; f++) {
        if (rx.test(fileSet[f])) { hit = true; break; }
      }
    }

    // Symbol match against task tokens (case-insensitive prefix-aware match)
    if (!hit) {
      for (var s = 0; s < symbols.length && !hit; s++) {
        var sym = String(symbols[s] || '').toLowerCase();
        if (!sym) continue;
        if (tokenSet[sym]) { hit = true; break; }
        // Also match if any token is contained in the symbol or vice-versa,
        // for camelCase symbols that won't tokenize verbatim (e.g. writeAtomic).
        for (var tk in tokenSet) {
          if (sym.indexOf(tk) !== -1) { hit = true; break; }
        }
      }
    }

    if (hit) matched.push(rule);
  }

  // Severity order: error > warn > info; stable on insertion order otherwise.
  var sevRank = { error: 0, warn: 1, info: 2 };
  matched.sort(function (a, b) {
    var ra = sevRank[a.severity] != null ? sevRank[a.severity] : 3;
    var rb = sevRank[b.severity] != null ? sevRank[b.severity] : 3;
    return ra - rb;
  });

  return matched.slice(0, cap || 5);
}

/**
 * Convert a simple glob (** and *) to a regex. Conservative: anchored, supports
 * "**" (any path including separators) and "*" (any non-separator chars).
 */
function _globToRegex(glob) {
  var src = '';
  var i = 0;
  while (i < glob.length) {
    var c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        src += '.*';
        i += 2;
        if (glob[i] === '/') i += 1; // consume optional '/' after '**'
      } else {
        src += '[^/]*';
        i += 1;
      }
    } else if (c === '?') {
      src += '[^/]';
      i += 1;
    } else if ('.+^$()|{}[]\\'.indexOf(c) !== -1) {
      src += '\\' + c;
      i += 1;
    } else {
      src += c;
      i += 1;
    }
  }
  return new RegExp('^' + src + '$');
}

/**
 * Read PKI knowledge relevant to a task from the project's knowledge index.
 *
 * Reads slim manifest + sibling indices (domain_index.json, tag_index.json,
 * concept_map.json) lazily; falls back to legacy manifest.<field> for backward
 * compatibility. Tokenizes task text (stopwords + len>=4), scores matches with
 * BM25-style rarity weighting, boosts concept_map exact hits 5x, expands
 * 1-hop via annotation.relationships.depends_on/related, and surfaces matching
 * rules from .synapse/knowledge/rules/. Output preserves the existing markdown
 * block contract and adds a new ### RULES section.
 *
 * Cached per absolute projectPath at 60s TTL (module-level _pkiCache).
 *
 * @param {string} projectPath — target project directory
 * @param {object} task — the agent entry from initialization.json (has title, description, id)
 * @returns {string} formatted PKI knowledge block or ''
 */
function readPKIKnowledge(projectPath, task) {
  if (!projectPath) return '';

  var pki = _loadPKI(projectPath);
  var manifest = pki.manifest;
  if (!manifest || !manifest.files) return '';

  var totalFiles = 0;
  for (var fk in manifest.files) {
    if (Object.prototype.hasOwnProperty.call(manifest.files, fk)) totalFiles += 1;
  }
  if (totalFiles === 0) return '';

  var searchText = ((task.title || '') + ' ' + (task.description || '')).toLowerCase();
  var tokens = _tokenize(searchText);
  if (tokens.length === 0) {
    // Nothing to match against — bail early rather than emitting an empty block.
    return '';
  }

  // BM25-style rarity weight: log(N_total / N_files_in_entry). Floor at a small
  // positive epsilon so a domain/tag covering every file still contributes a
  // tiny amount instead of zero (avoids -Infinity if N_files == N_total).
  function rarity(nFiles) {
    if (!nFiles || nFiles <= 0) return 0;
    var w = Math.log(totalFiles / nFiles);
    return w > 0 ? w : 0.01;
  }

  var fileScores = Object.create(null); // filePath -> aggregate score

  function addFile(filePath, weight) {
    if (!filePath) return;
    fileScores[filePath] = (fileScores[filePath] || 0) + weight;
  }

  // 1) Domain matches (exact: token === domain key)
  for (var dKey in pki.domain_index) {
    if (!Object.prototype.hasOwnProperty.call(pki.domain_index, dKey)) continue;
    var dKeyLower = dKey.toLowerCase();
    for (var ti = 0; ti < tokens.length; ti++) {
      if (tokens[ti] === dKeyLower) {
        var dFiles = pki.domain_index[dKey] || [];
        var dW = rarity(dFiles.length);
        for (var dfi = 0; dfi < dFiles.length; dfi++) addFile(dFiles[dfi], dW);
        break;
      }
    }
  }

  // 2) Tag matches (exact: token === tag key)
  for (var tKey in pki.tag_index) {
    if (!Object.prototype.hasOwnProperty.call(pki.tag_index, tKey)) continue;
    var tKeyLower = tKey.toLowerCase();
    for (var tti = 0; tti < tokens.length; tti++) {
      if (tokens[tti] === tKeyLower) {
        var tFiles = pki.tag_index[tKey] || [];
        var tW = rarity(tFiles.length);
        for (var tfi = 0; tfi < tFiles.length; tfi++) addFile(tFiles[tfi], tW);
        break;
      }
    }
  }

  // 3) Concept matches (token contained in concept_map key) — 5x bonus over tag rarity
  for (var cKey in pki.concept_map) {
    if (!Object.prototype.hasOwnProperty.call(pki.concept_map, cKey)) continue;
    var cKeyLower = cKey.toLowerCase();
    var cHit = false;
    for (var cti = 0; cti < tokens.length; cti++) {
      if (cKeyLower.indexOf(tokens[cti]) !== -1) { cHit = true; break; }
    }
    if (!cHit) continue;
    var cEntry = pki.concept_map[cKey];
    var cFiles = (cEntry && cEntry.files) || [];
    // 5x of the tag-equivalent rarity for these files.
    var cW = 5 * rarity(cFiles.length);
    for (var cfi = 0; cfi < cFiles.length; cfi++) addFile(cFiles[cfi], cW);
  }

  // Convert to ranked list with manifest entry + complexity/stale boosts.
  var ranked = [];
  for (var fp in fileScores) {
    var entry = manifest.files[fp];
    if (!entry) continue;
    var score = fileScores[fp];
    if (entry.complexity === 'high') score += 2;
    if (entry.stale) score -= 1;
    ranked.push({ file: fp, score: score, entry: entry });
  }
  ranked.sort(function (a, b) { return b.score - a.score; });

  // Cap primary matches at 8 (annotation read budget).
  var primary = ranked.slice(0, 8);
  if (primary.length === 0) return '';

  var primarySet = Object.create(null);
  for (var pp = 0; pp < primary.length; pp++) primarySet[primary[pp].file] = 1;

  // 1-hop expansion: walk depends_on + related from primary annotations.
  // Score expansion candidates by how often they appear (so files referenced
  // by multiple primaries float to the top). Cap +4 extras.
  var expansionScore = Object.create(null);
  for (var rpi = 0; rpi < primary.length; rpi++) {
    var pEntry = primary[rpi].entry;
    var pAnn = _readAnnotation(projectPath, pEntry && pEntry.hash, pki);
    if (!pAnn || !pAnn.relationships) continue;
    var rel = pAnn.relationships;
    var deps = (rel.depends_on || []).concat(rel.related || []);
    for (var dep = 0; dep < deps.length; dep++) {
      var depPath = deps[dep];
      if (!depPath || primarySet[depPath]) continue;
      if (!manifest.files[depPath]) continue; // skip unindexed neighbors (e.g., narrative refs)
      expansionScore[depPath] = (expansionScore[depPath] || 0) + 1;
    }
  }
  var expansionList = Object.keys(expansionScore).map(function (f) {
    return { file: f, score: expansionScore[f], entry: manifest.files[f] };
  });
  expansionList.sort(function (a, b) { return b.score - a.score; });
  var expansion = expansionList.slice(0, 4);

  // Build the union of files we'll harvest annotations from.
  var harvestList = primary.concat(expansion);
  var matchedFilePaths = harvestList.map(function (h) { return h.file; });

  // Harvest gotchas / patterns / conventions / stale, tagging by file label.
  var gotchas = [];
  var patterns = [];
  var conventions = [];
  var staleWarnings = [];

  for (var hi = 0; hi < harvestList.length; hi++) {
    var h = harvestList[hi];
    var ann = _readAnnotation(projectPath, h.entry && h.entry.hash, pki);
    if (!ann) continue;
    var fileLabel = h.file;
    if (ann.gotchas && Array.isArray(ann.gotchas)) {
      for (var ag = 0; ag < ann.gotchas.length; ag++) {
        gotchas.push('[' + fileLabel + '] ' + ann.gotchas[ag]);
      }
    }
    if (ann.patterns && Array.isArray(ann.patterns)) {
      for (var ap = 0; ap < ann.patterns.length; ap++) {
        patterns.push('[' + fileLabel + '] ' + ann.patterns[ap]);
      }
    }
    if (ann.conventions && Array.isArray(ann.conventions)) {
      for (var ac = 0; ac < ann.conventions.length; ac++) {
        conventions.push('[' + fileLabel + '] ' + ann.conventions[ac]);
      }
    }
    if (h.entry.stale) {
      staleWarnings.push('[' + fileLabel + '] Modified since last annotation — verify before relying');
    }
  }

  // Match rules against the matched-file set + tokens (top 5 severity-ordered).
  var matchedRules = _matchRules(pki.rules, matchedFilePaths, tokens, 5);

  if (
    gotchas.length === 0 &&
    patterns.length === 0 &&
    conventions.length === 0 &&
    matchedRules.length === 0
  ) return '';

  // Build the block, respecting the existing ~100-line target. Priority order
  // for trimming if we overshoot: keep gotchas > patterns > conventions > stale > rules.
  var block = [];
  block.push('## PKI Knowledge (from project knowledge index)');
  block.push('');

  if (gotchas.length > 0) {
    block.push('### GOTCHAS (respect these — discovered by previous agents):');
    var gBudget = Math.min(gotchas.length, 20);
    for (var gi2 = 0; gi2 < gBudget; gi2++) block.push('- ' + gotchas[gi2]);
    block.push('');
  }

  if (patterns.length > 0) {
    block.push('### PATTERNS (follow established patterns):');
    var pBudget = Math.min(patterns.length, 15);
    for (var pi2 = 0; pi2 < pBudget; pi2++) block.push('- ' + patterns[pi2]);
    block.push('');
  }

  if (conventions.length > 0) {
    block.push('### CONVENTIONS (maintain consistency):');
    var cBudget = Math.min(conventions.length, 10);
    for (var ci2 = 0; ci2 < cBudget; ci2++) block.push('- ' + conventions[ci2]);
    block.push('');
  }

  if (staleWarnings.length > 0) {
    block.push('### STALE (verify before relying):');
    for (var si = 0; si < staleWarnings.length; si++) block.push('- ' + staleWarnings[si]);
    block.push('');
  }

  if (matchedRules.length > 0) {
    block.push('### RULES (cross-cutting, severity-ranked):');
    for (var rri = 0; rri < matchedRules.length; rri++) {
      var rule = matchedRules[rri];
      var sev = (rule.severity || 'info').toUpperCase();
      var concept = rule.concept || rule.id || 'rule';
      block.push('- [' + sev + '] (' + concept + ') ' + (rule.gotcha || '').replace(/\s+/g, ' ').trim());
    }
    block.push('');
  }

  // Read recent insights for this task area (legacy helper, untouched).
  var insightsBlock = readRelevantInsights(projectPath, manifest, searchText);
  if (insightsBlock) {
    block.push(insightsBlock);
  }

  return block.join('\n');
}

/**
 * Read recent swarm insights relevant to the current task.
 *
 * @param {string} projectPath
 * @param {object} manifest
 * @param {string} searchText — lowercase task keywords
 * @returns {string|null}
 */
function readRelevantInsights(projectPath, manifest, searchText) {
  if (!manifest.insights_index || manifest.insights_index.length === 0) return null;

  // Check the 5 most recent insights
  var recent = manifest.insights_index.slice(-5);
  var relevantInsights = [];

  for (var i = 0; i < recent.length; i++) {
    var insightPath = path.join(projectPath, '.synapse', 'knowledge', recent[i].file);
    var insight;
    try {
      insight = JSON.parse(fs.readFileSync(insightPath, 'utf-8'));
    } catch (e) {
      continue;
    }

    if (!insight.insights) continue;

    // Check if any insights are relevant by scanning affected files and descriptions
    var categories = ['dependency_insights', 'complexity_surprises', 'failure_patterns', 'architecture_notes'];
    for (var ci = 0; ci < categories.length; ci++) {
      var cat = categories[ci];
      var items = insight.insights[cat];
      if (!items) continue;
      for (var ii = 0; ii < items.length; ii++) {
        var desc = (items[ii].description || '').toLowerCase();
        var affectedFiles = items[ii].affected_files || [];
        var isRelevant = false;

        // Check description overlap
        var descWords = desc.split(/\s+/);
        for (var dw = 0; dw < descWords.length; dw++) {
          if (descWords[dw].length > 4 && searchText.indexOf(descWords[dw]) !== -1) {
            isRelevant = true;
            break;
          }
        }

        // Check file overlap
        if (!isRelevant) {
          for (var af = 0; af < affectedFiles.length; af++) {
            if (searchText.indexOf(affectedFiles[af].toLowerCase()) !== -1) {
              isRelevant = true;
              break;
            }
          }
        }

        if (isRelevant) {
          relevantInsights.push({
            category: cat.replace(/_/g, ' '),
            description: items[ii].description,
            swarm: insight.swarm_name,
          });
        }
      }
    }
  }

  if (relevantInsights.length === 0) return null;

  var lines = ['### INSIGHTS (from previous swarms):'];
  var budget = Math.min(relevantInsights.length, 8);
  for (var ri = 0; ri < budget; ri++) {
    var ins = relevantInsights[ri];
    lines.push('- [' + ins.category + '] ' + ins.description + ' (from swarm: ' + ins.swarm + ')');
  }
  lines.push('');

  return lines.join('\n');
}

/**
 * Master-side complement to readRelevantInsights. Reads the 5 most recent
 * insights files from the PKI and emits a STRUCTURED suggestion object the
 * master can surface during plan presentation and (optionally) act on.
 *
 * Confidence model:
 *   - For each insight item, compute up to 2 relevance signals against the
 *     master's user prompt:
 *       (a) token overlap — count of overlapping non-stopword tokens (len >= 4)
 *           between the item's description and the prompt
 *       (b) file overlap — does the prompt mention any of the item's
 *           affected_files (substring match against the prompt text)?
 *   - HIGH confidence  = both signal types fire
 *   - MEDIUM confidence = exactly one signal type fires
 *   - LOW (skipped)    = neither fires
 *
 * Surfacing rules (warnings capped at 5 — most recent / highest-confidence first):
 *   - HIGH failure_patterns       -> warnings + (if description names tasks/files
 *                                    forming a chain) suggested_dependencies
 *   - HIGH complexity_surprises   -> warnings + suggested_wave_split = true
 *   - HIGH dependency_insights    -> warnings + suggested_dependencies
 *   - HIGH architecture_notes     -> warnings (info severity)
 *   - MEDIUM (any category)       -> warnings only (description, no plan edits)
 *
 * Output shape (always returned — fail-open empty shape on miss):
 *   {
 *     warnings: [{ category, description, swarm, affected_files, confidence }],
 *     suggested_dependencies: [{ from_task_pattern, to_task_pattern, reason }],
 *     suggested_wave_split: boolean,
 *     total_insights_consulted: number,
 *     high_confidence_count: number
 *   }
 *
 * The master MUST NOT auto-apply suggestions. They are advisories; the user
 * approves any structural changes during the plan-approval gate.
 *
 * @param {string} projectPath — absolute path to the target project
 * @param {string} prompt — the master's user prompt (verbatim)
 * @returns {object} structured suggestion object (see shape above)
 */
function readRelevantInsightsForPlanning(projectPath, prompt) {
  var EMPTY = {
    warnings: [],
    suggested_dependencies: [],
    suggested_wave_split: false,
    total_insights_consulted: 0,
    high_confidence_count: 0,
  };

  if (!projectPath || !prompt) return EMPTY;

  // Read manifest directly (do not load the full PKI corpus — planning-time
  // consultation only needs insights_index, not the full bag of indices).
  var manifest = null;
  try {
    manifest = JSON.parse(fs.readFileSync(
      path.join(projectPath, '.synapse', 'knowledge', 'manifest.json'), 'utf-8'
    ));
  } catch (e) {
    return EMPTY;
  }
  if (!manifest || !manifest.insights_index || manifest.insights_index.length === 0) {
    return EMPTY;
  }

  // Tokenize the user prompt (reuse the private _tokenize helper above —
  // same lowercase + stopword + len>=4 rules as readPKIKnowledge).
  var promptText = String(prompt || '');
  var promptLower = promptText.toLowerCase();
  var promptTokens = _tokenize(promptText);
  var promptTokenSet = Object.create(null);
  for (var pti = 0; pti < promptTokens.length; pti++) promptTokenSet[promptTokens[pti]] = 1;

  // Walk the 5 most recent insights files.
  var recent = manifest.insights_index.slice(-5);
  var consulted = 0;

  // Buckets accumulate raw matches before the cap-and-emit step at the end.
  // Each entry: { category, description, swarm, affected_files, confidence,
  //              recency, signals: { tokenOverlap, fileOverlap } }
  var rawMatches = [];
  // Suggested dependencies — gathered separately so we can dedupe by reason.
  var suggestedDeps = [];
  var suggestSplit = false;

  // Categories iterated per insight file. Same set as readRelevantInsights
  // plus effective_patterns (per the pki-overview.md spec — earlier helper
  // skipped it; we include it here for completeness).
  var CATEGORIES = [
    'dependency_insights',
    'complexity_surprises',
    'failure_patterns',
    'effective_patterns',
    'architecture_notes',
  ];

  for (var ri = 0; ri < recent.length; ri++) {
    var entry = recent[ri];
    if (!entry || !entry.file) continue;
    var insightPath = path.join(projectPath, '.synapse', 'knowledge', entry.file);
    var insight;
    try {
      insight = JSON.parse(fs.readFileSync(insightPath, 'utf-8'));
    } catch (e) {
      continue; // fail-open: skip unreadable insight files
    }
    if (!insight || !insight.insights) continue;

    for (var ci = 0; ci < CATEGORIES.length; ci++) {
      var cat = CATEGORIES[ci];
      var items = insight.insights[cat];
      if (!Array.isArray(items)) continue;

      for (var ii = 0; ii < items.length; ii++) {
        consulted += 1;
        var item = items[ii];
        var desc = String(item.description || '');
        var descLower = desc.toLowerCase();
        var affectedFiles = Array.isArray(item.affected_files) ? item.affected_files : [];

        // Signal A — description token overlap.
        // Count distinct non-stopword tokens (len>=4) appearing in BOTH
        // the description and the prompt.
        var descTokens = _tokenize(desc);
        var tokenOverlap = 0;
        for (var dti = 0; dti < descTokens.length; dti++) {
          if (promptTokenSet[descTokens[dti]]) tokenOverlap += 1;
        }

        // Signal B — affected_files overlap with prompt text. Match on
        // either the full path OR the basename so prompts mentioning
        // "PromptBuilder.js" still hit "electron/services/PromptBuilder.js".
        var fileOverlap = false;
        for (var afi = 0; afi < affectedFiles.length; afi++) {
          var f = String(affectedFiles[afi] || '').toLowerCase();
          if (!f) continue;
          if (promptLower.indexOf(f) !== -1) { fileOverlap = true; break; }
          var base = f.split('/').pop();
          if (base && base.length >= 4 && promptLower.indexOf(base) !== -1) {
            fileOverlap = true; break;
          }
        }

        // Confidence classification.
        var hasTokenSignal = tokenOverlap > 0;
        var hasFileSignal = fileOverlap;
        var signalCount = (hasTokenSignal ? 1 : 0) + (hasFileSignal ? 1 : 0);
        if (signalCount === 0) continue; // LOW — discard

        var confidence = signalCount >= 2 ? 'high' : 'medium';

        rawMatches.push({
          category: cat,
          description: desc,
          swarm: insight.swarm_name || (entry.swarm_name || 'unknown'),
          affected_files: affectedFiles,
          confidence: confidence,
          recency: ri, // larger = more recent (we slice(-5) so index correlates)
          signals: { tokenOverlap: tokenOverlap, fileOverlap: hasFileSignal },
          item: item,
        });

        // Plan-adjustment rules — HIGH confidence only.
        if (confidence === 'high') {
          if (cat === 'complexity_surprises') {
            suggestSplit = true;
          }
          if (cat === 'failure_patterns' || cat === 'dependency_insights') {
            // Try to extract a from->to chain hint from the description.
            // Heuristic: look for two affected_files (or two task IDs in
            // the description) and emit a soft suggested_dependency.
            if (affectedFiles.length >= 2) {
              suggestedDeps.push({
                from_task_pattern: 'modifies ' + affectedFiles[0],
                to_task_pattern: 'modifies ' + affectedFiles[1],
                reason: 'Past ' + cat.replace(/_/g, ' ') + ' from swarm "' +
                        (insight.swarm_name || 'unknown') + '": ' + desc,
              });
            } else if (item.discovered_by && item.task_id && item.discovered_by !== item.task_id) {
              suggestedDeps.push({
                from_task_pattern: 'task ' + item.discovered_by,
                to_task_pattern: 'task ' + item.task_id,
                reason: 'Past ' + cat.replace(/_/g, ' ') + ' from swarm "' +
                        (insight.swarm_name || 'unknown') + '": ' + desc,
              });
            }
          }
          // architecture_notes -> warnings only (info severity), no plan edits.
        }
      }
    }
  }

  // Sort warnings: HIGH first, then by recency (newer first).
  rawMatches.sort(function (a, b) {
    if (a.confidence !== b.confidence) {
      return a.confidence === 'high' ? -1 : 1;
    }
    return b.recency - a.recency;
  });

  // Cap at 5 most recent / highest-confidence.
  var capped = rawMatches.slice(0, 5);

  // Strip the internal-only fields from the public warning shape.
  var warnings = capped.map(function (m) {
    return {
      category: m.category,
      description: m.description,
      swarm: m.swarm,
      affected_files: m.affected_files,
      confidence: m.confidence,
    };
  });

  // Dedupe suggested_dependencies by reason text (defensive — same insight
  // could otherwise emit twice if the master re-runs planning during a session).
  var seenDepReasons = Object.create(null);
  var dedupedDeps = [];
  for (var sdi = 0; sdi < suggestedDeps.length; sdi++) {
    var dep = suggestedDeps[sdi];
    if (seenDepReasons[dep.reason]) continue;
    seenDepReasons[dep.reason] = 1;
    dedupedDeps.push(dep);
  }

  var highCount = 0;
  for (var hci = 0; hci < rawMatches.length; hci++) {
    if (rawMatches[hci].confidence === 'high') highCount += 1;
  }

  return {
    warnings: warnings,
    suggested_dependencies: dedupedDeps,
    suggested_wave_split: suggestSplit,
    total_insights_consulted: consulted,
    high_confidence_count: highCount,
  };
}

/**
 * Build the task prompt for a worker agent.
 * This is the main prompt passed as the final argument to claude CLI.
 *
 * @param {object} opts
 * @param {object} opts.task — the agent entry from initialization.json
 * @param {string} [opts.taskDescription] — additional description/context
 * @param {{ path: string, content: string }[]} [opts.projectContexts] — CLAUDE.md contents
 * @param {{ taskId: string, summary: string, files?: string[] }[]} [opts.upstreamResults] — completed dependency results
 * @param {{ path: string, content: string }[]} [opts.additionalContextPaths] — read-only context from additional directories
 * @param {string} [opts.projectPath] — target project path for PKI lookup
 * @returns {string}
 */
function buildTaskPrompt(opts) {
  var parts = [];

  parts.push('# Task ' + opts.task.id + ': ' + opts.task.title);
  parts.push('');

  if (opts.task.directory) {
    parts.push('**Working directory:** `' + opts.task.directory + '`');
    parts.push('');
  }

  // Task description
  if (opts.taskDescription) {
    parts.push('## Task Description');
    parts.push(opts.taskDescription);
    parts.push('');
  }

  // PKI knowledge injection (auto-enrichment from project knowledge index)
  if (opts.projectPath) {
    var pkiBlock = readPKIKnowledge(opts.projectPath, opts.task);
    if (pkiBlock) {
      parts.push(pkiBlock);
    }
  }

  // Project context (CLAUDE.md files)
  if (opts.projectContexts && opts.projectContexts.length > 0) {
    parts.push('## Project Context');
    for (var i = 0; i < opts.projectContexts.length; i++) {
      var ctx = opts.projectContexts[i];
      parts.push('### ' + path.basename(path.dirname(ctx.path)) + '/CLAUDE.md');
      parts.push('```');
      // Truncate very long CLAUDE.md to avoid context overflow
      var content = ctx.content;
      if (content.length > 8000) {
        content = content.substring(0, 8000) + '\n\n... (truncated)';
      }
      parts.push(content);
      parts.push('```');
      parts.push('');
    }
  }

  // Additional context directories (read-only reference)
  if (opts.additionalContextPaths && opts.additionalContextPaths.length > 0) {
    parts.push('## Additional Context (READ-ONLY)');
    parts.push('The following files are from **read-only** reference directories. Use them for context only — do NOT modify these files.');
    parts.push('');
    for (var k = 0; k < opts.additionalContextPaths.length; k++) {
      var actx = opts.additionalContextPaths[k];
      parts.push('### ' + actx.path);
      parts.push('```');
      var actxContent = actx.content;
      if (actxContent.length > 8000) {
        actxContent = actxContent.substring(0, 8000) + '\n\n... (truncated)';
      }
      parts.push(actxContent);
      parts.push('```');
      parts.push('');
    }
  }

  // Upstream results
  if (opts.upstreamResults && opts.upstreamResults.length > 0) {
    parts.push('## Upstream Task Results');
    parts.push('The following tasks have completed before yours. Use their results as context:');
    parts.push('');
    for (var j = 0; j < opts.upstreamResults.length; j++) {
      var upstream = opts.upstreamResults[j];
      parts.push('### Task ' + upstream.taskId);
      parts.push('**Summary:** ' + (upstream.summary || 'No summary available'));
      if (upstream.files && upstream.files.length > 0) {
        parts.push('**Files changed:** ' + upstream.files.join(', '));
      }
      if (upstream.deviations && upstream.deviations.length > 0) {
        parts.push('**Deviations:**');
        for (var d = 0; d < upstream.deviations.length; d++) {
          parts.push('- [' + upstream.deviations[d].severity + '] ' + upstream.deviations[d].description);
        }
      }
      parts.push('');
    }
  }

  return parts.join('\n');
}

/**
 * Read upstream results from completed progress files.
 *
 * @param {string} dashboardId
 * @param {string[]} dependsOn — list of task IDs this task depends on
 * @param {string} trackerRoot
 * @returns {{ taskId, summary, deviations }[]}
 */
function readUpstreamResults(dashboardId, dependsOn, trackerRoot) {
  var results = [];
  for (var i = 0; i < dependsOn.length; i++) {
    var progressFile = path.join(trackerRoot, 'dashboards', dashboardId, 'progress', dependsOn[i] + '.json');
    try {
      var data = JSON.parse(fs.readFileSync(progressFile, 'utf-8'));
      results.push({
        taskId: data.task_id,
        summary: data.summary,
        deviations: data.deviations || [],
      });
    } catch (e) {
      results.push({
        taskId: dependsOn[i],
        summary: '(progress file not found)',
        deviations: [],
      });
    }
  }
  return results;
}

/**
 * Build a replan prompt for the CLI when the circuit breaker trips.
 * Gives the replanner full context: the original plan, what completed,
 * what failed (with error details), and what's still pending/blocked.
 *
 * The CLI must return a JSON object with:
 *   - modified: agents[] with updated fields (description, depends_on, title)
 *   - added: new agent entries to insert into the plan
 *   - removed: task IDs to remove from the plan (blocked tasks that are no longer viable)
 *   - summary: short explanation of what changed and why
 *
 * @param {object} opts
 * @param {string} opts.dashboardId
 * @param {object} opts.init — current initialization.json contents
 * @param {object} opts.progress — all progress files keyed by task_id
 * @param {object} opts.failedTasks — { taskId: true } map of failed task IDs
 * @param {object} opts.completedTasks — { taskId: true } map of completed task IDs
 * @param {number} opts.failedInWave — which wave triggered the circuit breaker
 * @returns {string}
 */
function buildReplanPrompt(opts) {
  var parts = [];

  parts.push('# Circuit Breaker Triggered — Replan Required');
  parts.push('');
  parts.push('The swarm on dashboard `' + opts.dashboardId + '` has hit the circuit breaker: 3+ task failures in Wave ' + opts.failedInWave + '.');
  parts.push('Your job is to analyze the failures, figure out what went wrong, and produce a revised plan.');
  parts.push('');

  // Original task info
  if (opts.init && opts.init.task) {
    parts.push('## Original Task');
    parts.push('- **Name:** ' + opts.init.task.name);
    parts.push('- **Prompt:** ' + (opts.init.task.prompt || 'N/A'));
    parts.push('- **Project:** ' + (opts.init.task.project_root || opts.init.task.directory || 'N/A'));
    parts.push('');
  }

  // Completed tasks
  var completedIds = Object.keys(opts.completedTasks || {});
  if (completedIds.length > 0) {
    parts.push('## Completed Tasks');
    for (var c = 0; c < completedIds.length; c++) {
      var cid = completedIds[c];
      var cAgent = findAgentInInit(opts.init, cid);
      var cProg = opts.progress[cid];
      parts.push('### Task ' + cid + ': ' + (cAgent ? cAgent.title : 'Unknown'));
      if (cProg && cProg.summary) {
        parts.push('**Summary:** ' + cProg.summary);
      }
      if (cProg && cProg.deviations && cProg.deviations.length > 0) {
        parts.push('**Deviations:**');
        for (var cd = 0; cd < cProg.deviations.length; cd++) {
          parts.push('- ' + cProg.deviations[cd].description);
        }
      }
      parts.push('');
    }
  }

  // Failed tasks (the critical section)
  var failedIds = Object.keys(opts.failedTasks || {});
  if (failedIds.length > 0) {
    parts.push('## Failed Tasks');
    for (var f = 0; f < failedIds.length; f++) {
      var fid = failedIds[f];
      var fAgent = findAgentInInit(opts.init, fid);
      var fProg = opts.progress[fid];
      parts.push('### Task ' + fid + ': ' + (fAgent ? fAgent.title : 'Unknown'));
      if (fAgent && fAgent.description) {
        parts.push('**Original description:** ' + fAgent.description);
      }
      if (fAgent && fAgent.depends_on && fAgent.depends_on.length > 0) {
        parts.push('**Dependencies:** ' + fAgent.depends_on.join(', '));
      }
      if (fProg) {
        if (fProg.summary) parts.push('**Error summary:** ' + fProg.summary);
        if (fProg.stage) parts.push('**Failed at stage:** ' + fProg.stage);
        if (fProg.message) parts.push('**Last message:** ' + fProg.message);
        if (fProg.logs && fProg.logs.length > 0) {
          parts.push('**Logs (last 10):**');
          var startIdx = Math.max(0, fProg.logs.length - 10);
          for (var fl = startIdx; fl < fProg.logs.length; fl++) {
            var log = fProg.logs[fl];
            parts.push('- [' + (log.level || 'info') + '] ' + log.msg);
          }
        }
        if (fProg.deviations && fProg.deviations.length > 0) {
          parts.push('**Deviations before failure:**');
          for (var fd = 0; fd < fProg.deviations.length; fd++) {
            parts.push('- ' + fProg.deviations[fd].description);
          }
        }
      }
      parts.push('');
    }
  }

  // Pending/blocked tasks
  parts.push('## Pending Tasks (not yet dispatched)');
  if (opts.init && opts.init.agents) {
    for (var p = 0; p < opts.init.agents.length; p++) {
      var pAgent = opts.init.agents[p];
      var pid = pAgent.id;
      if (opts.completedTasks[pid] || opts.failedTasks[pid]) continue;
      // Check if dispatched (in progress)
      if (opts.progress[pid] && opts.progress[pid].status === 'in_progress') continue;
      parts.push('- **Task ' + pid + ':** ' + pAgent.title);
      if (pAgent.depends_on && pAgent.depends_on.length > 0) {
        parts.push('  Dependencies: ' + pAgent.depends_on.join(', '));
      }
    }
  }
  parts.push('');

  // Full agent list for reference
  parts.push('## Full Current Plan (agents array from initialization.json)');
  parts.push('```json');
  parts.push(JSON.stringify(opts.init.agents || [], null, 2));
  parts.push('```');
  parts.push('');

  // Instructions for output format
  parts.push('## Your Output');
  parts.push('');
  parts.push('Analyze the failures and produce a revised plan. You MUST output ONLY a single JSON object (no markdown fences, no explanation outside the JSON). The format:');
  parts.push('');
  parts.push('```');
  parts.push('{');
  parts.push('  "summary": "Short explanation of what went wrong and what you changed",');
  parts.push('  "modified": [');
  parts.push('    {');
  parts.push('      "id": "2.1",');
  parts.push('      "title": "Updated title if needed",');
  parts.push('      "description": "Revised task description addressing the failure",');
  parts.push('      "depends_on": ["1.1"],');
  parts.push('      "wave": 2');
  parts.push('    }');
  parts.push('  ],');
  parts.push('  "added": [');
  parts.push('    {');
  parts.push('      "id": "2.1r",');
  parts.push('      "title": "Repair task title",');
  parts.push('      "description": "Full description of what this repair task should do",');
  parts.push('      "depends_on": ["1.1"],');
  parts.push('      "wave": 2,');
  parts.push('      "layer": 1');
  parts.push('    }');
  parts.push('  ],');
  parts.push('  "removed": ["3.2"],');
  parts.push('  "retry": ["2.1"]');
  parts.push('}');
  parts.push('```');
  parts.push('');
  parts.push('Rules:');
  parts.push('- "modified" updates existing tasks (only include fields you are changing, plus the id)');
  parts.push('- "added" creates new repair/replacement tasks. Use the failed task id with an "r" suffix (e.g. "2.1r"). New tasks must have id, title, description, depends_on, wave, and layer.');
  parts.push('- "removed" lists task IDs that should be dropped from the plan entirely (they are no longer viable or needed)');
  parts.push('- "retry" lists task IDs that should be retried as-is (the failure was transient, not a plan problem)');
  parts.push('- You can combine these: retry some tasks, modify others, add repair tasks, remove dead ends');
  parts.push('- Do NOT modify completed tasks');
  parts.push('- Rewire depends_on arrays so nothing points at a removed task');
  parts.push('- Keep wave numbers consistent with the dependency graph');
  parts.push('');
  parts.push('Output ONLY the JSON object. No other text.');

  return parts.join('\n');
}

/**
 * Build the system prompt for the replan CLI process.
 */
function buildReplanSystemPrompt() {
  var parts = [];
  parts.push('You are a swarm replanner for the Synapse agent coordination system.');
  parts.push('Your job is to analyze task failures in a parallel agent swarm and produce a revised execution plan.');
  parts.push('You are an expert at root cause analysis and dependency graph repair.');
  parts.push('You must output ONLY valid JSON. No markdown, no explanation, no preamble. Just the JSON object.');
  return parts.join('\n');
}

function findAgentInInit(init, taskId) {
  if (!init || !init.agents) return null;
  for (var i = 0; i < init.agents.length; i++) {
    if (init.agents[i].id === taskId) return init.agents[i];
  }
  return null;
}

module.exports = { buildSystemPrompt, buildTaskPrompt, readUpstreamResults, readPKIKnowledge, readRelevantInsightsForPlanning, buildReplanPrompt, buildReplanSystemPrompt };
