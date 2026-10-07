// ═══════════════════════════════════════════════════════════
// Remote sink — batches logs asynchronously to the dedicated
// server. Never blocks callers; all I/O happens on a timer.
//
// Flow:
//   add() → queue.push() (fast, persistent)
//   scheduleFlush() → debounce → flush() sends up to 200 entries
//   on error → exponential backoff, entries remain in queue
//   on 3 consecutive failures → `online = false`, caller can
//     display a banner; we keep retrying in the background.
// ═══════════════════════════════════════════════════════════

const { request } = require('./http-client');
const { sanitize } = require('./log-sanitizer');

const activityLog = { add() {} };

const BATCH_MAX         = 200;
const FLUSH_DEBOUNCE_MS = 2_000;
const BACKOFF_MIN_MS    = 2_000;
const BACKOFF_MAX_MS    = 60_000;
const FAILURE_THRESHOLD = 3;

const LEVEL_NUM = { debug: 0, info: 1, warn: 2, error: 3, fatal: 4 };
function normalizeLevel(v) {
  if (typeof v === 'number' && v >= 0 && v <= 4) return v | 0;
  if (typeof v === 'string' && LEVEL_NUM[v.toLowerCase()] !== undefined) {
    return LEVEL_NUM[v.toLowerCase()];
  }
  return 1;
}

function getHostname() {
  try { return require('os').hostname(); } catch { return 'unknown'; }
}

function cleanupLegacyQueueFiles() {
  try {
    const fs = require('fs');
    const path = require('path');
    const { app } = require('electron');
    const queuePath = path.join(app.getPath('userData'), 'pending-logs.ndjson');
    for (const file of [queuePath, `${queuePath}.compact`]) {
      try {
        if (fs.existsSync(file)) fs.unlinkSync(file);
      } catch { /* best effort */ }
    }
  } catch { /* no electron context */ }
}

class MemoryRetryQueue {
  constructor() {
    this.queue = [];
    this.nextSeq = 1;
  }

  async init() { /* memory-only by design: dedicated mode leaves no local queue file */ }

  push(entry) {
    if (this.queue.length >= 10_000) {
      const idx = this.queue.findIndex(e => (e.entry.level ?? 1) < 3);
      if (idx !== -1) this.queue.splice(idx, 1);
      else this.queue.shift();
    }
    const seq = this.nextSeq++;
    this.queue.push({ seq, entry });
    return seq;
  }

  takeBatch(max) {
    return this.queue.slice(0, max);
  }

  async ack(batch) {
    if (!batch.length) return;
    const seqs = new Set(batch.map(b => b.seq));
    this.queue = this.queue.filter(e => !seqs.has(e.seq));
  }

  nack() { /* entries stay in memory for retry */ }

  size() {
    return this.queue.length;
  }

  async close() {
    this.queue = [];
  }
}

class RemoteSink {
  constructor() {
    this.mode = 'dedicated';
    this.queue = null;
    this.timer = null;
    this.retryTimer = null;
    this.backoff = BACKOFF_MIN_MS;
    this.consecutiveFailures = 0;
    this.online = true;
    this.cfg = null;
    this.hostname = getHostname();
    this.flushing = false;
    this.lastError = null;
    this.lastFlushAt = null;
    this.lastSuccessAt = null;
    this.lastQueuedAt = null;
  }

  async init(cfg) {
    cleanupLegacyQueueFiles();
    this.queue = new MemoryRetryQueue();
    await this.queue.init();
    this.cfg = cfg;
  }

  reconfigure(cfg) { this.cfg = cfg; }

  // ── Public API mirroring local-sink ──

  async add(action, details = {}) {
    const level = normalizeLevel(details.level ?? details.severity ?? 'info');
    const entry = {
      ts: details.ts || new Date().toISOString(),
      level,
      source: details.source || action,
      message: details.message || action,
      context: this._stripContext(details)
    };
    this.queue.push(entry);
    this.lastQueuedAt = new Date().toISOString();
    this._scheduleFlush();
    return entry;
  }

  _stripContext(details) {
    const { level, severity, ts, source, message, ...ctx } = details;
    const safe = sanitize(ctx);
    return Object.keys(safe).length ? safe : null;
  }

  async getRecent(count = 10) {
    if (!this._canRead()) return [];
    try {
      const res = await request({
        baseUrl: this.cfg.apiBaseUrl,
        path: `/api/logs/recent?limit=${count}`,
        apiKey: this.cfg.readApiKey || this.cfg.apiKey,
        pinnedFingerprint: this.cfg.tlsFingerprint
      });
      return res.body;
    } catch {
      return [];
    }
  }

