// DependencyLinesView — BFS pathway grid + SVG dependency line drawing
// ES module. Extracted from dashboard.js lines 763-1270.

// ---------------------------------------------------------------------------
// Pathway Grid Constants (private)
// ---------------------------------------------------------------------------

var PATHWAY_STEP = 15; // node spacing (px) along v-corridors
var PATHWAY_PAD = 6;   // stub offset from card edges
var PATHWAY_MARGIN = 3; // free-zone margin around cards

// BFS pathfinding cache — module-scoped, private
var _bfsCache = { key: null, grid: null, paths: {} };

// ---------------------------------------------------------------------------
// Pathway Grid Builder (private)
// ---------------------------------------------------------------------------

/**
 * Build a pathway grid for BFS-based dependency line routing.
 * Corridors live in the gaps between wave columns (vertical) and
 * between cards within columns (horizontal). BFS finds the shortest
 * path through these corridors so lines never cross cards.
 *
 * @param {HTMLElement} container — the .wave-pipeline or .chain-pipeline element
 * @returns {{ nodes: Object, exits: Object, entries: Object }}
 */
function buildPathwayGrid(container) {
  var containerRect = container.getBoundingClientRect();
  var scrollLeft = container.scrollLeft;
  var scrollTop = container.scrollTop;

  // Helper: convert viewport rect to container-relative coords
  function relX(clientX) { return clientX - containerRect.left + scrollLeft; }
  function relY(clientY) { return clientY - containerRect.top + scrollTop; }

  // ---- Step 1: Detect columns and their cards ----
  var columns = container.querySelectorAll('.wave-column');
  var colData = []; // { left, right, top, bottom, cards: [{id, top, bottom, centerY, left, right}] }

  if (columns.length > 0) {
    // Wave mode: columns are explicit DOM elements
    for (var c = 0; c < columns.length; c++) {
      var colRect = columns[c].getBoundingClientRect();
      var cards = columns[c].querySelectorAll('.agent-card');
      var cardList = [];
      for (var k = 0; k < cards.length; k++) {
        var agentId = cards[k].getAttribute('data-agent-id');
        if (!agentId) continue;
        var cr = cards[k].getBoundingClientRect();
        cardList.push({
          id: agentId,
          top: relY(cr.top),
          bottom: relY(cr.bottom),
          centerY: relY(cr.top + cr.height / 2),
          left: relX(cr.left),
          right: relX(cr.right)
        });
      }
      cardList.sort(function (a, b) { return a.top - b.top; });
      colData.push({
        left: relX(colRect.left),
        right: relX(colRect.right),
        top: relY(colRect.top),
        bottom: relY(colRect.bottom),
        cards: cardList
      });
    }
  } else {
    // Chain mode fallback: infer columns from card x-positions
    var allCards = container.querySelectorAll('.agent-card');
    var cardInfos = [];
    for (var k = 0; k < allCards.length; k++) {
      var agentId = allCards[k].getAttribute('data-agent-id');
      if (!agentId) continue;
      var cr = allCards[k].getBoundingClientRect();
      cardInfos.push({
        id: agentId,
        top: relY(cr.top),
        bottom: relY(cr.bottom),
        centerY: relY(cr.top + cr.height / 2),
        left: relX(cr.left),
        right: relX(cr.right),
        centerX: relX(cr.left + cr.width / 2)
      });
    }
    // Sort by x-center and cluster into columns (threshold 100px)
    cardInfos.sort(function (a, b) { return a.centerX - b.centerX; });
    var groups = [];
    for (var k = 0; k < cardInfos.length; k++) {
      if (groups.length === 0 || cardInfos[k].centerX - groups[groups.length - 1].anchor > 100) {
        groups.push({ anchor: cardInfos[k].centerX, cards: [cardInfos[k]] });
      } else {
        groups[groups.length - 1].cards.push(cardInfos[k]);
      }
    }
    for (var g = 0; g < groups.length; g++) {
      var grp = groups[g].cards;
      grp.sort(function (a, b) { return a.top - b.top; });
      var minLeft = grp[0].left, maxRight = grp[0].right;
      var minTop = grp[0].top, maxBottom = grp[0].bottom;
      for (var k = 1; k < grp.length; k++) {
        if (grp[k].left < minLeft) minLeft = grp[k].left;
        if (grp[k].right > maxRight) maxRight = grp[k].right;
        if (grp[k].top < minTop) minTop = grp[k].top;
        if (grp[k].bottom > maxBottom) maxBottom = grp[k].bottom;
      }
      colData.push({
        left: minLeft - 10,
        right: maxRight + 10,
        top: minTop - 10,
        bottom: maxBottom + 10,
        cards: grp
      });
    }
  }

  if (colData.length === 0) return { nodes: {}, exits: {}, entries: {} };

  // ---- Step 2: Compute v-corridor x-coordinates ----
  var vCorridors = []; // array of x-coordinates
  for (var i = 0; i < colData.length - 1; i++) {
    vCorridors.push(Math.round((colData[i].right + colData[i + 1].left) / 2));
  }

  // ---- Step 3: Compute free-zones per column ----
  // freeZones[colIdx] = [{min, max}, ...] — y-ranges where horizontal crossing is clear
  var freeZones = [];
  for (var c = 0; c < colData.length; c++) {
    var zones = [];
    var col = colData[c];
    var cds = col.cards;
    if (cds.length === 0) {
      // Entire column is free
      zones.push({ min: col.top, max: col.bottom });
    } else {
      // Skip zone above first card — contains wave/chain title header
      // Between cards
      for (var k = 0; k < cds.length - 1; k++) {
        var gapTop = cds[k].bottom + PATHWAY_MARGIN;
        var gapBot = cds[k + 1].top - PATHWAY_MARGIN;
        if (gapBot > gapTop) {
          zones.push({ min: gapTop, max: gapBot });
        }
      }
      // Below last card
      if (col.bottom - cds[cds.length - 1].bottom > PATHWAY_MARGIN * 2) {
        zones.push({ min: cds[cds.length - 1].bottom + PATHWAY_MARGIN, max: col.bottom });
      }
    }
    freeZones.push(zones);
  }

  // ---- Step 4: Build y-set ----
  var yMap = {}; // deduplicate
  // Card center-y values
  for (var c = 0; c < colData.length; c++) {
    for (var k = 0; k < colData[c].cards.length; k++) {
      var cy = Math.round(colData[c].cards[k].centerY);
      yMap[cy] = true;
    }
  }
  // Gap midpoints
  for (var c = 0; c < colData.length; c++) {
    for (var z = 0; z < freeZones[c].length; z++) {
      var mid = Math.round((freeZones[c][z].min + freeZones[c][z].max) / 2);
      yMap[mid] = true;
    }
  }
  // Regular STEP intervals
  var minY = colData[0].top;
  var maxY = colData[0].bottom;
  for (var c = 1; c < colData.length; c++) {
    if (colData[c].top < minY) minY = colData[c].top;
    if (colData[c].bottom > maxY) maxY = colData[c].bottom;
  }
  for (var y = Math.round(minY); y <= maxY; y += PATHWAY_STEP) {
    yMap[y] = true;
  }

  var ySet = Object.keys(yMap).map(Number);
  ySet.sort(function (a, b) { return a - b; });

  // ---- Step 5: Create nodes and edges ----
  var nodes = {}; // key -> { x, y, adj: [key, ...] }

  function addNode(key, x, y) {
    if (!nodes[key]) nodes[key] = { x: x, y: y, adj: [] };
  }

  function addEdge(keyA, keyB) {
    if (!nodes[keyA] || !nodes[keyB] || keyA === keyB) return;
    if (nodes[keyA].adj.indexOf(keyB) === -1) nodes[keyA].adj.push(keyB);
    if (nodes[keyB].adj.indexOf(keyA) === -1) nodes[keyB].adj.push(keyA);
  }

  // V-corridor nodes
  for (var v = 0; v < vCorridors.length; v++) {
    var vx = vCorridors[v];
    for (var yi = 0; yi < ySet.length; yi++) {
      addNode('v:' + v + ':' + ySet[yi], vx, ySet[yi]);
    }
    // V-edges: connect consecutive y values on same corridor
    for (var yi = 0; yi < ySet.length - 1; yi++) {
      addEdge('v:' + v + ':' + ySet[yi], 'v:' + v + ':' + ySet[yi + 1]);
    }
  }

  // ---- Step 6: H-edges — cross through columns ----
  for (var c = 0; c < colData.length; c++) {
    var vLeft = c - 1;  // v-corridor index on left (-1 means none)
    var vRight = c;     // v-corridor index on right (== vCorridors.length means none)

    for (var yi = 0; yi < ySet.length; yi++) {
      var y = ySet[yi];
      // Check if y is in a free-zone of this column
      var isFree = false;
      for (var z = 0; z < freeZones[c].length; z++) {
        if (y >= freeZones[c][z].min && y <= freeZones[c][z].max) {
          isFree = true;
          break;
        }
      }
      if (isFree && vLeft >= 0 && vRight < vCorridors.length) {
        addEdge('v:' + vLeft + ':' + y, 'v:' + vRight + ':' + y);
      }
    }
  }

  // ---- Step 7: Card stubs ----
  var exits = {};   // agentId -> node key
  var entries = {};  // agentId -> node key

  for (var c = 0; c < colData.length; c++) {
    var vRightIdx = c;       // v-corridor on the right of this column
    var vLeftIdx = c - 1;    // v-corridor on the left of this column

    for (var k = 0; k < colData[c].cards.length; k++) {
      var card = colData[c].cards[k];
      var cy = Math.round(card.centerY);

      // Exit stub (right side -> v-corridor on the right)
      if (vRightIdx < vCorridors.length) {
        var exitKey = 'exit:' + card.id;
        addNode(exitKey, card.right + PATHWAY_PAD, cy);
        exits[card.id] = exitKey;
        // Connect to v-corridor node at same y
        var vNodeKey = 'v:' + vRightIdx + ':' + cy;
        if (nodes[vNodeKey]) {
          addEdge(exitKey, vNodeKey);
        }
      }

      // Entry stub (left side -> v-corridor on the left)
      if (vLeftIdx >= 0) {
        var entryKey = 'entry:' + card.id;
        addNode(entryKey, card.left - PATHWAY_PAD, cy);
        entries[card.id] = entryKey;
        // Connect to v-corridor node at same y
        var vNodeKey = 'v:' + vLeftIdx + ':' + cy;
        if (nodes[vNodeKey]) {
          addEdge(entryKey, vNodeKey);
        }
      }
    }
  }

  return { nodes: nodes, exits: exits, entries: entries };
}

