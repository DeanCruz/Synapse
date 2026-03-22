/**
 * Validate the dependency graph defined by the agents[] array.
 * Checks for circular dependencies, dangling references, self-references, and orphan tasks.
 *
 * @param {Array} agents - Array of agent objects with { id, depends_on, wave } fields
 * @returns {{ valid: boolean, errors: Array<{type: string, message: string}>, warnings: Array<{type: string, message: string}> }}
 */
function validateDependencyGraph(agents) {
  const errors = [];
  const warnings = [];
  const idSet = new Set(agents.map(a => a.id));

  // Check A — Self-references
  for (const agent of agents) {
    if (agent.depends_on && agent.depends_on.includes(agent.id)) {
      errors.push({ type: 'self_ref', message: `Task ${agent.id} depends on itself` });
    }
  }

  // Check B — Dangling references
  for (const agent of agents) {
    if (agent.depends_on) {
      for (const dep of agent.depends_on) {
        if (!idSet.has(dep)) {
          errors.push({ type: 'dangling_ref', message: `Task ${agent.id} depends on ${dep} which does not exist` });
        }
      }
    }
  }

  // Check C — Circular dependencies (Kahn's algorithm)
  // Build adjacency list and in-degree map
  const inDegree = new Map();
  const adjacency = new Map();
  for (const agent of agents) {
    inDegree.set(agent.id, 0);
    adjacency.set(agent.id, []);
  }
  for (const agent of agents) {
    if (agent.depends_on) {
      for (const dep of agent.depends_on) {
        if (idSet.has(dep)) {
          adjacency.get(dep).push(agent.id);
          inDegree.set(agent.id, inDegree.get(agent.id) + 1);
        }
      }
    }
  }
  // BFS topological sort
  const queue = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }
  const sorted = [];
  while (queue.length > 0) {
    const node = queue.shift();
    sorted.push(node);
    for (const neighbor of adjacency.get(node)) {
      inDegree.set(neighbor, inDegree.get(neighbor) - 1);
      if (inDegree.get(neighbor) === 0) queue.push(neighbor);
    }
  }
  if (sorted.length < agents.length) {
    const cycleNodes = agents.filter(a => !sorted.includes(a.id)).map(a => a.id);
    errors.push({ type: 'cycle', message: `Circular dependency detected involving tasks: ${cycleNodes.join(', ')}` });
  }

  // Check D — Orphan tasks (warning only, Wave 1 exempt)
  const dependedOn = new Set();
  for (const agent of agents) {
    if (agent.depends_on) {
      for (const dep of agent.depends_on) dependedOn.add(dep);
    }
  }
  for (const agent of agents) {
    const wave = typeof agent.wave === 'string' ? parseInt(agent.wave, 10) : agent.wave;
    if (wave === 1) continue; // Wave 1 tasks are root tasks by design
    const hasDeps = agent.depends_on && agent.depends_on.length > 0;
    const isDependedOn = dependedOn.has(agent.id);
    if (!hasDeps && !isDependedOn) {
      warnings.push({ type: 'orphan', message: `Task ${agent.id} has no dependencies and nothing depends on it` });
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

module.exports = { validateDependencyGraph };
