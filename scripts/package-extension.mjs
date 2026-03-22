#!/usr/bin/env node

/**
 * package-extension.mjs
 *
 * Build script for packaging Synapse as a VS Code extension (.vsix).
 *
 * Prerequisites (run before this script, or use `npm run package:extension`):
 *   - Extension TypeScript compiled to dist/extension/ via `npm run build:extension`
 *   - Webview React app built to dist/webview/ via `npm run build:webview`
 *
 * This script:
 *   1. Verifies that both dist/extension/ and dist/webview/ exist
 *   2. Ensures synapse-logo.svg is present at the project root
 *   3. Runs `npx @vscode/vsce package` to produce the .vsix file
 *
 * Usage:
 *   node scripts/package-extension.mjs          # Package with default options
 *   node scripts/package-extension.mjs --out .  # Specify output directory
 */

import { existsSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');

// ── Preflight checks ─────────────────────────────────────────────────────────

const distExtension = resolve(projectRoot, 'dist/extension');
const distWebview = resolve(projectRoot, 'dist/webview');
const logoSource = resolve(projectRoot, 'electron/assets/synapse-logo.svg');
const logoDest = resolve(projectRoot, 'synapse-logo.svg');

let hasErrors = false;

if (!existsSync(resolve(distExtension, 'extension.js'))) {
  console.error(
    '  ERROR: dist/extension/extension.js not found.\n' +
    '         Run `npm run build:extension` first.'
  );
  hasErrors = true;
}

if (!existsSync(distWebview)) {
  console.error(
    '  ERROR: dist/webview/ not found.\n' +
    '         Run `npm run build:webview` first.'
  );
  hasErrors = true;
}

if (hasErrors) {
  process.exit(1);
}

// Ensure logo is at project root (copy from electron/assets if missing)
if (!existsSync(logoDest) && existsSync(logoSource)) {
  console.log('  Copying synapse-logo.svg to project root...');
  copyFileSync(logoSource, logoDest);
}

if (!existsSync(logoDest)) {
  console.error(
    '  ERROR: synapse-logo.svg not found at project root or electron/assets/.\n' +
    '         The VSIX icon will be missing.'
  );
  // Non-fatal — continue packaging without icon
}

// ── Package with vsce ─────────────────────────────────────────────────────────

console.log('');
console.log('  Packaging Synapse VS Code extension...');
console.log('');

// Forward any CLI args (e.g., --out, --pre-release) to vsce
const extraArgs = process.argv.slice(2).join(' ');
const vsceCmd = `npx --yes @vscode/vsce package ${extraArgs}`.trim();

try {
  execSync(vsceCmd, {
    cwd: projectRoot,
    stdio: 'inherit',
  });
  console.log('');
  console.log('  VSIX package created successfully.');
  console.log('  Install with: code --install-extension synapse-*.vsix');
  console.log('');
} catch (err) {
  console.error('');
  console.error('  ERROR: vsce package failed. See output above for details.');
  process.exit(1);
}
