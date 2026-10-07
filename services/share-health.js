// ═══════════════════════════════════════════════════════
// Share Health — fast async availability check with cache.
// Prevents sync fs operations from blocking the main
// process for 30-60 s when the network share is down.
// ═══════════════════════════════════════════════════════

const fs = require('fs');

let _status = { available: null, lastChecked: 0, path: '', error: '' };
const CACHE_TTL_MS = 30_000;  // trust a result for 30 s
const CHECK_TIMEOUT_MS = 3_000; // give up after 3 s

function getConfigSharePath() {
  try {
    return require('./config').getConfig()?.networkSharePath || '';
  } catch { return ''; }
}

/** Return cached status if still fresh, otherwise null. */
function cached() {
  if (_status.available !== null && Date.now() - _status.lastChecked < CACHE_TTL_MS) return _status;
  return null;
}

/** Async check with a hard timeout. Updates the cache. */
async function check() {
  const sharePath = getConfigSharePath();
  if (!sharePath) {
    _status = { available: false, lastChecked: Date.now(), path: '', error: 'No share configured' };
    return _status;
  }
  try {
    await Promise.race([
      fs.promises.access(sharePath, fs.constants.R_OK),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout: the network share did not respond within 3 seconds')), CHECK_TIMEOUT_MS))
    ]);
    _status = { available: true, lastChecked: Date.now(), path: sharePath, error: '' };
  } catch (err) {
    _status = { available: false, lastChecked: Date.now(), path: sharePath, error: err.message };
  }
  return _status;
}

/**
 * Sync guard — use before any blocking fs call to the share.
 * Returns true if the share is believed reachable (or unknown).
 * Returns false only when a *recent* async check proved it down.
 */
function isAvailableSync() {
  const c = cached();
  return c === null ? true : c.available;  // optimistic if no check yet
}

/** Force the cache to expire so the next guard re-checks. */
function invalidate() {
  _status = { available: null, lastChecked: 0, path: '', error: '' };
}

/** Convenience for IPC: returns the full status object. */
function getStatus() {
  return { ..._status };
}

module.exports = { check, isAvailableSync, invalidate, getStatus, cached };