// ---------------------------------------------------------------------------
// BFS Shortest Path (private)
// ---------------------------------------------------------------------------

/**
 * BFS shortest path through the pathway grid.
 * @param {Object} graph — { nodes: { key -> { x, y, adj: [...] } } }
 * @param {string} startKey — starting node key
 * @param {string} endKey — target node key
 * @returns {Array|null} — array of { x, y } coordinates, or null
 */
function bfsPath(graph, startKey, endKey) {
  if (!graph.nodes[startKey] || !graph.nodes[endKey]) return null;
  if (startKey === endKey) {
    var n = graph.nodes[startKey];
    return [{ x: n.x, y: n.y }];
  }

  var visited = {};
  visited[startKey] = null; // parent is null for start
  var queue = [startKey];
  var head = 0;

  while (head < queue.length) {
    var current = queue[head++];
    var adj = graph.nodes[current].adj;

    for (var i = 0; i < adj.length; i++) {
      var neighbor = adj[i];
      if (visited.hasOwnProperty(neighbor)) continue;
      visited[neighbor] = current;

      if (neighbor === endKey) {
        // Reconstruct path
        var path = [];
        var node = endKey;
        while (node !== null) {
          var nd = graph.nodes[node];
          path.push({ x: nd.x, y: nd.y });
          node = visited[node];
        }
        path.reverse();
        return path;
      }

      queue.push(neighbor);
    }
  }

  return null; // no path found
}