  async query(filters = {}) {
    if (!this._canRead()) {
      return { items: [], nextCursor: null };
    }
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) {
      if (v != null && v !== '') params.set(k, String(v));
    }
    const res = await request({
      baseUrl: this.cfg.apiBaseUrl,
      path: `/api/logs?${params.toString()}`,
      apiKey: this.cfg.readApiKey || this.cfg.apiKey,
      pinnedFingerprint: this.cfg.tlsFingerprint
    });
    return res.body;
  }

  async statsSummary(window = '24h') {
    if (!this._canRead()) {
      return {
        window,
        counts: { debug: 0, info: 0, warn: 0, error: 0, fatal: 0 },
        activeEquipos: 0,
        totalEvents: 0,
        topErrorEquipos: []
      };
    }
    const res = await request({
      baseUrl: this.cfg.apiBaseUrl,
      path: `/api/stats/summary?window=${encodeURIComponent(window)}`,
      apiKey: this.cfg.readApiKey || this.cfg.apiKey,
      pinnedFingerprint: this.cfg.tlsFingerprint
    });
    return res.body;
  }

  async equipos(search) {
    if (!this._canRead()) return [];
    const qs = search ? `?search=${encodeURIComponent(search)}` : '';
    const res = await request({
      baseUrl: this.cfg.apiBaseUrl,
      path: `/api/equipos${qs}`,
      apiKey: this.cfg.readApiKey || this.cfg.apiKey,
      pinnedFingerprint: this.cfg.tlsFingerprint
    });
    return res.body;
  }

  _canRead() {
    return !!(this.cfg && this.cfg.apiBaseUrl && (this.cfg.readApiKey || this.cfg.apiKey));
  }

  // ── Flush pipeline ──

  _scheduleFlush(delayMs = FLUSH_DEBOUNCE_MS) {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush().catch(() => {});
    }, delayMs);
  }

  async flush() {
    if (this.flushing) return;
    if (!this.cfg || !this.cfg.apiBaseUrl || !this.cfg.apiKey) return;
    const batch = this.queue.takeBatch(BATCH_MAX);
    if (!batch.length) return;

    this.flushing = true;
    const wasOnline = this.online;
    try {
      await request({
        baseUrl: this.cfg.apiBaseUrl,
        method: 'POST',
        path: '/api/logs/batch',
        apiKey: this.cfg.apiKey,
        pinnedFingerprint: this.cfg.tlsFingerprint,
        body: {
          hostname: this.hostname,
          shareId: this.cfg.shareId,
          entries: batch.map(b => b.entry)
        },
        timeoutMs: 10_000
      });
      await this.queue.ack(batch);
      this.backoff = BACKOFF_MIN_MS;
      this.consecutiveFailures = 0;
      this.lastError = null;
      this.lastFlushAt = new Date().toISOString();
      this.lastSuccessAt = this.lastFlushAt;

      if (!wasOnline) {
        this.online = true;
        activityLog.add('log_backend_reconnected', {
          source: 'logging',
          level: 'info',
          message: `Connection to the logging server restored: ${this.cfg.apiBaseUrl}`
        });
      } else {
        this.online = true;
      }

      if (this.queue.size() > 0) this._scheduleFlush(0);
    } catch (err) {
      this.queue.nack(batch);
      this.consecutiveFailures++;
      this.lastError = err?.message || String(err);
      this.lastFlushAt = new Date().toISOString();

      if (this.consecutiveFailures >= FAILURE_THRESHOLD && wasOnline) {
        this.online = false;
        activityLog.add('log_backend_offline', {
          source: 'logging',
          level: 'warn',
          message: `Logging server unavailable after ${this.consecutiveFailures} attempts: ${this.lastError}`,
          host: this.cfg.apiBaseUrl
        });
      } else if (this.consecutiveFailures >= FAILURE_THRESHOLD) {
        this.online = false;
      }

      const delay = this.backoff;
      this.backoff = Math.min(this.backoff * 2, BACKOFF_MAX_MS);
      this._scheduleRetry(delay);
    } finally {
      this.flushing = false;
    }
  }

  _scheduleRetry(delay) {
    if (this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this._scheduleFlush(0);
    }, delay);
  }

  status() {
    const canRead = this._canRead();
    const canWrite = !!(this.cfg && this.cfg.apiBaseUrl && this.cfg.apiKey);
    return {
      mode: 'dedicated',
      online: this.online && (canRead || canWrite),
      queueSize: this.queue ? this.queue.size() : 0,
      failures: this.consecutiveFailures,
      host: this.cfg?.apiBaseUrl || null,
      canRead,
      canWrite,
      lastError: this.lastError,
      lastFlushAt: this.lastFlushAt,
      lastSuccessAt: this.lastSuccessAt,
      lastQueuedAt: this.lastQueuedAt
    };
  }

  async close() {
    if (this.timer) clearTimeout(this.timer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    try { await this.flush(); } catch { /* ignore */ }
    if (this.queue) await this.queue.close();
  }
}

module.exports = new RemoteSink();
