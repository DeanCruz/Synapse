// staticRoutes.js — Extracted from server.js (lines 730-756)
// Updated to also serve src/client/ ES module files.

const fs = require('fs');
const path = require('path');
const { PUBLIC_DIR, ROOT, MIME_TYPES } = require('../utils/constants');

const SRC_CLIENT_DIR = path.join(ROOT, 'src', 'client');

/**
 * Serve static files from the PUBLIC_DIR directory and src/client/ for ES modules.
 * Handles index.html for root path, directory traversal prevention,
 * and MIME type detection.
 *
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {URL} url — parsed URL object
 */
function handleStaticRoute(req, res, url) {
  let filePath;

  // Serve src/client/ files for ES module imports
  if (url.pathname.startsWith('/src/client/')) {
    filePath = path.join(ROOT, url.pathname);
    // Prevent directory traversal
    if (!filePath.startsWith(SRC_CLIENT_DIR)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
  } else if (url.pathname === '/' || url.pathname === '/index.html') {
    filePath = path.join(PUBLIC_DIR, 'index.html');
  } else {
    filePath = path.join(PUBLIC_DIR, url.pathname);
  }

  // Prevent directory traversal for public/ files
  if (!filePath.startsWith(SRC_CLIENT_DIR) && !filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  });
}

module.exports = { handleStaticRoute };
