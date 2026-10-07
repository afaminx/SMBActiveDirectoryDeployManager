// ═══════════════════════════════════════════════════════
// Setup Page – Initial Configuration Wizard
// ═══════════════════════════════════════════════════════

const SetupPage = {
  async render(container) {
    const config = await window.api.config.get();
    const langs = await window.api.i18n.getAvailable();

    container.innerHTML = `
      <div style="max-width: 600px; margin: 40px auto; background: var(--bg-card); padding: var(--space-xl); border-radius: var(--radius-lg); border: 1px solid var(--border-color); box-shadow: var(--shadow-card);">
        
        <div style="text-align:center; margin-bottom: var(--space-xl);">
          <div style="width: 64px; height: 64px; background: var(--accent-primary-dim); color: var(--accent-primary); border-radius: 16px; display: flex; align-items: center; justify-content: center; margin: 0 auto var(--space-md); font-size: 32px;">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
          </div>
          <h1 style="font-size: var(--font-2xl); font-weight: 700; color: var(--text-primary); margin-bottom: var(--space-sm);">${t('setup.title')}</h1>
          <p style="color: var(--text-secondary); font-size: var(--font-base);">${t('setup.subtitle')}</p>
        </div>

        <div class="form-group">
          <label class="form-label">${t('setup.language')}</label>
          <select class="form-select" id="setup-lang">
            ${langs.map(l => `<option value="${l.code}" ${config.language === l.code ? 'selected' : ''}>${l.name}</option>`).join('')}
          </select>
          <p class="form-hint">${t('setup.languageHint')}</p>
        </div>

        <div class="form-group">
          <label class="form-label">${t('setup.uiModeLabel', 'Modo de interfaz')}</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <label style="flex:1;cursor:pointer;border:1px solid var(--border-color);border-radius:6px;padding:10px;min-width:220px;">
              <input type="radio" name="setup-ui-mode" value="simple" ${(config.uiMode || 'simple') !== 'advanced' ? 'checked' : ''}>
              <strong style="margin-left:6px;">${t('setup.uiModeSimple', 'Sencillo')}</strong>
              <p class="form-hint" style="margin:4px 0 0 22px;">${t('setup.uiModeSimpleHint', 'Oculta opciones avanzadas y deja solo el flujo básico para subir instaladores.')}</p>
            </label>
            <label style="flex:1;cursor:pointer;border:1px solid var(--border-color);border-radius:6px;padding:10px;min-width:220px;">
              <input type="radio" name="setup-ui-mode" value="advanced" ${(config.uiMode || '') === 'advanced' ? 'checked' : ''}>
              <strong style="margin-left:6px;">${t('setup.uiModeAdvanced', 'Avanzado')}</strong>
              <p class="form-hint" style="margin:4px 0 0 22px;">${t('setup.uiModeAdvancedHint', 'Muestra plantillas, detección, desinstalación y el resto de opciones técnicas.')}</p>
            </label>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">${t('setup.networkShare')}</label>
          <div class="flex gap-sm">
            <input class="form-input" id="setup-network" value="${App._esc(config.networkSharePath)}" placeholder="\\\\server\\share" style="flex:1;">
            <button class="btn btn-secondary" id="btn-browse-network">${t('setup.browse')}</button>
          </div>
          <p class="form-hint">${t('setup.networkShareHint')}</p>
        </div>

        <div class="form-group">
          <label class="form-label">${t('setup.defaultGpo')}</label>
          <input class="form-input" id="setup-gpo" value="${App._esc(config.defaultGPO || '')}" placeholder="SoftwareDeployment">
          <p class="form-hint">${t('setup.defaultGpoHint')}</p>
        </div>

        <div class="form-group">
          <label class="form-label">${t('setup.preferredDC')}</label>
          <input class="form-input" id="setup-dc" value="${App._esc(config.preferredDC || '')}" placeholder="dc1.empresa.local">
          <p class="form-hint">${t('setup.preferredDCHint')}</p>
        </div>

        <div class="form-group mb-md">
          <label class="form-label">${t('setup.baseOu')}</label>
          <div style="position:relative;margin-bottom:8px;">
            <svg style="position:absolute;left:9px;top:50%;transform:translateY(-50%);pointer-events:none;opacity:.4" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="text" class="form-input" id="setup-baseou-search" placeholder="${t('ous.searchOUs')}" autocomplete="off" style="padding-left:32px;">
          </div>
          <div id="setup-baseou-tree" style="max-height:190px;overflow-y:auto;border:1px solid var(--border-color);border-radius:6px;padding:4px 6px;background:var(--bg-secondary);">
            <div class="spinner"></div>
          </div>
          <div id="setup-baseou-selected" style="margin-top:6px;min-height:22px;display:flex;align-items:center;gap:8px;"></div>
          <p class="form-hint" style="margin-top:6px;">${t('setup.baseOuHint')}</p>
          <input type="hidden" id="setup-baseou" value="${JSON.stringify(config.baseOUs || (config.baseOU ? [config.baseOU] : [])).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">
        </div>

        <div class="form-group" id="setup-logmode-group" style="margin-top: var(--space-lg);">
          <label class="form-label">${t('setup.logMode') || 'Sistema de logs'}</label>
          <div id="setup-logmode-banner" style="display:none;margin-bottom:8px;padding:8px 10px;border-radius:6px;background:var(--accent-primary-dim);color:var(--accent-primary);font-size:12px;"></div>
          <div style="display:flex;gap:8px;">
            <label style="flex:1;cursor:pointer;border:1px solid var(--border-color);border-radius:6px;padding:10px;">
              <input type="radio" name="setup-logmode" value="local" ${config.logMode === 'local' || !config.logMode ? 'checked' : ''}>
              <strong style="margin-left:6px;">${t('setup.logModeLocal') || 'Local'}</strong>
              <p class="form-hint" style="margin:4px 0 0 22px;">${t('setup.logModeLocalHint') || 'Guarda los logs en este equipo.'}</p>
            </label>
            <label style="flex:1;cursor:pointer;border:1px solid var(--border-color);border-radius:6px;padding:10px;">
              <input type="radio" name="setup-logmode" value="dedicated" ${config.logMode === 'dedicated' ? 'checked' : ''}>
              <strong style="margin-left:6px;">${t('setup.logModeDedicated') || 'Servidor dedicado'}</strong>
              <p class="form-hint" style="margin:4px 0 0 22px;">${t('setup.logModeDedicatedHint') || 'Centraliza los logs via API.'}</p>
            </label>
          </div>
          <p class="form-hint" id="setup-logmode-readonly" style="display:none;margin-top:6px;color:var(--text-muted);">
            ${t('setup.logModeReadonly') || 'Configuración detectada en el share. Los campos están bloqueados para evitar sobrescribir la configuración del servidor.'}
          </p>

          <div id="setup-local-block" style="display:${config.logMode !== 'dedicated' ? 'block' : 'none'};margin-top:12px;padding:12px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);">
            <div class="form-group" style="margin-bottom:0;">
              <label class="form-label">${t('setup.logsDir') || 'Carpeta de logs locales'}</label>
              <div class="flex gap-sm">
                <input class="form-input" id="setup-logs" value="${App._esc(config.logDirectory || '')}" placeholder="C:\\ProgramData\\AppDeploy_Logs" style="flex:1;">
                <button class="btn btn-secondary" id="btn-browse-logs" type="button">${t('setup.browse') || 'Examinar'}</button>
              </div>
              <p class="form-hint">${t('setup.logsDirHint') || 'Vacío = carpeta de usuario por defecto.'}</p>
            </div>
          </div>

          <div id="setup-dedicated-block" style="display:${config.logMode === 'dedicated' ? 'block' : 'none'};margin-top:12px;padding:12px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);">
            <div class="form-group" style="margin-bottom:10px;">
              <label class="form-label">${t('setup.dedBaseUrl') || 'URL del servidor'}</label>
              <input class="form-input" id="setup-ded-baseurl" placeholder="https://logs.example.local" value="${App._esc((config.remoteLogging && config.remoteLogging.apiBaseUrl) || '')}">
            </div>
            <div class="form-group" style="margin-bottom:10px;">
              <label class="form-label">${t('setup.dedAdminKey') || 'Admin API Key'}</label>
              <input class="form-input" id="setup-ded-adminkey" type="password" autocomplete="off" placeholder="••••••••">
              <p class="form-hint">${t('setup.dedAdminKeyHint') || 'Sólo necesaria si quieres administrar claves desde esta máquina.'}</p>
            </div>
            <div class="form-group" style="margin-bottom:10px;">
              <label class="form-label">${t('setup.dedTlsFp') || 'TLS Fingerprint (opcional)'}</label>
              <input class="form-input" id="setup-ded-tlsfp" placeholder="sha256//..." value="${App._esc((config.remoteLogging && config.remoteLogging.tlsFingerprint) || '')}">
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <button class="btn btn-secondary btn-sm" id="btn-trust-cert" type="button">
                ${t('setup.trustCert') || 'Confiar en el certificado'}
              </button>
              <button class="btn btn-secondary btn-sm" id="btn-inspect-cert" type="button">
                ${t('setup.inspectCert') || 'Ver certificado'}
              </button>
            </div>
            <div id="setup-cert-status" style="display:none;margin-top:8px;font-size:12px;"></div>
          </div>
        </div>

        <div style="margin-top: var(--space-xl); display: flex; justify-content: flex-end;">
          <button class="btn btn-primary btn-lg" id="btn-save-setup">
            ${t('setup.saveAndContinue')}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-left: 8px;"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
          </button>
        </div>
      </div>
    `;

    // Toggle local/dedicated blocks on radio change
    document.querySelectorAll('input[name="setup-logmode"]').forEach(r => {
      r.addEventListener('change', (e) => {
        const isDed = e.target.value === 'dedicated';
        const ded = document.getElementById('setup-dedicated-block');
        const loc = document.getElementById('setup-local-block');
        if (ded) ded.style.display = isDed  ? 'block' : 'none';
        if (loc) loc.style.display = !isDed ? 'block' : 'none';
      });
    });

    document.getElementById('btn-browse-logs')?.addEventListener('click', async () => {
      const path = await window.api.config.selectFolder();
      if (path) document.getElementById('setup-logs').value = path;
    });

    // Cert trust + inspect buttons
    const setStatus = (msg, color) => {
      const el = document.getElementById('setup-cert-status');
      if (!el) return;
      el.style.display = 'block';
      el.style.color = color;
      el.textContent = msg;
    };
    document.getElementById('btn-inspect-cert')?.addEventListener('click', async () => {
      const url = document.getElementById('setup-ded-baseurl').value.trim();
      if (!url) return setStatus(t('setup.urlRequired') || 'URL requerida', 'var(--accent-warning)');
      setStatus(t('setup.inspecting') || 'Consultando...', 'var(--text-muted)');
      const res = await window.api.cert.inspect(url);
      if (!res.success) return setStatus(res.error, 'var(--accent-danger)');
      const fp = res.data.fingerprint;
      document.getElementById('setup-ded-tlsfp').value = fp;
      setStatus(`${res.data.subject} — ${fp}`, 'var(--text-secondary)');
    });
    document.getElementById('btn-trust-cert')?.addEventListener('click', async () => {
      const url = document.getElementById('setup-ded-baseurl').value.trim();
      if (!url) return setStatus(t('setup.urlRequired') || 'URL requerida', 'var(--accent-warning)');
      setStatus(t('setup.trusting') || 'Instalando certificado...', 'var(--text-muted)');
      const res = await window.api.cert.trust(url);
      if (!res.success) return setStatus(res.error, 'var(--accent-danger)');
      document.getElementById('setup-ded-tlsfp').value = res.data.fingerprint;
      setStatus((t('setup.trustOk') || 'Certificado instalado') + ` — ${res.data.subject}`, 'var(--accent-secondary)');
    });

    // Debounced share-config detection: when the user enters a
    // share path, peek for logging-config.json and lock the form
    // into dedicated mode if one is present.
    this._logModeState = { present: false, detail: null };
    const networkInput = document.getElementById('setup-network');
    let detectTimer = null;
    const runDetection = async () => {
      if (!networkInput.value.trim()) return;
      // Persist share path before detection so the main process sees it.
      await window.api.config.set({ networkSharePath: networkInput.value.trim() });
      const res = await window.api.share.detectLoggingConfig();
      this._applyLogModeDetection(res);
    };
    networkInput.addEventListener('blur', runDetection);
    networkInput.addEventListener('input', () => {
      clearTimeout(detectTimer);
      detectTimer = setTimeout(runDetection, 500);
    });
    // Run once on load in case the share is already configured.
    if (config.networkSharePath) runDetection();

    document.getElementById('setup-lang').addEventListener('change', async (e) => {
      // Re-fetch translations and re-render if user changes language during setup
      await window.api.config.set({ language: e.target.value, firstRun: true }); 
      await window.initI18n();
      this.render(container);
    });

    document.getElementById('btn-browse-network').addEventListener('click', async () => {
      const folder = await window.api.config.selectFolder();
      if (folder) {
        document.getElementById('setup-network').value = folder;
        await runDetection();
      }
    });

    if (App.rsatAvailable) {
      this.loadOUs(config.baseOUs || (config.baseOU ? [config.baseOU] : []));
    } else {
      document.getElementById('setup-baseou-tree').innerHTML = `<p style="padding:8px;font-size:13px;color:var(--text-muted);">RSAT requerido para listar OUs</p>`;
    }

    document.getElementById('btn-save-setup').addEventListener('click', async () => {
      await runDetection();
      const selectedMode = document.querySelector('input[name="setup-logmode"]:checked')?.value || 'local';
      const selectedUiMode = document.querySelector('input[name="setup-ui-mode"]:checked')?.value || 'simple';
      const dedBaseUrl = document.getElementById('setup-ded-baseurl')?.value.trim() || '';
      const dedTlsFp   = document.getElementById('setup-ded-tlsfp')?.value.trim() || '';
      const dedAdminKey = document.getElementById('setup-ded-adminkey')?.value.trim() || '';

      const newConfig = {
        language: document.getElementById('setup-lang').value,
        uiMode: selectedUiMode,
        networkSharePath: document.getElementById('setup-network').value.trim(),
        logDirectory: document.getElementById('setup-logs')?.value.trim() || '',
        defaultGPO: document.getElementById('setup-gpo').value.trim(),
        preferredDC: document.getElementById('setup-dc').value.trim(),
        baseOUs: this.getSelectedDNs(),
        logMode: selectedMode,
        firstRun: false
      };

      if (!newConfig.networkSharePath) {
        App.toast(t('common.error'), 'error');
        return;
      }

      if (selectedMode === 'dedicated' && !this._logModeState?.present) {
        if (!dedBaseUrl) {
          App.toast(t('setup.urlRequired') || 'URL del servidor requerida', 'warning');
          return;
        }
        newConfig.remoteLogging = {
          apiBaseUrl: dedBaseUrl,
          tlsFingerprint: dedTlsFp || null,
          readonly: false
        };
      }

      await window.api.config.set(newConfig);

      // When dedicated mode comes from the share, run enrollment
      // flow to obtain a per-equipo ingest API key.
      if (selectedMode === 'dedicated' && this._logModeState?.present) {
        const res = await window.api.share.enrollFromConfig();
        if (!res?.success) {
          App.toast(
            `${t('setup.enrollFailed') || 'Could not enroll the computer'}: ${res?.error || 'unknown'}`,
            'error'
          );
          return;
        }
        App.toast(t('setup.enrollOk') || 'Equipo enrolado correctamente', 'success');
      } else if (selectedMode === 'dedicated' && dedAdminKey) {
        // Manual dedicated setup: try logging in admin so user can manage keys later
        const r = await window.api.admin.login({
          baseUrl: dedBaseUrl,
          apiKey: dedAdminKey,
          tlsFingerprint: dedTlsFp || null
        });
        if (!r.success) {
          App.toast(`${t('setup.adminLoginFailed') || 'Admin login failed'}: ${r.error}`, 'warning');
        } else {
          const provision = await window.api.admin.provisionIngestKey();
          if (!provision.success) {
            App.toast(
              `${t('settings.ingestProvisionFailed') || 'Could not provision the ingest key'}: ${provision.error}`,
              'warning'
            );
          } else {
            await window.api.logs.reload();
            App.toast(t('settings.ingestProvisioned') || 'Clave de ingesta creada', 'success');
          }
        }
      } else if (selectedMode === 'local') {
        await window.api.logs.useLocal();
      }

      await window.initI18n();
      document.querySelector('.sidebar').style.display = 'flex';
      App.updateSidebarLanguage();
      App.navigate('dashboard');
      if (selectedMode === 'dedicated' && !this._logModeState?.present) {
        setTimeout(() => {
          App.toast(
            t('setup.dedicatedServerSavedGuide') || 'Servidor guardado. En Configuracion, publica la config en el share y regenera scripts desplegados si ya existian apps.',
            'info'
          );
        }, 250);
      }
    });
  },

  _applyLogModeDetection(detection) {
    const banner   = document.getElementById('setup-logmode-banner');
    const readonly = document.getElementById('setup-logmode-readonly');
    const radios   = document.querySelectorAll('input[name="setup-logmode"]');
    this._logModeState = detection || { present: false };

    if (detection && detection.present) {
      banner.style.display = 'block';
      banner.textContent = (t('setup.logModeShareDetected')
        || 'Configuración de logs detectada en el share') + ` — ${detection.apiBaseUrl}`;
      readonly.style.display = 'block';
      // Force dedicated + lock local option.
      radios.forEach(r => {
        r.checked = r.value === 'dedicated';
        r.disabled = true;
      });
    } else {
      banner.style.display = 'none';
      readonly.style.display = 'none';
      radios.forEach(r => { r.disabled = false; });
    }
  },

  getSelectedDNs() {
    try {
      const raw = document.getElementById('setup-baseou')?.value || '[]';
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

        const searchInput = document.getElementById('setup-baseou-search');
        if (searchInput) {
          searchInput.oninput = () => {
            this.renderOUTree(this.getSelectedDNs(), searchInput.value);
          };
        }
      }
    } catch(err) {}
  },

  renderOUTree(selectedDNs, query = '') {
    const treeContainer = document.getElementById('setup-baseou-tree');
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

    const dnInput = document.getElementById('setup-baseou');
    treeContainer.querySelectorAll('.tree-node').forEach(node => {
      node.onclick = (e) => {
        if (e.target.closest('.tree-toggle')) return;
        const dn = node.dataset.dn;
        const current = this.getSelectedDNs();
        const nextDNs = current.includes(dn)
          ? current.filter(item => item !== dn)
          : [...current, dn];
        if (dnInput) dnInput.value = JSON.stringify(nextDNs);
        this.renderOUTree(nextDNs, document.getElementById('setup-baseou-search')?.value || '');
      };
    });
  },

  updateSelectedDisplay(selectedDNs) {
    const selectedEl = document.getElementById('setup-baseou-selected');
    const dnInput = document.getElementById('setup-baseou');
    if (!selectedEl) return;

    if (!selectedDNs || selectedDNs.length === 0) {
      selectedEl.innerHTML = `<span style="font-size:12px;color:var(--text-muted);">${t('apps.selectOuRecommended')}</span>`;
      return;
    }

    selectedEl.innerHTML = selectedDNs.map(dn => {
      const selectedName = this.findOUName(this.ousTreeCache, dn) || dn;
      return `<span style="display:inline-flex;align-items:center;gap:6px;background:rgba(30,144,255,0.15);color:var(--primary-color);padding:2px 10px;border-radius:4px;font-size:12px;">
        📁 ${App._esc(selectedName)}
        <button type="button" class="btn btn-ghost btn-sm setup-baseou-remove" data-dn="${App._esc(dn)}" style="font-size:11px;padding:0 4px;min-height:auto;">✕</button>
      </span>`;
    }).join('') + `<button type="button" class="btn btn-ghost btn-sm" id="setup-baseou-clear" style="font-size:11px;margin-left:4px;opacity:.7;">${t('common.clear') || 'Borrar selección'}</button>`;

    selectedEl.querySelectorAll('.setup-baseou-remove').forEach(btn => {
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const dn = btn.dataset.dn;
        const nextDNs = this.getSelectedDNs().filter(item => item !== dn);
        if (dnInput) dnInput.value = JSON.stringify(nextDNs);
        this.renderOUTree(nextDNs, document.getElementById('setup-baseou-search')?.value || '');
      };
    });

    const clearBtn = document.getElementById('setup-baseou-clear');
    if (clearBtn) {
      clearBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (dnInput) dnInput.value = '[]';
        this.renderOUTree([], document.getElementById('setup-baseou-search')?.value || '');
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
