// ═══════════════════════════════════════════════════════
// Dashboard Page — with Activity Timeline & Health Check
// ═══════════════════════════════════════════════════════

const DashboardPage = {
  async render(container) {
    let appsCount = 0, deployedCount = 0, bundleCount = 0;

    let apps = [];
    try { apps = await window.api.apps.getAll(); appsCount = apps.length; } catch (e) {}
    try {
      const deployed = await window.api.files.listDeployed();
      if (deployed.success) deployedCount = deployed.data.length;
    } catch (e) {}
    try {
      const bundles = await window.api.bundles.getAll();
      bundleCount = bundles.length;
    } catch (e) {}

    const withGPO = apps.filter(a => a.gpoName).length;
    const healthStatus = this.computeHealth(apps);

    // Get recent activity
    let recentActivity = [];
    try { recentActivity = await window.api.activity.getRecent(10); } catch (e) {}

    // Get installation stats from logs
    let installOk = 0, installFail = 0;
    try {
      const logsOk = await window.api.logs.query({ q: 'install_success', limit: 100 });
      if (logsOk && logsOk.items) installOk = logsOk.items.length;
      const logsFail = await window.api.logs.query({ q: 'install_failed', limit: 100 });
      if (logsFail && logsFail.items) installFail = logsFail.items.length;
    } catch (e) {}

    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1>
            <span class="header-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
            </span>
            ${t('dashboard.title')}
          </h1>
          <p class="page-subtitle">${t('dashboard.subtitle')}</p>
        </div>
        <button class="btn btn-secondary" onclick="App.navigate('apps')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          ${t('dashboard.newApp')}
        </button>
      </div>

      ${App.rsatWarningHTML()}

      <div class="stats-grid">
        <div class="stat-card" onclick="App.navigate('apps')" style="cursor:pointer;" title="${t('nav.apps')}">
          <div class="stat-icon purple">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
          </div>
          <div class="card-label">${t('dashboard.configuredApps')}</div>
          <div class="card-value">${appsCount}</div>
        </div>

        <div class="stat-card" onclick="App.navigate('deployments')" style="cursor:pointer;" title="${t('nav.deployments')}">
          <div class="stat-icon green">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          </div>
          <div class="card-label">${t('dashboard.deployedFolders')}</div>
          <div class="card-value">${deployedCount}</div>
        </div>

        <div class="stat-card" onclick="App.navigate('gpos')" style="cursor:pointer;" title="${t('nav.gpos')}">
          <div class="stat-icon yellow">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          </div>
          <div class="card-label">${t('dashboard.withGpo')}</div>
          <div class="card-value">${withGPO}</div>
        </div>

        <div class="stat-card" onclick="App.navigate('bundles')" style="cursor:pointer;" title="${t('nav.bundles')}">
          <div class="stat-icon blue">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16.5 9.4l-9-5.19M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
          </div>
          <div class="card-label">${t('dashboard.bundles')}</div>
          <div class="card-value">${bundleCount}</div>
        </div>

      </div>

      <!-- Health & Telemetry Section -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(400px, 1fr));gap:var(--space-xl);margin-bottom:var(--space-xl)">
        
        <!-- Health Check -->
        <div class="card">
        <div class="card-title" style="display:flex;align-items:center;gap:8px">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
          ${t('dashboard.healthStatus')}
          <span class="badge ${healthStatus.color}" style="margin-left:auto">${healthStatus.label}</span>
        </div>
        <div style="margin-top:12px;display:flex;gap:24px;flex-wrap:wrap">
          <div style="font-size:var(--font-sm)">
            <span style="color:var(--accent-secondary)">● </span>${healthStatus.ok} ${t('dashboard.healthOk')}
          </div>
          <div style="font-size:var(--font-sm)">
            <span style="color:var(--accent-warning)">● </span>${healthStatus.warn} ${t('dashboard.healthWarn')}
          </div>
          <div style="font-size:var(--font-sm)">
            <span style="color:var(--accent-danger)">● </span>${healthStatus.error} ${t('dashboard.healthError')}
          </div>
        </div>
        ${healthStatus.issues.length > 0 ? `
          <div style="margin-top:12px;border-top:1px solid var(--border-color);padding-top:12px">
            ${healthStatus.issues.slice(0, 5).map(issue => `
              <div style="font-size:var(--font-sm);color:${issue.type === 'warn' ? 'var(--accent-warning)' : 'var(--accent-danger)'};padding:4px 0">
                ${issue.type === 'warn' ? '⚠' : '❌'} ${App._esc(issue.msg)}
              </div>
            `).join('')}
          </div>
        ` : ''}
        </div>

        <!-- Telemetría de Instalaciones -->
        <div class="card">
          <div class="card-title" style="display:flex;align-items:center;gap:8px">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>
            Telemetría de Despliegues (Últimas 24h)
          </div>
          <div style="display:flex; gap:16px; margin-top:20px; flex-wrap:wrap;">
            <div class="stat-card" onclick="App.navigate('logs'); setTimeout(() => { const el = document.getElementById('logs-q'); if(el) { el.value='install_success'; el.dispatchEvent(new Event('input')) } }, 100);" style="cursor:pointer; flex:1; min-width:140px;" title="Instalaciones OK">
              <div class="stat-icon green" style="margin-bottom: 12px; width:38px; height:38px;">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
              </div>
              <div class="card-label">Instalaciones OK</div>
              <div class="card-value">${installOk}</div>
            </div>

            <div class="stat-card" onclick="App.navigate('logs'); setTimeout(() => { const el = document.getElementById('logs-q'); if(el) { el.value='install_failed'; el.dispatchEvent(new Event('input')) } }, 100);" style="cursor:pointer; flex:1; min-width:140px;" title="Instalaciones Fallidas">
              <div class="stat-icon red" style="margin-bottom: 12px; width:38px; height:38px;">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
              </div>
              <div class="card-label">Instalaciones Fallidas</div>
              <div class="card-value">${installFail}</div>
            </div>
          </div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-xl)">
        <!-- Quick Actions -->
        <div class="card">
          <div class="card-title">${t('dashboard.quickActions')}</div>
          <div style="display:flex;flex-direction:column;gap:8px;margin-top:12px">
            <button class="btn btn-primary" onclick="App.navigate('apps')">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              ${t('dashboard.createApp')}
            </button>
            <button class="btn btn-secondary" onclick="App.navigate('bundles')">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
              ${t('dashboard.createBundle')}
            </button>
            <button class="btn btn-secondary" onclick="App.navigate('ous')">${t('dashboard.exploreOus')}</button>
            <button class="btn btn-secondary" onclick="App.navigate('deployments')">${t('dashboard.viewDeployments')}</button>
          </div>
        </div>

        <!-- Activity Timeline -->
        <div class="card">
          <div class="card-title">${t('dashboard.recentActivity')}</div>
          <div style="margin-top:12px;max-height:300px;overflow-y:auto" id="activity-timeline">
            ${recentActivity.length === 0 ? `
              <p style="color:var(--text-muted);font-size:var(--font-sm);text-align:center;padding:24px 0">${t('dashboard.noActivity')}</p>
            ` : recentActivity.map(entry => `
              <div style="display:flex;gap:12px;padding:8px 0;border-bottom:1px solid var(--border-color);align-items:start">
                <div style="width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;background:${this.getActivityColor(entry.action)}">
                  ${this.getActivityIcon(entry.action)}
                </div>
                <div style="flex:1;min-width:0">
                  <div style="font-size:var(--font-sm);color:var(--text-primary)">${this.getActivityText(entry)}</div>
                  <div style="font-size:var(--font-xs);color:var(--text-muted)">${App.formatDate(entry.timestamp)}</div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <!-- AD & Network Status -->
      <div class="card" style="margin-top:var(--space-xl)">
        <div class="card-title" style="display:flex;align-items:center;gap:8px">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
          ${t('dashboard.adStatus')}
        </div>
        <div style="display:flex;flex-direction:column;gap:12px;margin-top:12px;" id="connectivity-status">
          <div style="display:flex;align-items:center;gap:8px;">
            <div style="width:10px;height:10px;border-radius:50%;background:${App.rsatAvailable ? 'var(--accent-secondary)' : 'var(--accent-danger)'};box-shadow:0 0 8px ${App.rsatAvailable ? 'rgba(0,212,170,.5)' : 'rgba(239,68,68,.5)'}"></div>
            <span style="color:var(--text-secondary)">${App.rsatAvailable ? t('dashboard.rsatOk') : t('dashboard.rsatMissing')}</span>
          </div>
          <div id="network-share-status" style="display:flex;align-items:center;gap:8px;">
            <div class="spinner" style="width:10px;height:10px;border-width:2px;margin:0;"></div>
            <span style="color:var(--text-muted)">${t('dashboard.netShareChecking')}</span>
          </div>
          <div id="log-backend-status" style="display:flex;align-items:center;gap:8px;cursor:pointer;" onclick="App.navigate('logs')" title="${t('nav.logs') || 'Logs'}">
            <div class="spinner" style="width:10px;height:10px;border-width:2px;margin:0;"></div>
            <span style="color:var(--text-muted)">${t('logs.title') || 'Logs'}...</span>
          </div>
        </div>
        ${!App.rsatAvailable ? `
          <div style="margin-top:12px;padding:12px;background:var(--accent-danger-dim);border:1px solid rgba(239,68,68,0.25);border-radius:var(--radius-sm);">
            <div style="font-size:var(--font-sm);color:#fca5a5;">
              <strong>⚠ Active Directory no disponible</strong>
              <p style="margin-top:6px;color:var(--text-muted);">${t('dashboard.possibleCauses')}</p>
              <ul style="margin:6px 0 0 16px;color:var(--text-muted);line-height:1.8;">
                <li>${t('dashboard.cause1')}</li>
                <li>${t('dashboard.cause2')}</li>
                <li>${t('dashboard.cause3')}</li>
              </ul>
              <p style="margin-top:8px;color:var(--text-muted);">Instala RSAT con: <code style="background:rgba(0,0,0,0.3);padding:2px 6px;border-radius:3px;font-size:var(--font-xs);">Add-WindowsCapability -Online -Name Rsat.GroupPolicy.Management.Tools~~~~0.0.1.0</code></p>
            </div>
          </div>
        ` : ''}
      </div>
    `;

    // Check network share connectivity asynchronously
    this.checkNetworkShare();
    this.checkLogBackend();
  },

  async checkLogBackend() {
    const el = document.getElementById('log-backend-status');
    if (!el) return;
    let st;
    try { st = await window.api.logs.status(); }
    catch { return; }
    const isD = st.mode === 'dedicated';
    const dotColor = (isD && !st.online) ? 'var(--accent-warning)' : 'var(--accent-secondary)';
    const shadow   = (isD && !st.online) ? 'rgba(245,158,11,.5)'   : 'rgba(0,212,170,.5)';
    const label = isD
      ? (st.online
          ? `${t('logs.backendDedicated') || 'Servidor dedicado'} — ${st.host || ''}`
          : `${t('logs.backendOffline') || 'Servidor no alcanzable'} · cola ${st.queueSize}`)
      : (t('logs.backendLocal') || 'Almacenamiento local');
    el.innerHTML = `
      <div style="width:10px;height:10px;border-radius:50%;background:${dotColor};box-shadow:0 0 8px ${shadow};flex-shrink:0;"></div>
      <span style="color:var(--text-secondary);">Logs — ${App.escapeHtml ? App.escapeHtml(label) : label}</span>
    `;
  },

  async checkNetworkShare() {
    const el = document.getElementById('network-share-status');
    if (!el) return;

    try {
      const config = await window.api.config.get();
      if (!config.networkSharePath) {
        el.innerHTML = `
          <div style="width:10px;height:10px;border-radius:50%;background:var(--accent-warning);box-shadow:0 0 8px rgba(245,158,11,.5);flex-shrink:0;"></div>
          <span style="color:var(--text-secondary);">${t('dashboard.netShareNotConfigured')} <a href="#" onclick="App.navigate('settings')" style="color:var(--accent-primary);">${t('dashboard.goToSettings')}</a></span>
        `;
        return;
      }

      const result = await window.api.files.listDeployed();
      if (result.success) {
        el.innerHTML = `
          <div style="width:10px;height:10px;border-radius:50%;background:var(--accent-secondary);box-shadow:0 0 8px rgba(0,212,170,.5);flex-shrink:0;"></div>
          <span style="color:var(--text-secondary);">${t('dashboard.netShareAccessible')} — <code style="background:rgba(0,0,0,0.2);padding:2px 6px;border-radius:3px;font-size:var(--font-xs);">${App._esc(config.networkSharePath)}</code></span>
        `;
      } else {
        el.innerHTML = `
          <div style="width:10px;height:10px;border-radius:50%;background:var(--accent-danger);box-shadow:0 0 8px rgba(239,68,68,.5);flex-shrink:0;"></div>
          <span style="color:#fca5a5;">${t('dashboard.netShareInaccessible')}</span>
        `;
        // Add error detail banner
        const container = document.getElementById('connectivity-status');
        if (container) {
          container.insertAdjacentHTML('beforeend', `
            <div style="padding:12px;background:var(--accent-danger-dim);border:1px solid rgba(239,68,68,0.25);border-radius:var(--radius-sm);margin-top:4px;">
              <div style="font-size:var(--font-sm);color:#fca5a5;">
                <strong>❌ ${t('dashboard.netShareInaccessible')}</strong>
                <p style="margin-top:4px;color:var(--text-muted);">Ruta: <code style="background:rgba(0,0,0,0.3);padding:2px 6px;border-radius:3px;font-size:var(--font-xs);">${App._esc(config.networkSharePath)}</code></p>
                <p style="margin-top:4px;color:var(--text-muted);">${App._esc(result.error)}</p>
              </div>
            </div>
          `);
        }
      }
    } catch (err) {
      el.innerHTML = `
        <div style="width:10px;height:10px;border-radius:50%;background:var(--accent-danger);box-shadow:0 0 8px rgba(239,68,68,.5);flex-shrink:0;"></div>
        <span style="color:#fca5a5;">Error: ${App._esc(err.message)}</span>
      `;
    }
  },

  computeHealth(apps) {
    let ok = 0, warn = 0, error = 0;
    const issues = [];
    apps.forEach(app => {
      if (app.deployed && app.deployedPath) {
        if (!app.gpoName) {
          warn++;
          issues.push({ type: 'warn', msg: t('dashboard.issueWarnNoGpo').replace('{app}', app.name) });
        } else if (!app.version || app.version === '1.0.0') {
          ok++; // Default version is fine
        } else {
          ok++;
        }
      } else if (app.gpoName && !app.deployed) {
        warn++;
        issues.push({ type: 'warn', msg: t('dashboard.issueWarnNotDeployed').replace('{app}', app.name) });
      } else if (!app.deployed && !app.gpoName) {
        error++;
        issues.push({ type: 'error', msg: t('dashboard.issueErrorNoDeployNoGpo').replace('{app}', app.name) });
      } else {
        ok++;
      }
    });
    const total = ok + warn + error;
    let label = t('dashboard.statusNoApps'), color = 'badge-neutral';
    if (total > 0) {
      if (error === 0 && warn === 0) { label = t('dashboard.statusAllOk'); color = 'badge-success'; }
      else if (error === 0) { label = `${warn} ${t('dashboard.statusWarnings')}`; color = 'badge-warning'; }
      else { label = `${error} ${t('dashboard.statusErrors')}`; color = 'badge-danger'; }
    }
    return { ok, warn, error, issues, label, color };
  },

  getActivityColor(action) {
    const safeAction = String(action || '');
    const colors = {
      app_create:              'var(--accent-secondary-dim)',
      app_update:              'var(--accent-info-dim)',
      app_scripts_regenerated: 'var(--accent-info-dim)',
      app_uninstall_prepare: 'var(--accent-warning-dim)',
      app_disable: 'var(--accent-warning-dim)',
      app_delete: 'var(--accent-danger-dim)',
      bundle_create: 'var(--accent-primary-dim)',
      bundle_deploy: 'var(--accent-secondary-dim)',
      bundle_uninstall_prepare: 'var(--accent-warning-dim)',
      bundle_update: 'var(--accent-info-dim)',
      bundle_delete: 'var(--accent-danger-dim)',
      bundle_disable: 'var(--accent-warning-dim)',
      gpo_create: 'var(--accent-info-dim)',
      config_export: 'var(--accent-primary-dim)',
      config_import: 'var(--accent-warning-dim)',
    };
    return colors[safeAction] || 'var(--accent-primary-dim)';
  },

  getActivityIcon(action) {
    const safeAction = String(action || '');
    if (safeAction.includes('uninstall')) return '&#128465;';
    if (safeAction.includes('create')) return '&#10133;';
    if (safeAction.includes('update')) return '&#9999;&#65039;';
    if (safeAction.includes('delete')) return '&#128465;';
    if (safeAction.includes('deploy')) return '&#128640;';
    if (safeAction.includes('disable')) return '&#9209;&#65039;';
    if (safeAction.includes('export')) return '&#128228;';
    if (safeAction.includes('import')) return '&#128229;';
    return '&#128203;';
  },



  getActivityText(entry) {
    entry = entry || {};
    const e = s => App._esc(String(s ?? '?'));
    const appName    = e(entry.appName);
    const bundleName = e(entry.bundleName);
    const gpoName    = e(entry.gpoName);
    const version    = e(entry.version || '1.0.0');
    const newVersion = entry.newVersion ? ` → v${e(entry.newVersion)}` : '';
    const texts = {
      app_create:             `App creada: <strong>${appName}</strong> v${version}`,
      app_update:             `App actualizada: <strong>${appName}</strong>`,
      app_quick_update:       `Actualización rápida: <strong>${appName}</strong>`,
      app_auto_update:        `Auto-update: <strong>${appName}</strong>${newVersion}`,
      app_uninstall_prepare:  `Desinstalación preparada: <strong>${appName}</strong>`,
      app_disable:            `App deshabilitada: <strong>${appName}</strong>`,
      app_delete:             `App eliminada: <strong>${appName}</strong>`,
      bundle_create:          `Bundle creado: <strong>${bundleName}</strong> (${Number(entry.appCount) || 0} apps)`,
      bundle_deploy:          `Bundle desplegado: <strong>${bundleName}</strong>`,
      bundle_uninstall_prepare: `Desinstalación de bundle: <strong>${bundleName}</strong>`,
      bundle_update:          `Bundle actualizado: <strong>${bundleName}</strong>`,
      bundle_delete:          `Bundle eliminado`,
      bundle_disable:         `Bundle deshabilitado: <strong>${bundleName}</strong>`,
      gpo_create:             `GPO creada: <strong>${gpoName}</strong>`,
      gpo_delete:             `GPO eliminada: <strong>${gpoName}</strong>`,
      script_deploy:          `Script desplegado: <strong>${appName}</strong>`,
      install_success:        `Instalado: <strong>${appName}</strong> v${version}`,
      install_failed:         `Error de instalación: <strong>${appName}</strong>`,
      install_skipped:        `Omitido: <strong>${appName}</strong>`,
      uninstall_success:      `Desinstalado: <strong>${appName}</strong>`,
      uninstall_failed:       `Error de desinstalación: <strong>${appName}</strong>`,
      config_export:          `Configuración exportada`,
      config_import:          `Configuración importada`,
      log_backend_enrolled:   `Enrolled en servidor de logs`,
      log_backend_reconnected:`Servidor de logs reconectado`,
      log_backend_offline:    `Servidor de logs no disponible`,
      log_share_config_published:           `Config de logging publicada`,
      app_scripts_regenerated:              `Scripts regenerados: <strong>${appName}</strong>`,
      script_update_background_started:     `Actualización de scripts iniciada`,
      script_update_background_completed:   `Actualización de scripts completada`,
      ps_error:                             `Error de PowerShell`,
    };
    return texts[String(entry.action || '')] || App._esc(entry.action || entry.message || '');
  }
};