// ---------------------------------------------------------------------------
// Dependency Line Drawing (exported)
// ---------------------------------------------------------------------------

/**
 * Draw dependency lines using pathway grid BFS routing.
 * Lines travel strictly through corridor gaps, never through cards.
 * Each line highlights blue on hover.
 *
 * @param {SVGElement} svg
 * @param {Array} agents
 * @param {Object} agentMap — agent ID -> agent object
 * @param {Object} cardElements — agent ID -> DOM element
 * @param {HTMLElement} container — the pipeline container element
 */
export function drawDependencyLines(svg, agents, agentMap, cardElements, container) {
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  var scrollW = container.scrollWidth;
  var scrollH = container.scrollHeight;
  if (scrollW === 0 || scrollH === 0) return;

  svg.setAttribute('width', scrollW);
  svg.setAttribute('height', scrollH);
  svg.setAttribute('viewBox', '0 0 ' + scrollW + ' ' + scrollH);

  var svgNS = 'http://www.w3.org/2000/svg';

  // Defs — glow filter
  var defs = document.createElementNS(svgNS, 'defs');
  var glowFilter = document.createElementNS(svgNS, 'filter');
  glowFilter.setAttribute('id', 'dep-glow');
  glowFilter.setAttribute('x', '-20%');
  glowFilter.setAttribute('y', '-20%');
  glowFilter.setAttribute('width', '140%');
  glowFilter.setAttribute('height', '140%');
  var feGauss = document.createElementNS(svgNS, 'feGaussianBlur');
  feGauss.setAttribute('stdDeviation', '3');
  feGauss.setAttribute('result', 'blur');
  glowFilter.appendChild(feGauss);
  var feMerge = document.createElementNS(svgNS, 'feMerge');
  var feMergeBlur = document.createElementNS(svgNS, 'feMergeNode');
  feMergeBlur.setAttribute('in', 'blur');
  var feMergeOrig = document.createElementNS(svgNS, 'feMergeNode');
  feMergeOrig.setAttribute('in', 'SourceGraphic');
  feMerge.appendChild(feMergeBlur);
  feMerge.appendChild(feMergeOrig);
  glowFilter.appendChild(feMerge);
  defs.appendChild(glowFilter);
  svg.appendChild(defs);

  // Build cache key from card positions (changes when layout shifts)
  var cacheKeyParts = [];
  for (var ck in cardElements) {
    var rect = cardElements[ck].getBoundingClientRect();
    cacheKeyParts.push(ck + ':' + Math.round(rect.left) + ',' + Math.round(rect.top) + ',' + Math.round(rect.width) + ',' + Math.round(rect.height));
  }
  var cacheKey = cacheKeyParts.sort().join('|') + '|' + scrollW + 'x' + scrollH;

  // Reuse cached grid if layout hasn't changed
  var grid;
  if (_bfsCache.key === cacheKey && _bfsCache.grid) {
    grid = _bfsCache.grid;
  } else {
    grid = buildPathwayGrid(container);
    _bfsCache = { key: cacheKey, grid: grid, paths: {} };
  }

  // Draw each dependency
  for (var i = 0; i < agents.length; i++) {
    var agent = agents[i];
    var dependsOn = agent.depends_on || [];

    for (var d = 0; d < dependsOn.length; d++) {
      var depId = dependsOn[d];
      var fromCard = cardElements[depId];
      var toCard = cardElements[agent.id];
      if (!fromCard || !toCard) continue;

      var exitKey = grid.exits[depId];
      var entryKey = grid.entries[agent.id];
      if (!exitKey || !entryKey) continue;

      // Use cached path if available
      var pathCacheKey = exitKey + '->' + entryKey;
      var pathResult = _bfsCache.paths[pathCacheKey];
      if (pathResult === undefined) {
        pathResult = bfsPath(grid, exitKey, entryKey);
        _bfsCache.paths[pathCacheKey] = pathResult;
      }
      if (!pathResult || pathResult.length < 2) continue;
      var path = pathResult;

      // Build polyline points string
      var points = '';
      for (var p = 0; p < path.length; p++) {
        if (p > 0) points += ' ';
        points += path[p].x + ',' + path[p].y;
      }

      var depAgent = agentMap[depId];
      var depStatus = depAgent ? depAgent.status : 'pending';

      // SVG group for hover interaction
      var group = document.createElementNS(svgNS, 'g');
      group.setAttribute('class', 'dep-group');
      group.setAttribute('data-from', depId);
      group.setAttribute('data-to', agent.id);

      // Visible line
      var visLine = document.createElementNS(svgNS, 'polyline');
      visLine.setAttribute('points', points);
      visLine.setAttribute('fill', 'none');
      visLine.setAttribute('stroke-linejoin', 'round');
      visLine.setAttribute('stroke-linecap', 'round');

      if (depStatus === 'completed') {
        visLine.setAttribute('stroke', '#34d399');
        visLine.setAttribute('stroke-width', '2');
        visLine.setAttribute('stroke-opacity', '0.8');
        visLine.setAttribute('filter', 'url(#dep-glow)');
        visLine.setAttribute('class', 'dep-line dep-line-active dep-visible');
      } else if (depStatus === 'in_progress') {
        visLine.setAttribute('stroke', '#9b7cf0');
        visLine.setAttribute('stroke-width', '2');
        visLine.setAttribute('stroke-opacity', '0.7');
        visLine.setAttribute('filter', 'url(#dep-glow)');
        visLine.setAttribute('class', 'dep-line dep-line-progress dep-visible');
      } else {
        visLine.setAttribute('stroke', '#6E6E73');
        visLine.setAttribute('stroke-width', '1.5');
        visLine.setAttribute('stroke-opacity', '0.3');
        visLine.setAttribute('stroke-dasharray', '6 4');
        visLine.setAttribute('class', 'dep-line dep-visible');
      }

      // Hit area (wide transparent stroke for hover)
      var hitArea = document.createElementNS(svgNS, 'polyline');
      hitArea.setAttribute('points', points);
      hitArea.setAttribute('class', 'dep-hit-area');
      hitArea.setAttribute('stroke-linejoin', 'round');
      hitArea.setAttribute('stroke-linecap', 'round');

      group.appendChild(visLine);
      group.appendChild(hitArea);
      svg.appendChild(group);
    }
  }
}

