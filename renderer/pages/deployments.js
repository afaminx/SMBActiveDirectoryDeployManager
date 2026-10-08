// ═══════════════════════════════════════════════════════
// Deployments Page – Network Share Explorer
// ═══════════════════════════════════════════════════════

const DeploymentsPage = {
  async render(container) {
    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1>
            <span class="header-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            </span>
            ${t('deployments.title')}
          </h1>
          <p class="page-subtitle">${t('deployments.subtitle')}</p>
        </div>
        <div style="display:flex;align-items:center;gap:12px;">
          <div style="position:relative;">
            <svg style="position:absolute;left:9px;top:50%;transform:translateY(-50%);pointer-events:none;opacity:.4" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="text" class="form-input" id="deployments-search" placeholder="${t('deployments.search')}" autocomplete="off" style="padding-left:32px;width:220px;">
          </div>
          <button class="btn btn-secondary" onclick="DeploymentsPage.refresh()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            ${t('deployments.refresh')}
          </button>
        </div>
      </div>

      <div id="deployments-container">
        <div class="spinner"></div>
        <p class="loading-text">${t('deployments.scanning')}</p>
      </div>
    `;

    this.loadDeployments();
  },

  async refresh() {
    const container = document.getElementById('deployments-container');
    container.innerHTML = `<div class="spinner"></div><p class="loading-text">${t('deployments.scanning')}</p>`;
    this.loadDeployments();
  },

  async loadDeployments() {
    const container = document.getElementById('deployments-container');

    try {
      const config = await window.api.config.get();
      const result = await window.api.files.listDeployed();

      if (!result.success) {
        container.innerHTML = `
          <div class="rsat-warning">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <div>
              <strong>${t('deployments.accessError')}</strong>
              <p class="mt-sm">${App._esc(result.error)}</p>
              <p class="mt-sm text-muted">${t('deployments.pathConfigured')}: <code>${App._esc(config.networkSharePath)}</code></p>
              <p class="mt-sm"><a href="#" onclick="App.navigate('settings')" style="color:var(--accent-primary)">${t('deployments.changePath')} →</a></p>
            </div>
          </div>`;
        return;
      }

      if (result.data.length === 0) {
        container.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            </div>
            <p class="empty-state-title">${t('deployments.emptyFolder')}</p>
            <p class="empty-state-text">${t('deployments.noAppsInFolder')}<br><code>${App._esc(config.networkSharePath)}</code></p>
          </div>`;
        return;
      }

      // Get configured apps for cross-reference
      let apps = [];
      try { apps = await window.api.apps.getAll(); } catch (e) {}

      container.innerHTML = `
        <p class="text-muted text-sm mb-md">📂 ${App._esc(config.networkSharePath)} — ${result.data.length} ${t('deployments.folders')}</p>
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>${t('deployments.app')}</th>
                <th>${t('deployments.version')}</th>
                <th>${t('deployments.status')}</th>
                <th>${t('deployments.gpo')}</th>
                <th>${t('deployments.files')}</th>
                <th>${t('deployments.lastModified')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${result.data.map(app => {
                const configuredApp = apps.find(a => a.name === app.name);
                const gpoName = configuredApp?.gpoName || '';
                const latestMod = app.files.length > 0 ?
                  app.files.reduce((latest, f) => new Date(f.modified) > new Date(latest.modified) ? f : latest).modified : null;
                const version = app.version || configuredApp?.version || null;
                const hash = app.hash || configuredApp?.lastDeployHash || null;

                return `
                  <tr>
                    <td style="color:var(--text-primary); font-weight:500;">
                      <div class="flex items-center gap-sm">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent-warning)" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                        ${App._esc(app.name)}
                      </div>
                    </td>
                    <td>
                      ${version
                        ? `<span class="badge badge-info">v${App._esc(version)}</span>`
                        : '<span class="text-muted">—</span>'}
                    </td>
                    <td>
                      ${(() => {
                        const isNoInstaller = configuredApp?.template === 'winget' || configuredApp?.template === 'odt';
                        const effectiveStatus = (app.status === 'missing-installer' && isNoInstaller) ? 'ready' : app.status;
                        const label = effectiveStatus === 'ready' ? t('deployments.ready') : effectiveStatus === 'missing-installer' ? t('deployments.missingInstaller') : t('deployments.missingScript');
                        return `<span class="status-dot ${effectiveStatus}"></span>${label}`;
                      })()}
                    </td>
                    <td>${gpoName
                      ? `<span class="badge badge-info">${App._esc(gpoName)}</span>`
                      : configuredApp
                        ? `<span class="badge badge-warning" title="App configurada sin GPO asignada">⚠ ${t('gui.noGpo')}</span>`
                        : '<span class="text-muted" style="font-size:11px;">No configurada</span>'
                    }</td>
                    <td>${app.files.length}</td>
                    <td class="text-muted">${App.formatDate(latestMod)}</td>
                    <td style="text-align:right;">
                      <div style="display:flex;gap:4px;justify-content:flex-end;">
                        ${hash ? `
                          <button class="btn btn-ghost btn-sm" onclick="DeploymentsPage.showDetails('${this.jsArg(app.name)}', '${this.jsArg(version || '')}', '${this.jsArg(hash)}', '${this.jsArg(app.deployedAt || '')}')">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                            ${t('deployments.seeMore')}
                          </button>
                        ` : ''}
                        <button class="btn btn-ghost btn-sm" onclick="DeploymentsPage.showFiles('${this.jsArg(app.name)}')">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                          ${t('deployments.files')}
                        </button>
                      </div>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>`;

      this.bindSearch();
    } catch (err) {
      container.innerHTML = `
        <div class="rsat-warning">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
          <div><strong>Error</strong><p class="mt-sm">${App._esc(err.message)}</p></div>
        </div>`;
    }
  },

  bindSearch() {
    const input = document.getElementById('deployments-search');
    if (!input) return;
    // Preserve query across refreshes
    if (this._searchQuery) input.value = this._searchQuery;
    input.addEventListener('input', (e) => {
      this._searchQuery = e.target.value;
      const q = this._searchQuery.trim().toLowerCase();
      const tbody = document.querySelector('#deployments-container tbody');
      if (!tbody) return;
      let anyVisible = false;
      tbody.querySelectorAll('tr').forEach(row => {
        const text = row.textContent.toLowerCase();
        const matches = !q || text.includes(q);
        row.style.display = matches ? '' : 'none';
        if (matches) anyVisible = true;
      });
      let noMatch = document.getElementById('deployments-no-match');
      if (!anyVisible && q) {
        if (!noMatch) {
          noMatch = document.createElement('tr');
          noMatch.id = 'deployments-no-match';
          noMatch.innerHTML = `<td colspan="7" style="text-align:center;padding:40px;color:var(--text-muted);">${t('deployments.noDeploymentsMatch')}</td>`;
          tbody.appendChild(noMatch);
        }
      } else if (noMatch) {
        noMatch.remove();
      }
    });
  },

  showDetails(appName, version, hash, deployedAt) {
    const body = `
      <div style="display:flex;flex-direction:column;gap:16px;">
        <div>
          <div style="font-size:var(--font-xs);color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">${t('deployments.app')}</div>
          <div style="font-size:var(--font-md);font-weight:600;color:var(--text-primary);">${App._esc(appName)}</div>
        </div>
        ${version ? `
          <div>
            <div style="font-size:var(--font-xs);color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">${t('deployments.version')}</div>
            <div><span class="badge badge-info">v${App._esc(version)}</span></div>
          </div>
        ` : ''}
        ${hash ? `
          <div>
            <div style="font-size:var(--font-xs);color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">${t('deployments.hash')}</div>
            <div style="background:var(--bg-input);border:1px solid var(--border-color);border-radius:var(--radius-sm);padding:10px 14px;font-family:'Cascadia Code','Fira Code','Consolas',monospace;font-size:var(--font-sm);color:var(--accent-secondary);word-break:break-all;cursor:pointer;" onclick="navigator.clipboard.writeText('${App._esc(hash)}'); App.toast('${t('deployments.hashCopied')}','success');" title="${t('gui.clickToCopy')}">${App._esc(hash)}</div>
            <div style="font-size:var(--font-xs);color:var(--text-muted);margin-top:4px;">${t('deployments.clickToCopy')}</div>
          </div>
        ` : ''}
        ${deployedAt ? `
          <div>
            <div style="font-size:var(--font-xs);color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">${t('deployments.deployedOn')}</div>
            <div style="color:var(--text-secondary);">${App.formatDate(deployedAt)}</div>
          </div>
        ` : ''}
      </div>
    `;

    App.openModal(t('deployments.details').replace('...', appName), body, `<button class="btn btn-secondary" onclick="App.closeModal()">${t('deployments.close')}</button>`);
  },

  async showFiles(appName) {
    try {
      const result = await window.api.files.getContents(appName);
      if (!result.success) {
        App.toast('Error: ' + result.error, 'error');
        return;
      }

      const body = result.data.length > 0 ? `
        <ul class="file-list">
          ${result.data.map(f => {
            return `
              <li class="file-item">
                <span class="file-icon">
                  ${f.extension === '.ps1' ? '📜' : f.extension === '.msi' ? '📀' : f.extension === '.exe' ? '⚙️' : f.extension === '.xml' ? '📋' : f.extension === '.json' ? '📊' : '📄'}
                </span>
                <span style="color:var(--text-primary)">${App._esc(f.name)}</span>
                <span class="file-meta">${App.formatBytes(f.size)} · ${App.formatDate(f.modified)}</span>
              </li>`;
          }).join('')}
        </ul>` : `<p class="text-muted">${t('gui.folderIsEmpty')}</p>`;

      App.openModal(`📂 ${appName}`, body);
    } catch (err) {
      App.toast('Error: ' + err.message, 'error');
    }
  },



  jsArg(str) {
    return String(str || '')
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/"/g, '\\x22')
      .replace(/\r/g, '\\r')
      .replace(/\n/g, '\\n')
      .replace(/</g, '\\x3C')
      .replace(/>/g, '\\x3E')
      .replace(/&/g, '\\x26');
  }
};
