'use strict';

const AppsUpdatesModule = {
  async wingetUpdateDialog(id) {
    const app = await window.api.apps.get(id);
    if (!app || !app.wingetId) return;

    const body = `
      <div style="display:flex;flex-direction:column;gap:12px;">
        <div style="display:flex;align-items:center;gap:12px;">
          <div style="width:44px;height:44px;border-radius:10px;background:var(--accent-primary-dim);display:flex;align-items:center;justify-content:center;font-size:24px;">&#128230;</div>
          <div>
            <div style="font-size:17px;font-weight:700;color:var(--text-primary);">${App._esc(app.name)}</div>
            <div style="font-size:12px;color:var(--text-muted);font-family:monospace;">${App._esc(app.wingetId)}</div>
          </div>
        </div>
        <div style="padding:10px 14px;background:var(--bg-input);border-radius:8px;display:flex;justify-content:space-between;font-size:13px;">
          <span style="color:var(--text-muted);">VersiÃ³n actual</span>
          <span style="font-weight:600;">v${App._esc(app.version || '1.0.0')}</span>
        </div>
        <div id="wud-status" style="text-align:center;padding:16px;">
          <span class="spinner" style="width:18px;height:18px;display:inline-block;border-width:2px;margin-right:8px;"></span>
          <span style="color:var(--text-secondary);font-size:13px;">${t('apps.checkingUpdates')}</span>
        </div>
      </div>`;

    App.openModal(t('apps.checkUpdates'), body,
      `<button class="btn btn-secondary" onclick="App.closeModal()">${t('common.cancel')}</button><div style="flex:1"></div><button class="btn btn-success" id="wud-update-btn" style="display:none;"></button>`
    );

    try {
      const r = await window.api.catalog.checkSingle(app.wingetId, app.wingetSource, app.name);
      const latestVersion = r?.latestVersion;
      const statusEl = document.getElementById('wud-status');
      const updateBtn = document.getElementById('wud-update-btn');

      if (!latestVersion) {
        const isMsStore = (r?.wingetSource || app.wingetSource || '').toLowerCase() === 'msstore';
        const msg = isMsStore
          ? t('gui.msStoreManagesUpdatesAutomaticallyTheVersionIs')
          : t('gui.couldNotVerifyTheLatestVersion');
        if (statusEl) statusEl.innerHTML = `<span style="color:var(--text-muted);font-size:13px;">${App._esc(msg)}</span>`;
        return;
      }

      if (latestVersion === (app.version || '1.0.0')) {
        if (statusEl) statusEl.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent-secondary)" stroke-width="2" style="margin-right:8px;vertical-align:middle;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg><span style="color:var(--text-secondary);font-size:13px;">${t('apps.noUpdatesFound')}</span>`;
        return;
      }

      if (statusEl) statusEl.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;gap:12px;padding:10px;background:var(--bg-tertiary);border-radius:8px;">
          <div style="text-align:center;">
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:2px;">Actual</div>
            <div style="font-weight:700;color:var(--text-primary);">v${App._esc(app.version || '1.0.0')}</div>
          </div>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--primary-color)" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
          <div style="text-align:center;">
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:2px;">${t('gui.available')}</div>
            <div style="font-weight:700;color:var(--accent-secondary);">v${App._esc(latestVersion)}</div>
          </div>
        </div>`;

      if (updateBtn) {
        updateBtn.style.display = '';
        updateBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.2-8.55"/><polyline points="21 4 21 10 15 10"/></svg> ${t('apps.updateToVersion').replace('{version}', latestVersion)}`;
        updateBtn.addEventListener('click', () => {
          this.performWingetAutoUpdate(app.id, latestVersion, app.name, updateBtn);
        });
      }
    } catch (e) {
      const statusEl = document.getElementById('wud-status');
      if (statusEl) statusEl.innerHTML = `<span style="color:var(--danger-color);font-size:13px;">Error: ${App._esc(e.message)}</span>`;
    }
  },

  // â”€â”€â”€ Winget Update Check â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async checkUpdates() {
    const panel = document.getElementById('apps-updates-panel');
    if (!panel) return;

    panel.style.display = '';
    AppsPage._checkingUpdates = true;
    AppsPage._updateCheckResults = [];
    panel.innerHTML = this._renderUpdatesPanelHTML();

    try {
      const apps = await window.api.apps.getAll();
      const wingetApps = apps.filter(a => a.wingetId && a.template === 'winget');

      if (wingetApps.length === 0) {
        AppsPage._checkingUpdates = false;
        AppsPage._updateCheckResults = [];
        panel.innerHTML = this._renderUpdatesPanelHTML();
        return;
      }

      // Check each winget app's latest version in parallel
      const checks = await Promise.allSettled(
        wingetApps.map(async (app) => {
          const r = await window.api.catalog.checkSingle(app.wingetId, app.wingetSource, app.name);
          return { app, latestVersion: r.latestVersion };
        })
      );

      AppsPage._updateCheckResults = checks
        .filter(c => c.status === 'fulfilled')
        .map(c => c.value)
        .filter(({ app, latestVersion }) => {
          if (!latestVersion) return false;
          // Only show if latest version is different from current
          return latestVersion !== (app.version || '1.0.0');
        })
        .map(({ app, latestVersion }) => ({
          appId: app.id,
          appName: app.name,
          wingetId: app.wingetId,
          currentVersion: app.version || '1.0.0',
          latestVersion
        }));

    } catch (err) {
      AppsPage._updateCheckResults = [];
    }

    AppsPage._checkingUpdates = false;
    panel.innerHTML = this._renderUpdatesPanelHTML();
    this._bindUpdatesPanelEvents(panel);
  },

  _renderUpdatesPanelHTML() {
    if (AppsPage._checkingUpdates) {
      return `
        <div class="card" style="padding:20px;display:flex;align-items:center;gap:12px;">
          <span class="spinner" style="width:18px;height:18px;border-width:2px;display:inline-block;flex-shrink:0;"></span>
          <span style="color:var(--text-secondary);font-size:var(--font-sm);">${t('apps.checkingUpdates')}</span>
        </div>`;
    }

    const results = AppsPage._updateCheckResults;
    if (results.length === 0) {
      return `
        <div class="card" style="padding:16px 20px;display:flex;align-items:center;justify-content:space-between;gap:12px;">
          <div style="display:flex;align-items:center;gap:10px;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent-secondary)" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            <span style="font-size:var(--font-sm);color:var(--text-secondary);">${t('apps.noUpdatesFound')}</span>
          </div>
          <button class="btn btn-ghost btn-sm" onclick="document.getElementById('apps-updates-panel').style.display='none'">&times;</button>
        </div>`;
    }

    const rows = results.map((r, i) => `
      <div style="display:flex;align-items:center;gap:12px;padding:10px 12px;background:var(--bg-input);border-radius:var(--radius-sm);">
        <div style="flex:1;min-width:0;">
          <div style="font-weight:600;color:var(--text-primary);font-size:var(--font-sm);">${App._esc(r.appName)}</div>
          <div style="font-size:var(--font-xs);color:var(--text-muted);font-family:monospace;">${App._esc(r.wingetId)}</div>
        </div>
        <div style="font-size:var(--font-sm);white-space:nowrap;">
          <span style="color:var(--text-muted);">v${App._esc(r.currentVersion)}</span>
          <span style="color:var(--accent-primary);margin:0 6px;">&#8594;</span>
          <span style="color:var(--accent-secondary);font-weight:600;">v${App._esc(r.latestVersion)}</span>
        </div>
        <button class="btn btn-primary btn-sm update-app-btn" data-idx="${i}" style="white-space:nowrap;min-width:90px;">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.2-8.55"/><polyline points="21 4 21 10 15 10"/></svg>
          ${t('apps.updateToVersion').replace('{version}', r.latestVersion)}
        </button>
      </div>
    `).join('');

    return `
      <div class="card" style="padding:16px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.2-8.55"/><polyline points="21 4 21 10 15 10"/></svg>
          <span style="font-weight:600;font-size:var(--font-sm);">${t('apps.updatesFound').replace('{count}', results.length)}</span>
          <div style="flex:1"></div>
          ${results.length > 1 ? `<button class="btn btn-success btn-sm" id="btn-update-all-apps">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.2-8.55"/><polyline points="21 4 21 10 15 10"/></svg>
            ${t('apps.updateAll')}
          </button>` : ''}
          <button class="btn btn-ghost btn-sm" onclick="document.getElementById('apps-updates-panel').style.display='none'" style="margin-left:4px;">&times;</button>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${rows}
        </div>
      </div>`;
  },

  _bindUpdatesPanelEvents(panel) {
    panel.querySelectorAll('.update-app-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx);
        const r = AppsPage._updateCheckResults[idx];
        if (r) this.performWingetAutoUpdate(r.appId, r.latestVersion, r.appName, btn);
      });
    });

    document.getElementById('btn-update-all-apps')?.addEventListener('click', () => {
      this.bulkWingetUpdate();
    });
  },

  async performWingetAutoUpdate(appId, newVersion, appName, btnEl) {
    if (btnEl) {
      btnEl.disabled = true;
      btnEl.innerHTML = `<span class="spinner" style="width:12px;height:12px;display:inline-block;border-width:2px;"></span> ${t('apps.updatingApp')}`;
    }

    try {
      const app = await window.api.apps.get(appId);
      if (!app) throw new Error('App not found');

      const history = Array.isArray(app.versionHistory) ? [...app.versionHistory] : [];
      history.push({
        version: app.version || '1.0.0',
        hash: app.lastDeployHash || '',
        replacedAt: new Date().toISOString(),
        replacedBy: 'auto-update'
      });

      const updatedData = { version: newVersion, versionHistory: history };
      await window.api.apps.update(appId, updatedData);

      const fullApp = { ...app, ...updatedData, id: appId };
      const deployResult = await window.api.scripts.deploy(fullApp);

      if (!deployResult.success) {
        throw new Error(deployResult.error);
      }

      await window.api.apps.update(appId, {
        deployed: true,
        deployedPath: deployResult.path,
        publishedAction: 'install',
        publishedAt: new Date().toISOString()
      });
      await window.api.activity.add('app_auto_update', { appName, newVersion });

      App.toast(t('apps.updateSuccess').replace('{name}', appName).replace('{version}', newVersion), 'success');

      // Update the card version badge in-place without a full page reload
      const card = document.querySelector(`.app-card[data-id="${appId}"]`);
      if (card) {
        const vBadge = card.querySelector('.app-card-version');
        if (vBadge) vBadge.textContent = `v${newVersion}`;
      }

      // Remove from results list
      AppsPage._updateCheckResults = AppsPage._updateCheckResults.filter(r => r.appId !== appId);
      const panel = document.getElementById('apps-updates-panel');
      if (panel) {
        panel.innerHTML = this._renderUpdatesPanelHTML();
        this._bindUpdatesPanelEvents(panel);
      }
    } catch (err) {
      App.toast(`${t('gui.updateFailedFor')}${appName}: ${err.message}`, 'error');
      if (btnEl) {
        btnEl.disabled = false;
        btnEl.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.2-8.55"/><polyline points="21 4 21 10 15 10"/></svg> ${t('apps.updateToVersion').replace('{version}', AppsPage._updateCheckResults.find(r => r.appId === appId)?.latestVersion || '')}`;
      }
    }
  },

  async bulkWingetUpdate() {
    const results = [...AppsPage._updateCheckResults];
    if (results.length === 0) return;

    const updateAllBtn = document.getElementById('btn-update-all-apps');
    if (updateAllBtn) {
      updateAllBtn.disabled = true;
      updateAllBtn.innerHTML = `<span class="spinner" style="width:12px;height:12px;display:inline-block;border-width:2px;"></span> ${t('apps.updatingApp')}`;
    }

    for (const r of results) {
      await this.performWingetAutoUpdate(r.appId, r.latestVersion, r.appName, null);
    }
  },
};

window.AppsUpdatesModule = AppsUpdatesModule;