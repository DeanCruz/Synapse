# Layout Modes: Waves vs Chains

The Synapse Dashboard supports two visualization modes for rendering agent task pipelines. The mode is determined by the `task.type` field in `initialization.json`, which is set to either `"Waves"` or `"Chains"` during swarm planning.

---

## Mode Selection

```javascript
// In DashboardContent (App.jsx)
const taskType = task?.type ?? 'Waves';

{taskType === 'Chains'
  ? <ChainPipeline status={currentStatus} ... />
  : <WavePipeline status={currentStatus} ... />}
```

**Default:** Waves mode is the default when no type is specified.

---

## Waves Mode

**Component:** `WavePipeline` (`/src/ui/components/WavePipeline.jsx`)

**Best for:** Broad, parallel workloads with many independent tasks per wave.

### Visual Structure

```
+-- Wave 1: Setup ----+  +-- Wave 2: Core -----+  +-- Wave 3: Integration +
| Wave 1: Setup  2/2  |  | Wave 2: Core   1/4  |  | Wave 3: Integ  0/2   |
| [completed]          |  | [in_progress]        |  | [pending]             |
|                      |  |                      |  |                       |
| +--[1.1 Task A]---+ |  | +--[2.1 Task C]---+ |  | +--[3.1 Task G]---+  |
| | completed        | |  | | in_progress      | |  | | pending          |  |
| +------------------+ |  | +------------------+ |  | +------------------+  |
|                      |  |                      |  |                       |
| +--[1.2 Task B]---+ |  | +--[2.2 Task D]---+ |  | +--[3.2 Task H]---+  |
| | completed        | |  | | pending          | |  | | pending          |  |
| +------------------+ |  | +------------------+ |  | +------------------+  |
|                      |  |                      |  |                       |
|                      |  | +--[2.3 Task E]---+ |  |                       |
|                      |  | | pending          | |  |                       |
|                      |  | +------------------+ |  |                       |
+----------------------+  +----------------------+  +-----------------------+
```

### Layout Details

- Waves are rendered as **vertical columns** (`flex-direction: column`)
- The pipeline scrolls **horizontally** when waves overflow
- Each column has:
  - A wave header with title, completed/total count, and status badge
  - Agent cards stacked vertically with 8px gaps
- Column sizing: `min-width: 280px`, `max-width: 320px`

### CSS Classes

| Class | Element |
|---|---|
| `.wave-pipeline` | Container (flex, horizontal scroll) |
| `.wave-column` | Individual wave column |
| `.wave-column.wave-active` | Purple border/glow when wave has active agents |
| `.wave-column.wave-done` | Green border/glow when wave is complete |
| `.wave-header` | Column header row |
| `.wave-title` | Wave name text |
| `.wave-count` | Completed/total count |

### Dependency Lines

Waves mode includes an **SVG overlay** for drawing dependency lines between agent cards. Lines are routed through corridor gaps between columns using BFS pathfinding.

**Components involved:**
- SVG element: `<svg ref={svgRef} className="chain-svg" />` (overlay, absolutely positioned)
- `drawDependencyLines()` -- Draws lines between dependent cards
- `setupCardHoverEffects()` -- Sets up hover highlight behavior

Lines are redrawn:
- After every render where `status` changes
- When the container is resized (via `ResizeObserver`)

### Unblocked Tasks Toast

When tasks become newly dispatchable (dependencies satisfied), a green toast notification appears at the top of the pipeline:

```
[>] 3 tasks ready for dispatch    1.3, 2.1, 2.4
```

Auto-dismisses after 8 seconds. Clickable to dismiss manually.

---

## Chains Mode

**Component:** `ChainPipeline` (`/src/ui/components/ChainPipeline.jsx`)

**Best for:** Narrow, deep dependency pipelines where tasks flow sequentially through waves.

### Visual Structure

```
+------------+-------------------+-------------------+-------------------+
|            | Wave 1: Setup     | Wave 2: Core      | Wave 3: Integrate |
|            | [completed]       | [in_progress]     | [pending]         |
+------------+-------------------+-------------------+-------------------+
| Auth Chain | [1.1 Auth Setup]  | [2.1 Auth API]    | [3.1 Auth Test]   |
|            | completed         | in_progress        | pending           |
+------------+-------------------+-------------------+-------------------+
| Data Chain | [1.2 DB Schema]   |                   | [3.2 Data Test]   |
|            | completed         |                   | pending           |
+------------+-------------------+-------------------+-------------------+
| UI Chain   | [1.3 Components]  | [2.3 Pages]       | [3.3 UI Test]     |
|            | completed         | pending            | pending           |
+------------+-------------------+-------------------+-------------------+
```

### Layout Details

- Chains are rendered as **horizontal rows** (CSS Grid/Flex table layout)
- The pipeline scrolls **horizontally** when wave columns overflow
- Structure:
  - **Header row** with wave labels (sticky at top)
  - **Chain rows** with one cell per wave column
  - **Chain labels** are sticky on the left side
- Each cell contains at most one agent card (the task from that chain in that wave)
- Empty cells are rendered as blank space

### CSS Classes

| Class | Element |
|---|---|
| `.chain-pipeline` | Container (flex column, horizontal scroll) |
| `.chain-header-row` | Top row with wave headers (sticky) |
| `.chain-label-cell` | Empty cell in header row (aligns with labels) |
| `.chain-wave-header` | Wave title cell in header row |
| `.chain-wave-active` | Purple bottom border for active wave |
| `.chain-wave-done` | Green bottom border for completed wave |
| `.chain-row` | Individual chain row |
| `.chain-label` | Left-side chain name (sticky) |
| `.chain-cell` | Cell for one wave-chain intersection |

