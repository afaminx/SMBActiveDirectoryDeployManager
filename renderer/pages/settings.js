// ═══════════════════════════════════════════════════════
// Settings Page
// ═══════════════════════════════════════════════════════

const SettingsPage = {
  async render(container) {
    const [config, updateInfo] = await Promise.all([
      window.api.config.get(),
      window.api.updates.getCurrent().catch(() => ({
        currentVersion: App.updateCheckResult?.currentVersion || '0.0.0'
      }))
    ]);
    this.currentConfig = config;

    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1>
            <span class="header-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            </span>
            ${t('settings.title')}
          </h1>
          <p class="page-subtitle">${t('settings.subtitle')}</p>
        </div>
      </div>

      <!-- Network Share -->
      <div class="settings-section">
        <div class="settings-section-title">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          ${t('settings.general')}
        </div>
        
        <div class="form-group" style="margin-top:16px;">
          <label class="form-label">${t('settings.language')}</label>
          <select class="form-select" id="cfg-language">
            <!-- Rendered in JS logic -->
          </select>
          <p class="form-hint">${t('settings.languageHint')}</p>
        </div>

        <div class="form-group">
          <label class="form-label">${t('settings.uiModeLabel', 'Modo de interfaz')}</label>
          <select class="form-select" id="cfg-ui-mode">
            <option value="simple" ${(config.uiMode || 'simple') !== 'advanced' ? 'selected' : ''}>${t('settings.uiModeSimple', 'Sencillo')}</option>
            <option value="advanced" ${(config.uiMode || '') === 'advanced' ? 'selected' : ''}>${t('settings.uiModeAdvanced', 'Avanzado')}</option>
          </select>
          <p class="form-hint">${t('settings.uiModeHint', 'En modo sencillo se ocultan las opciones avanzadas del alta de apps y plantillas.')}</p>
        </div>

        <div class="form-group">
          <label class="form-label">${t('settings.netShare')}</label>
          <div class="input-with-btn">
            <input class="form-input" id="cfg-share-path" value="${App._esc(config.networkSharePath)}" placeholder="\\\\servidor\\share\\apps">
            <button class="btn btn-secondary" id="btn-browse-share">${t('settings.browse')}</button>
          </div>
          <p class="form-hint">${t('settings.netShareHint')}</p>
        </div>

        

        <div class="form-group">
          <label class="form-label">${t('settings.defaultGpo')}</label>
          <select class="form-select" id="cfg-default-gpo">
            <option value="">${t('common.cancel')} / ${t('gui.none')}</option>
          </select>
          <p class="form-hint">${t('settings.defaultGpoHint')}</p>
        </div>

        <div class="form-group">
          <label class="form-label">${t('settings.preferredDC')}</label>
          <input class="form-input" id="cfg-preferred-dc" value="${App._esc(config.preferredDC || '')}" placeholder="dc1.empresa.local">
          <p class="form-hint">${t('settings.preferredDCHint')}</p>
        </div>

        <div class="form-group mb-md">
          <label class="form-label">${t('settings.baseOu')}</label>
          <div style="position:relative;margin-bottom:8px;">
            <svg style="position:absolute;left:9px;top:50%;transform:translateY(-50%);pointer-events:none;opacity:.4" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="text" class="form-input" id="cfg-baseou-search" placeholder="${t('ous.searchOUs')}" autocomplete="off" style="padding-left:32px;">
          </div>
          <div id="cfg-baseou-tree" style="max-height:190px;overflow-y:auto;border:1px solid var(--border-color);border-radius:6px;padding:4px 6px;background:var(--bg-secondary);">
            <div class="spinner"></div>
          </div>
          <div id="cfg-baseou-selected" style="margin-top:6px;min-height:22px;display:flex;align-items:center;gap:8px;"></div>
          <p class="form-hint" style="margin-top:6px;">${t('settings.baseOuHint')}</p>
          <input type="hidden" id="cfg-base-ou" value="${JSON.stringify(config.baseOUs || (config.baseOU ? [config.baseOU] : [])).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">
        </div>
      </div>

      
      <!-- Logs backend -->
      <div class="settings-section">
        <div class="settings-section-title">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>
          ${t('settings.logsBackendTitle') || 'Sistema de logs'}
        </div>
        <div id="settings-logs-block" style="margin-top:12px;"></div>
      </div>

      <!-- RSAT Status -->
      <div class="settings-section">
        <div class="settings-section-title">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
          ${t('gui.groupPolicyToolsActiveDirectoryStatus')}
        </div>
        <div class="flex items-center gap-md mb-md">
          <div class="rsat-dot" style="width:12px;height:12px;border-radius:50%;background:${App.rsatAvailable ? 'var(--accent-secondary)' : 'var(--accent-danger)'}"></div>
          <div>
            <strong style="color:${App.rsatAvailable ? 'var(--accent-secondary)' : 'var(--accent-danger)'}">
              ${App.rsatAvailable ? t('gui.directoryServicesAvailable') : t('gui.directoryServicesUnavailable')}
            </strong>
            <p class="text-muted text-sm">${App.rsatAvailable ? t('gui.ldapIsAvailableGpoOperationsUseTheGrouppolicy') : t('gui.directoryOperationsAreDisabled')}</p>
          </div>
        </div>
        ${!App.rsatAvailable ? `
          <div class="rsat-warning">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            <div>
              ${t('gui.installGroupPolicyManagementToolsByRunningThis')}
              <code>Add-WindowsCapability -Online -Name Rsat.GroupPolicy.Management.Tools~~~~0.0.1.0</code>
              <p class="mt-sm">${t('gui.alsoCheckLdapAndTheConfiguredDcUsing')}</p>
            </div>
          </div>
        ` : ''}
        <div class="flex gap-sm">
          <button class="btn btn-secondary" id="btn-check-rsat">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            ${t('gui.checkGroupPolicyTools')}
          </button>
          <button class="btn btn-secondary" id="btn-test-ad">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
            ${t('gui.testAdConnection')}
          </button>
        </div>
      </div>

      <!-- Export / Import -->
      <div class="settings-section">
        <div class="settings-section-title">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          ${t('settings.exportImport')}
        </div>
        <div class="flex gap-sm" style="margin-top:12px;">
          <button class="btn btn-secondary" id="btn-export-config">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            ${t('settings.exportBtn')}
          </button>
          <button class="btn btn-secondary" id="btn-import-config">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            ${t('settings.importBtn')}
          </button>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>
          ${t('updates.sectionTitle')}
        </div>
        <div id="settings-app-updates-content" style="margin-top:12px;"></div>
      </div>

      <!-- Save Button -->
      <div class="flex justify-between mt-lg">
        <div></div>
        <button class="btn btn-primary btn-lg" id="btn-save-config">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
          ${t('settings.save')}
        </button>
      </div>
    `;

    // Load available languages into the selector dynamically
    const langSelect = document.getElementById('cfg-language');
    const langs = await window.api.i18n.getAvailable();
    langs.forEach(lang => {
      const el = document.createElement('option');
      el.value = lang.code;
      el.textContent = lang.name;
      if (config.language === lang.code) el.selected = true;
      langSelect.appendChild(el);
    });

    this.currentAppVersion = updateInfo?.currentVersion || App.updateCheckResult?.currentVersion || '0.0.0';
    this.bindEvents(config);
    this.renderUpdateSection(this.currentAppVersion);
    this.loadGPOs(config);
    if (App.rsatAvailable) {
      this.loadOUs(config.baseOUs || (config.baseOU ? [config.baseOU] : []));
    } else {
      document.getElementById('cfg-baseou-tree').innerHTML = `<p style="padding:8px;font-size:13px;color:var(--text-muted);">${t('gui.ldapConnectivityIsRequiredToListOus')}</p>`;
    }

    await this._renderLogsBlock(config);
  },


  // ─── Logs / Admin section (lives inside Settings) ─────────────

  async _renderLogsBlock(config) {
    const block = document.getElementById('settings-logs-block');
    if (!block) return;

    const remote = config.remoteLogging || {};
    const adminStatus = await window.api.admin.status();
    const isReadonlyRemote = config.logMode === 'dedicated' && remote.readonly === true;
    const readonlyAttr = isReadonlyRemote ? 'disabled' : '';
    const readonlyFieldAttr = isReadonlyRemote ? 'readonly' : '';

    block.innerHTML = `
      <div style="display:flex;gap:8px;margin-bottom:12px;">
        <label style="flex:1;cursor:pointer;border:1px solid var(--border-color);border-radius:6px;padding:10px;">
          <input type="radio" name="cfg-logmode" value="local" ${config.logMode === 'local' || !config.logMode ? 'checked' : ''} ${readonlyAttr}>
          <strong style="margin-left:6px;">${t('settings.logModeLocal') || 'Local'}</strong>
          <p class="form-hint" style="margin:4px 0 0 22px;">${t('settings.logModeLocalHint') || 'Logs en este equipo.'}</p>
        </label>
        <label style="flex:1;cursor:pointer;border:1px solid var(--border-color);border-radius:6px;padding:10px;">
          <input type="radio" name="cfg-logmode" value="dedicated" ${config.logMode === 'dedicated' ? 'checked' : ''} ${readonlyAttr}>
          <strong style="margin-left:6px;">${t('settings.logModeDedicated') || 'Servidor dedicado'}</strong>
          <p class="form-hint" style="margin:4px 0 0 22px;">${t('settings.logModeDedicatedHint') || 'API HTTPS centralizada.'}</p>
        </label>
      </div>

      <div id="cfg-local-block" style="display:${config.logMode !== 'dedicated' ? 'block' : 'none'};padding:12px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);margin-bottom:12px;">
        <div class="form-group" style="margin-bottom:0;">
          <label class="form-label">${t('settings.logsLocalPath') || 'Carpeta de logs locales'}</label>
          <div class="input-with-btn">
            <input class="form-input" id="cfg-log-dir" value="${App._esc(config.logDirectory || '')}" placeholder="C:\\ProgramData\\AppDeploy_Logs">
            <button class="btn btn-secondary" id="btn-browse-log" type="button">${t('settings.browse') || 'Examinar'}</button>
          </div>
          <p class="form-hint">${t('settings.logsLocalPathHint') || 'Vacío = carpeta de usuario por defecto.'}</p>
        </div>
      </div>

      <div id="cfg-dedicated-block" style="display:${config.logMode === 'dedicated' ? 'block' : 'none'};padding:12px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);margin-bottom:12px;">
        ${isReadonlyRemote ? `
          <div style="padding:8px 10px;border-radius:6px;background:var(--accent-primary-dim);color:var(--accent-primary);font-size:12px;margin-bottom:10px;">
            <strong>${t('settings.readonlyModeTitle') || 'Modo lectura'}</strong> - ${t('settings.readonlyModeHint') || 'La configuracion viene del share publicado por el admin. Este equipo puede consultar logs, pero no publicar cambios.'}
          </div>
        ` : ''}
        <div class="form-group" style="margin-bottom:10px;">
          <label class="form-label">${t('settings.dedBaseUrl') || 'URL del servidor'}</label>
          <input class="form-input" id="cfg-ded-baseurl" placeholder="https://logs.example.local" value="${App._esc(remote.apiBaseUrl || '')}" ${readonlyFieldAttr}>
        </div>
        <div class="form-group" style="margin-bottom:10px;">
          <label class="form-label">${t('settings.dedTlsFp') || 'TLS Fingerprint (opcional)'}</label>
          <input class="form-input" id="cfg-ded-tlsfp" placeholder="sha256//..." value="${App._esc(remote.tlsFingerprint || '')}" ${readonlyFieldAttr}>
        </div>
        <div style="display:${isReadonlyRemote ? 'none' : 'flex'};gap:8px;flex-wrap:wrap;margin-bottom:10px;">
          <button class="btn btn-secondary btn-sm" id="cfg-btn-inspect" type="button">${t('settings.inspectCert') || 'Obtener Fingerprint (Certificado)'}</button>
          <button class="btn btn-secondary btn-sm" id="cfg-btn-save-ded" type="button">${t('settings.saveDedConfig') || 'Guardar URL/Fingerprint'}</button>
        </div>
        <p class="form-hint" style="margin-top:-6px;margin-bottom:10px;">${t('gui.youDoNotNeedToInstallTheCertificate')}</p>
        <div id="cfg-cert-status" style="display:none;font-size:12px;margin-bottom:10px;"></div>

        <hr style="border:none;border-top:1px solid var(--border-color);margin:12px 0;">

        <div id="cfg-admin-block">
          ${adminStatus.loggedIn
            ? this._adminLoggedInHtml(adminStatus)
            : (isReadonlyRemote ? this._readonlyLogsHtml(remote) : this._adminLoginHtml(remote))}
        </div>
      </div>
    `;

    this._bindLogsBlockEvents();
    if (adminStatus.loggedIn) await this._loadAdminTables();
  },

  _adminLoginHtml() {
    return `
      <div class="form-group" style="margin-bottom:10px;">
        <label class="form-label">${t('settings.adminApiKey') || 'Admin API Key'}</label>
        <input class="form-input" id="cfg-admin-key" type="password" autocomplete="off" placeholder="••••••••">
        <p class="form-hint">${t('settings.adminApiKeyHint') || 'Necesaria para gestionar claves desde aquí.'}</p>
      </div>
      <div id="cfg-admin-error" style="display:none;margin-bottom:8px;padding:8px;border-radius:4px;background:rgba(239,68,68,0.1);color:#ef4444;font-size:12px;"></div>
      <button class="btn btn-primary btn-sm" id="cfg-btn-admin-login">${t('settings.adminLogin') || 'Conectar admin'}</button>
    `;
  },

  _readonlyLogsHtml(remote = {}) {
    return `
      <div style="padding:10px 12px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);">
        <div style="font-size:13px;font-weight:600;color:var(--text-primary);margin-bottom:4px;">
          ${t('settings.readonlyConnectedTitle') || 'Lectura conectada'}
        </div>
        <p class="form-hint" style="margin:0;">
          ${(t('settings.readonlyConnectedHint') || 'Este equipo usa la clave de lectura publicada por el admin para consultar logs del servidor {server}.')
            .replace('{server}', App._esc(remote.apiBaseUrl || ''))}
        </p>
      </div>
    `;
  },

  _adminLoggedInHtml(st) {
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <span style="font-size:13px;color:var(--text-secondary);">
          <span style="color:var(--accent-secondary)">●</span>
          ${t('settings.adminConnected') || 'Admin conectado'} — ${App._esc(st.baseUrl || '')}
        </span>
        <button class="btn btn-secondary btn-sm" id="cfg-btn-admin-logout">${t('settings.adminLogout') || 'Salir'}</button>
      </div>
      <div style="padding:10px 12px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);margin-bottom:12px;">
        <div style="font-size:13px;font-weight:600;color:var(--text-primary);margin-bottom:4px;">
          ${t('settings.dedicatedNextStepTitle') || 'Servidor listo para publicar'}
        </div>
        <p class="form-hint" style="margin:0 0 10px 0;">
          ${t('settings.dedicatedNextStepHint') || 'Publica la configuracion y una clave de lectura en el share. Si ya hay apps desplegadas, regenera sus scripts para actualizar los hooks de logging.'}
        </p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-secondary btn-sm" id="cfg-btn-publish-share-log">
            ${t('settings.publishShareLogConfig') || 'Publicar config en share'}
          </button>
          <button class="btn btn-secondary btn-sm" id="cfg-btn-regenerate-scripts">
            ${t('settings.regeneratePublishedScripts') || 'Regenerar scripts desplegados'}
          </button>
        </div>
      </div>

      <div style="margin-bottom:14px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <strong style="font-size:13px;">API Keys</strong>
          <button class="btn btn-secondary btn-sm" id="cfg-btn-new-key">Nueva API Key</button>
        </div>
        <div id="cfg-keys-table"><div class="spinner" style="width:14px;height:14px;border-width:2px;margin:4px 0;"></div></div>
      </div>

      <div style="margin-bottom:14px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <strong style="font-size:13px;">Share Secrets</strong>
          <button class="btn btn-secondary btn-sm" id="cfg-btn-new-secret">Nuevo Share Secret</button>
        </div>
        <div id="cfg-secrets-table"><div class="spinner" style="width:14px;height:14px;border-width:2px;margin:4px 0;"></div></div>
      </div>

      <div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <strong style="font-size:13px;">Enrollment Tokens</strong>
          <button class="btn btn-secondary btn-sm" id="cfg-btn-new-token">Nuevo Token</button>
        </div>
        <div id="cfg-tokens-table"><div class="spinner" style="width:14px;height:14px;border-width:2px;margin:4px 0;"></div></div>
      </div>
    `;
  },

  _bindLogsBlockEvents() {
    document.querySelectorAll('input[name="cfg-logmode"]').forEach(rad => {
      rad.addEventListener('change', async (e) => {
        const val = e.target.value;
        const cur = await window.api.config.get();
        await window.api.config.set({ logMode: val });
        await window.api.logs.reload();
        await this._renderLogsBlock({ ...cur, logMode: val });
        App.toast(t('settings.saved'), 'success');
      });
    });

    document.getElementById('cfg-btn-inspect')?.addEventListener('click', async () => {
      const baseUrl = document.getElementById('cfg-ded-baseurl').value.trim();
      if (!baseUrl) return App.toast(t('settings.urlRequired') || 'URL requerida', 'warning');
      const st = document.getElementById('cfg-cert-status');
      st.style.display = 'block';
      st.textContent = t('settings.inspecting') || 'Inspeccionando...';
      st.style.color = 'var(--text-muted)';
      const r = await window.api.cert.inspect(baseUrl);
      if (!r.success) {
        st.textContent = r.error;
        st.style.color = '#ef4444';
        return;
      }
      const i = r.data;
      document.getElementById('cfg-ded-tlsfp').value = i.fingerprint || '';
      st.innerHTML = `
        <div style="color:var(--text-primary);">
          <strong>Sujeto:</strong> ${App._esc(i.subject)}<br>
          <strong>Emisor:</strong> ${App._esc(i.issuer)}<br>
          <strong>Validez:</strong> ${new Date(i.validFrom).toLocaleDateString()} al ${new Date(i.validTo).toLocaleDateString()}<br>
          <strong style="color:var(--accent-secondary)">${t('gui.sha256FingerprintRetrievedSuccessfully')}</strong>
        </div>
      `;
    });

    document.getElementById('cfg-btn-save-ded')?.addEventListener('click', async () => {
      const baseUrl = document.getElementById('cfg-ded-baseurl').value.trim();
      const tlsFp   = document.getElementById('cfg-ded-tlsfp').value.trim() || null;
      if (!baseUrl) return App.toast(t('settings.urlRequired') || 'URL requerida', 'warning');
      const cur = await window.api.config.get();
      await window.api.config.set({
        logMode: 'dedicated',
        remoteLogging: { ...(cur.remoteLogging || {}), apiBaseUrl: baseUrl, tlsFingerprint: tlsFp }
      });
      await window.api.logs.reload();
      App.toast(t('settings.saved'), 'success');
      App.toast(
        t('settings.dedicatedServerSavedGuide') || 'Servidor guardado. Publica la config en el share y regenera scripts desplegados si ya existian apps.',
        'info'
      );
    });

    document.getElementById('btn-browse-log')?.addEventListener('click', async () => {
      const path = await window.api.config.selectFolder();
      if (path) document.getElementById('cfg-log-dir').value = path;
    });

    document.getElementById('cfg-btn-admin-login')?.addEventListener('click', () => this._doAdminLogin());
    document.getElementById('cfg-btn-admin-logout')?.addEventListener('click', () => this._doAdminLogout());
    document.getElementById('cfg-btn-new-key')?.addEventListener('click', () => this._modalNewKey());
    document.getElementById('cfg-btn-new-secret')?.addEventListener('click', () => this._modalNewSecret());
    document.getElementById('cfg-btn-new-token')?.addEventListener('click', () => this._modalNewToken());
    document.getElementById('cfg-btn-publish-share-log')?.addEventListener('click', () => this._publishShareLoggingConfig());
    document.getElementById('cfg-btn-regenerate-scripts')?.addEventListener('click', () => this._regeneratePublishedScripts());
  },

  async _doAdminLogin() {
    const baseUrl = document.getElementById('cfg-ded-baseurl').value.trim();
    const apiKey  = document.getElementById('cfg-admin-key').value.trim();
    const tlsFp   = document.getElementById('cfg-ded-tlsfp').value.trim() || null;
    const err = document.getElementById('cfg-admin-error');
    err.style.display = 'none';

    if (!baseUrl || !apiKey) {
      err.textContent = t('settings.adminLoginMissing') || t('gui.urlAndKeyAreRequired');
      err.style.display = 'block';
      return;
    }

    const r = await window.api.admin.login({ baseUrl, apiKey, tlsFingerprint: tlsFp });
    if (!r.success) {
      err.textContent = r.error;
      err.style.display = 'block';
      return;
    }

    // Save dedicated config alongside admin login so the sink can use it.
    const cur = await window.api.config.get();
    await window.api.config.set({
      logMode: 'dedicated',
      remoteLogging: { ...(cur.remoteLogging || {}), apiBaseUrl: baseUrl, tlsFingerprint: tlsFp }
    });

    // Auto-provision an ingest key so this workstation can ship logs.
    const prov = await window.api.admin.provisionIngestKey();
    if (!prov.success) {
      App.toast(`${t('settings.ingestProvisionFailed') || 'Could not provision the ingest key'}: ${prov.error}`, 'warning');
    } else {
      App.toast(t('settings.ingestProvisioned') || 'Clave de ingesta creada', 'success');
    }

    await window.api.logs.reload();
    const cfg2 = await window.api.config.get();
    await this._renderLogsBlock(cfg2);
    App.toast(
      t('settings.dedicatedServerSavedGuide') || 'Servidor guardado. Publica la config en el share y regenera scripts desplegados si ya existian apps.',
      'info'
    );
  },

  async _doAdminLogout() {
    await window.api.admin.logout();
    const cfg = await window.api.config.get();
    await this._renderLogsBlock(cfg);
  },

  async _publishShareLoggingConfig() {
    const baseUrl = document.getElementById('cfg-ded-baseurl')?.value.trim() || '';
    const tlsFingerprint = document.getElementById('cfg-ded-tlsfp')?.value.trim() || null;
    if (!baseUrl) return App.toast(t('settings.urlRequired') || 'URL requerida', 'warning');
    const result = await window.api.share.publishLoggingConfig({
      apiBaseUrl: baseUrl,
      tlsFingerprint,
      unlimited: true   // per-app token, no expiry, no use cap
    });
    if (!result.success) {
      App.toast(`${t('common.error') || 'Error'}: ${result.error}`, 'error');
      return;
    }
    App.toast(
      `${t('settings.shareLogConfigPublished') || t('gui.configurationPublished')}: ${result.path}`,
      'success'
    );
    await this._loadTokensTable();
    await this._loadSecretsTable();
  },

  async _regeneratePublishedScripts() {
    const btn = document.getElementById('cfg-btn-regenerate-scripts');
    const originalHtml = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span class="spinner" style="width:12px;height:12px;display:inline-block;border-width:2px;"></span>`;
    }

    try {
      const apps = await window.api.apps.getAll().catch(() => []);
      const targets = (Array.isArray(apps) ? apps : [])
        .filter(app => app && app.id && app.deployed !== false && (app.deployedPath || app.uninstallDeployedPath));

      if (!targets.length) {
        App.toast(t('settings.noPublishedScripts') || 'No hay scripts desplegados para regenerar.', 'info');
        return;
      }

      let updated = 0;
      const failed = [];
      for (const app of targets) {
        const result = await window.api.scripts.regenerate(app);
        if (!result?.success) {
          if (App.isShareError(result?.error)) {
            App.handleShareError();
            failed.push(`${app.name}: ${result.error}`);
            break;
          }
          failed.push(`${app.name}: ${result?.error || 'error'}`);
          continue;
        }

        const nextPublishedAction = String(result.publishedAction || app.publishedAction || '').trim().toLowerCase() === 'uninstall'
          ? 'uninstall'
          : 'install';
        await window.api.apps.update(app.id, {
          deployed: true,
          deployedPath: result.installPath || app.deployedPath || '',
          uninstallDeployedPath: result.uninstallPath || app.uninstallDeployedPath || '',
          publishedAction: nextPublishedAction,
          publishedAt: new Date().toISOString(),
          lastDeployHash: result.hash || app.lastDeployHash || ''
        });
        updated += 1;
      }

      if (updated > 0) {
        await window.api.activity.add('settings_scripts_regenerated', {
          updated,
          failed: failed.length
        });
      }

      if (failed.length) {
        App.toast(
          (t('settings.regeneratePublishedScriptsPartial') || '{updated} scripts regenerados; {failed} con error.')
            .replace('{updated}', String(updated))
            .replace('{failed}', String(failed.length)),
          'warning'
        );
        return;
      }

      App.toast(
        (t('settings.regeneratePublishedScriptsSuccess') || '{count} scripts regenerados.')
          .replace('{count}', String(updated)),
        'success'
      );
    } catch (err) {
      App.toast(`${t('settings.regeneratePublishedScriptsError') || 'Could not regenerate scripts'}: ${err.message}`, 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
      }
    }
  },

  async _loadAdminTables() {
    await Promise.all([this._loadKeysTable(), this._loadSecretsTable(), this._loadTokensTable()]);
  },

  async _loadKeysTable() {
    const r = await window.api.admin.listKeys();
    const el = document.getElementById('cfg-keys-table');
    if (!el) return;
    if (!r.success) { el.innerHTML = `<div class="logs-muted">${App._esc(r.error)}</div>`; return; }
    const rows = r.data || [];
    if (!rows.length) { el.innerHTML = `<div class="logs-muted">${t('settings.empty') || t('gui.noEntries')}</div>`; return; }

    const LIMIT = 3;
    const collapsible = rows.length > LIMIT;

    el.innerHTML = `
      ${collapsible ? `
      <div style="margin-bottom:6px;">
        <input class="form-input" id="cfg-keys-search" placeholder="${t('gui.searchApiKeys')}"
          style="font-size:12px;padding:4px 8px;height:28px;width:100%;">
      </div>` : ''}
      <table class="logs-table">
        <thead><tr>
          <th>${t('settings.colName') || 'Nombre'}</th>
          <th style="width:80px;">${t('settings.colScope') || 'Scope'}</th>
          <th style="width:140px;">${t('settings.colCreated') || 'Creada'}</th>
          <th style="width:140px;">${t('settings.colLastUsed') || 'Último uso'}</th>
          <th style="width:80px;">${t('settings.colState') || 'Estado'}</th>
          <th style="width:90px;"></th>
        </tr></thead>
        <tbody>
          ${rows.map((k, i) => `
            <tr data-key-idx="${i}" data-key-name="${App._esc((k.name || '').toLowerCase())}"
                ${collapsible && i >= LIMIT ? 'class="cfg-key-extra" style="display:none;"' : ''}>
              <td>${App._esc(k.name)}</td>
              <td><span class="level-pill level-${k.scope === 'admin' ? 'error' : k.scope === 'read' ? 'info' : 'warn'}">${k.scope}</span></td>
              <td class="mono">${this._fmtTs(k.createdAt)}</td>
              <td class="mono">${this._fmtTs(k.lastUsed)}</td>
              <td>${k.revokedAt ? `<span class="logs-muted">${t('settings.revoked') || 'revocada'}</span>` : `<span style="color:var(--accent-secondary)">●</span>`}</td>
              <td>${!k.revokedAt ? `<button class="btn btn-secondary btn-sm" data-revoke="${k.id}">${t('settings.revoke') || 'Revocar'}</button>` : ''}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      ${collapsible ? `
      <button class="btn btn-ghost btn-sm" id="cfg-keys-toggle" style="margin-top:4px;font-size:12px;">
        ${t('settings.showAll') || 'Ver todas'} (${rows.length})
      </button>` : ''}
    `;

    el.querySelectorAll('[data-revoke]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm(t('settings.confirmRevoke') || t('gui.revoke'))) return;
        const r = await window.api.admin.revokeKey(btn.dataset.revoke);
        if (!r.success) App.toast(r.error, 'error');
        await this._loadKeysTable();
      });
    });

    if (!collapsible) return;

    let expanded = false;
    const toggleBtn = document.getElementById('cfg-keys-toggle');
    const searchInput = document.getElementById('cfg-keys-search');

    const applyFilter = (query) => {
      const q = query.toLowerCase().trim();
      el.querySelectorAll('tbody tr').forEach((row, i) => {
        const nameMatch = !q || (row.dataset.keyName || '').includes(q);
        row.style.display = nameMatch ? '' : 'none';
      });
      if (toggleBtn) toggleBtn.style.display = q ? 'none' : '';
    };

    toggleBtn.addEventListener('click', () => {
      expanded = !expanded;
      el.querySelectorAll('.cfg-key-extra').forEach(row => { row.style.display = expanded ? '' : 'none'; });
      toggleBtn.textContent = expanded
        ? (t('settings.showLess') || 'Ver menos')
        : `${t('settings.showAll') || 'Ver todas'} (${rows.length})`;
    });

    searchInput.addEventListener('input', (e) => applyFilter(e.target.value));
  },

  async _loadSecretsTable() {
    const r = await window.api.admin.listShareSecrets();
    const el = document.getElementById('cfg-secrets-table');
    if (!el) return;
    if (!r.success) { el.innerHTML = `<div class="logs-muted">${App._esc(r.error)}</div>`; return; }
    const rows = r.data || [];
    if (!rows.length) { el.innerHTML = `<div class="logs-muted">${t('settings.empty') || t('gui.noEntries')}</div>`; return; }
    el.innerHTML = `
      <table class="logs-table">
        <thead><tr><th>shareId</th><th style="width:140px;">${t('settings.colCreated') || 'Creada'}</th></tr></thead>
        <tbody>${rows.map(s => `<tr><td class="mono">${App._esc(s.shareId)}</td><td class="mono">${this._fmtTs(s.createdAt)}</td></tr>`).join('')}</tbody>
      </table>
    `;
  },

  async _loadTokensTable() {
    const r = await window.api.admin.listEnrollTokens();
    const el = document.getElementById('cfg-tokens-table');
    if (!el) return;
    if (!r.success) { el.innerHTML = `<div class="logs-muted">${App._esc(r.error)}</div>`; return; }
    const rows = r.data || [];
    if (!rows.length) { el.innerHTML = `<div class="logs-muted">${t('settings.empty') || t('gui.noEntries')}</div>`; return; }
    el.innerHTML = `
      <table class="logs-table">
        <thead><tr><th>shareId</th><th style="width:60px;">${t('settings.colUses') || 'Usos'}</th><th style="width:140px;">${t('settings.colExpires') || 'Expira'}</th></tr></thead>
        <tbody>${rows.map(o => `<tr><td class="mono">${App._esc(o.shareId)}</td><td class="mono">${o.usesLeft == null ? '∞' : o.usesLeft}</td><td class="mono">${o.expiresAt == null ? '∞' : this._fmtTs(o.expiresAt)}</td></tr>`).join('')}</tbody>
      </table>
    `;
  },

  _modalFooter(idCreate) {
    return `
      <button class="btn btn-secondary" id="modal-close-btn">${t('common.close') || t('gui.close')}</button>
      <button class="btn btn-primary" id="${idCreate}">${t('settings.create') || 'Crear'}</button>
    `;
  },
  _wireModalClose() {
    document.getElementById('modal-close-btn')?.addEventListener('click', () => App.closeModal());
    const x = document.getElementById('modal-close');
    if (x) x.onclick = () => App.closeModal();
  },
  _resultBlock(id) {
    return `
      <div id="modal-result" style="display:none;margin-top:12px;padding:10px;border-radius:6px;background:var(--bg-secondary);">
        <p class="form-hint">${t('settings.copyOnce') || t('gui.copyItNowItWillNotBeShown')}</p>
        <code id="${id}" style="display:block;padding:8px;background:rgba(0,0,0,0.25);border-radius:4px;word-break:break-all;font-family:ui-monospace,monospace;font-size:12px;"></code>
      </div>
    `;
  },

  _modalNewKey() {
    const body = `
      <div class="form-group"><label class="form-label">${t('settings.colName') || 'Nombre'}</label>
        <input class="form-input" id="modal-name" placeholder="dashboard-read"></div>
      <div class="form-group"><label class="form-label">${t('settings.colScope') || 'Scope'}</label>
        <select class="form-select" id="modal-scope">
          <option value="read">read</option><option value="ingest">ingest</option><option value="admin">admin</option>
        </select></div>
      ${this._resultBlock('modal-newkey')}
    `;
    App.openModal(t('settings.newKey') || 'Nueva API Key', body, this._modalFooter('modal-create-key'));
    this._wireModalClose();
    document.getElementById('modal-create-key').addEventListener('click', async () => {
      const name = document.getElementById('modal-name').value.trim();
      const scope = document.getElementById('modal-scope').value;
      if (!name) return App.toast(t('settings.nameRequired') || 'Nombre requerido', 'warning');
      const r = await window.api.admin.createKey({ name, scope });
      if (!r.success) return App.toast(r.error, 'error');
      document.getElementById('modal-result').style.display = 'block';
      document.getElementById('modal-newkey').textContent = r.data.apiKey;
      await this._loadKeysTable();
    });
  },

  _modalNewSecret() {
    const body = `
      <div class="form-group"><label class="form-label">shareId</label>
        <input class="form-input" id="modal-shareid" placeholder="ABC12345"></div>
      ${this._resultBlock('modal-newsecret')}
    `;
    App.openModal(t('settings.newShareSecret') || 'Nuevo share secret', body, this._modalFooter('modal-create-secret'));
    this._wireModalClose();
    document.getElementById('modal-create-secret').addEventListener('click', async () => {
      const id = document.getElementById('modal-shareid').value.trim();
      if (!id) return;
      const r = await window.api.admin.createShareSecret(id);
      if (!r.success) return App.toast(r.error, 'error');
      document.getElementById('modal-result').style.display = 'block';
      document.getElementById('modal-newsecret').textContent = r.data.secret;
      await this._loadSecretsTable();
    });
  },

  _modalNewToken() {
    const body = `
      <div class="form-group"><label class="form-label">shareId</label>
        <input class="form-input" id="modal-shareid" placeholder="ABC12345"></div>
      <div class="form-group">
        <label class="form-label" style="display:flex;align-items:center;gap:8px;">
          <input type="checkbox" id="modal-unlimited" checked>
          ${t('settings.unlimitedToken') || t('gui.noExpirationUnlimitedUses')}
        </label>
      </div>
      <div class="form-group" id="modal-limits-group" style="display:none;">
        <label class="form-label">${t('settings.ttlHours') || 'TTL (horas)'}</label>
        <input class="form-input" id="modal-ttl" type="number" value="720" min="1" max="87600">
        <label class="form-label" style="margin-top:8px;">${t('settings.uses') || t('gui.maximumUses')}</label>
        <input class="form-input" id="modal-uses" type="number" value="1000" min="1" max="1000000">
      </div>
      ${this._resultBlock('modal-newtoken')}
    `;
    App.openModal(t('settings.newEnrollToken') || 'Nuevo enrollment token', body, this._modalFooter('modal-create-token'));
    this._wireModalClose();
    const cbUnlim = document.getElementById('modal-unlimited');
    const grpLim  = document.getElementById('modal-limits-group');
    cbUnlim.addEventListener('change', () => {
      grpLim.style.display = cbUnlim.checked ? 'none' : 'block';
    });
    document.getElementById('modal-create-token').addEventListener('click', async () => {
      const shareId = document.getElementById('modal-shareid').value.trim();
      if (!shareId) return;
      const unlimited = cbUnlim.checked;
      const payload = { shareId, unlimited };
      if (!unlimited) {
        payload.ttlHours = Number(document.getElementById('modal-ttl').value) || 24;
        payload.usesLeft = Number(document.getElementById('modal-uses').value) || 1000;
      }
      const r = await window.api.admin.createEnrollToken(payload);
      if (!r.success) return App.toast(r.error, 'error');
      document.getElementById('modal-result').style.display = 'block';
      document.getElementById('modal-newtoken').textContent = r.data.enrollmentToken;
      await this._loadTokensTable();
    });
  },

  _fmtTs(ts) {
    if (!ts) return '—';
    try {
      const d = new Date(ts);
      const pad = x => String(x).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch { return String(ts); }
  },

  bindEvents(config) {
    document.getElementById('btn-browse-share').addEventListener('click', async () => {
      const path = await window.api.config.selectFolder();
      if (path) document.getElementById('cfg-share-path').value = path;
    });

document.getElementById('btn-save-config').addEventListener('click', () => this.save());

    document.getElementById('btn-check-rsat').addEventListener('click', async () => {
      await App.checkRSAT();
      App.navigate('settings');
    });

    document.getElementById('btn-test-ad').addEventListener('click', async () => {
      try {
        const result = await window.api.ad.testADConnection();
        if (result.success) {
          App.toast(`${t('gui.ldapAvailable')} — ${result.data.server} (${result.data.domain})`, 'success');
        } else {
          App.toast('Error AD: ' + result.error, 'error');
        }
      } catch (err) {
        App.toast('Error: ' + err.message, 'error');
      }
    });

    document.getElementById('btn-export-config').addEventListener('click', async () => {
      try {
        const data = await window.api.exportAll();
        const json = JSON.stringify(data, null, 2);
        const result = await window.api.saveFile(json, `deploy_manager_backup_${new Date().toISOString().slice(0,10)}.json`);
        if (result.success) {
          await window.api.activity.add('config_export', {});
          App.toast('Configuration exported successfully', 'success');
        }
      } catch (err) {
        App.toast('Export failed: ' + err.message, 'error');
      }
    });

    document.getElementById('btn-import-config').addEventListener('click', async () => {
      try {
        const result = await window.api.loadFile();
        if (result.success && result.data) {
          const importResult = await window.api.importAll(result.data);
          if (importResult.success) {
            await window.api.activity.add('config_import', {});
            App.toast('Configuration imported successfully. Reloading...', 'success');
            setTimeout(() => App.navigate('settings'), 500);
          } else {
            App.toast('Import failed: ' + importResult.error, 'error');
          }
        }
      } catch (err) {
        App.toast('Import failed: ' + err.message, 'error');
      }
    });
  },

  async loadGPOs(config) {
    try {
      const apps = await window.api.apps.getAll().catch(() => []);
      const programGPOs = [...new Set([
        ...apps.filter(a => a.gpoName).map(a => a.gpoName),
        config.defaultGPO || null
      ].filter(Boolean))];

      const select = document.getElementById('cfg-default-gpo');
      if (select) {
        programGPOs.forEach(gpoName => {
          const opt = document.createElement('option');
          opt.value = gpoName;
          opt.textContent = gpoName;
          opt.selected = gpoName === config.defaultGPO;
          select.appendChild(opt);
        });
      }
    } catch (e) {}
  },

  async save() {
    const data = {
      networkSharePath: document.getElementById('cfg-share-path').value.trim(),
      logDirectory: document.getElementById('cfg-log-dir').value.trim(),
      defaultGPO: document.getElementById('cfg-default-gpo').value,
      preferredDC: document.getElementById('cfg-preferred-dc').value.trim(),
      baseOUs: this.getSelectedDNs(),
      language: document.getElementById('cfg-language').value,
      uiMode: document.getElementById('cfg-ui-mode').value
    };

    if (!data.networkSharePath) {
      App.toast(t('common.error'), 'warning');
      return;
    }

    const currentConfig = await window.api.config.get();
    const isLangChanged = data.language !== currentConfig.language;

    const result = await window.api.config.set(data);
    if (result.success) {
      this.currentConfig = result.data || { ...currentConfig, ...data };
      await window.initI18n();
      App.updateAppUpdateBanner();
      App.updateSidebarLanguage();
      if (isLangChanged) {
        App.toast(t('settings.restartRequired'), 'warning');
        App.navigate('settings'); // Reload the page to reflect translations
      } else {
        App.toast(t('settings.saved'), 'success');
        App.navigate('settings');
      }
    } else {
      App.toast(t('common.error') + ': ' + result.error, 'error');
    }
  },

  renderUpdateSection(currentVersion = this.currentAppVersion, result = App.updateCheckResult, isChecking = App.isCheckingAppUpdates()) {
    const container = document.getElementById('settings-app-updates-content');
    if (!container) return;

    container.innerHTML = this.getUpdateSectionHTML(currentVersion, result, isChecking);
    this.bindUpdateActions();
  },

  bindUpdateActions() {
    document.getElementById('btn-check-app-updates')?.addEventListener('click', async () => {
      this.renderUpdateSection(this.currentAppVersion, App.updateCheckResult, true);
      const result = await App.checkAppUpdates({ force: true });
      this.currentAppVersion = result?.currentVersion || this.currentAppVersion || '0.0.0';
      this.renderUpdateSection(this.currentAppVersion, result, false);
    });

    document.getElementById('btn-open-app-release')?.addEventListener('click', async () => {
      await App.openLatestReleasePage();
    });

    document.getElementById('btn-reset-app-update-reminder')?.addEventListener('click', async () => {
      const button = document.getElementById('btn-reset-app-update-reminder');
      if (button) button.disabled = true;

      try {
        await App.clearDismissedAppUpdateVersion();
        this.currentConfig = { ...(this.currentConfig || {}), dismissedAppUpdateVersion: '' };
        this.renderUpdateSection(this.currentAppVersion, App.updateCheckResult, App.isCheckingAppUpdates());
        App.updateAppUpdateBanner();
        App.toast(t('updates.reminderRestoredToast'), 'success');
      } catch (err) {
        if (button) button.disabled = false;
        App.toast(`${t('common.error')}: ${err?.message || t('updates.reminderSaveFailed')}`, 'error');
      }
    });
  },

  getUpdateSectionHTML(currentVersion, result, isChecking) {
    const safeCurrentVersion = App._esc(currentVersion || result?.currentVersion || '0.0.0');
    const safeLatestVersion = App._esc(result?.latestVersion || '');
    const safeReleaseName = App._esc(result?.releaseName || result?.tagName || '');
    const checkedAt = result?.checkedAt ? App.formatDate(result.checkedAt) : '—';
    const publishedAt = result?.publishedAt ? App.formatDate(result.publishedAt) : '—';

    const reminderMuted = App.isUpdateReminderDismissedPersistently(result);
    let statusText = t('updates.statusUnknown');
    let statusColor = 'var(--text-secondary)';
    if (isChecking) {
      statusText = t('updates.statusChecking');
      statusColor = 'var(--accent-primary)';
    } else if (result?.success && result?.hasUpdate) {
      statusText = t('updates.statusAvailable').replace('{version}', result.latestVersion || '?');
      statusColor = 'var(--accent-warning)';
    } else if (result?.success) {
      statusText = t('updates.statusUpToDate');
      statusColor = 'var(--accent-secondary)';
    } else if (result?.error) {
      statusText = t('updates.statusError');
      statusColor = 'var(--accent-danger)';
    }

    return `
      <div style="display:grid;gap:14px;">
        <div style="display:flex;flex-wrap:wrap;align-items:center;gap:10px;">
          <span style="display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:999px;background:rgba(255,255,255,0.04);border:1px solid var(--border-color);font-size:12px;">
            <strong style="color:var(--text-secondary);">${t('updates.currentVersion')}:</strong>
            <span style="color:var(--text-primary);">v${safeCurrentVersion}</span>
          </span>
          <span style="display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:999px;background:rgba(255,255,255,0.04);border:1px solid var(--border-color);font-size:12px;">
            <strong style="color:var(--text-secondary);">${t('updates.latestVersion')}:</strong>
            <span style="color:var(--text-primary);">${safeLatestVersion ? `v${safeLatestVersion}` : '—'}</span>
          </span>
          <span style="font-size:13px;font-weight:700;color:${statusColor};">${App._esc(statusText)}</span>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;">
          <div style="padding:12px;border:1px solid var(--border-color);border-radius:10px;background:var(--bg-secondary);">
            <div style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted);margin-bottom:4px;">${t('updates.releaseLabel')}</div>
            <div style="font-weight:600;color:var(--text-primary);">${safeReleaseName || '—'}</div>
          </div>
          <div style="padding:12px;border:1px solid var(--border-color);border-radius:10px;background:var(--bg-secondary);">
            <div style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted);margin-bottom:4px;">${t('updates.checkedAt')}</div>
            <div style="font-weight:600;color:var(--text-primary);">${App._esc(checkedAt)}</div>
          </div>
          <div style="padding:12px;border:1px solid var(--border-color);border-radius:10px;background:var(--bg-secondary);">
            <div style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted);margin-bottom:4px;">${t('updates.publishedAt')}</div>
            <div style="font-weight:600;color:var(--text-primary);">${App._esc(publishedAt)}</div>
          </div>
        </div>

        ${result?.error ? `
          <div style="padding:12px;border-radius:10px;border:1px solid rgba(239,68,68,0.35);background:rgba(239,68,68,0.08);color:var(--text-primary);font-size:13px;">
            <strong style="display:block;color:var(--accent-danger);margin-bottom:4px;">${t('updates.errorLabel')}</strong>
            ${App._esc(result.error)}
          </div>
        ` : ''}

        ${reminderMuted ? `
          <div style="padding:12px;border-radius:10px;border:1px solid rgba(245,158,11,0.35);background:rgba(245,158,11,0.08);color:var(--text-primary);font-size:13px;">
            <strong style="display:block;color:var(--accent-warning);margin-bottom:4px;">${t('updates.reminderMutedLabel')}</strong>
            ${t('updates.reminderMutedMessage').replace('{version}', safeLatestVersion ? `v${safeLatestVersion}` : '?')}
          </div>
        ` : ''}

        <div class="flex gap-sm" style="flex-wrap:wrap;">
          <button class="btn btn-secondary" id="btn-check-app-updates" ${isChecking ? 'disabled' : ''}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            ${isChecking ? t('updates.statusChecking') : t('updates.checkNow')}
          </button>
          <button class="btn btn-secondary" id="btn-open-app-release">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 3h7v7"/><path d="M10 14L21 3"/><path d="M21 14v7h-7"/><path d="M3 10V3h7"/><path d="M3 21l11-11"/></svg>
            ${t('updates.openRelease')}
          </button>
          ${reminderMuted ? `
            <button class="btn btn-secondary" id="btn-reset-app-update-reminder">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 3-6.71"/><path d="M3 3v6h6"/></svg>
              ${t('updates.enableReminder')}
            </button>
          ` : ''}
        </div>
      </div>
    `;
  },

  getSelectedDNs() {
    try {
      const raw = document.getElementById('cfg-base-ou')?.value || '[]';
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch {
      return [];
    }
  },

  async loadOUs(selectedDNs) {
    try {
      const result = await window.api.ad.getOUs(true); // ignoreBaseOU = true!
      if (result.success && result.data) {
        this.ousTreeCache = result.data;
        this.renderOUTree(selectedDNs);

        const searchInput = document.getElementById('cfg-baseou-search');
        if (searchInput) {
          searchInput.oninput = () => {
            this.renderOUTree(this.getSelectedDNs(), searchInput.value);
          };
        }
      }
    } catch(err) {}
  },

  renderOUTree(selectedDNs, query = '') {
    const treeContainer = document.getElementById('cfg-baseou-tree');
    if (!treeContainer || !this.ousTreeCache) return;

    const normalized = Array.isArray(selectedDNs) ? selectedDNs.filter(Boolean) : [];
    treeContainer.innerHTML = App.ouPickerTreeHTML(this.ousTreeCache, query, normalized);
    this.updateSelectedDisplay(normalized);

    // Bind expand/collapse toggles (use onclick to prevent stacking)
    treeContainer.querySelectorAll('.tree-toggle:not(.empty)').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const li = btn.closest('.tree-item');
        const children = li.querySelector('.tree-children');
        if (children) {
          children.classList.toggle('collapsed');
          btn.classList.toggle('expanded');
        }
      };
    });

    const dnInput = document.getElementById('cfg-base-ou');
    treeContainer.querySelectorAll('.tree-node').forEach(node => {
      node.onclick = (e) => {
        if (e.target.closest('.tree-toggle')) return;
        const dn = node.dataset.dn;
        const current = this.getSelectedDNs();
        const nextDNs = current.includes(dn)
          ? current.filter(item => item !== dn)
          : [...current, dn];
        if (dnInput) dnInput.value = JSON.stringify(nextDNs);
        this.renderOUTree(nextDNs, document.getElementById('cfg-baseou-search')?.value || '');
      };
    });
  },

  updateSelectedDisplay(selectedDNs) {
    const selectedEl = document.getElementById('cfg-baseou-selected');
    const dnInput = document.getElementById('cfg-base-ou');
    if (!selectedEl) return;

    if (!selectedDNs || selectedDNs.length === 0) {
      selectedEl.innerHTML = `<span style="font-size:12px;color:var(--text-muted);">${t('apps.selectOuRecommended')}</span>`;
      return;
    }

    selectedEl.innerHTML = selectedDNs.map(dn => {
      const selectedName = this.findOUName(this.ousTreeCache, dn) || dn;
      return `<span style="display:inline-flex;align-items:center;gap:6px;background:rgba(30,144,255,0.15);color:var(--primary-color);padding:2px 10px;border-radius:4px;font-size:12px;">
        📁 ${App._esc(selectedName)}
        <button type="button" class="btn btn-ghost btn-sm cfg-baseou-remove" data-dn="${App._esc(dn)}" style="font-size:11px;padding:0 4px;min-height:auto;">✕</button>
      </span>`;
    }).join('') + `<button type="button" class="btn btn-ghost btn-sm" id="cfg-baseou-clear" style="font-size:11px;margin-left:4px;opacity:.7;">${t('common.clear') || t('gui.clearSelection')}</button>`;

    selectedEl.querySelectorAll('.cfg-baseou-remove').forEach(btn => {
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const dn = btn.dataset.dn;
        const nextDNs = this.getSelectedDNs().filter(item => item !== dn);
        if (dnInput) dnInput.value = JSON.stringify(nextDNs);
        this.renderOUTree(nextDNs, document.getElementById('cfg-baseou-search')?.value || '');
      };
    });

    const clearBtn = document.getElementById('cfg-baseou-clear');
    if (clearBtn) {
      clearBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (dnInput) dnInput.value = '[]';
        this.renderOUTree([], document.getElementById('cfg-baseou-search')?.value || '');
      };
    }
  },

  findOUName(nodes, dn) {
    if (!Array.isArray(nodes) || !dn) return '';
    for (const node of nodes) {
      if (node?.dn === dn) return node.name || dn;
      const childMatch = this.findOUName(node?.children, dn);
      if (childMatch) return childMatch;
    }
    return '';
  }
};
