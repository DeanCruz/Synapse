/**
 * Planning-time token budget estimator for master agent worker prompts.
 */

// --- Character-per-token ratios by content type ---
const CHAR_RATIOS = {
  prose: 4,
  code: 3,
  mixed: 3.5,
};

/**
 * Estimate the token count for a given text string.
 *
 * @param {string} text - The text to estimate tokens for.
 * @param {'prose'|'code'|'mixed'} [type='mixed'] - The content type.
 * @returns {number} Estimated token count (rounded up).
 */
function estimateTokens(text, type = 'mixed') {
  const ratio = CHAR_RATIOS[type] || CHAR_RATIOS.mixed;
  return Math.ceil(text.length / ratio);
}

/**
 * Format a token budget breakdown as a markdown table.
 *
 * @param {Object<string, {text: string, type?: string}>} sections - Named sections with text content.
 * @param {number} [budgetLimit=8000] - The total token budget.
 * @returns {string} Markdown table with per-section estimates, percentages, and optional warnings.
 */
function formatBudget(sections, budgetLimit = 8000) {
  const names = Object.keys(sections);
  const rows = [];
  let total = 0;

  for (const name of names) {
    const { text, type } = sections[name];
    const tokens = estimateTokens(text, type);
    total += tokens;
    rows.push({ name, tokens });
  }

  const lines = [];
  lines.push('| Section | Est. Tokens | % of Budget |');
  lines.push('|---|---|---|');

  for (const row of rows) {
    const pct = ((row.tokens / budgetLimit) * 100).toFixed(1);
    const flag = row.tokens > budgetLimit * 0.4 ? ' [!]' : '';
    lines.push(`| ${row.name} | ${row.tokens} | ${pct}%${flag} |`);
  }

  const totalPct = ((total / budgetLimit) * 100).toFixed(1);
  const totalFlag = total > budgetLimit * 0.4 ? ' [!]' : '';
  lines.push(`| **Total** | **${total}** | **${totalPct}%**${totalFlag} |`);

  if (total > budgetLimit) {
    lines.push('');
    lines.push(`> **WARNING:** Total estimated tokens (${total}) exceeds budget limit (${budgetLimit}) by ${total - budgetLimit} tokens.`);
  }

  return lines.join('\n');
}

/**
 * Check whether a set of sections fits within a token budget.
 *
 * @param {Object<string, {text: string, type?: string}>} sections - Named sections with text content.
 * @param {number} [budgetLimit=8000] - The total token budget.
 * @returns {{total: number, overBudget: boolean, sections: Object<string, number>}} Budget check result.
 */
function checkBudget(sections, budgetLimit = 8000) {
  const sectionTokens = {};
  let total = 0;

  for (const name of Object.keys(sections)) {
    const { text, type } = sections[name];
    const tokens = estimateTokens(text, type);
    sectionTokens[name] = tokens;
    total += tokens;
  }

  return {
    total,
    overBudget: total > budgetLimit,
    sections: sectionTokens,
  };
}

module.exports = {
  estimateTokens,
  formatBudget,
  checkBudget,
};
