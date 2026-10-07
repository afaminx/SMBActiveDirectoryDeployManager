'use strict';

const AppsActionsModule = {
  // the app isn't deployed / no installer is present on the share.
  async resolveSharedInstaller(appName, preferredInstallerPath = '') {
    try {
      if (!appName) return null;
      const result = await window.api.files.getContents(appName);
      if (!result || !result.success || !Array.isArray(result.data)) return null;
      const preferredName = String(preferredInstallerPath || '').split(/[\\/]/).pop()?.toLowerCase() || '';
      const installers = result.data.filter(f =>
        AppUtils.isSupportedInstallerExtension(f.extension)
        && String(f.name || '').toLowerCase() !== 'install.ps1'
        && String(f.name || '').toLowerCase() !== 'uninstall.ps1'
      );
      const installer = installers.find(f => String(f.name || '').toLowerCase() === preferredName) || installers[0];
      if (!installer) return null;
      const config = await window.api.config.get();
      if (!config || !config.networkSharePath) return null;
      const base = config.networkSharePath.replace(/[\\/]+$/, '');
      return base + '\\' + appName + '\\' + installer.name;
    } catch (e) {
      return null;
    }
  },
  async showAppDetail(id) {
    const app = await window.api.apps.get(id);
    if (!app) return;

    const templates = await window.api.scripts.getTemplates();
    const templateInfo = templates.find(tmpl => tmpl.id === app.template) || { name: app.templateDefinition?.name || app.template };
    const isDeployed = app.deployed !== false && app.deployedPath;
    const publishedAction = AppUtils.getPublishedAction(app);
    const statusClass = AppUtils.getDeploymentVisualState(app);
    const statusText = AppUtils.getDeploymentStatusLabel(app);

    // Prefer the share location for the installer (where it actually lives now)
    const sharedInstaller = await this.resolveSharedInstaller(app.name, app.installerPath);
    const displayInstallerPath = sharedInstaller || app.installerPath;

    const row = (label, value) => value ? `
      <div style="display:flex; justify-content:space-between; padding:10px 0; border-bottom:1px solid var(--border-color);">
        <span style="color:var(--text-muted); font-size:13px;">${label}</span>
        <span style="color:var(--text-primary); font-size:13px; font-weight:500; text-align:right; max-width:60%; word-break:break-all;">${value}</span>
      </div>` : '';

    const ouNameFromDN = (dn) => {
      const match = (dn || '').match(/^OU=([^,]+)/i);
      return match ? match[1] : dn;
    };

    const ousHtml = app.assignedOUs && app.assignedOUs.length > 0
      ? app.assignedOUs.map(ou => `<div style="font-size:12px; color:var(--text-secondary); padding:4px 8px; background:var(--bg-tertiary); border-radius:4px; margin-top:4px;" title="${App._esc(ou)}">${App._esc(ouNameFromDN(ou))}</div>`).join('')
      : `<span style="color:var(--text-muted); font-size:13px;">${t('apps.detailNoOUs')}</span>`;

    const paramsHtml = app.customParams && Object.keys(app.customParams).length > 0
      ? Object.entries(app.customParams).map(([k, v]) => row(App._esc(k), App._esc(String(v)))).join('')
      : '';
    const uninstallSummary = AppUtils.getUninstallSummary(app);
    const canUninstall = AppUtils.canGenerateUninstall(app);
    const canPublishUninstall = isDeployed && publishedAction !== 'uninstall';

    const body = `
      <div style="display:flex; flex-direction:column; gap:16px;">
        <!-- Header -->
        <div style="display:flex; align-items:center; gap:12px;">
          <div style="width:48px; height:48px; border-radius:12px; background:var(--accent-primary-dim); display:flex; align-items:center; justify-content:center; font-size:26px;">
            ${AppUtils.templateIcon(app.template)}
          </div>
          <div>
            <div style="font-size:18px; font-weight:700; color:var(--text-primary);">${App._esc(app.name)}</div>
            <div style="font-size:13px; color:var(--text-muted);">${App._esc(templateInfo.name)}</div>
          </div>
        </div>

        <!-- Status badges -->
        <div style="display:flex; flex-wrap:wrap; gap:6px;">
          <span class="badge badge-primary">${App._esc((app.installerType || 'exe').toUpperCase())}</span>
          <span class="badge badge-info">v${App._esc(app.version || '1.0.0')}</span>
          ${statusClass === 'uninstalling'
            ? `<span class="badge badge-warning">${t('apps.uninstallPublished', 'Desinstalacion')}</span>`
            : (isDeployed
                ? `<span class="badge badge-success">${t('apps.installPublished', 'Instalacion')}</span>`
                : `<span class="badge badge-neutral">${t('apps.detailNotDeployed')}</span>`)}
          ${app.gpoName ? `<span class="badge badge-info">${App._esc(app.gpoName)}</span>` : `<span class="badge badge-neutral">${t('apps.noGpoBadge')}</span>`}
          ${app.notifyUser ? `<span class="badge badge-warning">${t('apps.detailNotifyEnabled')}</span>` : ''}
        </div>

        <!-- General Info -->
        <div class="card" style="padding:12px 16px; margin:0;">
          <div style="font-weight:600; font-size:13px; color:var(--text-secondary); margin-bottom:4px;">${t('apps.detailSectionGeneral')}</div>
          ${row(t('apps.detailTemplate'), App._esc(templateInfo.name))}
          ${app.template === 'winget'
            ? row('Winget ID', `<code style="background:var(--bg-tertiary); padding:2px 6px; border-radius:4px; font-size:12px;">${App._esc(app.wingetId || '-')}</code>`)
            : app.template === 'odt'
              ? row('Producto ODT', `<code style="background:var(--bg-tertiary); padding:2px 6px; border-radius:4px; font-size:12px;">${App._esc((app.odtConfig?.product || 'O365BusinessRetail') + ' · ' + (app.odtConfig?.channel || 'MonthlyEnterprise') + ' · ' + (app.odtConfig?.language || 'es-es'))}</code>`)
              : row(t('apps.detailInstallerType'), App._esc((app.installerType || 'exe').toUpperCase()))
          }
          ${(app.template !== 'winget' && app.template !== 'odt') ? row(t('apps.detailSilentArgs'), app.silentArgs ? '<code style="background:var(--bg-tertiary); padding:2px 6px; border-radius:4px; font-size:12px;">' + App._esc(app.silentArgs) + '</code>' : '-') : ''}
          ${row(t('apps.publishedState', 'Estado publicado'), App._esc(statusText))}
          ${row(t('apps.uninstallMode', 'Modo de desinstalacion'), App._esc(uninstallSummary))}
          ${row(t('apps.detailVersion'), App._esc(app.version || '1.0.0'))}
          ${row(t('apps.detailNotifyUser'), app.notifyUser ? '&#10003;' : '&#10007;')}
        </div>

        <!-- Paths -->
        <div class="card" style="padding:12px 16px; margin:0;">
          <div style="font-weight:600; font-size:13px; color:var(--text-secondary); margin-bottom:4px;">${t('apps.detailSectionPaths')}</div>
          ${(app.template !== 'winget' && app.template !== 'odt') ? row(t('apps.detailInstaller'), displayInstallerPath ? '<span style="font-family:monospace; font-size:12px;">' + App._esc(displayInstallerPath) + '</span>' : '-') : ''}
          ${app.configXmlPath ? row(t('apps.detailConfigXml'), '<span style="font-family:monospace; font-size:12px;">' + App._esc(app.configXmlPath) + '</span>') : ''}
          ${row(t('apps.detailDeployPath'), app.deployedPath ? '<span style="font-family:monospace; font-size:12px;">' + App._esc(app.deployedPath) + '</span>' : '-')}
          ${row(t('apps.uninstallDeployPath', 'Ruta uninstall'), app.uninstallDeployedPath ? '<span style="font-family:monospace; font-size:12px;">' + App._esc(app.uninstallDeployedPath) + '</span>' : '-')}
          ${app.lastDeployHash ? row(t('apps.detailHash'), '<span style="font-family:monospace; font-size:11px;">' + App._esc(app.lastDeployHash.substring(0, 16)) + '...</span>') : ''}
        </div>

        <!-- GPO & OUs -->
        <div class="card" style="padding:12px 16px; margin:0;">
          <div style="font-weight:600; font-size:13px; color:var(--text-secondary); margin-bottom:4px;">${t('apps.detailSectionTargeting')}</div>
          ${row(t('apps.detailGpo'), app.gpoName ? App._esc(app.gpoName) : '-')}
          <div style="padding:10px 0; border-bottom:1px solid var(--border-color);">
            <span style="color:var(--text-muted); font-size:13px;">${t('apps.detailAssignedOUs')}</span>
            <div style="margin-top:6px;">${ousHtml}</div>
          </div>
        </div>

        ${paramsHtml ? `
        <!-- Custom Parameters -->
        <div class="card" style="padding:12px 16px; margin:0;">
          <div style="font-weight:600; font-size:13px; color:var(--text-secondary); margin-bottom:4px;">${t('apps.detailSectionParams')}</div>
          ${paramsHtml}
        </div>
        ` : ''}

        ${app.versionHistory && app.versionHistory.length > 0 ? `
        <!-- Version History -->
        <div class="card" style="padding:12px 16px; margin:0;">
          <div style="font-weight:600; font-size:13px; color:var(--text-secondary); margin-bottom:8px;">${t('apps.detailSectionHistory')} (${app.versionHistory.length})</div>
          <div style="display:flex; flex-direction:column; gap:6px; max-height:200px; overflow-y:auto;">
            ${app.versionHistory.slice().reverse().map(h => `
              <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 10px; background:var(--bg-tertiary); border-radius:6px; font-size:12px;">
                <div style="display:flex; flex-direction:column; gap:2px;">
                  <span style="color:var(--text-primary); font-weight:600;">v${App._esc(h.version || '?')}</span>
                  ${h.hash ? `<span style="font-family:monospace; font-size:10px; color:var(--text-muted);">${App._esc(h.hash.substring(0, 16))}...</span>` : ''}
                </div>
                <span style="color:var(--text-muted); font-size:11px;">${h.replacedAt ? new Date(h.replacedAt).toLocaleString() : ''}</span>
              </div>
            `).join('')}
          </div>
        </div>
        ` : ''}

        <!-- Timestamps -->
        <div style="display:flex; justify-content:space-between; font-size:11px; color:var(--text-muted); padding-top:4px;">
          <span>${t('apps.detailCreated')}: ${app.createdAt ? new Date(app.createdAt).toLocaleString() : '-'}</span>
          <span>${t('apps.detailUpdated')}: ${app.updatedAt ? new Date(app.updatedAt).toLocaleString() : '-'}</span>
        </div>
      </div>
    `;

    App.openModal(t('apps.detailTitle'), body, `
      <button class="btn btn-secondary" onclick="App.closeModal()">${t('common.close')}</button>
      ${canPublishUninstall && canUninstall ? `<button class="btn btn-warning" onclick="App.closeModal(); AppsPage.uninstallApp('${app.id}')">${t('apps.uninstallAction', 'Desinstalar')}</button>` : ''}
      ${(!isDeployed || publishedAction === 'uninstall') ? `<button class="btn btn-success" onclick="App.closeModal(); AppsPage.deployApp('${app.id}')">${AppUtils.getInstallActionLabel(app)}</button>` : ''}
      <button class="btn btn-secondary" onclick="App.closeModal(); AppsPage.editApp('${app.id}')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        ${t('apps.edit')}
      </button>
    `);

    AppsPage.keepAppCardVisible(id);
  },
  async quickUpdate(id) {
    const app = await window.api.apps.get(id);
    if (!app) return;

    const templates = await window.api.scripts.getTemplates();
    const templateInfo = templates.find(tmpl => tmpl.id === app.template) || { name: app.templateDefinition?.name || app.template };

    // Local state for the quick update flow
    const state = {
      newInstallerPath: '',
      newVersion: '',
      newHash: '',
      sameFile: false,
      isDowngrade: false
    };

    const renderModal = () => {
      const body = `
        <div style="display:flex; flex-direction:column; gap:14px;">
          <!-- Info banner -->
          <div style="padding:12px; background:rgba(30,144,255,0.08); border:1px solid rgba(30,144,255,0.2); border-radius:8px;">
            <p style="margin:0; color:var(--text-secondary); font-size:13px;">
              ${t('apps.quickUpdateIntro')}
            </p>
          </div>

          <!-- Header -->
          <div style="display:flex; align-items:center; gap:12px;">
            <div style="width:44px; height:44px; border-radius:10px; background:var(--accent-primary-dim); display:flex; align-items:center; justify-content:center; font-size:24px;">
              ${AppUtils.templateIcon(app.template)}
            </div>
            <div>
              <div style="font-size:17px; font-weight:700; color:var(--text-primary);">${App._esc(app.name)}</div>
              <div style="font-size:12px; color:var(--text-muted);">${App._esc(templateInfo.name)}</div>
            </div>
          </div>

          <!-- Current state -->
          <div class="card" style="padding:12px 16px; margin:0;">
            <div style="font-weight:600; font-size:13px; color:var(--text-secondary); margin-bottom:8px;">${t('apps.quickUpdateCurrent')}</div>
            <div style="display:flex; justify-content:space-between; padding:6px 0; font-size:13px;">
              <span style="color:var(--text-muted);">${t('apps.detailVersion')}</span>
              <span style="color:var(--text-primary); font-weight:500;">v${App._esc(app.version || '1.0.0')}</span>
            </div>
            <div style="display:flex; justify-content:space-between; padding:6px 0; font-size:13px;">
              <span style="color:var(--text-muted);">${t('apps.detailInstaller')}</span>
              <span style="font-family:monospace; font-size:11px; color:var(--text-primary); max-width:60%; text-align:right; word-break:break-all;">${App._esc(app.installerPath || '-')}</span>
            </div>
            ${app.lastDeployHash ? `
            <div style="display:flex; justify-content:space-between; padding:6px 0; font-size:13px;">
              <span style="color:var(--text-muted);">SHA-256</span>
              <span style="font-family:monospace; font-size:11px; color:var(--text-muted);">${App._esc(app.lastDeployHash.substring(0, 16))}...</span>
            </div>
            ` : ''}
          </div>

          <!-- File picker -->
          <div>
            <label class="form-label">${t('apps.quickUpdatePickNew')}</label>
            <div class="flex gap-sm">
              <input class="form-input" id="qu-installer-path" value="${App._esc(state.newInstallerPath)}" placeholder="${t('apps.quickUpdatePickPlaceholder')}" readonly style="flex:1">
              <button class="btn btn-secondary" id="qu-pick-btn">${t('apps.browse')}</button>
            </div>
          </div>

          <!-- Comparison (only if new file picked) -->
          ${state.newInstallerPath ? `
            <div class="card" style="padding:12px 16px; margin:0;">
              <div style="font-weight:600; font-size:13px; color:var(--text-secondary); margin-bottom:8px;">${t('apps.quickUpdateComparison')}</div>
              <div style="display:flex; align-items:center; justify-content:center; gap:16px; padding:10px; background:var(--bg-tertiary); border-radius:6px;">
                <div style="text-align:center;">
                  <div style="font-size:11px; color:var(--text-muted); margin-bottom:2px;">${t('apps.quickUpdateOldLabel')}</div>
                  <div style="font-weight:700; color:var(--text-primary);">v${App._esc(app.version || '1.0.0')}</div>
                </div>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--primary-color)" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                <div style="text-align:center;">
                  <div style="font-size:11px; color:var(--text-muted); margin-bottom:2px;">${t('apps.quickUpdateNewLabel')}</div>
                  <div style="font-weight:700; color:${state.isDowngrade ? 'var(--warning-color)' : 'var(--success-color, #10b981)'};">v${App._esc(state.newVersion || '?')}</div>
                </div>
              </div>
              ${state.newHash ? `
                <div style="display:flex; justify-content:space-between; padding:8px 0 0 0; font-size:11px; font-family:monospace; color:var(--text-muted);">
                  <span>${App._esc((app.lastDeployHash || '').substring(0, 16))}...</span>
                  <span>&#8594;</span>
                  <span>${App._esc(state.newHash.substring(0, 16))}...</span>
                </div>
              ` : ''}
            </div>

            ${state.sameFile ? `
              <div style="padding:12px; background:rgba(239,68,68,0.08); border:1px solid rgba(239,68,68,0.25); border-radius:8px;">
                <p style="margin:0; color:var(--danger-color); font-size:13px; font-weight:500;">
                  &#9888;&#65039; ${t('apps.quickUpdateSameFile')}
                </p>
              </div>
            ` : ''}

            ${state.isDowngrade && !state.sameFile ? `
              <div style="padding:12px; background:rgba(251,191,36,0.08); border:1px solid rgba(251,191,36,0.3); border-radius:8px;">
                <p style="margin:0; color:var(--warning-color); font-size:13px; font-weight:500;">
                  &#9888;&#65039; ${t('apps.quickUpdateDowngradeWarn').replace('{old}', app.version || '1.0.0').replace('{new}', state.newVersion)}
                </p>
              </div>
            ` : ''}
          ` : ''}
        </div>
      `;

      const canUpdate = state.newInstallerPath && !state.sameFile;
      const footer = `
        <button class="btn btn-secondary" onclick="App.closeModal()">${t('common.cancel')}</button>
        <div style="flex:1"></div>
        <button class="btn btn-success" id="qu-confirm-btn" ${canUpdate ? '' : 'disabled'}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
          ${t('apps.quickUpdateConfirm')}
        </button>
      `;

      App.openModal(t('apps.quickUpdateTitle'), body, footer);

      document.getElementById('qu-pick-btn').addEventListener('click', async () => {
        const file = await window.api.config.selectFile([{ name: 'Installers', extensions: ['exe', 'msi'] }]);
        if (!file) return;

        state.newInstallerPath = file;
        state.newVersion = '';
        state.newHash = '';
        state.sameFile = false;
        state.isDowngrade = false;

        // Detect version
        try {
          const verResult = await window.api.apps.getInstallerVersion(file);
          if (verResult && verResult.success && verResult.version) {
            state.newVersion = verResult.version;
            state.isDowngrade = AppUtils.compareVersions(verResult.version, app.version || '0') < 0;
          }
        } catch (e) {}

        // Compute hash and compare
        try {
          const hashResult = await window.api.apps.computeHash(file);
          if (hashResult && hashResult.hash) {
            state.newHash = hashResult.hash;
            if (app.lastDeployHash && app.lastDeployHash === hashResult.hash) {
              state.sameFile = true;
            }
          }
        } catch (e) {}

        renderModal();
      });

      const confirmBtn = document.getElementById('qu-confirm-btn');
      if (confirmBtn) {
        confirmBtn.addEventListener('click', () => {
          this.performQuickUpdate(app, state);
        });
      }
    };

    renderModal();
  },

  async performQuickUpdate(app, state) {
    const confirmBtn = document.getElementById('qu-confirm-btn');
    if (confirmBtn) {
      confirmBtn.style.width = confirmBtn.offsetWidth + 'px';
      confirmBtn.style.height = confirmBtn.offsetHeight + 'px';
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = '<span class="spinner" style="width:14px;height:14px;display:inline-block;border-width:2px;"></span>';
    }

    try {
      // 1. Push current version to history
      const history = Array.isArray(app.versionHistory) ? [...app.versionHistory] : [];
      history.push({
        version: app.version || '1.0.0',
        hash: app.lastDeployHash || '',
        replacedAt: new Date().toISOString(),
        replacedBy: 'quick-update'
      });

      // 2. Build updated app data
      const newInstallerType = AppUtils.getInstallerTypeFromPath(state.newInstallerPath, app.template);
      const updatedData = {
        installerPath: state.newInstallerPath,
        installerType: newInstallerType,
        version: state.newVersion || app.version,
        versionHistory: history
      };

      // 3. Update app record
      await window.api.apps.update(app.id, updatedData);

      // 4. Redeploy (copies new installer + regenerates install.ps1)
      const fullAppData = { ...app, ...updatedData, id: app.id };
      const deployResult = await window.api.scripts.deploy(fullAppData);

      if (!deployResult.success) {
        if (App.isShareError(deployResult.error)) { App.handleShareError(); return; }
        App.toast(`${t('apps.appSavedDeployError')} ${deployResult.error}`, 'error');
        return;
      }

      // 5. Save new hash & deployedPath
      await window.api.apps.update(app.id, {
        deployed: true,
        deployedPath: deployResult.path,
        lastDeployHash: deployResult.hash || state.newHash,
        publishedAction: 'install',
        publishedAt: new Date().toISOString()
      });

      // 6. Activity log
      await window.api.activity.add('app_quick_update', {
        appName: app.name,
        oldVersion: app.version,
        newVersion: state.newVersion
      });

      App.toast(t('apps.quickUpdateSuccess').replace('{version}', state.newVersion || '?'), 'success');
      App.closeModal();
      AppsListModule.setPendingFocus(app.id);
      App.navigate('apps');
    } catch (err) {
      App.toast('Error: ' + err.message, 'error');
    }
  },
  async previewScript(id) {
    const app = await window.api.apps.get(id);
    if (!app) return;

    const script = await window.api.scripts.generate(app);

    App.openModal(`Script: ${app.name}`, `
      <div class="code-header">
        <span>&#128196; install.ps1</span>
        <button class="btn btn-ghost btn-sm" onclick="AppsPage.copyScript()">${t('apps.copyBtn')}</button>
      </div>
      <pre class="code-preview" id="script-preview">${App._esc(script)}</pre>
    `);
  },

  async previewUninstallScript(id) {
    const app = await window.api.apps.get(id);
    if (!app) return;
    if (!AppUtils.canGenerateUninstall(app)) {
      App.toast(t('apps.uninstallNotConfigured', 'Esta app no tiene una desinstalacion configurada.'), 'warning');
      return;
    }

    const script = await window.api.scripts.generateUninstall(app);
    App.openModal(`${t('apps.uninstallScript', 'Script uninstall')}: ${app.name}`, `
      <div class="code-header">
        <span>&#128196; uninstall.ps1</span>
        <button class="btn btn-ghost btn-sm" onclick="AppsPage.copyScript()">${t('apps.copyBtn')}</button>
      </div>
      <pre class="code-preview" id="script-preview">${App._esc(script)}</pre>
    `);
  },

  async deployApp(id) {
    const app = await window.api.apps.get(id);
    if (!app) return;

    try {
      const result = await window.api.scripts.deploy(app);
      if (result.success) {
        await window.api.apps.update(id, {
          deployed: true,
          deployedPath: result.path,
          uninstallDeployedPath: result.uninstallPath || '',
          publishedAction: 'install',
          publishedAt: new Date().toISOString()
        });
        App.toast(t('apps.deployedToPath').replace('{app}', app.name).replace('{path}', result.path), 'success');
        AppsListModule.setPendingFocus(id);
        App.navigate('apps');
      } else {
        if (App.isShareError(result.error)) { App.handleShareError(); return; }
        App.toast(`Error: ${result.error}`, 'error');
      }
    } catch (err) {
      App.toast(t('apps.deployError') + ' ' + err.message, 'error');
    }
  },

  async regenerateScripts(id) {
    if (AppsPage._regeneratingScriptIds.has(id)) return;

    const app = await window.api.apps.get(id);
    if (!app) return;

    AppsPage._regeneratingScriptIds.add(id);
    try {
      const result = await window.api.scripts.regenerate(app);
      if (!result?.success) {
        if (App.isShareError(result?.error)) { App.handleShareError(); return; }
        throw new Error(result?.error || t('apps.regenerateScriptsError', 'Could not regenerate scripts.'));
      }

      const nextPublishedAction = String(result.publishedAction || app.publishedAction || '').trim().toLowerCase() === 'uninstall'
        ? 'uninstall'
        : 'install';
      await window.api.apps.update(id, {
        deployed: true,
        deployedPath: result.installPath || app.deployedPath || '',
        uninstallDeployedPath: result.uninstallPath || app.uninstallDeployedPath || '',
        publishedAction: nextPublishedAction,
        publishedAt: new Date().toISOString(),
        lastDeployHash: result.hash || app.lastDeployHash || ''
      });
      await window.api.activity.add('app_scripts_regenerated', {
        appName: app.name,
        publishedAction: nextPublishedAction
      });
      App.toast(t('apps.regenerateScriptsSuccess', 'Scripts regenerados correctamente para {app}.').replace('{app}', app.name), 'success');
      AppsListModule.setPendingFocus(id);
      App.navigate('apps');
    } catch (err) {
      App.toast(`${t('apps.regenerateScriptsError', 'Could not regenerate scripts.')}: ${err.message}`, 'error');
    } finally {
      AppsPage._regeneratingScriptIds.delete(id);
    }
  },

  async uninstallApp(id) {
    const app = await window.api.apps.get(id);
    if (!app) return;
    if (!AppUtils.canGenerateUninstall(app)) {
      App.toast(t('apps.uninstallNotConfigured', 'Esta app no tiene una desinstalacion configurada.'), 'warning');
      return;
    }

    const hasGPO = !!app.gpoName;
    const targetOUs = Array.isArray(app.assignedOUs) && app.assignedOUs.length > 0
      ? app.assignedOUs
      : (app.ouDN ? [app.ouDN] : []);

    App.openModal(t('apps.uninstallAction', 'Desinstalar'), `
      <p>${t('apps.uninstallPrepareMsg', 'Se preparará el script de desinstalacion para')} <strong>${App._esc(app.name)}</strong>.</p>
      <div class="card" style="padding:12px 14px; margin:12px 0 0 0;">
        <div style="font-size:12px; color:var(--text-secondary); margin-bottom:6px;">${t('apps.uninstallMode', 'Modo de desinstalacion')}</div>
        <div style="font-weight:600; color:var(--text-primary);">${App._esc(AppUtils.getUninstallSummary(app))}</div>
      </div>
      ${hasGPO ? `
        <label class="checkbox-wrapper checkbox-panel" style="margin-top:12px;">
          <input type="checkbox" class="checkbox-select" id="chk-switch-uninstall-gpo" checked>
          <span>${t('apps.uninstallSwitchGpo', 'Reapuntar la GPO al uninstall.ps1')}</span>
        </label>
        <p class="form-hint">${t('apps.uninstallSwitchGpoHint', 'La GPO conservará sus enlaces OU y ejecutará ahora el script de desinstalacion.')}</p>
      ` : ''}
    `, `
      <button class="btn btn-secondary" onclick="App.closeModal()">${t('common.cancel')}</button>
      <button class="btn btn-warning" id="btn-confirm-uninstall-app">${t('apps.uninstallAction', 'Desinstalar')}</button>
    `);

    document.getElementById('btn-confirm-uninstall-app').addEventListener('click', async () => {
      const btn = document.getElementById('btn-confirm-uninstall-app');
      btn.style.width = btn.offsetWidth + 'px';
      btn.style.height = btn.offsetHeight + 'px';
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;display:inline-block;border-width:2px;"></span>';

      try {
        const deployResult = await window.api.scripts.deployUninstall(app);
        if (!deployResult.success) {
          if (App.isShareError(deployResult.error)) { App.handleShareError(); return; }
          throw new Error(deployResult.error || 'Could not prepare uninstall.ps1');
        }

        const uninstallPath = deployResult.uninstallPath || deployResult.path || '';
        await window.api.apps.update(app.id, {
          uninstallDeployedPath: uninstallPath,
          publishedAction: 'uninstall',
          publishedAt: new Date().toISOString()
        });

        const switchGPO = document.getElementById('chk-switch-uninstall-gpo')?.checked ?? false;
        if (hasGPO && switchGPO && uninstallPath) {
          if (!App.rsatAvailable) {
            App.toast(t('apps.uninstallGpoSkipped', 'Could not update the GPO because Group Policy tools are unavailable.'), 'warning');
          } else {
            const gpoResult = await window.api.ad.createGPO(app.gpoName, uninstallPath, targetOUs);
            if (!gpoResult.success) {
              App.toast(`${t('apps.uninstallGpoWarn', 'Uninstall script generated, but the GPO could not be updated.')}: ${gpoResult.error}`, 'warning');
            }
          }
        }

        await window.api.activity.add('app_uninstall_prepare', {
          appName: app.name,
          mode: AppUtils.normalizeUninstallState(app, app).mode
        });
        App.toast(t('apps.uninstallPrepared', 'Script de desinstalacion preparado correctamente.'), 'success');
        App.closeModal();
        AppsListModule.setPendingFocus(id);
        App.navigate('apps');
      } catch (err) {
        App.toast(`${t('common.error')}: ${err.message}`, 'error');
        btn.disabled = false;
        btn.textContent = t('apps.uninstallAction', 'Desinstalar');
      }
    });
  },

  async disableDeploy(id) {
    const app = await window.api.apps.get(id);
    if (!app) return;

    const hasGPO = !!app.gpoName;
    const hasOUs = app.assignedOUs && app.assignedOUs.length > 0;

    App.openModal(t('apps.disableConfirm'), `
      <p>${t('apps.disableMsg').replace('{app}', `<strong>${App._esc(app.name)}</strong>`)}</p>
      ${hasGPO ? `
        <div class="form-group mt-md" style="background: rgba(255,165,0,0.08); border: 1px solid rgba(255,165,0,0.25); border-radius:8px; padding:12px;">
          <p style="margin:0 0 8px 0; color:var(--warning-color); font-weight:600;">&#9888;&#65039; Esta app tiene la GPO "${App._esc(app.gpoName)}" asignada</p>
          ${hasOUs ? `
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
              <input type="checkbox" id="chk-unlink-gpo" checked style="width:auto; cursor:pointer;">
              <label for="chk-unlink-gpo" style="margin:0; cursor:pointer; font-size:14px; color:var(--text-secondary);">${t('apps.cleanGpoOption')}</label>
            </div>
          ` : ''}
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
            <input type="checkbox" id="chk-clean-script" checked style="width:auto; cursor:pointer;">
            <label for="chk-clean-script" style="margin:0; cursor:pointer; font-size:14px; color:var(--text-secondary);">${t('apps.cleanSysvolOption')}</label>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            <input type="checkbox" id="chk-delete-gpo" style="width:auto; cursor:pointer;">
            <label for="chk-delete-gpo" style="margin:0; cursor:pointer; font-size:14px; color:var(--text-muted);">${t('apps.deleteGpoOption')}</label>
          </div>
        </div>
      ` : ''}
      <div class="form-group mt-md" style="display:flex; align-items:center; gap:8px;">
        <input type="checkbox" id="chk-delete-deploy-files" style="width:auto; cursor:pointer;" checked>
        <label for="chk-delete-deploy-files" style="margin:0; cursor:pointer; font-size:14px; color:var(--text-muted);">${t('apps.keepFilesOption')}</label>
      </div>
    `, `
      <button class="btn btn-secondary" onclick="App.closeModal()">${t('common.cancel')}</button>
      <button class="btn btn-warning" id="btn-confirm-disable">${t('apps.disable')}</button>
    `);

    document.getElementById('btn-confirm-disable').addEventListener('click', async () => {
      const btn = document.getElementById('btn-confirm-disable');
      btn.style.width = btn.offsetWidth + 'px';
      btn.style.height = btn.offsetHeight + 'px';
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;display:inline-block;border-width:2px;"></span>';

      try {
        // Checkbox = "keep files" (checked by default), so invert to get deleteFiles
        const deleteFiles = !document.getElementById('chk-delete-deploy-files').checked;
        const unlinkGPO = document.getElementById('chk-unlink-gpo')?.checked ?? false;
        const cleanScript = document.getElementById('chk-clean-script')?.checked ?? false;
        const deleteGPO = document.getElementById('chk-delete-gpo')?.checked ?? false;

        // 1. Unlink GPO from all assigned OUs
        if (hasGPO && unlinkGPO && hasOUs) {
          for (const ouDN of app.assignedOUs) {
            const result = await window.api.ad.unlinkGPOfromOU(app.gpoName, ouDN);
            if (result.success) {
              App.toast(t('apps.gpoUnlinkedOu').replace('{ou}', ouDN.split(',')[0]), 'success');
            } else {
              App.toast(t('apps.gpoUnlinkFailed').replace('{ou}', ouDN.split(',')[0]) + ' ' + result.error, 'warning');
            }
          }
        }

        // 2. Clean startup script from SYSVOL
        if (hasGPO && cleanScript) {
          const cleanResult = await window.api.ad.removeGPOStartupScript(app.gpoName);
          if (cleanResult.success) {
            App.toast(t('apps.sysvolCleaned'), 'success');
          } else {
            App.toast(`${t('apps.sysvolCleanWarn')} ${cleanResult.error}`, 'warning');
          }
        }

        // 3. Delete GPO entirely if requested
        if (hasGPO && deleteGPO) {
          const delResult = await window.api.ad.deleteGPO(app.gpoName);
          if (delResult.success) {
            App.toast(t('apps.gpoDeletedMsg').replace('{gpo}', app.gpoName), 'success');
          } else {
            App.toast(`${t('apps.gpoDeleteFailed')} ${delResult.error}`, 'warning');
          }
        }

        // 4. Delete files from network share if requested
        if (deleteFiles) {
          await window.api.apps.delete(id, true);
          // Re-create the app record without files
          const freshApp = { ...app };
          delete freshApp.id;
          freshApp.deployed = false;
          freshApp.deployedPath = '';
          freshApp.publishedAction = 'pending';
          freshApp.publishedAt = '';
          freshApp.gpoName = deleteGPO ? '' : app.gpoName;
          freshApp.assignedOUs = (unlinkGPO || deleteGPO) ? [] : app.assignedOUs;
          await window.api.apps.create(freshApp);
          await window.api.activity.add('app_disable', { appName: app.name, deletedFiles: true, deletedGPO: deleteGPO });
        } else {
          // Just update the app status
          const updateData = { deployed: false, deployedPath: '', publishedAction: 'pending', publishedAt: '' };
          if (deleteGPO) updateData.gpoName = '';
          if (unlinkGPO || deleteGPO) updateData.assignedOUs = [];
          await window.api.apps.update(id, updateData);
          await window.api.activity.add('app_disable', { appName: app.name, deletedFiles: false, deletedGPO: deleteGPO });
        }

        App.toast(t('apps.disableSuccess').replace('{app}', app.name), 'success');
        App.closeModal();
        App.navigate('apps');
      } catch (err) {
        App.toast('Error: ' + err.message, 'error');
        btn.disabled = false;
        btn.textContent = t('apps.disable');
      }
    });
  },

  async editApp(id) {
    const app = await window.api.apps.get(id);
    if (app) AppsPage.openWizard(app);
  },

  async deleteApp(id) {
    const app = await window.api.apps.get(id);
    if (!app) return;

    const hasGPO = !!app.gpoName;
    const hasOUs = app.assignedOUs && app.assignedOUs.length > 0;
    const body = `
      <div style="display:flex;flex-direction:column;gap:12px;">
        <div style="padding:10px 14px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:8px;">
          <div style="font-size:13px;font-weight:700;color:var(--accent-danger);">${t('apps.deleteConfirm')}</div>
          <div style="font-size:12px;color:var(--text-secondary);margin-top:4px;">
            ${t('apps.deleteMsg').replace('{app}', `<strong>${App._esc(app.name)}</strong>`)}
          </div>
        </div>
        ${AppUtils.renderDeleteTargetCard({
          icon: AppUtils.templateIcon(app.template),
          title: app.name,
          subtitle: app.gpoName ? `GPO: ${App._esc(app.gpoName)}` : ''
        })}
        ${hasGPO && hasOUs ? AppUtils.renderDeleteOptionCard({
          id: 'chk-del-unlink-gpo',
          checked: true,
          title: t('apps.cleanGpoOption'),
          hint: t('apps.cleanGpoOptionHint', 'Quita la vinculacion de la GPO en las OUs asignadas')
        }) : ''}
        ${hasGPO ? AppUtils.renderDeleteOptionCard({
          id: 'chk-del-clean-script',
          checked: true,
          title: t('apps.cleanSysvolOption'),
          hint: t('apps.cleanSysvolOptionHint', 'Elimina el script de inicio asociado en SYSVOL')
        }) : ''}
        ${hasGPO ? AppUtils.renderDeleteOptionCard({
          id: 'chk-del-delete-gpo',
          checked: true,
          title: t('apps.deleteGpoOption'),
          hint: t('apps.deleteGpoOptionHint', 'Borra la GPO de Active Directory si ya no se necesita')
        }) : ''}
        ${AppUtils.renderDeleteOptionCard({
          id: 'chk-delete-files',
          checked: true,
          title: t('apps.keepFilesOption'),
          hint: t('apps.keepFilesOptionHint', 'Desmarca esta opcion si tambien quieres borrar la carpeta del share')
        })}
      </div>
    `;

    App.openModal(
      t('apps.deleteConfirm'),
      body,
      AppUtils.renderDeleteFooter('btn-confirm-delete', t('common.delete'))
    );

    document.getElementById('btn-confirm-delete-cancel')?.addEventListener('click', () => App.closeModal());
    document.getElementById('btn-confirm-delete').addEventListener('click', async () => {
      const btn = document.getElementById('btn-confirm-delete');
      btn.style.width = btn.offsetWidth + 'px';
      btn.style.height = btn.offsetHeight + 'px';
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;display:inline-block;border-width:2px;"></span>';

      try {
        const deleteFiles = !document.getElementById('chk-delete-files').checked;
        const unlinkGPO = document.getElementById('chk-del-unlink-gpo')?.checked ?? false;
        const cleanScript = document.getElementById('chk-del-clean-script')?.checked ?? false;
        const deleteGPO = document.getElementById('chk-del-delete-gpo')?.checked ?? false;

        if (hasGPO && unlinkGPO && hasOUs) {
          for (const ouDN of app.assignedOUs) {
            await window.api.ad.unlinkGPOfromOU(app.gpoName, ouDN);
          }
        }
        if (hasGPO && cleanScript) {
          await window.api.ad.removeGPOStartupScript(app.gpoName);
        }
        if (hasGPO && deleteGPO) {
          await window.api.ad.deleteGPO(app.gpoName);
        }

        await window.api.apps.delete(id, deleteFiles);
        App.toast(t('apps.deleteSuccess').replace('{app}', app.name), 'success');
        App.closeModal();
        App.navigate('apps');
      } catch (err) {
        App.toast('Error: ' + err.message, 'error');
        btn.disabled = false;
        btn.innerHTML = t('common.delete');
      }
    });
  },
};

window.AppsActionsModule = AppsActionsModule;