// ---------------------------------------------------------------------------
// Sibling Communication Line Drawing (exported)
// ---------------------------------------------------------------------------

/**
 * Draw sibling communication lines between agents that read each other's
 * progress files (via non-empty `sibling_reads` arrays in progress data).
 * Lines are dashed blue, drawn AFTER dependency lines but with lower opacity.
 * Reuses the cached BFS pathway grid from drawDependencyLines.
 *
 * @param {SVGElement} svg
 * @param {Array} agents
 * @param {Object} agentMap — agent ID -> agent object
 * @param {Object} cardElements — agent ID -> DOM element
 * @param {HTMLElement} container — the pipeline container element
 * @param {Object} progressData — task ID -> progress file data (must contain sibling_reads)
 */
export function drawSiblingLines(svg, agents, agentMap, cardElements, container, progressData) {
  if (!progressData) return;

  // Reuse the cached grid — drawDependencyLines must have been called first
  var grid = _bfsCache.grid;
  if (!grid) return;

  var svgNS = 'http://www.w3.org/2000/svg';

  for (var i = 0; i < agents.length; i++) {
    var agent = agents[i];
    var progress = progressData[agent.id];
    if (!progress || !progress.sibling_reads || !Array.isArray(progress.sibling_reads) || progress.sibling_reads.length === 0) continue;

    var siblingReads = progress.sibling_reads;

    for (var s = 0; s < siblingReads.length; s++) {
      var siblingId = siblingReads[s];
      var fromCard = cardElements[agent.id];
      var toCard = cardElements[siblingId];
      if (!fromCard || !toCard) continue;

      // Determine routing direction: use exit/entry based on wave positions
      var fromAgent = agentMap[agent.id];
      var toAgent = agentMap[siblingId];
      var exitKey, entryKey;

      if (fromAgent && toAgent && fromAgent.wave <= toAgent.wave) {
        exitKey = grid.exits[agent.id];
        entryKey = grid.entries[siblingId];
      } else if (fromAgent && toAgent && fromAgent.wave > toAgent.wave) {
        exitKey = grid.exits[siblingId];
        entryKey = grid.entries[agent.id];
      } else {
        // Same wave or no wave info — try exit from reader to entry of sibling
        exitKey = grid.exits[agent.id];
        entryKey = grid.entries[siblingId];
        // If that fails, try the reverse
        if (!exitKey || !entryKey) {
          exitKey = grid.exits[siblingId];
          entryKey = grid.entries[agent.id];
        }
      }

      if (!exitKey || !entryKey) continue;

      // Use cached path if available
      var pathCacheKey = exitKey + '->' + entryKey;
      var pathResult = _bfsCache.paths[pathCacheKey];
      if (pathResult === undefined) {
        pathResult = bfsPath(grid, exitKey, entryKey);
        _bfsCache.paths[pathCacheKey] = pathResult;
      }
      if (!pathResult || pathResult.length < 2) continue;
      var path = pathResult;

      // Build polyline points string
      var points = '';
      for (var p = 0; p < path.length; p++) {
        if (p > 0) points += ' ';
        points += path[p].x + ',' + path[p].y;
      }

      // SVG group for hover interaction
      var group = document.createElementNS(svgNS, 'g');
      group.setAttribute('class', 'sibling-group');
      group.setAttribute('data-from', agent.id);
      group.setAttribute('data-to', siblingId);

      // Visible line — dashed blue with lower opacity
      var visLine = document.createElementNS(svgNS, 'polyline');
      visLine.setAttribute('points', points);
      visLine.setAttribute('fill', 'none');
      visLine.setAttribute('stroke', '#60a5fa');
      visLine.setAttribute('stroke-width', '1.5');
      visLine.setAttribute('stroke-dasharray', '4 3');
      visLine.setAttribute('stroke-opacity', '0.5');
      visLine.setAttribute('stroke-linejoin', 'round');
      visLine.setAttribute('stroke-linecap', 'round');
      visLine.setAttribute('class', 'sibling-line sibling-visible');

      // Hit area (wide transparent stroke for hover)
      var hitArea = document.createElementNS(svgNS, 'polyline');
      hitArea.setAttribute('points', points);
      hitArea.setAttribute('class', 'sibling-hit-area');
      hitArea.setAttribute('stroke-linejoin', 'round');
      hitArea.setAttribute('stroke-linecap', 'round');

      group.appendChild(visLine);
      group.appendChild(hitArea);
      svg.appendChild(group);
    }
  }
}

