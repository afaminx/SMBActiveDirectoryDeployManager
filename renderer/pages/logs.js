// ═══════════════════════════════════════════════════════════
// Logs Page — unified view over local or dedicated backend.
//
// The window.api.logs bridge auto-routes to the right sink
// (local activity-log or remote API) based on config.logMode.
// This page doesn't care which one — it calls the same methods.
// ═══════════════════════════════════════════════════════════

const LogsPage = {
  // Pagination cursor (keyset). null = start from head.
  _cursor: null,
  _pollTimer: null,
  _searchTimer: null,
  _items: [],
  _status: null,

  async render(container) {
    this._cursor = null;
    this._items = [];
    if (this._pollTimer) clearInterval(this._pollTimer);

    try {
      this._status = await window.api.logs.status();
    } catch {
      this._status = { mode: 'local', online: true, queueSize: 0 };
    }

    container.innerHTML = this._shell();
    await this._loadSummary();
    await this._loadRecent();
    await this._reloadTable({ reset: true });

    this._wireEvents();

    // Poll recent activity + backend status every 15s.
    this._pollTimer = setInterval(() => {
      this._loadRecent().catch(() => {});
      this._refreshBackendBadge().catch(() => {});
    }, 15_000);
  },

  // ── Rendering ────────────────────────────────────────────

  _shell() {
    const st = this._status || {};
    const isDedicated = st.mode === 'dedicated';
    const statusLabel = isDedicated
      ? (st.online
          ? `${t('logs.backendDedicated') || 'Servidor dedicado'} — ${App._esc(st.host || '')}`
          : `${t('logs.backendOffline') || 'Servidor no alcanzable'} — cola: ${st.queueSize}`)
      : (t('logs.backendLocal') || 'Almacenamiento local');

    return `
      <div class="page-header">
        <div>
          <h1>
            <span class="header-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>
            </span>
            ${t('logs.title') || 'Logs'}
          </h1>
          <p class="page-subtitle">${t('logs.subtitle') || 'Actividad del sistema y despliegues'}</p>
        </div>
        <div id="logs-backend-badge" class="${isDedicated && (!st.online || !st.canWrite) ? 'logs-badge logs-badge-warn' : 'logs-badge'}">
          <span class="logs-badge-dot ${isDedicated && (!st.online || !st.canWrite) ? 'off' : 'on'}"></span>
          <span id="logs-backend-label">${App._esc(this._backendStatusLabel(st) || statusLabel)}</span>
        </div>
      </div>

      <div class="stats-grid" id="logs-stats" style="grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));">
        ${this._statsSkeleton()}
      </div>

      <div class="logs-layout">
        <section class="logs-main">
          <div class="logs-toolbar">
            <div class="form-group" style="flex:1;min-width:200px;">
              <label class="form-label">${t('logs.searchLabel') || t('gui.searchMessages')}</label>
              <input class="form-input" id="logs-q" placeholder="${t('logs.searchPh') || 'texto libre...'}">
            </div>
            <div class="form-group" style="min-width:200px;">
              <label class="form-label">${t('logs.equipoLabel') || 'Equipo'}</label>
              <input class="form-input" id="logs-equipo" list="logs-equipos-datalist" placeholder="${t('logs.equipoPh') || 'hostname'}">
              <datalist id="logs-equipos-datalist"></datalist>
            </div>
            <div class="form-group" style="min-width:300px;">
              <label class="form-label">${t('logs.levelLabel') || 'Nivel'}</label>
              <div style="display:flex;gap:12px;align-items:center;height:38px;padding:0 12px;background:var(--bg-input);border:1px solid var(--border-color);border-radius:var(--radius-sm);overflow-x:auto;">
                <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:13px;color:var(--text-secondary);"><input type="checkbox" value="debug" class="logs-lvl-chk" style="accent-color:var(--accent-primary)"> Debug</label>
                <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:13px;color:var(--text-secondary);"><input type="checkbox" value="info" class="logs-lvl-chk" style="accent-color:var(--accent-info)" checked> Info</label>
                <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:13px;color:var(--text-secondary);"><input type="checkbox" value="warn" class="logs-lvl-chk" style="accent-color:var(--accent-warning)" checked> Warn</label>
                <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:13px;color:var(--text-secondary);"><input type="checkbox" value="error" class="logs-lvl-chk" style="accent-color:var(--accent-danger)" checked> Error</label>
                <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:13px;color:var(--text-secondary);"><input type="checkbox" value="fatal" class="logs-lvl-chk" style="accent-color:#991b1b" checked> Fatal</label>
              </div>
            </div>
            <div class="form-group" style="align-self:flex-end;">
              <button class="btn btn-secondary" id="logs-clear">${t('logs.clear') || 'Limpiar'}</button>
            </div>
          </div>

          <div class="logs-table-wrap" style="max-height: 75vh;">
            <table class="logs-table">
              <thead>
                <tr>
                  <th style="width:160px;">${t('logs.colTs') || 'Timestamp'}</th>
                  <th style="width:70px;">${t('logs.colLevel') || 'Nivel'}</th>
                  <th style="width:140px;">${t('logs.colEquipo') || 'Equipo'}</th>
                  <th style="width:120px;">${t('logs.colSource') || 'Origen'}</th>
                  <th>${t('logs.colMessage') || 'Mensaje'}</th>
                </tr>
              </thead>
              <tbody id="logs-tbody">
                <tr><td colspan="5" style="text-align:center;padding:40px;"><div class="spinner"></div></td></tr>
              </tbody>
            </table>
          </div>

          <div class="logs-pagination">
            <button class="btn btn-secondary" id="logs-load-more" disabled>${t('logs.loadMore') || t('gui.loadMore')}</button>
            <span id="logs-count" class="logs-muted">0</span>
          </div>
        </section>

        <aside class="logs-side">
          <h3 class="logs-side-title">${t('logs.recent') || 'Actividad reciente'}</h3>
          <ul class="logs-side-list" id="logs-recent">
            <li><div class="spinner"></div></li>
          </ul>
        </aside>
      </div>
    `;
  },

  _backendStatusLabel(st = {}) {
    const isDedicated = st.mode === 'dedicated';
    if (!isDedicated) return t('logs.backendLocal') || 'Almacenamiento local';
    if (!st.online) {
      return `${t('logs.backendOffline') || 'Servidor no alcanzable'} - cola: ${st.queueSize || 0}`;
    }
    if (!st.canWrite) {
      return `${t('logs.backendDedicated') || 'Servidor dedicado'} - ${t('gui.ingestKeyMissing')}`;
    }
    return `${t('logs.backendDedicated') || 'Servidor dedicado'} - ${st.host || ''}`;
  },

  _statsSkeleton() {
    const cells = [
      { key: 'info',  label: t('logs.statInfo')   || 'Info',   color: 'blue' },
      { key: 'warn',  label: t('logs.statWarn')   || 'Warn',   color: 'yellow' },
      { key: 'error', label: t('logs.statError')  || 'Errores', color: 'red' },
      { key: 'totalEvents', label: t('logs.statTotal') || 'Total 24h', color: 'purple' },
      { key: 'activeEquipos', label: t('logs.statEquipos') || 'Equipos activos', color: 'green' }
    ];
    return cells.map(c => `
      <div class="stat-card">
        <div class="stat-icon ${c.color}">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>
        </div>
        <div class="card-label">${c.label}</div>
        <div class="card-value" data-stat="${c.key}">—</div>
      </div>
    `).join('');
  },

  // ── Data loading ─────────────────────────────────────────

  async _loadSummary() {
    let s;
    try { s = await window.api.logs.statsSummary('24h'); }
    catch { return; }
    if (!s || !s.counts) return;

    const set = (k, v) => {
      const el = document.querySelector(`[data-stat="${k}"]`);
      if (el) el.textContent = v;
    };
    set('info',  s.counts.info || 0);
    set('warn',  s.counts.warn || 0);
    set('error', (s.counts.error || 0) + (s.counts.fatal || 0));
    set('totalEvents',  s.totalEvents || 0);
    set('activeEquipos', s.activeEquipos || 0);
  },

  async _loadRecent() {
    let recent = [];
    try { recent = await window.api.logs.recent(12); } catch { return; }
    const ul = document.getElementById('logs-recent');
    if (!ul) return;
    if (!recent.length) {
      ul.innerHTML = `<li class="logs-muted">${t('logs.noRecent') || t('gui.noRecentActivity')}</li>`;
      return;
    }
    ul.innerHTML = recent.map(r => {
      const lvl = this._levelName(r.level);
      const { primary } = this._formatMessage(r);
      return `
        <li class="logs-side-item">
          <span class="level-pill level-${lvl}">${lvl.toUpperCase()}</span>
          <div class="logs-side-body">
            <div class="logs-side-msg">${primary}</div>
            <div class="logs-side-meta">
              ${App._esc(r.hostname || '—')} · ${App._esc(r.source || '')} · ${this._fmtTs(r.ts)}
            </div>
          </div>
        </li>
      `;
    }).join('');
  },

  async _refreshBackendBadge() {
    try {
      const st = await window.api.logs.status();
      this._status = st;
      const label = document.getElementById('logs-backend-label');
      const badge = document.getElementById('logs-backend-badge');
      if (!label || !badge) return;
      const isD = st.mode === 'dedicated';
      label.textContent = isD
        ? (st.online
            ? `${t('logs.backendDedicated') || 'Servidor dedicado'} — ${st.host || ''}`
            : `${t('logs.backendOffline') || 'Servidor no alcanzable'} — cola: ${st.queueSize}`)
        : (t('logs.backendLocal') || 'Almacenamiento local');
      badge.className = (isD && !st.online) ? 'logs-badge logs-badge-warn' : 'logs-badge';
      const warn = isD && (!st.online || !st.canWrite);
      label.textContent = this._backendStatusLabel(st);
      badge.className = warn ? 'logs-badge logs-badge-warn' : 'logs-badge';
      const dot = badge.querySelector('.logs-badge-dot');
      if (dot) dot.className = 'logs-badge-dot ' + (warn ? 'off' : 'on');
    } catch { /* ignore */ }
  },

  async _loadEquipos(search) {
    try {
      const rows = await window.api.logs.equipos(search || '');
      const dl = document.getElementById('logs-equipos-datalist');
      if (!dl) return;
      dl.innerHTML = rows.map(e => `<option value="${App._esc(e.hostname)}">`).join('');
    } catch { /* ignore */ }
  },

  _collectFilters() {
    const q = document.getElementById('logs-q')?.value.trim() || '';
    const equipo = document.getElementById('logs-equipo')?.value.trim() || '';
    const chks = document.querySelectorAll('.logs-lvl-chk:checked');
    const levels = Array.from(chks).map(c => c.value);
    return {
      q: q || undefined,
      equipo: equipo || undefined,
      level: levels.length ? levels.join(',') : undefined,
      limit: 50
    };
  },

  async _reloadTable({ reset = false } = {}) {
    if (reset) {
      this._cursor = null;
      this._items = [];
    }
    const filters = this._collectFilters();
    if (this._cursor) {
      filters.beforeTs = this._cursor.beforeTs;
      filters.beforeId = this._cursor.beforeId;
    }

    const tbody = document.getElementById('logs-tbody');
    if (tbody && reset) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:24px;"><div class="spinner"></div></td></tr>`;
    }

    let result;
    try {
      result = await window.api.logs.query(filters);
    } catch (e) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--danger);padding:24px;">${App._esc(e.message || 'error')}</td></tr>`;
      return;
    }
    if (result?.error) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--danger);padding:24px;">${App._esc(result.error)}</td></tr>`;
      this._items = [];
      this._cursor = null;
      return;
    }

    const items = Array.isArray(result?.items) ? result.items : [];
    this._items = this._items.concat(items);
    this._cursor = result?.nextCursor || null;

    this._renderTableRows();
    const btn = document.getElementById('logs-load-more');
    if (btn) {
      btn.disabled = !this._cursor;
      btn.textContent = this._cursor
        ? (t('logs.loadMore') || t('gui.loadMore'))
        : (t('logs.endOfList') || 'Fin del listado');
    }
    const count = document.getElementById('logs-count');
    if (count) count.textContent = `${this._items.length} ${t('logs.results') || 'resultados'}`;
  },

  _renderTableRows() {
    const tbody = document.getElementById('logs-tbody');
    if (!tbody) return;
    if (!this._items.length) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--text-muted);">${t('logs.empty') || t('gui.noResultsWithTheCurrentFilters')}</td></tr>`;
      return;
    }
    tbody.innerHTML = this._items.map(r => {
      const lvl = this._levelName(r.level);
      const { primary, secondary } = this._formatMessage(r);
      return `
        <tr>
          <td class="mono">${this._fmtTs(r.ts)}</td>
          <td><span class="level-pill level-${lvl}">${lvl.toUpperCase()}</span></td>
          <td class="mono">${App._esc(r.hostname || '—')}</td>
          <td class="mono">${App._esc(r.source || '')}</td>
          <td>
            <div>${primary}</div>
            ${secondary ? `<div class="logs-ctx">${secondary}</div>` : ''}
          </td>
        </tr>
      `;
    }).join('');
  },

  // ── Events ──────────────────────────────────────────────

  _wireEvents() {
    const debounce = (fn, ms) => (...args) => {
      clearTimeout(this._searchTimer);
      this._searchTimer = setTimeout(() => fn(...args), ms);
    };

    const onFilterChange = debounce(() => this._reloadTable({ reset: true }), 300);
    document.getElementById('logs-q')?.addEventListener('input', onFilterChange);
    
    document.querySelectorAll('.logs-lvl-chk').forEach(chk => {
      chk.addEventListener('change', () => this._reloadTable({ reset: true }));
    });

    const equipoInput = document.getElementById('logs-equipo');
    if (equipoInput) {
      equipoInput.addEventListener('input', debounce(async (e) => {
        await this._loadEquipos(e.target.value);
        this._reloadTable({ reset: true });
      }, 300));
      this._loadEquipos('');
    }

    document.getElementById('logs-load-more')?.addEventListener('click', () => this._reloadTable());

    document.getElementById('logs-clear')?.addEventListener('click', () => {
      const q = document.getElementById('logs-q'); if (q) q.value = '';
      const eq = document.getElementById('logs-equipo'); if (eq) eq.value = '';
      document.querySelectorAll('.logs-lvl-chk').forEach(chk => {
        chk.checked = ['info','warn','error','fatal'].includes(chk.value);
      });
      this._reloadTable({ reset: true });
    });
  },

  // ── Helpers ──────────────────────────────────────────────

  _formatMessage(r) {
    let ctx = {};
    if (r.context && typeof r.context === 'object') ctx = r.context;
    else if (typeof r.context === 'string' && r.context) {
      try { ctx = JSON.parse(r.context); } catch { /* leave empty */ }
    }

    const e  = s => App._esc(String(s ?? ''));
    const app    = ctx.appName    ? `<strong>${e(ctx.appName)}</strong>` : '';
    const bundle = ctx.bundleName ? `<strong>${e(ctx.bundleName)}</strong>` : '';
    const gpo    = ctx.gpoName    ? `<strong>${e(ctx.gpoName)}</strong>` : '';
    const ver    = ctx.version    ? ` <span class="logs-ctx-ver">v${e(ctx.version)}</span>` : '';
    const newVer = ctx.newVersion ? ` → <span class="logs-ctx-ver">v${e(ctx.newVersion)}</span>` : '';
    const errTxt = ctx.error      ? e(String(ctx.error).slice(0, 180)) : '';

    const dispMap = { installed: 'Installed', skipped: 'Skipped (already installed)', pending: 'Installed', updated: 'Updated' };
    const disp = dispMap[ctx.disposition] || (ctx.disposition ? e(ctx.disposition) : 'Installed');

    const reasonMap = {
      'tracker-success': 'already installed',
      'detection-rule':  'already detected',
      'max-retries':     `too many attempts${ctx.retryCount ? ` (${ctx.retryCount})` : ''}`
    };
    const reason = ctx.reason ? (reasonMap[ctx.reason] || e(ctx.reason)) : '';

    const stage = ctx.stage ? ` [${e(ctx.stage)}]` : '';

    const map = {
      install_start:    `Installing${app ? ': ' + app : ''}${ver}`,
      install_skipped:  `Skipped${app ? ': ' + app : ''}${ver}${reason ? ` — ${reason}` : ''}`,
      install_success:  `${disp}${app ? ': ' + app : ''}${ver}`,
      install_failed:   `Installation failed${app ? ': ' + app : ''}${ver}${stage}`,
      uninstall_start:  `Uninstalling${app ? ': ' + app : ''}${ver}`,
      uninstall_checked:`Uninstall check${app ? ': ' + app : ''}${ver}`,
      uninstall_success:`Uninstalled${app ? ': ' + app : ''}${ver}`,
      uninstall_failed: `Uninstall failed${app ? ': ' + app : ''}${ver}`,
      gpo_create:       `GPO created${gpo ? ': ' + gpo : ''}${app ? ' for ' + app : ''}`,
      gpo_delete:       `GPO deleted${gpo ? ': ' + gpo : ''}`,
      script_deploy:    `Script deployed${app ? ': ' + app : ''}${ver}`,
      bundle_deploy:    `Bundle deployed${bundle ? ': ' + bundle : ''}`,
      bundle_uninstall_prepare: `Bundle uninstall prepared${bundle ? ': ' + bundle : ''}`,
      app_create:       `App created${app ? ': ' + app : ''}${ver}`,
      app_update:       `App updated${app ? ': ' + app : ''}`,
      app_delete:       `App deleted${app ? ': ' + app : ''}`,
      app_disable:      `App disabled${app ? ': ' + app : ''}`,
      app_quick_update: `Quick update${app ? ': ' + app : ''}`,
      app_auto_update:  `Auto-update${app ? ': ' + app : ''}${newVer}`,
      app_uninstall_prepare: `Uninstall prepared${app ? ': ' + app : ''}`,
      bundle_create:    `Bundle created${bundle ? ': ' + bundle : ''}${ctx.appCount ? ` (${ctx.appCount} apps)` : ''}`,
      bundle_update:    `Bundle updated${bundle ? ': ' + bundle : ''}`,
      bundle_delete:    `Bundle deleted`,
      bundle_disable:   `Bundle disabled${bundle ? ': ' + bundle : ''}`,
      config_export:    `Configuration exported`,
      config_import:    `Configuration imported`,
      log_backend_enrolled:       `Enrolled with logging server`,
      log_backend_reconnected:    `Logging server reconnected`,
      log_backend_offline:        `Logging server unavailable`,
      log_share_config_published: `Logging configuration published to share`,
      ou_external_changes_detected:         `External OU changes detected`,
      app_scripts_regenerated:              `Scripts regenerated${app ? ': ' + app : ''}`,
      script_update_background_started:     `Script update started${ctx.outdatedCount ? ` (${ctx.outdatedCount} apps)` : ''}`,
      script_update_background_completed:   `Script update completed${ctx.updatedCount != null ? ` — ${ctx.updatedCount} updated` : ''}${ctx.failedCount ? `, ${ctx.failedCount} errors` : ''}`,
      ps_error:                             `PowerShell error${ctx.stage ? ` [${e(ctx.stage)}]` : ''}`,
    };

    const key = String(r.message || '');
    const primary = map[key] ?? e(key);

    // Secondary line: error text for failures, or nothing for clean messages
    let secondary = '';
    if (errTxt) {
      secondary = `<span style="color:var(--accent-danger,#ef4444)">${errTxt}</span>`;
    } else if (!map[key] && Object.keys(ctx).length) {
      // Unknown key — show non-noise context fields
      const { hash, scriptRoot, ...rest } = ctx;
      const pairs = Object.entries(rest).map(([k, v]) => `${e(k)}: ${e(String(v).slice(0, 80))}`);
      if (pairs.length) secondary = pairs.join(' · ');
    }

    return { primary, secondary };
  },

  _levelName(n) {
    const names = ['debug', 'info', 'warn', 'error', 'fatal'];
    if (typeof n === 'number' && n >= 0 && n <= 4) return names[n];
    if (typeof n === 'string' && names.includes(n.toLowerCase())) return n.toLowerCase();
    return 'info';
  },

  _fmtTs(ts) {
    if (!ts) return '';
    try {
      const d = new Date(ts);
      const pad = x => String(x).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    } catch { return String(ts); }
  },

};
