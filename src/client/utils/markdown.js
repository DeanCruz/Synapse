// Markdown-to-HTML Renderer — lightweight, zero-dependency, XSS-safe
// ES module. No external dependencies.
// Supports the subset of Markdown that Claude typically produces.

/**
 * Escape HTML special characters in a raw text string to prevent XSS.
 * Only call this on *input text*, not on generated HTML tags/attributes.
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Process inline markdown within a single line/block of already-escaped text.
 * Handles: bold, italic, inline code.
 * The input is HTML-escaped text (so < > & are already safe).
 * @param {string} text - HTML-escaped text
 * @returns {string} - HTML string with inline elements applied
 */
function processInline(text) {
  // Inline code: `code` — must come before bold/italic to protect contents.
  // Use a placeholder with no special chars that bold/italic regexes could match.
  // Placeholder format: \x00IC\x01{idx}\x00 — uses control chars, no _ or *
  const inlineCodePlaceholders = [];
  text = text.replace(/`([^`]+)`/g, (_, code) => {
    const idx = inlineCodePlaceholders.length;
    inlineCodePlaceholders.push('<code>' + code + '</code>');
    return '\x00IC\x01' + idx + '\x00';
  });

  // Bold: **text** or __text__
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/__(.+?)__/g, '<strong>$1</strong>');

  // Italic: *text* or _text_ (single, not double)
  text = text.replace(/\*([^*\n]+?)\*/g, '<em>$1</em>');
  text = text.replace(/_([^_\n]+?)_/g, '<em>$1</em>');

  // Restore inline code placeholders
  text = text.replace(/\x00IC\x01(\d+)\x00/g, (_, idx) => inlineCodePlaceholders[+idx]);

  return text;
}

/**
 * Convert a markdown string to an HTML string.
 * Safe to assign directly to element.innerHTML — raw input is HTML-escaped.
 *
 * Supported features:
 *  1. Fenced code blocks (```lang\n...\n```)
 *  2. Inline code (`code`)
 *  3. Bold (**text** or __text__)
 *  4. Italic (*text* or _text_)
 *  5. Headings H1–H3 (# / ## / ###)
 *  6. Unordered lists (- item / * item)
 *  7. Ordered lists (1. item)
 *  8. Paragraphs (blank-line-separated blocks)
 *  9. Line breaks (single newline within a paragraph → <br>)
 * 10. Horizontal rules (--- alone on a line)
 * 11. Blockquotes (> text)
 *
 * @param {string} text - Raw markdown string (may contain arbitrary user/assistant content)
 * @returns {string} - HTML string safe for innerHTML
 */
export function renderMarkdown(text) {
  if (!text || typeof text !== 'string') return '';

  // ── Step 1: Extract fenced code blocks and replace with placeholders ──────
  // This protects code block contents from all further processing.
  const codeBlockPlaceholders = [];
  text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const escapedCode = escapeHtml(code);
    const langAttr = lang ? ' class="language-' + escapeHtml(lang) + '"' : '';
    const html = '<pre><code' + langAttr + '>' + escapedCode + '</code></pre>';
    const idx = codeBlockPlaceholders.length;
    codeBlockPlaceholders.push(html);
    return '\x00CODE_BLOCK_' + idx + '\x00';
  });

  // ── Step 2: Escape HTML in remaining text ─────────────────────────────────
  // Split on placeholders so we only escape non-placeholder content.
  const parts = text.split(/(\x00CODE_BLOCK_\d+\x00)/);
  const escapedParts = parts.map(part => {
    if (/^\x00CODE_BLOCK_\d+\x00$/.test(part)) return part; // leave placeholder as-is
    return escapeHtml(part);
  });
  text = escapedParts.join('');

  // ── Step 3: Process block-level elements line by line ────────────────────
  // Split into lines for block processing.
  const lines = text.split('\n');
  const outputChunks = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Code block placeholder — emit directly
    if (/^\x00CODE_BLOCK_\d+\x00$/.test(line.trim())) {
      outputChunks.push(line.trim());
      i++;
      continue;
    }

    // Horizontal rule: line is exactly "---" (after HTML escaping, --- stays ---)
    if (/^\s*---\s*$/.test(line)) {
      outputChunks.push('<hr>');
      i++;
      continue;
    }

    // Headings: # / ## / ###
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const content = processInline(headingMatch[2]);
      outputChunks.push('<h' + level + '>' + content + '</h' + level + '>');
      i++;
      continue;
    }

    // Blockquote: lines starting with >
    // Collect consecutive blockquote lines into one <blockquote>
    if (/^&gt;\s?/.test(line)) {
      const bqLines = [];
      while (i < lines.length && /^&gt;\s?/.test(lines[i])) {
        bqLines.push(lines[i].replace(/^&gt;\s?/, ''));
        i++;
      }
      const bqContent = processInline(bqLines.join('\n').replace(/\n/g, '<br>'));
      outputChunks.push('<blockquote>' + bqContent + '</blockquote>');
      continue;
    }

    // Unordered list: lines starting with - or *
    if (/^\s*[-*]\s+/.test(line)) {
      const listItems = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        const itemText = lines[i].replace(/^\s*[-*]\s+/, '');
        listItems.push('<li>' + processInline(itemText) + '</li>');
        i++;
      }
      outputChunks.push('<ul>' + listItems.join('') + '</ul>');
      continue;
    }

    // Ordered list: lines starting with a number followed by ". "
    if (/^\s*\d+\.\s+/.test(line)) {
      const listItems = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        const itemText = lines[i].replace(/^\s*\d+\.\s+/, '');
        listItems.push('<li>' + processInline(itemText) + '</li>');
        i++;
      }
      outputChunks.push('<ol>' + listItems.join('') + '</ol>');
      continue;
    }

    // Blank line — paragraph separator, skip
    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }

    // Paragraph: collect consecutive non-blank, non-special lines
    const paraLines = [];
    while (i < lines.length) {
      const l = lines[i];
      // Stop collecting if we hit a blank line or a block-level element
      if (/^\s*$/.test(l)) break;
      if (/^\x00CODE_BLOCK_\d+\x00$/.test(l.trim())) break;
      if (/^\s*---\s*$/.test(l)) break;
      if (/^(#{1,3})\s+/.test(l)) break;
      if (/^&gt;\s?/.test(l)) break;
      if (/^\s*[-*]\s+/.test(l)) break;
      if (/^\s*\d+\.\s+/.test(l)) break;
      paraLines.push(l);
      i++;
    }

    if (paraLines.length > 0) {
      // Join lines with <br> for single-newline line breaks within a paragraph
      const paraContent = paraLines.map(l => processInline(l)).join('<br>');
      outputChunks.push('<p>' + paraContent + '</p>');
    }
  }

  // ── Step 4: Join chunks ───────────────────────────────────────────────────
  let html = outputChunks.join('\n');

  // ── Step 5: Restore code block placeholders ───────────────────────────────
  html = html.replace(/\x00CODE_BLOCK_(\d+)\x00/g, (_, idx) => codeBlockPlaceholders[+idx]);

  return html;
}