// ---------------------------------------------------------------------------
// Card Hover Effects (exported)
// ---------------------------------------------------------------------------

/**
 * Set up card hover effects for dependency line highlighting.
 * Uses event delegation on the container with mouseenter/mouseleave (capture: true).
 * Removes prior delegated handlers before attaching new ones.
 *
 * @param {HTMLElement} container — the pipeline container element
 * @param {SVGElement} svg — the dependency lines SVG element
 */
export function setupCardHoverEffects(container, svg) {
  // Remove prior delegated handlers before attaching new ones
  if (container._depMouseEnter) {
    container.removeEventListener('mouseenter', container._depMouseEnter, true);
    container.removeEventListener('mouseleave', container._depMouseLeave, true);
  }

  container._depMouseEnter = function (e) {
    var card = e.target.closest('.agent-card[data-agent-id]');
    if (!card) return;
    var agentId = card.getAttribute('data-agent-id');
    var groups = svg.querySelectorAll('.dep-group');
    var hasRelevant = false;

    for (var g = 0; g < groups.length; g++) {
      var from = groups[g].getAttribute('data-from');
      var to = groups[g].getAttribute('data-to');

      if (to === agentId) {
        groups[g].classList.add('dep-highlight-needs');
        hasRelevant = true;
      } else if (from === agentId) {
        groups[g].classList.add('dep-highlight-blocks');
        hasRelevant = true;
      } else {
        groups[g].classList.add('dep-dimmed');
      }
    }

    // Sibling communication lines
    var siblingGroups = svg.querySelectorAll('.sibling-group');
    for (var g = 0; g < siblingGroups.length; g++) {
      var from = siblingGroups[g].getAttribute('data-from');
      var to = siblingGroups[g].getAttribute('data-to');

      if (from === agentId || to === agentId) {
        siblingGroups[g].classList.add('sibling-highlight');
        hasRelevant = true;
      } else {
        siblingGroups[g].classList.add('sibling-dimmed');
      }
    }

    if (hasRelevant) {
      svg.classList.add('dep-hover-active');
    }
  };

  container._depMouseLeave = function (e) {
    var card = e.target.closest('.agent-card[data-agent-id]');
    if (!card) return;
    var groups = svg.querySelectorAll('.dep-group');
    for (var g = 0; g < groups.length; g++) {
      groups[g].classList.remove('dep-highlight-needs', 'dep-highlight-blocks', 'dep-dimmed');
    }

    // Clear sibling line hover states
    var siblingGroups = svg.querySelectorAll('.sibling-group');
    for (var g = 0; g < siblingGroups.length; g++) {
      siblingGroups[g].classList.remove('sibling-highlight', 'sibling-dimmed');
    }

    svg.classList.remove('dep-hover-active');
  };

  container.addEventListener('mouseenter', container._depMouseEnter, true);
  container.addEventListener('mouseleave', container._depMouseLeave, true);
}
