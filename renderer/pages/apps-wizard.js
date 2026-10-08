// =============================================================
// renderer/pages/apps-wizard.js — Wizard (crear/editar app)
// =============================================================
// Depende de: AppUtils, AppsPage coordinator
// Expone: window.AppsWizardModule
// =============================================================

const AppsWizardModule = {

  captureWizardScrollState() {
    const overlay = document.getElementById('modal-overlay');
    const modalBody = document.getElementById('modal-body');
    if (!overlay?.classList.contains('visible') || !modalBody?.querySelector('.wizard-content')) {
      return null;
    }

    const activeStepValue = modalBody.querySelector('.wizard-step.active')?.dataset.actualStep
      || modalBody.querySelector('.wizard-step.active .wizard-step-number')?.textContent
      || '';
    const activeStep = Number.parseInt(activeStepValue, 10);

    return {
      step: Number.isFinite(activeStep) ? activeStep : null,
      modalBodyScrollTop: modalBody.scrollTop || 0,
      catalogScrollTop: document.getElementById('wiz-catalog-results')?.scrollTop || 0,
      plantillaScrollTop: document.getElementById('wiz-plantilla-results')?.scrollTop || 0,
      manualScrollTop: document.getElementById('wiz-manual-results')?.scrollTop || 0
    };
  },

  restoreWizardScrollState(snapshot, state) {
    if (!snapshot || snapshot.step !== state.step) return;

    requestAnimationFrame(() => {
      const modalBody = document.getElementById('modal-body');
      if (modalBody && Number.isFinite(snapshot.modalBodyScrollTop)) {
        modalBody.scrollTop = snapshot.modalBodyScrollTop;
      }

      const catalogResults = document.getElementById('wiz-catalog-results');
      if (catalogResults && Number.isFinite(snapshot.catalogScrollTop)) {
        catalogResults.scrollTop = snapshot.catalogScrollTop;
      }

      const plantillaResults = document.getElementById('wiz-plantilla-results');
      if (plantillaResults && Number.isFinite(snapshot.plantillaScrollTop)) {
        plantillaResults.scrollTop = snapshot.plantillaScrollTop;
      }

      const manualResults = document.getElementById('wiz-manual-results');
      if (manualResults && Number.isFinite(snapshot.manualScrollTop)) {
        manualResults.scrollTop = snapshot.manualScrollTop;
      }

      if (state.step === 1) {
        const selectedCard = document.querySelector(
          '#wiz-catalog-results .catalog-item.selected, #wiz-winget-section .catalog-item.selected, #wiz-plantilla-results .template-card.selected, #wiz-manual-results .template-card.selected'
        );
        if (selectedCard) {
          selectedCard.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
      }
    });
  },

  async openWizard(existingApp = null) {
    if (AppsPage._wizardOpening) return;
    AppsPage._wizardOpening = true;

    // Show locked loading modal immediately so user gets feedback and can't double-open
    App.openModalLocked(
      existingApp ? t('apps.edit') : t('apps.newApp'),
      `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;min-height:120px;">
        <span class="spinner" style="width:24px;height:24px;border-width:3px;flex-shrink:0;"></span>
        <span style="color:var(--text-secondary);font-size:14px;">${t('bundles.loadingOUs')}</span>
      </div>`,
      ''
    );

    try {
      const [templates, catalogData, config, existingApps] = await Promise.all([
        window.api.scripts.getTemplates(),
        window.api.catalog.getCatalog().catch(() => ({ catalog: [], odtProducts: [], odtApps: [], odtLanguages: [], odtChannels: [] })),
        window.api.config.get().catch(() => ({})),
        window.api.apps.getAll().catch(() => [])
      ]);
      AppsPage.wingetCatalogCache = catalogData;
      const isEdit = !!(existingApp?.id);
      if (existingApp?.templateDefinition?.kind === 'user-template' && !templates.some(tmpl => tmpl.id === existingApp.template)) {
        const fallbackTemplate = AppsPage.buildTemplateViewFromDefinition(existingApp.template, existingApp.templateDefinition);
        if (fallbackTemplate) templates.push(fallbackTemplate);
      }

      // Pre-fetch OUs â€” always refresh for new apps so stale tree/baseOU change is reflected
      if (!isEdit) { AppsPage.ousTreeCache = null; AppsPage.ousCache = null; }
      if (App.rsatAvailable && !App.rsatMissingGPMC && !AppsPage.ousTreeCache) {
        try {
          const ouResult = await window.api.ad.getOUs();
          if (ouResult.success && ouResult.data) {
            AppsPage.ousTreeCache = ouResult.data;
            AppsPage.ousCache = this.flattenOUs(ouResult.data);
          }
        } catch (e) { /* AD unavailable â€“ OU list will be empty */ }
      }

      // When editing, prefer the installer path on the share (where it actually
      // lives now) instead of the original local path used at creation time.
      let initialInstallerPath = existingApp?.installerPath || '';
      if (existingApp) {
        const sharedPath = await AppsPage.resolveSharedInstaller(existingApp.name, existingApp.installerPath);
        if (sharedPath) initialInstallerPath = sharedPath;
      }
      let initialConfigXmlPath = existingApp?.configXmlPath || '';
      let initialTemplateFiles = existingApp?.templateFiles || {};
      if (existingApp?.template) {
        const selectedTemplate = templates.find(tmpl => tmpl.id === existingApp.template) || null;
        const normalizedTemplateSelection = AppsPage.reconcileLegacyTemplateXmlSelection(
          selectedTemplate,
          initialTemplateFiles,
          initialConfigXmlPath
        );
        initialTemplateFiles = normalizedTemplateSelection.templateFiles;
        initialConfigXmlPath = normalizedTemplateSelection.configXmlPath;
      }

    // State
    const plantillaTemplateIds = templates.filter(tmpl => tmpl.category !== 'General' || tmpl.id === 'office').map(tmpl => tmpl.id);
    const isSimpleWizardFlow = AppsPage.isSimpleUIMode() && !isEdit;
    const initialTemplate = isSimpleWizardFlow ? 'generic' : (existingApp?.template || '');
    const normalizedUninstall = AppUtils.normalizeUninstallState(existingApp || {}, {
      ...(existingApp || {}),
      template: initialTemplate,
      installerPath: initialInstallerPath || existingApp?.installerPath || '',
      installerType: existingApp?.installerType || ''
    });
    const state = {
      // Skip template selection in simple mode and when opened from catalog with a pre-selected app (no id = not editing)
      step: isSimpleWizardFlow ? 2 : ((existingApp && !existingApp.id) ? 2 : 1),
      catalogTab: isSimpleWizardFlow ? 'manual' : (existingApp?.wingetId ? 'catalog' :
                  existingApp?.template === 'odt' ? 'catalog' :
                  (existingApp && plantillaTemplateIds.includes(existingApp.template)) ? 'plantilla' :
                  (existingApp ? 'manual' : 'catalog')),
      catalogSearch: '',
      catalogCat: 'Todo',
      template: initialTemplate,
      wingetId: existingApp?.wingetId || '',
      wingetSource: existingApp?.wingetSource || 'winget',
      wingetScope: existingApp?.wingetScope || ((existingApp?.wingetSource === 'msstore' || existingApp?.wingetId === 'Spotify.Spotify') ? 'user' : 'machine'),
      wingetRepair: existingApp?.wingetRepair === true,
      odtConfig: existingApp?.odtConfig || {
        product: 'O365BusinessRetail',
        apps: ['Word', 'Excel', 'PowerPoint', 'Outlook', 'OneNote', 'OneDrive'],
        language: 'es-es',
        channel: 'MonthlyEnterprise',
        arch: '64'
      },
      name: existingApp?.name || '',
      silentArgs: existingApp?.silentArgs || '/S',
      templateInstallers: config.templateInstallers || {},
      installerPath: initialInstallerPath || (!isEdit && existingApp?.template ? (config.templateInstallers?.[existingApp.template] || '') : ''),
      configXmlPath: initialConfigXmlPath,
      customParams: existingApp?.customParams || {},
      templateFiles: initialTemplateFiles,
      templateDefinition: existingApp?.templateDefinition || null,
      selectedOUs: (existingApp?.assignedOUs && existingApp.assignedOUs.length > 0)
        ? [...existingApp.assignedOUs]
        : (existingApp?.ouDN ? [existingApp.ouDN] : []),
      ouDN: existingApp?.ouDN || (existingApp?.assignedOUs && existingApp.assignedOUs[0]) || '',
      gpoName: isEdit ? (existingApp?.gpoName || '') : (config.defaultGPO || ''),
      createGPO: false,
      simpleModeFlow: isSimpleWizardFlow,
      version: existingApp?.version || '1.0.0',
      suggestedVersion: '',
      notifyUser: existingApp?.notifyUser || false,
      uninstallMode: normalizedUninstall.mode,
      uninstallCommand: normalizedUninstall.command,
      uninstallArgs: normalizedUninstall.args,
      uninstallRegistryName: normalizedUninstall.registryMatchName || (existingApp?.name || ''),
      uninstallRegistryPublisher: normalizedUninstall.registryMatchPublisher,
      uninstallProductCode: normalizedUninstall.productCode,
      detection: {
        type: existingApp?.detection?.type || 'tracker',
        filePath: existingApp?.detection?.filePath || '',
        fileCheck: existingApp?.detection?.fileCheck || 'exists',
        fileVersionOp: existingApp?.detection?.fileVersionOp || '>=',
        fileVersionValue: existingApp?.detection?.fileVersionValue || '',
        registryHive: existingApp?.detection?.registryHive || 'HKLM',
        registryKey: existingApp?.detection?.registryKey || '',
        registryValueName: existingApp?.detection?.registryValueName || '',
        registryCheck: existingApp?.detection?.registryCheck || 'exists',
        registryOp: existingApp?.detection?.registryOp || '>=',
        registryExpectedValue: existingApp?.detection?.registryExpectedValue || ''
      },
      dependsOn: {
        appId: existingApp?.dependsOn?.appId || '',
        appName: existingApp?.dependsOn?.appName || '',
        timeoutMinutes: existingApp?.dependsOn?.timeoutMinutes || 30,
        behavior: existingApp?.dependsOn?.behavior || 'skip'
      },
      availableApps: (Array.isArray(existingApps) ? existingApps : [])
        .filter(a => a && a.id && a.id !== existingApp?.id)
        .map(a => ({ id: a.id, name: a.name })),
      wizardWingetResults: [],
      wizardWingetSearching: false,
      _wizardWingetTimer: null,
      _catalogResolutionToken: 0
    };

    const renderWizard = () => {
      const wizardScrollState = this.captureWizardScrollState();
      const wizardMinStep = state.simpleModeFlow ? 2 : 1;
      const wizardMaxStep = 4;
      const wizardSteps = state.simpleModeFlow
        ? [
            { actualStep: 2, label: t('apps.step2') },
            { actualStep: 3, label: t('apps.step3') },
            { actualStep: 4, label: t('apps.step4') }
          ]
        : [
            { actualStep: 1, label: t('apps.step1') },
            { actualStep: 2, label: t('apps.step2') },
            { actualStep: 3, label: t('apps.step3') },
            { actualStep: 4, label: t('apps.step4') }
          ];
      let body = `
        <div class="wizard-steps">
          ${wizardSteps.map((wizardStep, index) => `
            <div class="wizard-step ${state.step > wizardStep.actualStep ? 'done' : (state.step === wizardStep.actualStep ? 'active' : '')}" data-actual-step="${wizardStep.actualStep}">
              <span class="wizard-step-number">${index + 1}</span><span>${wizardStep.label}</span>
            </div>
          `).join('')}
        </div>
        <div class="wizard-content" style="min-height: 480px; display: flex; flex-direction: column;">`;

      if (state.step === 1) {
        const catalog = catalogData?.catalog || [];

        // â”€â”€ Tab bar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const tabStyle = (active) => `padding:8px 18px;background:none;border:none;border-bottom:2px solid ${active ? 'var(--primary-color)' : 'transparent'};cursor:pointer;font-size:13px;font-weight:600;color:${active ? 'var(--primary-color)' : 'var(--text-secondary)'};margin-bottom:-1px;transition:color .15s,border-color .15s;`;
        body += `
          <div style="display:flex;gap:0;border-bottom:1px solid var(--border-color);margin-bottom:var(--space-md);">
            <button class="wiz-tab" data-tab="catalog" style="${tabStyle(state.catalogTab==='catalog')}">&#128722; ${t('gui.catalog')}</button>
            <button class="wiz-tab" data-tab="plantilla" style="${tabStyle(state.catalogTab==='plantilla')}">&#128203; ${t('gui.template')}</button>
            <button class="wiz-tab" data-tab="manual" style="${tabStyle(state.catalogTab==='manual')}">&#128230; Manual</button>
          </div>
        `;

        if (state.catalogTab === 'catalog') {
          // â”€â”€ Search + category filter â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
          const cats = ['Todo', ...new Set(catalog.map(c => c.category))];
          const catBtnStyle = (active) => `padding:4px 10px;border-radius:20px;border:1px solid var(--border-color);background:${active ? 'var(--primary-color)' : 'transparent'};color:${active ? '#fff' : 'var(--text-secondary)'};cursor:pointer;font-size:11px;white-space:nowrap;`;
          const activeCat = state.catalogCat || 'Todo';
          body += `
            <div style="display:flex;gap:8px;margin-bottom:var(--space-sm);align-items:center;flex-wrap:wrap;">
              <div style="position:relative;flex:1;min-width:160px;">
                <svg style="position:absolute;left:8px;top:50%;transform:translateY(-50%);opacity:.4;pointer-events:none;" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input type="text" class="form-input" id="catalog-search" value="${App._esc(state.catalogSearch||'')}" placeholder="${t('gui.searchApps')}" style="padding-left:28px;padding-top:5px;padding-bottom:5px;font-size:13px;" autocomplete="off">
              </div>
              <div style="display:flex;gap:4px;flex-wrap:wrap;">
                ${cats.map(cat => `<button class="catalog-cat-btn" data-cat="${App._esc(cat)}" style="${catBtnStyle(activeCat===cat)}">${App._esc(cat)}</button>`).join('')}
              </div>
            </div>
            <div id="wiz-catalog-results" style="max-height:330px;overflow-y:auto;padding-right:2px;">
          `;

          // Winget catalog by category
          const q = (state.catalogSearch || '').toLowerCase();

          // ODT special card at top (only show if matches search and category)
          const odtSel = state.template === 'odt';
          const odtKeywords = ['office', 'microsoft', '365', 'odt', 'ltsc', 'word', 'excel'];
          const odtMatchesQ = !q || odtKeywords.some(k => k.includes(q));
          const odtMatchesCat = activeCat === 'Todo' || activeCat === 'Tools';
          if (odtMatchesQ && odtMatchesCat) {
            body += `
              <div style="margin-bottom:var(--space-sm);">
                <h5 style="font-size:10px;text-transform:uppercase;color:var(--text-muted);margin-bottom:6px;letter-spacing:.05em;">Microsoft Office</h5>
                <div class="template-grid" style="grid-template-columns:repeat(auto-fill,minmax(130px,1fr));">
                  <div class="template-card catalog-item ${odtSel ? 'selected' : ''}" data-catalog-type="odt" style="cursor:pointer;" tabindex="0">
                    <div class="template-card-icon" style="font-size:22px;">&#127970;</div>
                    <div class="template-card-name" style="font-size:11px;">Microsoft Office</div>
                    <div class="template-card-desc" style="font-size:10px;">365 / LTSC 2021 / 2019</div>
                  </div>
                </div>
              </div>
            `;
          }

          const filteredCatalog = catalog.filter(item => {
            const matchCat = activeCat === 'Todo' || item.category === activeCat;
            const matchQ = !q || item.name.toLowerCase().includes(q) || item.category.toLowerCase().includes(q) || item.wingetId.toLowerCase().includes(q);
            return matchCat && matchQ;
          });
          const grouped2 = {};
          filteredCatalog.forEach(item => {
            if (!grouped2[item.category]) grouped2[item.category] = [];
            grouped2[item.category].push(item);
          });
          const catOrder2 = ['Browsers', 'Tools', 'Connectivity', 'Communication', 'Multimedia', 'Development'];
          catOrder2.forEach(cat => {
            if (!grouped2[cat]) return;
            body += `
              <div style="margin-bottom:var(--space-sm);">
                <h5 style="font-size:10px;text-transform:uppercase;color:var(--text-muted);margin-bottom:6px;letter-spacing:.05em;">${App._esc(cat)}</h5>
                <div class="template-grid" style="grid-template-columns:repeat(auto-fill,minmax(130px,1fr));">
                  ${grouped2[cat].map(item => {
                    const isSel = state.template === 'winget'
                      && state.wingetId === item.wingetId
                      && (state.wingetSource || 'winget') === (item.wingetSource || 'winget');
                    return `
                      <div class="template-card catalog-item ${isSel ? 'selected' : ''}"
                           data-catalog-type="winget" data-winget-id="${App._esc(item.wingetId)}"
                           data-winget-source="${App._esc(item.wingetSource || 'winget')}"
                           data-app-name="${App._esc(item.name)}" data-app-version="${App._esc(item.defaultVersion)}"
                           style="cursor:pointer;">
                        <div class="template-card-icon" style="font-size:22px;">${item.icon}</div>
                        <div class="template-card-name" style="font-size:11px;">${App._esc(item.name)}</div>
                        <div class="template-card-desc" style="font-size:10px;">v${App._esc(item.defaultVersion)}</div>
                      </div>`;
                  }).join('')}
                </div>
              </div>`;
          });

          if (!filteredCatalog.length && !odtMatchesQ) {
            body += `<p style="text-align:center;color:var(--text-muted);padding:20px 0;font-size:13px;">${t('gui.noAppsFound')}</p>`;
          }
          body += `</div>`; // close scrollable

          // Winget CLI search results (two-phase)
          if (state.wizardWingetSearching) {
            body += `<div id="wiz-winget-section" style="display:flex;align-items:center;gap:6px;padding:8px 2px;font-size:12px;color:var(--text-muted);">
              <span class="spinner" style="width:12px;height:12px;border-width:2px;display:inline-block;"></span>
              ${t('gui.searchingWingetCli')}
            </div>`;
          } else if (state.wizardWingetResults?.length > 0) {
            body += `<div id="wiz-winget-section" style="margin-top:8px;">
              <h5 style="font-size:10px;text-transform:uppercase;color:var(--text-muted);margin-bottom:6px;letter-spacing:.05em;">Winget CLI</h5>
              <div class="template-grid" style="grid-template-columns:repeat(auto-fill,minmax(130px,1fr));">
                ${state.wizardWingetResults.map(item => {
                  const isSel = state.template === 'winget'
                    && state.wingetId === item.wingetId
                    && (state.wingetSource || 'winget') === (item.wingetSource || 'winget');
                  return `<div class="template-card catalog-item ${isSel ? 'selected' : ''}"
                       data-catalog-type="winget" data-winget-id="${App._esc(item.wingetId)}"
                       data-winget-source="${App._esc(item.wingetSource || 'winget')}"
                       data-app-name="${App._esc(item.name)}" data-app-version="${App._esc(item.version||'')}"
                       style="cursor:pointer;">
                    <div class="template-card-icon" style="font-size:22px;">&#128230;</div>
                    <div class="template-card-name" style="font-size:11px;">${App._esc(item.name)}</div>
                    ${item.version ? `<div class="template-card-desc" style="font-size:10px;">v${App._esc(item.version)}</div>` : ''}
                  </div>`;
                }).join('')}
              </div>
            </div>`;
          } else {
            body += `<div id="wiz-winget-section"></div>`;
          }

        } else if (state.catalogTab === 'plantilla') {
          // â”€â”€ Plantilla tab: Non-General templates + Office XML â”€â”€â”€â”€â”€
          const preferredPlantillaCats = ['Security', 'Connectivity', 'RMM', 'Backups', 'Corporate', 'Custom'];
          const plantillaCats = [
            ...preferredPlantillaCats.filter(cat => templates.some(tmpl => tmpl.category === cat && tmpl.id !== 'office')),
            ...[...new Set(
              templates
                .filter(tmpl => tmpl.category && tmpl.category !== 'General' && tmpl.id !== 'office' && !preferredPlantillaCats.includes(tmpl.category))
                .map(tmpl => tmpl.category)
            )]
          ];
          let hasVisibleTemplates = false;

          // Search bar for Plantilla tab
          body += `
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:var(--space-sm);flex-wrap:wrap;">
              <div style="position:relative;max-width:360px;flex:1;min-width:260px;">
                <svg style="position:absolute;left:8px;top:50%;transform:translateY(-50%);opacity:.4;pointer-events:none;" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input type="text" class="form-input" id="plantilla-search" value="${App._esc(state.plantillaSearch||'')}" placeholder="${t('gui.searchTemplates')}" style="padding-left:28px;padding-top:6px;padding-bottom:6px;font-size:13px;" autocomplete="off">
              </div>
              <button class="btn btn-secondary btn-sm" type="button" id="btn-open-template-manager">${t('apps.newCustomTemplate', 'Nueva plantilla')}</button>
            </div>
          `;

          const pq = (state.plantillaSearch || '').toLowerCase();
          body += `<div id="wiz-plantilla-results" style="max-height:330px;overflow-y:auto;padding-right:2px;">`;

          if (!pq || 'winget package windows package manager'.includes(pq)) {
            hasVisibleTemplates = true;
            body += '<div class="template-grid" style="margin-bottom:16px"><div class="template-card ' + (state.template === 'winget' ? 'selected' : '') + '" data-template="winget"><div class="template-card-icon">&#128230;</div><div class="template-card-name">WinGet Package</div><div class="template-card-desc">' + t('winget.templateHint') + '</div></div></div>';
          }
          // Office XML template at the top of Plantilla tab
          const officeTmpl = templates.find(tmpl => tmpl.id === 'office');
          if (officeTmpl) {
            const officeMatches = !pq || 'microsoft office'.includes(pq) || 'office xml'.includes(pq) || officeTmpl.name.toLowerCase().includes(pq) || officeTmpl.description.toLowerCase().includes(pq);
            if (officeMatches) {
              hasVisibleTemplates = true;
              body += `
                <div class="template-category-group" style="margin-bottom:var(--space-md);">
                  <h5 style="margin-bottom:var(--space-sm);color:var(--text-primary);border-bottom:1px solid var(--border-color);padding-bottom:4px;">Microsoft Office</h5>
                  <div class="template-grid">
                    <div class="template-card ${state.template === 'office' ? 'selected' : ''}" data-template="office">
                      <div class="template-card-icon">${AppUtils.templateIcon('office')}</div>
                      <div class="template-card-name">${App._esc(officeTmpl.name)}</div>
                      <div class="template-card-desc">${App._esc(officeTmpl.description)}</div>
                    </div>
                  </div>
                </div>`;
            }
          }

          plantillaCats.forEach(cat => {
            const catTmpls = templates.filter(tmpl => {
              if (tmpl.category !== cat) return false;
              if (!pq) return true;
              return tmpl.name.toLowerCase().includes(pq) || tmpl.description.toLowerCase().includes(pq) || tmpl.id.toLowerCase().includes(pq) || cat.toLowerCase().includes(pq);
            });
            if (!catTmpls.length) return;
            hasVisibleTemplates = true;
            body += `
              <div class="template-category-group" style="margin-bottom:var(--space-md);">
                <h5 style="margin-bottom:var(--space-sm);color:var(--text-primary);border-bottom:1px solid var(--border-color);padding-bottom:4px;">${cat === 'Custom' ? t('apps.customTemplatesTitle', 'Plantillas personalizadas') : cat}</h5>
                <div class="template-grid">
                  ${catTmpls.map(tmpl => `
                    <div class="template-card ${state.template === tmpl.id ? 'selected' : ''}" data-template="${tmpl.id}">
                      <div class="template-card-icon">${AppUtils.templateIcon(tmpl.id)}</div>
                      <div class="template-card-name">${App._esc(tmpl.name)}</div>
                      <div class="template-card-desc">${App._esc(tmpl.description)}</div>
                    </div>`).join('')}
                </div>
              </div>`;
          });
          if (!hasVisibleTemplates) {
            body += `<div style="padding:16px;border:1px dashed var(--border-color);border-radius:8px;color:var(--text-muted);font-size:12px;">${t('apps.templatesSearchEmpty', 'No se han encontrado plantillas para esa busqueda.')}</div>`;
          }
          body += `</div>`;

        } else {
          // â”€â”€ Manual tab: only GenÃ©rica and Script Custom â”€â”€
          const manualTmpls = templates.filter(tmpl => tmpl.id === 'generic' || tmpl.id === 'custom');
          body += `
            <div id="wiz-manual-results" style="max-height:360px;overflow-y:auto;padding-right:2px;">
              <div style="margin-bottom:var(--space-sm);">
                <div>
                  <div style="font-size:12px;font-weight:700;color:var(--text-primary);">${t('apps.manualTemplatesTitle', 'Plantillas manuales')}</div>
                  <div style="font-size:11px;color:var(--text-muted);">${t('apps.manualTemplatesHint', 'Usa una app generica o un script manual cuando no quieras una plantilla reutilizable.')}</div>
                </div>
              </div>
              <div class="template-grid">
                ${manualTmpls.map(tmpl => `
                  <div class="template-card ${state.template === tmpl.id ? 'selected' : ''}" data-template="${tmpl.id}">
                    <div class="template-card-icon">${AppUtils.templateIcon(tmpl.id)}</div>
                    <div class="template-card-name">${App._esc(tmpl.name)}</div>
                  <div class="template-card-desc">${App._esc(tmpl.description)}</div>
                  </div>`).join('')}
              </div>
            </div>`;
        }

      } else if (state.step === 2) {
        const tmpl = templates.find(tmp => tmp.id === state.template);
        const isWinget = state.template === 'winget';
        const isODT = state.template === 'odt';
        const isUserTemplate = !!tmpl?.isUserDefined;
        const showsConfigXmlPicker = ['sap-gui', 'office'].includes(state.template);
        const requiresConfigXml = ['sap-gui', 'office'].includes(state.template);
        const showWizardAdvancedSections = !state.simpleModeFlow;

        body += `
          <div class="form-group">
            <label class="form-label">${t('apps.appName')}</label>
            <input class="form-input" id="wiz-name" value="${App._esc(state.name)}" placeholder="Ej: Google Chrome">
            <p class="form-hint">${t('apps.nameHint')}</p>
          </div>
          ${state.simpleModeFlow ? `
            <div style="padding:12px 14px;background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.18);border-radius:8px;margin-bottom:14px;font-size:12px;color:var(--text-secondary);">
              ${t('apps.simpleModeHint', 'Modo sencillo: solo necesitas nombre, instalador y argumentos. Cambia a avanzado desde Configuracion para ver desinstalacion, deteccion y opciones adicionales.')}
            </div>
          ` : ''}`;

        if (isUserTemplate) {
          const fieldCount = Array.isArray(tmpl?.fields) ? tmpl.fields.length : 0;
          const fileCount = Array.isArray(tmpl?.fileFields) ? tmpl.fileFields.length : 0;
          body += `
            <div class="card" style="padding:14px 16px;margin:0 0 14px 0;background:rgba(30,144,255,0.08);border-color:rgba(30,144,255,0.2);">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">
                <div style="display:flex;align-items:flex-start;gap:10px;">
                  <span style="font-size:28px;line-height:1;">${AppUtils.templateIcon(state.template)}</span>
                  <div>
                    <div style="font-size:15px;font-weight:700;color:var(--text-primary);">${App._esc(tmpl.name)}</div>
                    <p style="margin:6px 0 0 0;font-size:13px;line-height:1.5;color:var(--text-secondary);">${App._esc(tmpl.description || t('apps.customTemplateDefaultDescLong', 'Plantilla reutilizable. Completa solo los valores que cambian en cada despliegue.'))}</p>
                  </div>
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                  <span class="badge badge-info">${fieldCount} ${t('apps.customTemplateArgsBadge', 'campos')}</span>
                  <span class="badge badge-neutral">${fileCount} ${t('apps.customTemplateFilesBadge', 'archivos')}</span>
                  ${tmpl?.hasCustomScript ? `<span class="badge badge-primary">${t('apps.customTemplateScriptBadge', 'script opcional')}</span>` : ''}
                </div>
              </div>
            </div>`;
        } else if (!isWinget && !isODT && tmpl) {
          // Built-in system template banner
          body += `
            <div class="card" style="padding:12px 16px;margin:0 0 14px 0;background:var(--bg-secondary);border-color:var(--border-color);">
              <div style="display:flex;align-items:center;gap:10px;">
                <span style="font-size:28px;line-height:1;">${AppUtils.templateIcon(state.template)}</span>
                <div>
                  <div style="font-size:14px;font-weight:700;color:var(--text-primary);">${App._esc(tmpl.name)}</div>
                  ${tmpl.description ? `<div style="font-size:12px;color:var(--text-muted);margin-top:2px;">${App._esc(tmpl.description)}</div>` : ''}
                </div>
                <span class="badge badge-neutral" style="margin-left:auto;flex-shrink:0;">Sistema</span>
              </div>
            </div>`;
        }

        if (isWinget) {
          // â”€â”€ Winget mode: info panel + wingetId display â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
          body += `<div class="form-group"><label class="form-label">${t('winget.packageId')}</label><input class="form-input" id="wiz-winget-id" value="${App._esc(state.wingetId)}" placeholder="Mozilla.Firefox"></div>
          <div class="form-group"><label class="form-label">${t('winget.source')}</label><select class="form-input" id="wiz-winget-source"><option value="winget" ${state.wingetSource === 'winget' ? 'selected' : ''}>WinGet</option><option value="msstore" ${state.wingetSource === 'msstore' ? 'selected' : ''}>Microsoft Store</option></select></div>
          <div class="form-group"><label class="form-label">${t('winget.search')}</label><div style="display:flex;gap:8px"><input class="form-input" id="wiz-winget-query" placeholder="Spotify"><button type="button" class="btn btn-secondary" id="wiz-winget-search">${t('winget.search')}</button></div><div id="wiz-winget-matches"></div></div>
          <div class="form-group"><label class="form-label">${t('winget.scope')}</label><select class="form-input" id="wiz-winget-scope"><option value="user" ${state.wingetScope === 'user' ? 'selected' : ''}>${t('winget.user')}</option>${state.wingetSource !== 'msstore' ? '<option value="machine" ' + (state.wingetScope === 'machine' ? 'selected' : '') + '>' + t('winget.machine') + '</option>' : ''}</select><p>${t('winget.unverified')}</p><p>${state.wingetScope === 'machine' ? t('winget.machineHint') : t('winget.userHint')}</p></div>
          <label><input type="checkbox" id="wiz-winget-repair" ${state.wingetRepair ? 'checked' : ''}> ${t('winget.repair')}</label><p>${t('winget.repairHint')}</p>`;

        } else if (isODT) {
          // â”€â”€ ODT mode: product radio-cards + app chip-toggles + options row â”€â”€
          const odtProds = catalogData?.odtProducts || [];
          const odtApps2 = catalogData?.odtApps || [];
          const odtLangs = catalogData?.odtLanguages || [];
          const odtChans = catalogData?.odtChannels || [];
          const cfg = state.odtConfig;
          const curProd = odtProds.find(p => p.id === cfg.product);
          const curChan = odtChans.find(c => c.id === cfg.channel);
          const curLang = odtLangs.find(l => l.id === cfg.language);

          body += `
          <div class="odt-wizard">
            <div class="odt-header">
              <div class="odt-header-icon">&#127970;</div>
              <div>
                <div class="odt-header-title">Microsoft Office</div>
                <div class="odt-header-sub">Office Deployment Tool · ${t('gui.noManualDownload')}</div>
              </div>
            </div>

            <div class="odt-section">
              <div class="odt-section-label">${t('gui.product')}</div>
              <div class="odt-product-grid">
                ${odtProds.map(p => `
                  <label class="odt-product-card ${cfg.product === p.id ? 'active' : ''}">
                    <input type="radio" name="odt-product-radio" value="${App._esc(p.id)}" ${cfg.product === p.id ? 'checked' : ''}>
                    <div class="odt-product-name">${App._esc(p.label)}</div>
                    <div class="odt-product-badge">${p.type === 'subscription' ? t('gui.subscription') : 'Licencia perpetua'}</div>
                  </label>`).join('')}
              </div>
            </div>

            <div class="odt-section">
              <div class="odt-section-label">${t('gui.applicationsToInclude')}</div>
              <div class="odt-apps-grid">
                ${odtApps2.map(a => `
                  <label class="odt-app-chip ${cfg.apps.includes(a.id) ? 'active' : ''}">
                    <input type="checkbox" name="odt-app" value="${App._esc(a.id)}" ${cfg.apps.includes(a.id) ? 'checked' : ''}>
                    ${App._esc(a.label)}
                  </label>`).join('')}
              </div>
            </div>

            <div class="odt-section">
              <div class="odt-options-row">
                <div class="odt-option">
                  <label class="odt-option-label">${t('gui.language')}</label>
                  <select class="form-select" id="odt-language">
                    ${odtLangs.map(l => `<option value="${App._esc(l.id)}" ${cfg.language === l.id ? 'selected' : ''}>${App._esc(l.label)}</option>`).join('')}
                  </select>
                </div>
                <div class="odt-option">
                  <label class="odt-option-label">${t('gui.channel')}</label>
                  <select class="form-select" id="odt-channel">
                    ${odtChans.map(c => `<option value="${App._esc(c.id)}" ${cfg.channel === c.id ? 'selected' : ''}>${App._esc(c.label)}</option>`).join('')}
                  </select>
                </div>
                <div class="odt-option odt-option-sm">
                  <label class="odt-option-label">${t('gui.architecture')}</label>
                  <select class="form-select" id="odt-arch">
                    <option value="64" ${cfg.arch === '64' ? 'selected' : ''}>64 bits</option>
                    <option value="32" ${cfg.arch === '32' ? 'selected' : ''}>32 bits</option>
                  </select>
                </div>
              </div>
            </div>

            <div class="odt-summary" id="odt-summary">
              <div class="odt-summary-row">
                <span class="odt-summary-key">${t('gui.product')}</span>
                <span class="odt-summary-val" id="odt-sum-product">${App._esc(curProd?.label || cfg.product)}</span>
              </div>
              <div class="odt-summary-row">
                <span class="odt-summary-key">Apps</span>
                <span class="odt-summary-val" id="odt-sum-apps">${cfg.apps.length > 0 ? cfg.apps.map(id => { const a = odtApps2.find(x => x.id === id); return App._esc(a?.label || id); }).join(', ') : t('gui.noneSelected')}</span>
              </div>
              <div class="odt-summary-row">
                <span class="odt-summary-key">${t('gui.channel')} · ${t('gui.language')} · Arq</span>
                <span class="odt-summary-val" id="odt-sum-opts">${App._esc(curChan?.label || cfg.channel)} · ${App._esc(curLang?.label || cfg.language)} · ${cfg.arch} bits</span>
              </div>
              <div class="odt-summary-warning">
                &#9201; ${t('gui.installationMayTake20To60MinutesOn')}
              </div>
            </div>
          </div>`;

        } else {
          // â”€â”€ Standard installer mode â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
          body += `
          ${state.template !== 'custom' || true ? `
            <div class="form-group">
              <label class="form-label">${t('apps.installer')}${state.template === 'custom' ? ` <span style="font-size:11px;font-weight:400;color:var(--text-muted);">(${t('apps.optional', 'opcional')})</span>` : ''}</label>
              <div class="flex gap-sm">
                <input class="form-input" id="wiz-installer" value="${App._esc(state.installerPath)}" placeholder="C:\\Descargas\\app.exe" readonly style="flex:1">
                <button class="btn btn-secondary" id="btn-pick-installer">${t('apps.browse')}</button>
              </div>
              ${state.template === 'custom' ? `<p class="form-hint">${t('apps.customInstallerHint', 'Opcional. Si adjuntas un instalador, el script puede referenciar $Instalador, $CacheDir, $ArgumentosExe y $CurrentVersion.')}</p>` : ''}
              ${state.installerSignature ? (() => {
                const sig = state.installerSignature;
                const typeLabels = {
                  nsis: 'NSIS', innosetup: 'InnoSetup', 'wix-burn': 'WiX Burn',
                  installshield: 'InstallShield', squirrel: 'Squirrel', iexpress: 'IExpress',
                  'advanced-installer': 'Advanced Installer', 'setup-factory': 'Setup Factory',
                  wise: 'Wise', java: 'Java', adobe: 'Adobe', vcredist: 'VC++ Redist',
                  dotnet: '.NET Runtime', msi: 'MSI', ps1: 'PowerShell', exe: t('gui.genericExe')
                };
                const label = typeLabels[sig.type] || sig.type;
                const confColor = sig.confidence === 'high' || sig.confidence === 'definitive'
                  ? 'var(--accent-secondary,#22c55e)' : 'var(--text-muted)';
                const pubInfo = sig.publisher ? ` · ${App._esc(sig.publisher)}` : '';
                return `<p class="form-hint" style="margin-top:4px;">
                  <span style="display:inline-flex;align-items:center;gap:5px;">
                    <span class="badge" style="background:rgba(99,102,241,.15);color:var(--primary-color);font-size:10px;">🔍 ${App._esc(label)}</span>
                    <span style="color:${confColor};font-size:11px;">${sig.confidence === 'low' ? t('gui.notDetectedUsingGenericS') : t('gui.detected')}${pubInfo}</span>
                    ${sig.suggestedArgs ? `<code style="font-size:10px;background:var(--bg-input);padding:1px 5px;border-radius:3px;">${App._esc(sig.suggestedArgs)}</code>` : ''}
                  </span>
                </p>`;
              })() : ''}
              <p class="form-hint">${t('apps.installerHint')}</p>
            </div>
          ` : ''}

          ${showsConfigXmlPicker ? `
            <div class="form-group">
              <label class="form-label">${t('apps.xmlConfig')}${requiresConfigXml ? ' *' : ''}</label>
              <div class="flex gap-sm">
                <input class="form-input" id="wiz-xml" value="${App._esc(state.configXmlPath)}" placeholder="${App._esc(t('apps.xmlHint'))}" readonly style="flex:1">
                <button class="btn btn-secondary" id="btn-pick-xml">${t('apps.browse')}</button>
              </div>
            </div>
          ` : ''}

          ${state.template === 'generic' || isUserTemplate ? `
            <div id="wiz-silent-args-container">
              <div class="form-group">
                <label class="form-label">${t('apps.silentArgs')}</label>
                <div style="display:flex;gap:8px;">
                  <input class="form-input" id="wiz-silentArgs" value="${App._esc(state.silentArgs)}" placeholder="/S, /qn, /norestart" style="flex:1;">
                  <button class="btn btn-secondary btn-sm" type="button" id="btn-show-args-help" style="white-space:nowrap;align-self:center;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                    ${t('apps.commonArgs')}
                  </button>
                </div>
                ${isUserTemplate ? `<p class="form-hint">${t('apps.customTemplateSilentHint', 'Estos argumentos base se añaden antes de los argumentos definidos en la plantilla.')}</p>` : ''}
              </div>
            </div>
          ` : ''}`;
        }

        body += `
          ${showWizardAdvancedSections ? (() => {
            const installerType = AppUtils.getInstallerTypeFromPath(state.installerPath, state.template);
            const options = [];
            if (state.template === 'winget') {
              options.push(['winget', t('apps.uninstallModeWinget', 'Winget')]);
              options.push(['none', t('apps.uninstallModeNone', 'Sin desinstalacion')]);
            } else if (installerType === 'msi') {
              options.push(['auto-msi', t('apps.uninstallModeMsi', 'MSI automatico')]);
              options.push(['auto-registry', t('apps.uninstallModeRegistry', 'Auto por registro')]);
              options.push(['manual', t('apps.uninstallModeManual', 'Comando manual')]);
              options.push(['none', t('apps.uninstallModeNone', 'Sin desinstalacion')]);
            } else if (state.template === 'custom' || state.template === 'odt') {
              options.push(['manual', t('apps.uninstallModeManual', 'Comando manual')]);
              options.push(['none', t('apps.uninstallModeNone', 'Sin desinstalacion')]);
            } else {
              options.push(['auto-registry', t('apps.uninstallModeRegistry', 'Auto por registro')]);
              options.push(['manual', t('apps.uninstallModeManual', 'Comando manual')]);
              options.push(['none', t('apps.uninstallModeNone', 'Sin desinstalacion')]);
            }

            const selectedMode = state.uninstallMode || AppUtils.getDefaultUninstallMode(state.template, state.installerPath, installerType);
            return `
              <div class="card" style="padding:14px 16px; margin:0 0 14px 0;">
                <div style="font-weight:600; font-size:13px; color:var(--text-secondary); margin-bottom:10px;">${t('apps.uninstallSection', 'Desinstalacion')}</div>
                <div class="form-group">
                  <label class="form-label">${t('apps.uninstallMode', 'Modo de desinstalacion')}</label>
                  <select class="form-select" id="wiz-uninstall-mode">
                    ${options.map(([value, label]) => `<option value="${value}" ${selectedMode === value ? 'selected' : ''}>${App._esc(label)}</option>`).join('')}
                  </select>
                  <p class="form-hint">${t('apps.uninstallHint', 'Define como se va a preparar el script uninstall.ps1 para esta app.')}</p>
                </div>
                ${selectedMode === 'auto-msi' ? `
                  <div class="form-group" style="margin-bottom:0;">
                    <label class="form-label">${t('apps.uninstallProductCode', 'ProductCode MSI')}</label>
                    <input class="form-input" id="wiz-uninstall-product-code" value="${App._esc(state.uninstallProductCode || '')}" placeholder="{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}">
                    <p class="form-hint">${t('apps.uninstallProductCodeHint', 'Opcional. Si lo dejas vacio, se intentara resolver automaticamente desde el MSI o el registro del equipo cliente.')}</p>
                  </div>
                ` : ''}
                ${selectedMode === 'auto-registry' ? `
                  <div class="form-group">
                    <label class="form-label">${t('apps.uninstallRegistryName', 'Nombre a buscar en registro')}</label>
                    <input class="form-input" id="wiz-uninstall-reg-name" value="${App._esc(state.uninstallRegistryName || state.name || '')}" placeholder="Nombre del programa instalado">
                  </div>
                  <div class="form-group" style="margin-bottom:0;">
                    <label class="form-label">${t('apps.uninstallRegistryPublisher', 'Publisher opcional')}</label>
                    <input class="form-input" id="wiz-uninstall-reg-publisher" value="${App._esc(state.uninstallRegistryPublisher || '')}" placeholder="Fabricante / Publisher">
                    <p class="form-hint">${t('apps.uninstallRegistryHint', 'Se usara QuietUninstallString o UninstallString de la app detectada en el registro de Windows.')}</p>
                  </div>
                ` : ''}
                ${selectedMode === 'manual' ? `
                  <div class="form-group">
                    <label class="form-label">${t('apps.uninstallCommand', 'Ruta o comando')}</label>
                    <input class="form-input" id="wiz-uninstall-command" value="${App._esc(state.uninstallCommand || '')}" placeholder="C:\\Program Files\\App\\uninstall.exe">
                  </div>
                  <div class="form-group" style="margin-bottom:0;">
                    <label class="form-label">${t('apps.uninstallArgs', 'Argumentos')}</label>
                    <input class="form-input" id="wiz-uninstall-args" value="${App._esc(state.uninstallArgs || '')}" placeholder="/S /quiet">
                    <p class="form-hint">${t('apps.uninstallManualHint', 'Usa esta opcion para EXE, scripts personalizados u otros instaladores que requieran un comando especifico.')}</p>
                  </div>
                ` : ''}
                ${selectedMode === 'winget' ? `
                  <div style="padding:10px 12px; border-radius:8px; background:rgba(59,130,246,0.08); border:1px solid rgba(59,130,246,0.18); font-size:12px; color:var(--text-secondary);">
                    ${t('apps.uninstallWingetHint', 'Se generara automaticamente winget uninstall con el paquete seleccionado.')} <code>${App._esc(state.wingetId || '-')}</code>
                  </div>
                ` : ''}
                ${selectedMode === 'none' ? `
                  <div style="padding:10px 12px; border-radius:8px; background:rgba(245,158,11,0.08); border:1px solid rgba(245,158,11,0.18); font-size:12px; color:var(--text-secondary);">
                    ${t('apps.uninstallNoneHint', 'Esta app se desplegara sin script de desinstalacion. Podras cambiarlo mas tarde desde Editar app.')}
                  </div>
                ` : ''}
              </div>
            `;
          })() : ''}

          ${showWizardAdvancedSections ? (() => {
            const det = state.detection || {};
            const detType = det.type || 'tracker';
            const fileCheck = det.fileCheck || 'exists';
            const regCheck = det.registryCheck || 'exists';
            const opOptions = ['>=','=','>','<','<=','!='];
            return `
              <div class="card" style="padding:14px 16px; margin:0 0 14px 0;">
                <div style="font-weight:600; font-size:13px; color:var(--text-secondary); margin-bottom:10px;">${t('apps.detectionSection', 'Deteccion de instalacion')}</div>
                <div class="form-group">
                  <label class="form-label">${t('apps.detectionType', 'Metodo de deteccion')}</label>
                  <select class="form-select" id="wiz-detection-type">
                    <option value="tracker" ${detType === 'tracker' ? 'selected' : ''}>${t('apps.detectionTypeTracker', 'Tracker (predeterminado)')}</option>
                    <option value="msi-productcode" ${detType === 'msi-productcode' ? 'selected' : ''}>${t('apps.detectionTypeMsiProductCode', 'MSI ProductCode (registro)')}</option>
                    <option value="file" ${detType === 'file' ? 'selected' : ''}>${t('apps.detectionTypeFile', 'Archivo/ruta en disco')}</option>
                    <option value="registry" ${detType === 'registry' ? 'selected' : ''}>${t('apps.detectionTypeRegistry', 'Clave o valor de registro')}</option>
                  </select>
                  <p class="form-hint">${t('apps.detectionHint', 'Al estilo Intune: si se cumple la regla, la app se considera instalada y el script no la reinstala.')}</p>
                </div>
                ${detType === 'file' ? `
                  <div class="form-group">
                    <label class="form-label">${t('apps.detectionFilePath', 'Ruta del archivo')}</label>
                    <input class="form-input" id="wiz-detection-file-path" value="${App._esc(det.filePath || '')}" placeholder="C:\\Program Files\\App\\app.exe">
                  </div>
                  <div class="form-group" style="margin-bottom:0;">
                    <label class="form-label">${t('apps.detectionFileCheck', 'Que verificar')}</label>
                    <div style="display:flex;gap:8px;">
                      <select class="form-select" id="wiz-detection-file-check" style="flex:0 0 220px;">
                        <option value="exists" ${fileCheck === 'exists' ? 'selected' : ''}>${t('apps.detectionFileCheckExists', 'Existe el archivo')}</option>
                        <option value="version" ${fileCheck === 'version' ? 'selected' : ''}>${t('apps.detectionFileCheckVersion', 'Comparar version')}</option>
                        <option value="date" ${fileCheck === 'date' ? 'selected' : ''}>${t('apps.detectionFileCheckDate', 'Existe (fecha)')}</option>
                      </select>
                      ${fileCheck === 'version' ? `
                        <select class="form-select" id="wiz-detection-file-op" style="flex:0 0 90px;">
                          ${opOptions.map(op => `<option value="${op}" ${(det.fileVersionOp || '>=') === op ? 'selected' : ''}>${op}</option>`).join('')}
                        </select>
                        <input class="form-input" id="wiz-detection-file-version" value="${App._esc(det.fileVersionValue || '')}" placeholder="1.0.0" style="flex:1;">
                      ` : ''}
                    </div>
                  </div>
                ` : ''}
                ${detType === 'registry' ? `
                  <div class="form-group">
                    <label class="form-label">${t('apps.detectionRegistryHive', 'Hive')}</label>
                    <select class="form-select" id="wiz-detection-reg-hive" style="max-width:220px;">
                      <option value="HKLM" ${(det.registryHive || 'HKLM') === 'HKLM' ? 'selected' : ''}>HKLM</option>
                      <option value="HKCU" ${det.registryHive === 'HKCU' ? 'selected' : ''}>HKCU</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label class="form-label">${t('apps.detectionRegistryKey', 'Clave de registro')}</label>
                    <input class="form-input" id="wiz-detection-reg-key" value="${App._esc(det.registryKey || '')}" placeholder="SOFTWARE\\MyCompany\\App">
                  </div>
                  <div class="form-group">
                    <label class="form-label">${t('apps.detectionRegistryValueName', 'Nombre del valor (opcional)')}</label>
                    <input class="form-input" id="wiz-detection-reg-value-name" value="${App._esc(det.registryValueName || '')}" placeholder="Version">
                  </div>
                  <div class="form-group" style="margin-bottom:0;">
                    <label class="form-label">${t('apps.detectionRegistryCheck', 'Comprobacion')}</label>
                    <div style="display:flex;gap:8px;">
                      <select class="form-select" id="wiz-detection-reg-check" style="flex:0 0 220px;">
                        <option value="exists" ${regCheck === 'exists' ? 'selected' : ''}>${t('apps.detectionRegistryCheckExists', 'Existe la clave/valor')}</option>
                        <option value="equals" ${regCheck === 'equals' ? 'selected' : ''}>${t('apps.detectionRegistryCheckEquals', 'Igual a')}</option>
                        <option value="contains" ${regCheck === 'contains' ? 'selected' : ''}>${t('apps.detectionRegistryCheckContains', 'Contiene')}</option>
                        <option value="version" ${regCheck === 'version' ? 'selected' : ''}>${t('apps.detectionRegistryCheckVersion', 'Comparar version')}</option>
                      </select>
                      ${regCheck === 'version' ? `
                        <select class="form-select" id="wiz-detection-reg-op" style="flex:0 0 90px;">
                          ${opOptions.map(op => `<option value="${op}" ${(det.registryOp || '>=') === op ? 'selected' : ''}>${op}</option>`).join('')}
                        </select>
                      ` : ''}
                      ${regCheck !== 'exists' ? `
                        <input class="form-input" id="wiz-detection-reg-expected" value="${App._esc(det.registryExpectedValue || '')}" placeholder="${regCheck === 'version' ? '1.0.0' : t('apps.detectionRegistryExpectedPlaceholder', 'Valor esperado')}" style="flex:1;">
                      ` : ''}
                    </div>
                  </div>
                ` : ''}
                ${detType === 'msi-productcode' ? `
                  <div style="padding:10px 12px; border-radius:8px; background:rgba(34,197,94,0.08); border:1px solid rgba(34,197,94,0.22); font-size:12px; color:var(--text-secondary);">
                    ${t('apps.detectionMsiProductCodeHint', 'Comprueba HKLM/WOW6432Node/HKCU Uninstall por ProductCode. Sin archivos en el equipo cliente.')}
                    ${state.msiProductCode ? `<div style="margin-top:6px; font-family:monospace; color:var(--text-primary); font-size:11px;">${App._esc(state.msiProductCode)}</div>` : ''}
                  </div>
                ` : ''}
                ${detType === 'tracker' ? `
                  <div style="padding:10px 12px; border-radius:8px; background:rgba(59,130,246,0.08); border:1px solid rgba(59,130,246,0.18); font-size:12px; color:var(--text-secondary);">
                    ${t('apps.detectionTrackerHint', 'Se usara el archivo Tracker_<App>.json generado en el log local para evitar reinstalaciones.')}
                  </div>
                ` : ''}
              </div>
            `;
          })() : ''}

          ${showWizardAdvancedSections ? (() => {
            const dep = state.dependsOn || {};
            const apps = Array.isArray(state.availableApps) ? state.availableApps : [];
            return `
              <div class="card" style="padding:14px 16px; margin:0 0 14px 0;">
                <div style="font-weight:600; font-size:13px; color:var(--text-secondary); margin-bottom:10px;">${t('apps.dependsOnSection', 'Dependencia de otra app')}</div>
                <div class="form-group">
                  <label class="form-label">${t('apps.dependsOnApp', 'Esperar a que termine')}</label>
                  <select class="form-select" id="wiz-dep-app-id">
                    <option value="">${t('apps.dependsOnNone', 'Sin dependencia')}</option>
                    ${apps.map(a => `<option value="${App._esc(a.id)}" data-name="${App._esc(a.name || '')}" ${dep.appId === a.id ? 'selected' : ''}>${App._esc(a.name || a.id)}</option>`).join('')}
                  </select>
                  <p class="form-hint">${t('apps.dependsOnHint', 'Si eliges una app, este instalador esperara a que termine correctamente antes de ejecutarse.')}</p>
                </div>
                ${dep.appId ? `
                  <div style="display:flex;gap:12px;">
                    <div class="form-group" style="flex:0 0 200px;">
                      <label class="form-label">${t('apps.dependsOnTimeout', 'Timeout (minutos)')}</label>
                      <input type="number" min="1" max="1440" step="1" class="form-input" id="wiz-dep-timeout" value="${Number(dep.timeoutMinutes) || 30}">
                    </div>
                    <div class="form-group" style="flex:1;">
                      <label class="form-label">${t('apps.dependsOnBehavior', 'Si expira el tiempo')}</label>
                      <select class="form-select" id="wiz-dep-behavior">
                        <option value="skip" ${dep.behavior !== 'fail' ? 'selected' : ''}>${t('apps.dependsOnBehaviorSkip', 'Continuar de todos modos')}</option>
                        <option value="fail" ${dep.behavior === 'fail' ? 'selected' : ''}>${t('apps.dependsOnBehaviorFail', 'Fallar la instalacion')}</option>
                      </select>
                    </div>
                  </div>
                ` : ''}
              </div>
            `;
          })() : ''}

          ${showWizardAdvancedSections ? `
            <div style="display:flex;gap:12px">
              <div class="form-group" style="flex:0 0 220px">
                <label class="form-label">${t('apps.version')}</label>
                <input class="form-input" id="wiz-version" value="${state.version}" placeholder="1.0.0">
                ${state.suggestedVersion && state.suggestedVersion !== state.version ? `
                  <div id="wiz-version-suggestion" style="margin-top:6px; display:inline-flex; align-items:center; gap:6px; padding:4px 10px; background:rgba(108,99,255,0.12); border:1px solid rgba(108,99,255,0.3); border-radius:20px; font-size:11px; cursor:pointer;" title="${t('apps.applySuggestedVersion')}">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--primary-color)" stroke-width="2.5"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
                    <span style="color:var(--text-secondary);">${t('apps.suggestedVersion')}:</span>
                    <strong style="color:var(--primary-color); font-family:monospace;">${App._esc(state.suggestedVersion)}</strong>
                  </div>
                ` : ''}
              </div>
              <div class="form-group" style="flex:1;display:flex;align-items:stretch;">
                <label class="checkbox-wrapper checkbox-panel" style="align-items:center;">
                  <input type="checkbox" class="checkbox-select" id="wiz-notify" ${state.notifyUser ? 'checked' : ''}>
                  <span>&#128276; ${t('apps.notifyUser')}</span>
                </label>
              </div>
            </div>
          ` : ''}

          ${(showWizardAdvancedSections && !isWinget && !isODT) ? (tmpl?.fields || []).map(f => {
            let inputHtml = '';
            if (f.type === 'select') {
              inputHtml = '<select class="form-select" id="wiz-param-' + f.key + '">\n' +
                (f.options || []).map(opt => '<option value="' + opt.value + '" ' + (state.customParams[f.key] === opt.value || (!state.customParams[f.key] && f.default === opt.value) ? 'selected' : '') + '>' + opt.label + '</option>').join('') +
              '\n</select>';
            } else if (f.type === 'textarea') {
              inputHtml = '<textarea class="form-input" id="wiz-param-' + f.key + '" rows="8" style="font-family: monospace;">' + App._esc(state.customParams[f.key] || f.default) + '</textarea>';
            } else if (f.type === 'checkbox') {
              return `
                <div class="form-group">
                  <label class="checkbox-wrapper">
                    <input type="checkbox" id="wiz-param-${f.key}" ${state.customParams[f.key] === true || (state.customParams[f.key] === undefined && f.default) ? 'checked' : ''}>
                    <span class="form-label mb-0" style="margin: 0; display: inline;">${App._esc(f.label)}</span>
                  </label>
                  ${f.hint ? '<p class="form-hint" style="margin-left: 26px;">' + App._esc(f.hint) + '</p>' : ''}
                </div>
              `;
            } else {
              let val = state.customParams[f.key];
              if (val === undefined) val = f.default;
              inputHtml = '<input class="form-input" id="wiz-param-' + f.key + '" value="' + App._esc(val) + '" placeholder="' + App._esc(f.hint || '') + '">';
            }
            return `
              <div class="form-group">
                <label class="form-label">${App._esc(f.label)}${f.required ? ' *' : ''}</label>
                ${inputHtml}
                ${f.hint ? '<p class="form-hint">' + App._esc(f.hint) + '</p>' : ''}
              </div>
            `;
          }).join('') : ''}

          ${(showWizardAdvancedSections && !isWinget && !isODT && isUserTemplate) ? (tmpl?.fileFields || []).map(fileField => `
            <div class="form-group">
              <label class="form-label">${App._esc(fileField.label)}${fileField.required ? ' *' : ''}</label>
              <div class="flex gap-sm">
                <input class="form-input" id="wiz-file-${fileField.key}" value="${App._esc(state.templateFiles[fileField.key]?.sourcePath || state.templateFiles[fileField.key] || '')}" placeholder="${App._esc(AppsPage.describeTemplateFile(fileField))}" readonly style="flex:1">
                <button class="btn btn-secondary btn-template-file" type="button" data-file-key="${App._esc(fileField.key)}">${t('apps.browse')}</button>
              </div>
              <p class="form-hint">${App._esc(AppsPage.describeTemplateFile(fileField))}</p>
            </div>
          `).join('') : ''}

          ${showWizardAdvancedSections && isUserTemplate && tmpl?.hasCustomScript ? `
            <div style="padding:12px 14px;background:rgba(30,144,255,0.08);border:1px solid rgba(30,144,255,0.2);border-radius:8px;margin-top:8px;">
              <div style="font-weight:600;font-size:13px;color:var(--text-primary);margin-bottom:4px;">${t('apps.customTemplatePostScriptTitle', 'Script adicional')}</div>
              <p style="margin:0;font-size:12px;color:var(--text-secondary);">${t('apps.customTemplatePostScriptHint', 'La plantilla incluye un script opcional que se ejecutará después del instalador con acceso a los valores y archivos auxiliares definidos.')}</p>
            </div>
          ` : ''}
        `;
      } else if (state.step === 3) {
        const selectedOUs = Array.isArray(state.selectedOUs) ? state.selectedOUs : [];
        body += `
          <div class="form-group mb-md">
            <label class="form-label">${t('apps.selectOus')}</label>
            <div style="position:relative;margin-bottom:8px;">
              <svg style="position:absolute;left:9px;top:50%;transform:translateY(-50%);pointer-events:none;opacity:.4" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input type="text" class="form-input" id="wiz-ou-search" placeholder="${t('ous.searchOUs')}" autocomplete="off" style="padding-left:32px;">
            </div>
            <div id="wiz-ou-tree" style="max-height:190px;overflow-y:auto;border:1px solid var(--border-color);border-radius:6px;padding:4px 6px;background:var(--bg-secondary);">
              ${AppsPage.ousTreeCache ? App.ouPickerTreeHTML(AppsPage.ousTreeCache, '', selectedOUs) : `<p style="padding:8px;font-size:13px;color:var(--text-muted);">${t('ous.noOusFound')}</p>`}
            </div>
            <div id="wiz-ou-selected" style="margin-top:6px;min-height:22px;display:flex;flex-wrap:wrap;align-items:center;gap:6px;">
              <span style="font-size:12px;color:var(--text-muted);">${t('apps.selectOuRecommended')}</span>
            </div>
            <input type="hidden" id="wiz-ou-dn" value="${JSON.stringify(selectedOUs).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">
          </div>

          <div class="form-group mb-md">
            <label class="checkbox-wrapper checkbox-panel checkbox-panel--accent">
              <input type="checkbox" class="checkbox-select" id="wiz-create-gpo" ${state.createGPO ? 'checked' : ''}>
              <span style="font-weight:600;color:var(--primary-color)">&#10024; ${t('apps.createGpoCheckbox')}</span>
            </label>
          </div>

          <div class="form-group" style="opacity: ${state.createGPO ? '0.5' : '1'}; pointer-events: ${state.createGPO ? 'none' : 'auto'};">
            <label class="form-label">${t('apps.selectGpo')}</label>
            <select class="form-select" id="wiz-gpo">
              <option value="">${t('apps.noGpoOption')}</option>
            </select>
          </div>`;
      } else if (state.step === 4) {
        if (state.template === 'winget') body += `<div class="form-group"><strong>${t('winget.packageId')}</strong>: ${App._esc(state.wingetId)}<br><strong>${t('winget.source')}</strong>: ${App._esc(state.wingetSource)}<br><strong>${t('winget.scope')}</strong>: ${t(state.wingetScope === 'machine' ? 'winget.machine' : 'winget.user')}<br>${t('winget.repair')}: ${t(state.wingetRepair ? 'common.yes' : 'common.no')}</div>`;
        body += `
          <div class="mb-md">
            <div class="flex items-center gap-md mb-md">
              <span class="badge badge-primary">${App._esc(state.template)}</span>
              <span style="font-weight:600; font-size:1.1rem">${App._esc(state.name)}</span>
              ${state.gpoName ? `<span class="badge badge-info">${App._esc(state.gpoName)}</span>` : ''}
            </div>
          </div>
          <div class="code-header">
            <span>&#128196; install.ps1</span>
            <button class="btn btn-ghost btn-sm" onclick="AppsPage.copyScript()">${t('apps.copyBtn')}</button>
          </div>
          <pre class="code-preview" id="script-preview">${t('apps.generatingScript')}</pre>`;
      }

      body += `</div>`;

      const footer = `
        ${state.step > wizardMinStep ? `<button class="btn btn-secondary" id="wiz-prev">${t('apps.back')}</button>` : ''}
        <div style="flex:1"></div>
        ${state.step < wizardMaxStep ?
          `<button class="btn btn-primary" id="wiz-next" ${state.step === 1 && !state.template ? 'disabled' : ''}>${t('apps.next')}</button>` :
          `<button class="btn btn-success" id="wiz-deploy">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
            ${isEdit ? t('apps.saveAndDeploy') : t('apps.create')}
          </button>`
        }`;

      App.openModal(isEdit ? t('apps.edit') : t('apps.newApp'), body, footer); // isEdit is !!(existingApp?.id)
      this.bindWizardEvents(state, templates, renderWizard, isEdit, existingApp);
      this.restoreWizardScrollState(wizardScrollState, state);
    };

    App._modalLocked = false;  // unlock before rendering the interactive wizard
    AppsPage._wizardOpening = false;
    renderWizard();
    // If opened from catalog with a pre-selected app, scroll it into view
    if (existingApp?.wingetId && !isEdit) {
      requestAnimationFrame(() => {
        const sel = document.querySelector('.catalog-item.selected');
        if (sel) sel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
    }
    } catch (err) {
      AppsPage._wizardOpening = false;
      App.toast(t('common.error') + ': ' + err.message, 'error');
      App.closeModal();
    }
  },

  bindWizardEvents(state, templates, renderWizard, isEdit, existingApp) {
    // â”€â”€ Tab switching (catalog / agentes / manual) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    document.querySelectorAll('.wiz-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        state.catalogTab = tab.dataset.tab;
        // Clear template selection when switching tabs so user picks fresh
        state.template = '';
        state.wingetId = '';
        state.wingetSource = 'winget';
        state.customParams = {};
        state.templateFiles = {};
        state.templateDefinition = null;
        state.configXmlPath = '';
        renderWizard();
      });
    });

    // â”€â”€ Catalog item selection (winget / ODT cards in catalog tab) â”€â”€
    document.querySelectorAll('.catalog-item').forEach(card => {
      card.addEventListener('click', (e) => {
        e.stopPropagation(); // prevent the generic .template-card handler below
        const catalogType = card.dataset.catalogType;
        const nextTemplate = catalogType === 'odt' ? 'odt' : 'winget';
        let selectedPackage = null;
        if (state.template !== nextTemplate) {
          state.customParams = {};
          state.templateFiles = {};
          state.templateDefinition = null;
          state.configXmlPath = '';
        }
        if (catalogType === 'odt') {
          state.template = 'odt';
          state.wingetId = '';
          state.wingetSource = 'winget';
          state.name = 'Microsoft Office';
          state.uninstallMode = 'none';
        } else if (catalogType === 'winget') {
          state.template = 'winget';
          state.wingetId = card.dataset.wingetId || '';
          state.wingetScope = (card.dataset.wingetSource === 'msstore' || state.wingetId === 'Spotify.Spotify') ? 'user' : 'machine';
          state.wingetSource = card.dataset.wingetSource || 'winget';
          state.name = card.dataset.appName || '';
          state.uninstallMode = 'winget';
          if (card.dataset.appVersion) state.version = card.dataset.appVersion;
          selectedPackage = {
            wingetId: state.wingetId,
            wingetSource: state.wingetSource,
            name: card.dataset.appName || state.name,
            version: card.dataset.appVersion || state.version || ''
          };
        }
        // Keep the user on step 1 in the New App wizard; the catalog page
        // still opens this wizard directly on step 2 via a prefilled state.
        if (state._wizardWingetTimer) clearTimeout(state._wizardWingetTimer);
        state.wizardWingetSearching = false;
        renderWizard();
        if (selectedPackage?.wingetId) {
          this.resolveCatalogPackageSelection(state, renderWizard, selectedPackage);
        }
      });
    });

    // â”€â”€ Template selection (plantilla / manual tabs) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    document.querySelectorAll('.template-card:not(.catalog-item)').forEach(card => {
      card.addEventListener('click', () => {
        if (state.template !== card.dataset.template) {
          state.customParams = {};
          state.templateFiles = {};
          state.templateDefinition = null;
          state.configXmlPath = '';
        }
        state.template = card.dataset.template;
        if (state.template === 'winget') state.wingetScope = 'user';
        state.wingetId = '';
        state.wingetSource = 'winget';
        // Auto-fill installer from template pre-configured installer
        const preInstaller = state.templateInstallers?.[state.template];
        if (preInstaller && !state.installerPath) state.installerPath = preInstaller;
        state.uninstallMode = AppUtils.getDefaultUninstallMode(
          state.template,
          state.installerPath,
          AppUtils.getInstallerTypeFromPath(state.installerPath, state.template)
        );
        // Stay on step 1 so the user confirms with "Next" from the New App wizard.
        renderWizard();
      });
    });

    const manageTemplatesBtn = document.getElementById('btn-open-template-manager');
    if (manageTemplatesBtn) {
      manageTemplatesBtn.addEventListener('click', () => {
        this.saveStepData(state, templates);
        AppsPage.openTemplateManager(async () => {
          const refreshedTemplates = await window.api.scripts.getTemplates();
          templates.splice(0, templates.length, ...refreshedTemplates);
          if (state.template && !refreshedTemplates.some(item => item.id === state.template)) {
            state.template = '';
            state.customParams = {};
            state.templateFiles = {};
            state.templateDefinition = null;
            state.configXmlPath = '';
          }
          renderWizard();
        });
      });
    }

    // â”€â”€ Catalog search input (two-phase: curated + winget CLI) â”€â”€
    const catalogSearchInput = document.getElementById('catalog-search');
    if (catalogSearchInput) {
      // Enter: fire CLI search immediately (don't let it bubble to Next button)
      catalogSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          const q = catalogSearchInput.value.trim();
          if (q.length >= 2 && state._wizardWingetTimer) {
            // Cancel debounce and fire immediately
            clearTimeout(state._wizardWingetTimer);
            state._wizardWingetTimer = null;
            this._runWizardWingetSearch(q, state, renderWizard);
          }
        }
      });

      catalogSearchInput.addEventListener('input', () => {
        const q = catalogSearchInput.value;
        state.catalogSearch = q;
        // Clear previous winget search state
        if (state._wizardWingetTimer) clearTimeout(state._wizardWingetTimer);
        state.wizardWingetResults = [];
        state.wizardWingetSearching = q.trim().length >= 2;

        // Phase 1: render curated results immediately
        renderWizard();
        const newInput = document.getElementById('catalog-search');
        if (newInput) { newInput.focus(); newInput.setSelectionRange(newInput.value.length, newInput.value.length); }

        // Phase 2: winget CLI search (debounced 600ms)
        if (q.trim().length >= 2) {
          state._wizardWingetTimer = setTimeout(() => {
            state._wizardWingetTimer = null;
            this._runWizardWingetSearch(q.trim(), state, renderWizard);
          }, 600);
        }
      });
    }

    // â”€â”€ Plantilla search input â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const plantillaSearchInput = document.getElementById('plantilla-search');
    if (plantillaSearchInput) {
      plantillaSearchInput.addEventListener('input', () => {
        state.plantillaSearch = plantillaSearchInput.value;
        renderWizard();
        // Re-focus and restore cursor position after re-render
        const newInput = document.getElementById('plantilla-search');
        if (newInput) {
          newInput.focus();
          newInput.setSelectionRange(newInput.value.length, newInput.value.length);
        }
      });
    }

    // â”€â”€ Catalog category filter buttons â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    document.querySelectorAll('.catalog-cat-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        state.catalogCat = btn.dataset.cat;
        renderWizard();
      });
    });

    document.getElementById('wiz-winget-source')?.addEventListener('change', () => { this.saveStepData(state, templates); renderWizard(); });
    document.getElementById('wiz-winget-scope')?.addEventListener('change', () => { this.saveStepData(state, templates); renderWizard(); });
    document.getElementById('wiz-winget-search')?.addEventListener('click', async () => {
      this.saveStepData(state, templates);
      const query = document.getElementById('wiz-winget-query')?.value.trim();
      const resultsBox = document.getElementById('wiz-winget-matches');
      if (!query || !resultsBox) return;
      resultsBox.textContent = t('winget.searching');
      try {
        const results = await window.api.catalog.searchCLI(query);
        if (resultsBox !== document.getElementById('wiz-winget-matches')) return;
        resultsBox.replaceChildren();
        for (const item of results) {
          const button = document.createElement('button'); button.type = 'button'; button.className = 'btn btn-secondary';
          button.textContent = item.name + ' — ' + item.wingetId + (item.version ? ' (' + item.version + ')' : '') + ' [' + (item.wingetSource || 'winget') + ']';
          button.addEventListener('click', () => { this.saveStepData(state, templates); state.wingetId = item.wingetId; state.wingetSource = item.wingetSource || 'winget'; state.name = item.name || state.name; state.wingetScope = 'user'; renderWizard(); });
          resultsBox.appendChild(button);
        }
        if (!results.length) resultsBox.textContent = t('winget.noResults');
      } catch (error) { resultsBox.textContent = t('winget.searchFailed') + ': ' + error.message; }
    });
    // Navigation
    const nextBtn = document.getElementById('wiz-next');
    const prevBtn = document.getElementById('wiz-prev');
    const deployBtn = document.getElementById('wiz-deploy');

    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        this.saveStepData(state, templates);

        // Validate step 2 before advancing
        if (state.step === 2) {
          if (state.template === 'winget' && !/^[A-Za-z0-9][A-Za-z0-9.+_-]*$/.test(state.wingetId)) { App.toast(t('winget.invalidId'), 'warning'); return; }
          const requiresAdvancedValidation = !state.simpleModeFlow;
          if (!state.name.trim()) {
            App.toast(t('apps.nameRequired'), 'warning');
            document.getElementById('wiz-name')?.focus();
            return;
          }
          const tmpl = templates.find(tmp => tmp.id === state.template);
          const needsInstaller = state.template !== 'custom' && !(tmpl?.noInstaller);
          if (needsInstaller && !state.installerPath) {
            App.toast(t('apps.installerRequired'), 'warning');
            return;
          }
          const missingRequiredArg = (tmpl?.fields || []).find(field =>
            field.required && !String(state.customParams[field.key] ?? field.default ?? '').trim()
          );
          if (missingRequiredArg) {
            App.toast(t('apps.customTemplateRequiredArg', 'Completa todos los argumentos obligatorios de la plantilla.'), 'warning');
            document.getElementById(`wiz-param-${missingRequiredArg.key}`)?.focus();
            return;
          }
          const missingRequiredFile = (tmpl?.fileFields || []).find(field =>
            field.required && !String(state.templateFiles[field.key]?.sourcePath || state.templateFiles[field.key] || '').trim()
          );
          if (missingRequiredFile) {
            App.toast(t('apps.customTemplateRequiredFile', 'Selecciona todos los archivos obligatorios de la plantilla.'), 'warning');
            return;
          }
          if (requiresAdvancedValidation && state.uninstallMode === 'manual' && !String(state.uninstallCommand || '').trim()) {
            App.toast(t('apps.uninstallCommandRequired', 'Define el comando de desinstalacion manual.'), 'warning');
            document.getElementById('wiz-uninstall-command')?.focus();
            return;
          }
          if (requiresAdvancedValidation && state.uninstallMode === 'auto-registry' && !String(state.uninstallRegistryName || state.name || '').trim()) {
            App.toast(t('apps.uninstallRegistryRequired', 'Indica el nombre a buscar en el registro para desinstalar.'), 'warning');
            document.getElementById('wiz-uninstall-reg-name')?.focus();
            return;
          }
          const requiresConfigXml = ['office', 'sap-gui'].includes(state.template);
          if (requiresAdvancedValidation && requiresConfigXml && !String(state.configXmlPath || '').trim()) {
            App.toast(t('apps.customTemplateRequiredXml', 'Selecciona el XML requerido para esta plantilla.'), 'warning');
            return;
          }
        }

        state.step++;
        renderWizard();
      });
    }

    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        const wizardMinStep = state.simpleModeFlow ? 2 : 1;
        state.step = Math.max(wizardMinStep, state.step - 1);
        renderWizard();
      });
    }

    if (deployBtn) {
      deployBtn.addEventListener('click', () => this.finishWizard(state, isEdit, existingApp, renderWizard));
    }

    // Step 2 events
    const btnPickInstaller = document.getElementById('btn-pick-installer');
    if (btnPickInstaller) {
      btnPickInstaller.addEventListener('click', async () => {
        this.saveStepData(state, templates);
        const file = await window.api.config.selectFile([{ name: t('gui.installers'), extensions: ['exe', 'msi', 'ps1'] }]);
        if (file) {
          state.installerPath = file;
          state.installerSignature = null;

          if (!['manual', 'none', 'winget'].includes(state.uninstallMode)) {
            state.uninstallMode = AppUtils.getDefaultUninstallMode(
              state.template,
              file,
              AppUtils.getInstallerTypeFromPath(file, state.template)
            );
          }

          // Auto-suggest name from filename — only if user hasn't typed one yet
          if (!state.name.trim()) {
            const basename = file.split(/[\\/]/).pop() || '';
            const nameWithoutExt = basename.replace(/\.[^.]+$/, '');
            const suggestedName = nameWithoutExt.replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim();
            if (suggestedName) state.name = suggestedName;
          }

          renderWizard();

          // Detect installer type + extract version in parallel
          const [sigResult, verResult] = await Promise.allSettled([
            window.api.apps.detectInstallerSignature(file),
            window.api.apps.getInstallerVersion(file)
          ]);

          let sigChanged = false;

          // Apply signature detection
          if (sigResult.status === 'fulfilled' && sigResult.value?.success) {
            const sig = sigResult.value;
            state.installerSignature = sig;
            // Auto-fill silentArgs unless admin already typed something meaningful
            const prevArgs = (state.silentArgs || '').trim();
            const defaultArgs = ['/S', '/qn', '/qn /norestart', ''];
            if (!prevArgs || defaultArgs.includes(prevArgs)) {
              state.silentArgs = sig.suggestedArgs || '';
            }
            // Auto-fill productName/publisher if not yet set
            if (sig.productName && !state.name.trim()) state.name = sig.productName;
            sigChanged = true;
          } else {
            // Fallback: extension-based defaults
            const ext = file.split('.').pop().toLowerCase();
            const prevArgs = (state.silentArgs || '').trim();
            if (ext === 'msi'  && (!prevArgs || prevArgs === '/S')) state.silentArgs = '/qn /norestart';
            if (ext === 'exe'  && (!prevArgs || prevArgs === '/qn /norestart' || prevArgs === '/qn')) state.silentArgs = '/S';
            if (ext === 'ps1'  && (!prevArgs || prevArgs === '/S' || prevArgs === '/qn /norestart' || prevArgs === '/qn')) state.silentArgs = '';
          }

          // Apply version from installer metadata
          if (verResult.status === 'fulfilled' && verResult.value?.success) {
            const vr = verResult.value;
            state.suggestedVersion = vr.version || '';
            if (vr.version && (!state.version || state.version === '1.0.0')) {
              state.version = vr.version;
            }
            // Store MSI metadata for version.json + auto-select ProductCode detection
            if (vr.productCode) {
              state.msiProductCode = vr.productCode;
              if (!state.detection?.type || state.detection.type === 'tracker') {
                state.detection = { ...(state.detection || {}), type: 'msi-productcode' };
              }
            }
            if (vr.publisher && !state.installerSignature?.publisher) {
              if (state.installerSignature) state.installerSignature.publisher = vr.publisher;
            }
          } else {
            state.suggestedVersion = '';
          }

          if (sigChanged || verResult.status === 'fulfilled') renderWizard();
        }
      });
    }

    // Suggested version bubble click â†’ apply to input
    const versionSuggestion = document.getElementById('wiz-version-suggestion');
    if (versionSuggestion) {
      versionSuggestion.addEventListener('click', () => {
        state.version = state.suggestedVersion;
        const versionInput = document.getElementById('wiz-version');
        if (versionInput) versionInput.value = state.suggestedVersion;
        versionSuggestion.style.display = 'none';
      });
    }

    const btnPickXml = document.getElementById('btn-pick-xml');
    if (btnPickXml) {
      btnPickXml.addEventListener('click', async () => {
        this.saveStepData(state, templates);
        const file = await window.api.config.selectFile([{ name: t('gui.xmlFiles'), extensions: ['xml'] }]);
        if (file) {
          state.configXmlPath = file;
          renderWizard();
        }
      });
    }

    document.querySelectorAll('.btn-template-file').forEach(btn => {
      btn.addEventListener('click', async () => {
        this.saveStepData(state, templates);
        const tmpl = templates.find(item => item.id === state.template);
        const fileField = (tmpl?.fileFields || []).find(item => item.key === btn.dataset.fileKey);
        if (!fileField) return;
        const extensions = Array.isArray(fileField.extensions) && fileField.extensions.length > 0
          ? fileField.extensions
          : ['*'];
        const normalizedExtensions = AppUtils.isInstallerTemplateFile(fileField) && extensions.length === 1 && extensions[0] === '*'
          ? ['exe', 'msi', 'ps1']
          : extensions;
        const file = await window.api.config.selectFile([{
          name: fileField.label || t(
            AppUtils.isInstallerTemplateFile(fileField) ? 'apps.customTemplateInstallerFile' : 'apps.customTemplateConfigFile',
            AppUtils.isInstallerTemplateFile(fileField) ? t('gui.attachedInstaller') : t('gui.configurationFile')
          ),
          extensions: normalizedExtensions
        }]);
        if (file) {
          state.templateFiles[fileField.key] = { sourcePath: file };
          renderWizard();
        }
      });
    });

    const uninstallModeSelect = document.getElementById('wiz-uninstall-mode');
    if (uninstallModeSelect) {
      uninstallModeSelect.addEventListener('change', () => {
        this.saveStepData(state, templates);
        state.uninstallMode = uninstallModeSelect.value;
        if (state.uninstallMode === 'auto-msi') {
          state.uninstallCommand = '';
          state.uninstallArgs = '';
        }
        if (state.uninstallMode !== 'auto-registry') {
          state.uninstallRegistryPublisher = state.uninstallRegistryPublisher || '';
        }
        renderWizard();
      });
    }

    const detTypeSelect = document.getElementById('wiz-detection-type');
    if (detTypeSelect) {
      detTypeSelect.addEventListener('change', () => {
        this.saveStepData(state, templates);
        state.detection.type = detTypeSelect.value;
        renderWizard();
      });
    }
    const detFileCheck = document.getElementById('wiz-detection-file-check');
    if (detFileCheck) {
      detFileCheck.addEventListener('change', () => {
        this.saveStepData(state, templates);
        state.detection.fileCheck = detFileCheck.value;
        renderWizard();
      });
    }
    const detRegCheck = document.getElementById('wiz-detection-reg-check');
    if (detRegCheck) {
      detRegCheck.addEventListener('change', () => {
        this.saveStepData(state, templates);
        state.detection.registryCheck = detRegCheck.value;
        renderWizard();
      });
    }

    const depAppSelect = document.getElementById('wiz-dep-app-id');
    if (depAppSelect) {
      depAppSelect.addEventListener('change', () => {
        this.saveStepData(state, templates);
        const opt = depAppSelect.options[depAppSelect.selectedIndex];
        state.dependsOn.appId = depAppSelect.value;
        state.dependsOn.appName = opt ? (opt.dataset.name || opt.textContent || '') : '';
        renderWizard();
      });
    }

    // Silent args helper button
    const btnArgsHelp = document.getElementById('btn-show-args-help');
    if (btnArgsHelp) {
      btnArgsHelp.addEventListener('click', () => {
        this.saveStepData(state, templates);
        this.showSilentArgsHelper(state, renderWizard);
      });
    }

    // ODT live summary update
    const odtWizard = document.querySelector('.odt-wizard');
    if (odtWizard) {
      const updateODTSummary = () => {
        const checkedProd = odtWizard.querySelector('input[name="odt-product-radio"]:checked');
        const prodLabel = checkedProd?.closest('.odt-product-card')?.querySelector('.odt-product-name')?.textContent || '';
        const sumProd = document.getElementById('odt-sum-product');
        if (sumProd && prodLabel) sumProd.textContent = prodLabel;

        const checkedApps = [...odtWizard.querySelectorAll('input[name="odt-app"]:checked')]
          .map(cb => cb.closest('.odt-app-chip')?.textContent?.trim() || cb.value);
        const sumApps = document.getElementById('odt-sum-apps');
        if (sumApps) sumApps.textContent = checkedApps.length > 0 ? checkedApps.join(', ') : t('gui.noneSelected');

        const lang = document.getElementById('odt-language');
        const chan = document.getElementById('odt-channel');
        const arch = document.getElementById('odt-arch');
        const sumOpts = document.getElementById('odt-sum-opts');
        if (sumOpts && lang && chan && arch) {
          sumOpts.textContent = `${chan.options[chan.selectedIndex]?.text} Â· ${lang.options[lang.selectedIndex]?.text} Â· ${arch.value} bits`;
        }

        // Sync active class on radio cards
        odtWizard.querySelectorAll('.odt-product-card').forEach(card => {
          const radio = card.querySelector('input[type="radio"]');
          card.classList.toggle('active', radio?.checked || false);
        });

        // Sync active class on chip toggles
        odtWizard.querySelectorAll('.odt-app-chip').forEach(chip => {
          const cb = chip.querySelector('input[type="checkbox"]');
          chip.classList.toggle('active', cb?.checked || false);
        });
      };

      odtWizard.addEventListener('change', updateODTSummary);
    }

    const checkCreateGpo = document.getElementById('wiz-create-gpo');
    if (checkCreateGpo) {
      checkCreateGpo.addEventListener('change', () => {
        this.saveStepData(state, templates);
        state.createGPO = checkCreateGpo.checked;
        if (state.createGPO) state.gpoName = '';
        renderWizard();
      });
    }

    // Load GPOs and OUs for step 3
    if (state.step === 3 && App.rsatAvailable) {
      this.loadGPOsForWizard(state);
      // OUs are pre-fetched in openWizard; bind tree events.
      // loadOUsForWizard handles the edge case where cache is still empty.
      if (AppsPage.ousTreeCache) {
        this.bindOUPickerEvents(state);
      } else {
        this.loadOUsForWizard(state);
      }
    }

    // Generate preview for step 4
    if (state.step === 4) {
      this.generatePreview(state);
    }
  },

  saveStepData(state, templates) {
    // Always try to save all visible inputs regardless of step
    for (const [id, key] of [['wiz-winget-id','wingetId'],['wiz-winget-source','wingetSource'],['wiz-winget-scope','wingetScope']]) {
      const input = document.getElementById(id); if (input) state[key] = input.value.trim();
    }
    const wingetRepair = document.getElementById('wiz-winget-repair'); if (wingetRepair) state.wingetRepair = wingetRepair.checked;
    if (state.wingetSource === 'msstore') state.wingetScope = 'user';
    const nameInput = document.getElementById('wiz-name');
    if (nameInput) state.name = nameInput.value;

    const silentInput = document.getElementById('wiz-silentArgs');
    if (silentInput) state.silentArgs = silentInput.value;

    const uninstallMode = document.getElementById('wiz-uninstall-mode');
    if (uninstallMode) state.uninstallMode = uninstallMode.value;
    const uninstallCommand = document.getElementById('wiz-uninstall-command');
    if (uninstallCommand) state.uninstallCommand = uninstallCommand.value;
    const uninstallArgs = document.getElementById('wiz-uninstall-args');
    if (uninstallArgs) state.uninstallArgs = uninstallArgs.value;
    const uninstallRegName = document.getElementById('wiz-uninstall-reg-name');
    if (uninstallRegName) state.uninstallRegistryName = uninstallRegName.value;
    const uninstallRegPublisher = document.getElementById('wiz-uninstall-reg-publisher');
    if (uninstallRegPublisher) state.uninstallRegistryPublisher = uninstallRegPublisher.value;
    const uninstallProductCode = document.getElementById('wiz-uninstall-product-code');
    if (uninstallProductCode) state.uninstallProductCode = uninstallProductCode.value;

    if (!state.detection) state.detection = {};
    const detType = document.getElementById('wiz-detection-type');
    if (detType) state.detection.type = detType.value;
    const detFilePath = document.getElementById('wiz-detection-file-path');
    if (detFilePath) state.detection.filePath = detFilePath.value;
    const detFileCheckEl = document.getElementById('wiz-detection-file-check');
    if (detFileCheckEl) state.detection.fileCheck = detFileCheckEl.value;
    const detFileOp = document.getElementById('wiz-detection-file-op');
    if (detFileOp) state.detection.fileVersionOp = detFileOp.value;
    const detFileVersion = document.getElementById('wiz-detection-file-version');
    if (detFileVersion) state.detection.fileVersionValue = detFileVersion.value;
    const detRegHive = document.getElementById('wiz-detection-reg-hive');
    if (detRegHive) state.detection.registryHive = detRegHive.value;
    const detRegKey = document.getElementById('wiz-detection-reg-key');
    if (detRegKey) state.detection.registryKey = detRegKey.value;
    const detRegValueName = document.getElementById('wiz-detection-reg-value-name');
    if (detRegValueName) state.detection.registryValueName = detRegValueName.value;
    const detRegCheckEl = document.getElementById('wiz-detection-reg-check');
    if (detRegCheckEl) state.detection.registryCheck = detRegCheckEl.value;
    const detRegOp = document.getElementById('wiz-detection-reg-op');
    if (detRegOp) state.detection.registryOp = detRegOp.value;
    const detRegExpected = document.getElementById('wiz-detection-reg-expected');
    if (detRegExpected) state.detection.registryExpectedValue = detRegExpected.value;

    if (!state.dependsOn) state.dependsOn = {};
    const depAppEl = document.getElementById('wiz-dep-app-id');
    if (depAppEl) {
      state.dependsOn.appId = depAppEl.value;
      const opt = depAppEl.options[depAppEl.selectedIndex];
      state.dependsOn.appName = opt ? (opt.dataset.name || opt.textContent || '') : '';
    }
    const depTimeoutEl = document.getElementById('wiz-dep-timeout');
    if (depTimeoutEl) state.dependsOn.timeoutMinutes = Number(depTimeoutEl.value) || 30;
    const depBehaviorEl = document.getElementById('wiz-dep-behavior');
    if (depBehaviorEl) state.dependsOn.behavior = depBehaviorEl.value;

    const xmlInput = document.getElementById('wiz-xml');
    if (xmlInput) {
      state.configXmlPath = xmlInput.value;
    }

    if (state.step === 2) {
      const tmpl = templates.find(tmp => tmp.id === state.template);
      (tmpl?.fields || []).forEach(f => {
        const input = document.getElementById(`wiz-param-${f.key}`);
        if (input) {
          if (f.type === 'checkbox') {
            state.customParams[f.key] = input.checked;
          } else {
            state.customParams[f.key] = input.value;
          }
        }
      });

      (tmpl?.fileFields || []).forEach(fileField => {
        const input = document.getElementById(`wiz-file-${fileField.key}`);
        if (input) {
          const existing = state.templateFiles[fileField.key];
          state.templateFiles[fileField.key] = typeof existing === 'object'
            ? { ...existing, sourcePath: input.value }
            : { sourcePath: input.value };
        }
      });

      // Save ODT config fields
      if (state.template === 'odt') {
        const odtProdRadio = document.querySelector('input[name="odt-product-radio"]:checked');
        if (odtProdRadio) state.odtConfig.product = odtProdRadio.value;
        const odtLang = document.getElementById('odt-language');
        if (odtLang) state.odtConfig.language = odtLang.value;
        const odtChan = document.getElementById('odt-channel');
        if (odtChan) state.odtConfig.channel = odtChan.value;
        const odtArch = document.getElementById('odt-arch');
        if (odtArch) state.odtConfig.arch = odtArch.value;
        const odtAppChecks = document.querySelectorAll('input[name="odt-app"]');
        if (odtAppChecks.length > 0) {
          state.odtConfig.apps = [];
          odtAppChecks.forEach(cb => { if (cb.checked) state.odtConfig.apps.push(cb.value); });
        }
      }
    }

    const gpoSelect = document.getElementById('wiz-gpo');
    if (gpoSelect) state.gpoName = gpoSelect.value;
    const ouDnInput = document.getElementById('wiz-ou-dn');
    if (ouDnInput) {
      try {
        const parsed = JSON.parse(ouDnInput.value || '[]');
        state.selectedOUs = Array.isArray(parsed) ? parsed.filter(Boolean) : [];
      } catch {
        state.selectedOUs = ouDnInput.value ? [ouDnInput.value] : [];
      }
      state.ouDN = state.selectedOUs[0] || '';
    }

    const versionInput = document.getElementById('wiz-version');
    if (versionInput) state.version = versionInput.value;
    const notifyCheck = document.getElementById('wiz-notify');
    if (notifyCheck) state.notifyUser = notifyCheck.checked;
  },

  async _runWizardWingetSearch(query, state, renderWizard) {
    try {
      const results = await window.api.catalog.searchCLI(query);
      // Abort if the user has already typed something new
      if (state.catalogSearch.trim() !== query) return;
      const curatedIds = new Set(
        (AppsPage.wingetCatalogCache?.catalog || [])
          .filter(item =>
            item.name.toLowerCase().includes(query.toLowerCase()) ||
            (item.wingetId || '').toLowerCase().includes(query.toLowerCase())
          )
          .map(item => `${(item.wingetId || '').toLowerCase()}|${(item.wingetSource || 'winget').toLowerCase()}`)
          .filter(Boolean)
      );
      state.wizardWingetResults = results.filter(r =>
        r.wingetId && !curatedIds.has(`${r.wingetId.toLowerCase()}|${(r.wingetSource || 'winget').toLowerCase()}`)
      );
      state.wizardWingetSearching = false;

      const ws = document.getElementById('wiz-winget-section');
      if (!ws) return;

      if (state.wizardWingetResults.length === 0) {
        ws.innerHTML = '';
        return;
      }

      ws.innerHTML = `<div style="margin-top:8px;">
        <h5 style="font-size:10px;text-transform:uppercase;color:var(--text-muted);margin-bottom:6px;letter-spacing:.05em;">Winget CLI</h5>
        <div class="template-grid" style="grid-template-columns:repeat(auto-fill,minmax(130px,1fr));">
          ${state.wizardWingetResults.map(item => `
            <div class="template-card catalog-item"
                 data-catalog-type="winget" data-winget-id="${App._esc(item.wingetId)}"
                 data-winget-source="${App._esc(item.wingetSource || 'winget')}"
                 data-app-name="${App._esc(item.name)}" data-app-version="${App._esc(item.version || '')}"
                 style="cursor:pointer;">
              <div class="template-card-icon" style="font-size:22px;">ðŸ“¦</div>
              <div class="template-card-name" style="font-size:11px;">${App._esc(item.name)}</div>
              ${item.version ? `<div class="template-card-desc" style="font-size:10px;">v${App._esc(item.version)}</div>` : ''}
            </div>`).join('')}
        </div>
      </div>`;

      ws.querySelectorAll('.catalog-item').forEach(card => {
        card.addEventListener('click', (e) => {
          e.stopPropagation();
          state.template = 'winget';
          state.wingetId = card.dataset.wingetId || '';
          state.wingetSource = card.dataset.wingetSource || 'winget';
          state.name = card.dataset.appName || '';
          if (card.dataset.appVersion) state.version = card.dataset.appVersion;
          // Stay on step 1 in the New App wizard and normalize the selected package in background.
          if (state._wizardWingetTimer) clearTimeout(state._wizardWingetTimer);
          state.wizardWingetSearching = false;
          renderWizard();
          this.resolveCatalogPackageSelection(state, renderWizard, {
            wingetId: state.wingetId,
            wingetSource: state.wingetSource,
            name: card.dataset.appName || state.name,
            version: card.dataset.appVersion || state.version || ''
          });
        });
      });
    } catch {
      state.wizardWingetSearching = false;
      const ws = document.getElementById('wiz-winget-section');
      if (ws) ws.innerHTML = '';
    }
  },

  async loadGPOsForWizard(state) {
    try {
      const [apps, cfg] = await Promise.all([
        window.api.apps.getAll().catch(() => []),
        window.api.config.get().catch(() => ({}))
      ]);
      const programGPOs = [...new Set([
        ...apps.filter(a => a.gpoName).map(a => a.gpoName),
        cfg.defaultGPO || null
      ].filter(Boolean))];

      const select = document.getElementById('wiz-gpo');
      if (select) {
        programGPOs.forEach(gpoName => {
          const opt = document.createElement('option');
          opt.value = gpoName;
          opt.textContent = gpoName;
          opt.selected = gpoName === state.gpoName;
          select.appendChild(opt);
        });
      }
    } catch (e) {}
  },

  async loadOUsForWizard(state) {
    // Fallback: fetches OUs if not already cached, then renders and binds the tree picker.
    // Under normal flow ousTreeCache is pre-populated in openWizard before step 3 is shown.
    if (!App.rsatAvailable || App.rsatMissingGPMC) return;
    try {
      if (!AppsPage.ousTreeCache) {
        const result = await window.api.ad.getOUs();
        if (result.success && result.data) {
          AppsPage.ousTreeCache = result.data;
          AppsPage.ousCache = this.flattenOUs(result.data);
        }
      }
      const treeContainer = document.getElementById('wiz-ou-tree');
      if (treeContainer && AppsPage.ousTreeCache) {
        treeContainer.innerHTML = App.ouPickerTreeHTML(AppsPage.ousTreeCache, '', state.selectedOUs || []);
      }
      this.bindOUPickerEvents(state);
    } catch (e) {}
  },

  // Removed ouPickerTreeHTML & ouNodeMatchesSearch to use App globals

  bindOUPickerEvents(state) {
    const searchInput = document.getElementById('wiz-ou-search');
    const treeContainer = document.getElementById('wiz-ou-tree');
    const dnInput = document.getElementById('wiz-ou-dn');
    const selectedDisplay = document.getElementById('wiz-ou-selected');
    if (!treeContainer) return;

    const renderSelectedDisplay = () => {
      if (!selectedDisplay) return;
      const selectedOUs = Array.isArray(state.selectedOUs) ? state.selectedOUs : [];
      if (selectedOUs.length === 0) {
        selectedDisplay.innerHTML = `<span style="font-size:12px;color:var(--text-muted);">${t('apps.selectOuRecommended')}</span>`;
        return;
      }

      selectedDisplay.innerHTML = selectedOUs.map(dn => {
        const name = AppsPage.ousCache
          ? (AppsPage.ousCache.find(o => o.dn === dn) || {}).name || dn
          : dn;
        return `<span style="display:inline-flex;align-items:center;gap:6px;background:rgba(30,144,255,0.15);color:var(--primary-color);padding:2px 10px;border-radius:4px;font-size:12px;">
          &#128193; ${App._esc(name)}
          <button class="btn btn-ghost btn-sm btn-remove-ou" data-dn="${App._esc(dn)}" style="font-size:11px;padding:0 4px;min-height:auto;">&times;</button>
        </span>`;
      }).join('') + `<button class="btn btn-ghost btn-sm" id="btn-clear-ou" style="font-size:11px;margin-left:4px;opacity:.7;">${t('common.clear') || 'Borrar selecciÃ³n'}</button>`;

      // Bind remove-one buttons
      selectedDisplay.querySelectorAll('.btn-remove-ou').forEach(btn => {
        btn.onclick = (ev) => {
          ev.stopPropagation();
          const dn = btn.dataset.dn;
          state.selectedOUs = (state.selectedOUs || []).filter(item => item !== dn);
          state.ouDN = state.selectedOUs[0] || '';
          if (dnInput) dnInput.value = JSON.stringify(state.selectedOUs);
          treeContainer.innerHTML = App.ouPickerTreeHTML(
            AppsPage.ousTreeCache, searchInput?.value || '', state.selectedOUs
          );
          bindNodes();
          renderSelectedDisplay();
        };
      });

      // Bind clear-all button
      const clearBtn = document.getElementById('btn-clear-ou');
      if (clearBtn) {
        clearBtn.onclick = (ev) => {
          ev.stopPropagation();
          state.selectedOUs = [];
          state.ouDN = '';
          if (dnInput) dnInput.value = '[]';
          treeContainer.innerHTML = App.ouPickerTreeHTML(
            AppsPage.ousTreeCache, searchInput?.value || '', []
          );
          bindNodes();
          renderSelectedDisplay();
        };
      }
    };

    const bindNodes = () => {
      // Toggle expand/collapse
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

      // Click to select (toggle: clicking already-selected OU deselects it)
      treeContainer.querySelectorAll('.tree-node').forEach(node => {
        node.onclick = (e) => {
          if (e.target.closest('.tree-toggle')) return;
          const dn = node.dataset.dn;
          const current = Array.isArray(state.selectedOUs) ? state.selectedOUs : [];
          state.selectedOUs = current.includes(dn)
            ? current.filter(item => item !== dn)
            : [...current, dn];
          state.ouDN = state.selectedOUs[0] || '';
          if (dnInput) dnInput.value = JSON.stringify(state.selectedOUs);
          treeContainer.innerHTML = App.ouPickerTreeHTML(
            AppsPage.ousTreeCache, searchInput?.value || '', state.selectedOUs
          );
          bindNodes();
          renderSelectedDisplay();
        };
      });
    };

    bindNodes();
    renderSelectedDisplay();

    if (searchInput) {
      searchInput.oninput = () => {
        treeContainer.innerHTML = App.ouPickerTreeHTML(
          AppsPage.ousTreeCache, searchInput.value, state.selectedOUs || []
        );
        bindNodes();
      };
    }
  },

  flattenOUs(roots, depth = 0, flat = []) {
    for (const root of roots) {
      flat.push({ ...root, depth });
      if (root.children && root.children.length) {
        this.flattenOUs(root.children, depth + 1, flat);
      }
    }
    return flat;
  },

  async generatePreview(state) {
    const preview = document.getElementById('script-preview');
    try {
      const templateDefinition = await AppsPage.fetchTemplateDefinition(state.template);
      state.templateDefinition = templateDefinition || state.templateDefinition || null;
      const script = await window.api.scripts.generate({
        name: state.name,
        template: state.template,
        silentArgs: state.silentArgs,
        configXmlPath: state.configXmlPath,
        customParams: state.customParams,
        templateFiles: state.templateFiles,
        templateDefinition: templateDefinition || state.templateDefinition || null
      });
      preview.textContent = script;
    } catch (err) {
      preview.textContent = '# ' + t('apps.errorGeneratingScript') + ' ' + err.message;
    }
  },

  async finishWizard(state, isEdit, existingApp, renderWizard) {
    if (!state.name.trim()) {
      App.toast(t('apps.nameRequired'), 'warning');
      return;
    }

    // Check for duplicate name
    const allApps = await window.api.apps.getAll();
    const duplicate = allApps.find(a =>
      a.name.toLowerCase() === state.name.trim().toLowerCase() &&
      (!isEdit || a.id !== existingApp?.id)
    );
    if (duplicate) {
      App.toast(t('apps.nameDuplicate').replace('{name}', state.name.trim()), 'error');
      return;
    }

    // Show confirmation modal with all details before proceeding
    await this.showWizardConfirmation(state, isEdit, existingApp, renderWizard);
  },

  async showWizardConfirmation(state, isEdit, existingApp, renderWizard) {
    const templates = await window.api.scripts.getTemplates();
    const config = await window.api.config.get().catch(() => ({}));
    const templateInfo = templates.find(tmpl => tmpl.id === state.template)
      || (state.templateDefinition ? { name: state.templateDefinition.name } : { name: state.template });

    const row = (label, value) => value ? `
      <div style="display:flex; justify-content:space-between; padding:10px 0; border-bottom:1px solid var(--border-color);">
        <span style="color:var(--text-muted); font-size:13px;">${label}</span>
        <span style="color:var(--text-primary); font-size:13px; font-weight:500; text-align:right; max-width:60%; word-break:break-all;">${value}</span>
      </div>` : '';

    const ouNameFromDN = (dn) => {
      const match = (dn || '').match(/^OU=([^,]+)/i);
      return match ? match[1] : dn;
    };

    const installerType = state.template === 'winget' ? 'WINGET'
      : state.template === 'odt' ? 'ODT'
      : AppUtils.getInstallerTypeFromPath(state.installerPath, state.template).toUpperCase();
    const sanitizedAppFolder = String(state.name || '').trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '');
    const wingetScriptPath = state.template === 'winget'
      ? (existingApp?.deployedPath
        || (config?.networkSharePath && sanitizedAppFolder
          ? config.networkSharePath.replace(/[\\/]+$/, '') + '\\' + sanitizedAppFolder + '\\install.ps1'
          : ''))
      : '';
    const gpoDisplay = state.createGPO
      ? `<span style="color:var(--primary-color);">&#10024; ${t('apps.confirmAutoGpo')}: Deploy_${App._esc(state.name.trim().replace(/\s/g, '_'))}</span>`
      : (state.gpoName ? App._esc(state.gpoName) : `<span style="color:var(--text-muted);">${t('apps.confirmNoGpo')}</span>`);

    const paramsHtml = state.customParams && Object.keys(state.customParams).length > 0
      ? Object.entries(state.customParams)
          .filter(([, v]) => v !== '' && v !== undefined && v !== null)
          .map(([k, v]) => row(App._esc(k), App._esc(String(v)))).join('')
      : '';
    const templateFilesHtml = state.templateFiles && Object.keys(state.templateFiles).length > 0
      ? Object.entries(state.templateFiles)
          .filter(([, v]) => (v?.sourcePath || v))
          .map(([k, v]) => row(App._esc(k), '<span style="font-family:monospace; font-size:12px;">' + App._esc(v?.sourcePath || v) + '</span>')).join('')
      : '';
    const showAdvancedConfirmation = !state.simpleModeFlow;

    const body = `
      <div style="display:flex; flex-direction:column; gap:14px;">
        <div style="padding:12px; background:rgba(30,144,255,0.08); border:1px solid rgba(30,144,255,0.2); border-radius:8px;">
          <p style="margin:0; color:var(--text-secondary); font-size:13px;">
            ${t('apps.confirmIntro')}
          </p>
        </div>

        <!-- Header -->
        <div style="display:flex; align-items:center; gap:12px;">
          <div style="width:44px; height:44px; border-radius:10px; background:var(--accent-primary-dim); display:flex; align-items:center; justify-content:center; font-size:24px;">
            ${AppUtils.templateIcon(state.template)}
          </div>
          <div>
            <div style="font-size:17px; font-weight:700; color:var(--text-primary);">${App._esc(state.name.trim())}</div>
            <div style="font-size:12px; color:var(--text-muted);">${App._esc(templateInfo.name)}</div>
          </div>
        </div>

        <!-- General -->
        <div class="card" style="padding:12px 16px; margin:0;">
          <div style="font-weight:600; font-size:13px; color:var(--text-secondary); margin-bottom:4px;">${t('apps.detailSectionGeneral')}</div>
          ${row(t('apps.detailTemplate'), App._esc(templateInfo.name))}
          ${state.template === 'winget'
            ? row(t('winget.scope'), App._esc(state.wingetScope === 'machine' ? t('winget.machine') : t('winget.user'))) + row(t('winget.repair'), state.wingetRepair ? t('common.yes') : t('common.no')) + row('Winget ID', `<code style="background:var(--bg-tertiary); padding:2px 6px; border-radius:4px; font-size:12px;">${App._esc(state.wingetId || '-')}</code>`)
            : state.template === 'odt'
              ? row('Producto ODT', `<code style="background:var(--bg-tertiary); padding:2px 6px; border-radius:4px; font-size:12px;">${App._esc((state.odtConfig?.product || 'O365BusinessRetail') + ' · ' + (state.odtConfig?.channel || 'MonthlyEnterprise'))}</code>`)
              : row(t('apps.detailInstallerType'), installerType)
          }
          ${(state.template !== 'winget' && state.template !== 'odt') ? row(t('apps.detailSilentArgs'), state.silentArgs ? '<code style="background:var(--bg-tertiary); padding:2px 6px; border-radius:4px; font-size:12px;">' + App._esc(state.silentArgs) + '</code>' : '-') : ''}
          ${showAdvancedConfirmation ? row(t('apps.uninstallMode', 'Modo de desinstalacion'), App._esc(AppUtils.getUninstallSummary({
            ...state,
            installerType: AppUtils.getInstallerTypeFromPath(state.installerPath, state.template),
            uninstall: {
              mode: state.uninstallMode,
              command: state.uninstallCommand,
              args: state.uninstallArgs,
              registryMatchName: state.uninstallRegistryName,
              registryMatchPublisher: state.uninstallRegistryPublisher,
              productCode: state.uninstallProductCode
            }
          }))) : ''}
          ${showAdvancedConfirmation ? row(t('apps.detailVersion'), App._esc(state.version || '1.0.0')) : ''}
          ${showAdvancedConfirmation ? row(t('apps.detailNotifyUser'), state.notifyUser ? '&#10003;' : '&#10007;') : ''}
        </div>

        <!-- Paths -->
        <div class="card" style="padding:12px 16px; margin:0;">
          <div style="font-weight:600; font-size:13px; color:var(--text-secondary); margin-bottom:4px;">${t('apps.detailSectionPaths')}</div>
          ${state.template === 'winget'
            ? row(t('apps.script'), wingetScriptPath ? '<span style="font-family:monospace; font-size:12px;">' + App._esc(wingetScriptPath) + '</span>' : '')
            : row(t('apps.detailInstaller'), state.installerPath ? '<span style="font-family:monospace; font-size:12px;">' + App._esc(state.installerPath) + '</span>' : '-')}
          ${state.configXmlPath ? row(t('apps.detailConfigXml'), '<span style="font-family:monospace; font-size:12px;">' + App._esc(state.configXmlPath) + '</span>') : ''}
          ${templateFilesHtml}
        </div>

        <!-- Targeting -->
        <div class="card" style="padding:12px 16px; margin:0;">
          <div style="font-weight:600; font-size:13px; color:var(--text-secondary); margin-bottom:4px;">${t('apps.detailSectionTargeting')}</div>
          ${row(t('apps.detailGpo'), gpoDisplay)}
          ${row(
            t('apps.detailAssignedOUs'),
            (state.selectedOUs && state.selectedOUs.length > 0)
              ? state.selectedOUs.map(dn => '<div title="' + App._esc(dn) + '" style="margin:2px 0;">' + App._esc(ouNameFromDN(dn)) + '</div>').join('')
              : '<span style="color:var(--text-muted);">' + t('apps.detailNoOUs') + '</span>'
          )}
        </div>

        ${paramsHtml ? `
        <div class="card" style="padding:12px 16px; margin:0;">
          <div style="font-weight:600; font-size:13px; color:var(--text-secondary); margin-bottom:4px;">${t('apps.detailSectionParams')}</div>
          ${paramsHtml}
        </div>
        ` : ''}
      </div>
    `;

    const footer = `
      <button class="btn btn-secondary" id="btn-confirm-back">${t('apps.back')}</button>
      <div style="flex:1"></div>
      <button class="btn btn-success" id="btn-confirm-create">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
        ${isEdit ? t('apps.saveAndDeploy') : t('apps.create')}
      </button>
    `;

    App.openModal(t('apps.confirmTitle'), body, footer);

    document.getElementById('btn-confirm-back').addEventListener('click', () => {
      // Re-render the wizard at step 4 preserving state
      if (typeof renderWizard === 'function') {
        renderWizard();
      } else {
        App.closeModal();
      }
    });

    document.getElementById('btn-confirm-create').addEventListener('click', () => {
      this.performWizardCreate(state, isEdit, existingApp);
    });
  },

  async performWizardCreate(state, isEdit, existingApp) {
    let createdAppId = null;
    const deployBtn = document.getElementById('btn-confirm-create');
    const backBtn   = document.getElementById('btn-confirm-back');
    try {
      if (deployBtn) {
        deployBtn.style.width = deployBtn.offsetWidth + 'px';
        deployBtn.style.height = deployBtn.offsetHeight + 'px';
        deployBtn.disabled = true;
        deployBtn.innerHTML = '<span class="spinner" style="width:14px;height:14px;display:inline-block;border-width:2px;"></span>';
      }
      if (backBtn) backBtn.disabled = true;

      const templateDefinition = await AppsPage.fetchTemplateDefinition(state.template);
      state.templateDefinition = templateDefinition || state.templateDefinition || null;
      const uninstallConfig = {
        mode: state.uninstallMode || AppUtils.getDefaultUninstallMode(
          state.template,
          state.installerPath,
          AppUtils.getInstallerTypeFromPath(state.installerPath, state.template)
        ),
        command: state.uninstallCommand || '',
        args: state.uninstallArgs || '',
        registryMatchName: state.uninstallRegistryName || state.name.trim(),
        registryMatchPublisher: state.uninstallRegistryPublisher || '',
        productCode: state.uninstallProductCode || ''
      };

      const appData = {
        name: state.name.trim(),
        template: state.template,
        wingetScope: state.wingetScope,
        wingetRepair: state.wingetRepair,
        installerType: AppUtils.getInstallerTypeFromPath(state.installerPath, state.template),
        silentArgs: state.silentArgs,
        installerPath: state.installerPath,
        configXmlPath: state.configXmlPath,
        customParams: state.customParams,
        templateFiles: state.templateFiles,
        templateDefinition: state.templateDefinition,
        gpoName: state.gpoName,
        ouDN: state.selectedOUs?.[0] || '',
        assignedOUs: Array.isArray(state.selectedOUs) ? state.selectedOUs : [],
        version: state.version || '1.0.0',
        notifyUser: state.notifyUser || false,
        uninstall: uninstallConfig,
        detection: state.detection || { type: 'tracker' },
        installerSignature: state.installerSignature
          ? { type: state.installerSignature.type, confidence: state.installerSignature.confidence, publisher: state.installerSignature.publisher || '' }
          : null,
        msiProductCode: state.msiProductCode || '',
        dependsOn: state.dependsOn && state.dependsOn.appId
          ? {
              appId: state.dependsOn.appId,
              appName: state.dependsOn.appName || '',
              timeoutMinutes: Number(state.dependsOn.timeoutMinutes) || 30,
              behavior: state.dependsOn.behavior === 'fail' ? 'fail' : 'skip'
            }
          : { appId: '', appName: '', timeoutMinutes: 0, behavior: 'skip' }
      };

      // Include wingetId for winget templates
      if (state.template === 'winget' && state.wingetId) {
        try {
          const resolvedWinget = await window.api.catalog.resolvePackage({
            wingetId: state.wingetId,
            wingetSource: state.wingetSource || 'winget',
            name: state.name.trim()
          });
          if (resolvedWinget?.available && resolvedWinget.wingetId) {
            appData.wingetId = state.wingetId;
            appData.wingetSource = state.wingetSource || 'winget';
            if (!state.version && resolvedWinget.latestVersion) {
              appData.version = resolvedWinget.latestVersion;
            }
          } else {
            appData.wingetId = state.wingetId;
            appData.wingetSource = state.wingetSource || 'winget';
          }
        } catch {
          appData.wingetId = state.wingetId;
          appData.wingetSource = state.wingetSource || 'winget';
        }
      }
      // Include odtConfig for ODT templates
      if (state.template === 'odt' && state.odtConfig) {
        appData.odtConfig = state.odtConfig;
      }

      let app;
      if (isEdit && existingApp) {
        app = await window.api.apps.update(existingApp.id, appData);
      } else {
        app = await window.api.apps.create(appData);
        if (app?.id) createdAppId = app.id;
      }

      if (!app || !app.id) {
        App.toast(t('common.error') + ': Failed to save app', 'error');
        return;
      }

      // Deploy script (Copies files to network share too)
      const deployResult = await window.api.scripts.deploy({
        ...appData,
        id: app.id
      });

      if (deployResult.success) {
        // Mark as deployed with hash for version tracking
        await window.api.apps.update(app.id, {
          deployed: true,
          deployedPath: deployResult.path,
          uninstallDeployedPath: deployResult.uninstallPath || '',
          lastDeployHash: deployResult.hash || '',
          publishedAction: 'install',
          publishedAt: new Date().toISOString()
        });
        // Log activity
        await window.api.activity.add(isEdit ? 'app_update' : 'app_create', {
          appName: state.name, version: state.version, template: state.template
        });
        App.toast(t('apps.appCreated'), 'success');
        App.toast(t('apps.deploySuccess'), 'success');

        // Create GPO automatically if chosen
        if (state.createGPO) {
          const newGpoName = `Deploy_${state.name.replace(/\s/g, "_")}`;
          await this._handleAutoGPO(newGpoName, deployResult.path, state.selectedOUs || [], app.id);
        } else if (state.gpoName && Array.isArray(state.selectedOUs) && state.selectedOUs.length > 0 && App.rsatAvailable) {
          // Existing GPO: link it to all selected OUs (already-linked ones are silently skipped by AD)
          try {
            const linkResults = await window.api.ad.bulkLinkGPO(state.gpoName, state.selectedOUs);
            const failed = (linkResults || []).filter(r => !r.success);
            if (failed.length > 0) {
              App.toast(`${t('apps.gpoWarningOnlyServer')} ${failed.map(r => r.error).join(', ')}`, 'warning');
            }
          } catch (e) { /* non-fatal â€” script is deployed even if link fails */ }
        }
      } else {
        if (App.isShareError(deployResult.error)) { App.handleShareError(); App.closeModal(); App.navigate('apps'); return; }
        App.toast(`${t('apps.appSavedDeployError')} ${deployResult.error}`, 'error');
      }

      App.closeModal();
      AppsListModule.setPendingFocus(app.id);
      App.navigate('apps');
    } catch (err) {
      if (deployBtn) {
        deployBtn.disabled = false;
        deployBtn.innerHTML = isEdit ? t('apps.saveAndDeploy') : t('apps.create');
        deployBtn.style.width = '';
        deployBtn.style.height = '';
      }
      if (backBtn) backBtn.disabled = false;
      if (!isEdit && createdAppId) {
        window.api.apps.delete(createdAppId, false).catch(() => {});
      }
      App.toast('Error: ' + err.message, 'error');
    }
  },

  copyScript() {
    const preview = document.getElementById('script-preview');
    if (preview) {
      navigator.clipboard.writeText(preview.textContent);
      App.toast(t('apps.scriptCopied'), 'success');
    }
  },

  // â”€â”€â”€ GPO conflict handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Called when "Create GPO automatically" is checked. If the GPO name already
  // exists in AD (and follows the program's naming convention), asks the user
  // what to do before proceeding.
  async _handleAutoGPO(gpoName, scriptPath, ouDNs, appId) {
    const isOwnGPO = /^(Deploy_|ADDM_)/.test(gpoName);

    // Check existence only for GPOs the program creates
    if (isOwnGPO && App.rsatAvailable) {
      let existsResult = { exists: false };
      try { existsResult = await window.api.ad.checkGPOExists(gpoName); } catch (e) {}

      if (existsResult.exists) {
        const choice = await new Promise(resolve => {
          App.openModal(
            t('apps.gpoConflictTitle') || 'GPO ya existe',
            `<div style="display:flex;flex-direction:column;gap:12px;">
              <div style="padding:12px;background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);border-radius:8px;font-size:13px;color:var(--text-secondary);">
                <strong style="color:var(--accent-warning);">&#9888;&#65039; ${App._esc(gpoName)}</strong><br>
                ${t('apps.gpoConflictBody') || 'Esta GPO ya existe en Active Directory. Fue creada por este programa.'}
              </div>
              <p style="font-size:13px;color:var(--text-muted);margin:0;">${t('apps.gpoConflictQuestion') || t('gui.whatWouldYouLikeToDo')}</p>
            </div>`,
            `<div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;">
              <button class="btn btn-secondary" id="_gpo-conflict-cancel">${t('common.cancel')}</button>
              <button class="btn btn-secondary" id="_gpo-conflict-update">${t('apps.gpoConflictUpdate') || t('gui.updateScript')}</button>
              <button class="btn btn-danger" id="_gpo-conflict-replace">${t('apps.gpoConflictReplace') || t('gui.deleteAndRecreate')}</button>
            </div>`
          );
          const pick = (val) => { App.closeModal(); resolve(val); };
          document.getElementById('_gpo-conflict-cancel').onclick  = () => pick('cancel');
          document.getElementById('_gpo-conflict-update').onclick  = () => pick('update');
          document.getElementById('_gpo-conflict-replace').onclick = () => pick('replace');
        });

        if (choice === 'cancel') {
          App.toast(t('apps.gpoConflictSkipped') || t('gui.gpoUnchanged'), 'info');
          return;
        }
        if (choice === 'replace') {
          App.toast(`${t('apps.gpoConflictDeleting') || t('gui.deletingGpo')} ${gpoName}...`, 'info');
          const delResult = await window.api.ad.deleteGPO(gpoName);
          if (!delResult.success) {
            App.toast(`${t('apps.gpoDeleteError') || 'Could not delete GPO:'} ${delResult.error}`, 'error');
            return;
          }
        }
        // 'update' or post-'replace' â†’ fall through to createGPO
      }
    }

    App.toast(`${t('apps.generatingGpo')} ${gpoName}...`, 'info');
    const gpoResult = await window.api.ad.createGPO(gpoName, scriptPath, ouDNs);
    if (gpoResult.success) {
      await window.api.apps.update(appId, { gpoName });
      App.toast(t('apps.gpoCreatedSuccess').replace('{gpo}', gpoName), 'success');
    } else {
      App.toast(`${t('apps.gpoWarningOnlyServer')} ${gpoResult.error}`, 'warning');
    }
  },

  async resolveCatalogPackageSelection(state, renderWizard, reference) {
    if (!reference?.wingetId) return;

    state._catalogResolutionToken = (state._catalogResolutionToken || 0) + 1;
    const token = state._catalogResolutionToken;
    const selectedVersion = String(reference.version || '');
    const selectedName = String(reference.name || '');
    const selectedSource = reference.wingetSource || 'winget';

    try {
      const resolved = await window.api.catalog.resolvePackage({
        wingetId: reference.wingetId,
        wingetSource: selectedSource,
        name: selectedName
      });

      if (state._catalogResolutionToken !== token) return;
      if (state.template !== 'winget') return;
      if (!resolved?.available || !resolved.wingetId) return;

      const currentKey = `${state.wingetId || ''}|${state.wingetSource || 'winget'}`;
      const originalKey = `${reference.wingetId || ''}|${selectedSource}`;
      const resolvedKey = `${resolved.wingetId || ''}|${resolved.wingetSource || selectedSource}`;
      if (currentKey !== originalKey && currentKey !== resolvedKey) return;

      const canReplaceName = !state.name || state.name === selectedName || state.name === 'Microsoft Office';
      const canReplaceVersion = !state.version || state.version === '1.0.0' || (selectedVersion && state.version === selectedVersion);

      state.wingetId = resolved.wingetId;
      state.wingetSource = resolved.wingetSource || selectedSource;
      if (canReplaceName && resolved.name) state.name = resolved.name;
      if (resolved.latestVersion && canReplaceVersion) state.version = resolved.latestVersion;

      if (state.step <= 2) renderWizard();
    } catch {
      // Non-blocking: keep the original catalog selection if resolution fails.
    }
  },

  showSilentArgsHelper(state, renderWizard) {
    const args = [
      { category: t('apps.argsCatMsi'), items: [
        { arg: '/qn', desc: t('apps.argsMsiQn') },
        { arg: '/qb', desc: t('apps.argsMsiQb') },
        { arg: '/qr', desc: t('apps.argsMsiQr') },
        { arg: '/norestart', desc: t('apps.argsMsiNoRestart') },
        { arg: '/passive', desc: t('apps.argsMsiPassive') },
        { arg: '/l*v "C:\\install.log"', desc: t('apps.argsMsiLog') },
        { arg: 'ALLUSERS=1', desc: t('apps.argsMsiAllUsers') },
        { arg: 'INSTALLDIR="C:\\Program Files\\App"', desc: t('apps.argsMsiInstallDir') },
        { arg: '/qn /norestart', desc: t('apps.argsMsiCombo') },
      ]},
      { category: t('apps.argsCatExe'), items: [
        { arg: '/S', desc: t('apps.argsExeNsis') },
        { arg: '/s', desc: t('apps.argsExeLower') },
        { arg: '/silent', desc: t('apps.argsExeInnoSilent') },
        { arg: '/verysilent', desc: t('apps.argsExeInnoVery') },
        { arg: '/SILENT /NORESTART', desc: t('apps.argsExeInnoCombo') },
        { arg: '/quiet', desc: t('apps.argsExeQuiet') },
        { arg: '/quiet /norestart', desc: t('apps.argsExeQuietCombo') },
        { arg: '-ms', desc: t('apps.argsExeMs') },
        { arg: '--silent --accept-license', desc: t('apps.argsExeAcceptLicense') },
      ]},
      { category: t('apps.argsCatSpecial'), items: [
        { arg: 'TRANSFORMS="config.mst"', desc: t('apps.argsSpecialMst') },
        { arg: '/extract:"C:\\temp"', desc: t('apps.argsSpecialExtract') },
        { arg: '/configure config.xml', desc: t('apps.argsSpecialOffice') },
      ]},
    ];

    const body = `
      <p style="color:var(--text-secondary);margin-bottom:16px;font-size:var(--font-sm);">${t('apps.clickToCopyArgs')}</p>
      ${args.map(cat => `
        <div style="margin-bottom:20px;">
          <div style="font-weight:600;color:var(--text-primary);margin-bottom:8px;font-size:var(--font-sm);text-transform:uppercase;letter-spacing:0.5px;">${cat.category}</div>
          <div style="display:flex;flex-direction:column;gap:4px;">
            ${cat.items.map(item => `
              <div class="args-helper-row" onclick="document.getElementById('_args_selected').value = '${item.arg.replace(/'/g, "\\'").replace(/"/g, '&quot;')}'; document.querySelectorAll('.args-helper-row').forEach(r=>r.style.background=''); this.style.background='var(--accent-primary-dim)';" style="display:flex;align-items:center;gap:12px;padding:8px 12px;border-radius:var(--radius-sm);cursor:pointer;transition:background 0.15s;">
                <code style="background:var(--bg-input);padding:4px 10px;border-radius:4px;font-size:var(--font-sm);color:var(--accent-secondary);white-space:nowrap;border:1px solid var(--border-color);">${App._esc(item.arg)}</code>
                <span style="font-size:var(--font-sm);color:var(--text-muted);">${item.desc}</span>
              </div>
            `).join('')}
          </div>
        </div>
      `).join('')}
      <input type="hidden" id="_args_selected" value="">
    `;

    App.openModal(t('apps.argsHelpTitle'), body, `
      <button class="btn btn-secondary" onclick="App.closeModal()">${t('common.cancel')}</button>
      <button class="btn btn-primary" id="btn-apply-arg">${t('apps.applyArg')}</button>
    `);

    document.getElementById('btn-apply-arg').addEventListener('click', () => {
      const selected = document.getElementById('_args_selected').value;
      if (selected) {
        state.silentArgs = selected;
        App.closeModal();
        renderWizard();
        App.toast(t('apps.argsCopied').replace('{arg}', selected), 'success');
      } else {
        App.toast(t('apps.selectArgWarning'), 'warning');
      }
    });
  }

};

window.AppsWizardModule = AppsWizardModule;