### Chain Data Structure

Chains are defined in `initialization.json`:

```json
{
  "chains": [
    {
      "id": "auth",
      "name": "Auth Chain",
      "tasks": ["1.1", "2.1", "3.1"]
    },
    {
      "id": "data",
      "name": "Data Chain",
      "tasks": ["1.2", "3.2"]
    }
  ]
}
```

Each chain lists the task IDs that belong to it. The `ChainPipeline` component maps each task to its wave column by looking up `agent.wave` in the agent map.

### Dependency Lines in Chain Mode

Chain mode currently does **not** draw SVG dependency lines. The visual structure of chains (left-to-right flow) implicitly shows dependencies. Dependency line support is planned as a follow-up enhancement.

---

## Dependency Line System (Waves Mode)

**File:** `/src/ui/utils/dependencyLines.js`

The dependency line system uses a BFS (Breadth-First Search) pathfinding algorithm to route lines through corridor gaps between wave columns. This prevents lines from crossing through agent cards or wave headers.

### Architecture

```
buildPathwayGrid(container)
  |-- Detects wave columns and card positions
  |-- Computes vertical corridors between columns
  |-- Computes free-zones (gaps between cards)
  |-- Builds a graph of nodes and edges
  |-- Returns { nodes, exits, entries }

bfsPath(graph, startKey, endKey)
  |-- BFS shortest path through the grid
  |-- Returns array of {x, y} coordinates

drawDependencyLines(svg, agents, agentMap, cardElements, container)
  |-- Builds/reuses pathway grid (cached)
  |-- For each dependency, BFS-routes a path
  |-- Draws SVG polylines with status-colored styling
  |-- Adds invisible wide hit areas for hover detection

setupCardHoverEffects(container, svg)
  |-- Delegated mouseenter/mouseleave on card elements
  |-- Highlights relevant dependency lines on hover
```

### Pathway Grid

The grid consists of:

1. **Vertical corridors** (`vCorridors[]`) -- x-coordinates in the gaps between wave columns
2. **Free-zones** (`freeZones[]`) -- y-ranges within each column where horizontal crossing is safe (between cards, below last card)
3. **Nodes** -- Points at intersections of corridors and y-coordinates. Key format: `v:{corridor}:{y}`
4. **Edges** -- Connections between adjacent nodes (vertical along corridors, horizontal through free-zones)
5. **Exit stubs** -- Points at the right edge of each card. Key: `exit:{agentId}`
6. **Entry stubs** -- Points at the left edge of each card. Key: `entry:{agentId}`

### Grid Constants

```javascript
PATHWAY_STEP = 15   // Node spacing along corridors (px)
PATHWAY_PAD = 6     // Stub offset from card edges (px)
PATHWAY_MARGIN = 3  // Free-zone margin around cards (px)
```

### Line Styling by Status

| Upstream Status | Stroke Color | Width | Opacity | Style |
|---|---|---|---|---|
| `completed` | `#34d399` (green) | `2` | `0.8` | Solid + glow filter |
| `in_progress` | `#9b7cf0` (purple) | `2` | `0.7` | Solid + glow filter |
| Other (pending) | `#6E6E73` (gray) | `1.5` | `0.3` | Dashed (`6 4`) |

### Hover Interactions

**Line hover:** Lines have a 12px-wide transparent hit area. On hover, the visible line turns blue (`#60a5fa`) with glow.

**Card hover:** When hovering over an agent card:
- Lines **coming into** the card (dependencies/"needs") highlight **red** (`#f87171`)
- Lines **going out** from the card (dependents/"blocks") highlight **blue** (`#60a5fa`)
- All unrelated lines **dim** to 8% opacity

CSS classes for hover states:

| Class | Applied To | Effect |
|---|---|---|
| `.dep-highlight-needs` | `.dep-group` | Red highlight for upstream dependencies |
| `.dep-highlight-blocks` | `.dep-group` | Blue highlight for downstream dependents |
| `.dep-dimmed` | `.dep-group` | Dims unrelated lines |
| `.dep-hover-active` | `svg` | Signals that a hover is active |

### Caching

The pathway grid and BFS paths are cached at the module level:

```javascript
var _bfsCache = { key: null, grid: null, paths: {} };
```

- **Grid cache key** -- Derived from card positions + container dimensions. Invalidated when any card moves.
- **Path cache** -- Individual BFS paths cached by `"exit:X->entry:Y"` keys. Invalidated when grid changes.

This avoids expensive BFS recomputation on every render when the layout hasn't changed.

---

## Choosing Between Modes

| Criterion | Waves | Chains |
|---|---|---|
| Task independence | Many independent tasks per wave | Tasks form named dependency chains |
| Visual emphasis | Parallel breadth | Sequential depth |
| Dependency visibility | SVG lines between cards | Implicit (left-to-right flow) |
| Best task count | 10-50+ tasks across 3-8 waves | 5-30 tasks in 2-6 chains |
| Scrolling | Horizontal (wave columns) | Horizontal (wave columns, with sticky labels) |

The mode is set once during planning via `task.type` in `initialization.json` and cannot be changed during execution.

---

## Stat Filtering

Both pipeline modes support stat-based filtering via the `activeStatFilter` prop. When a stat card is clicked (e.g., "Completed"), only agents matching that status are displayed:

- **Waves:** Waves with no matching agents are hidden entirely
- **Chains:** Chains with no visible agents are hidden entirely
- **Clearing:** Clicking the "Total" stat card or clicking the active filter again clears the filter

The filter state is managed in AppContext as `activeStatFilter` and passed down through `DashboardContent` to the pipeline components.
