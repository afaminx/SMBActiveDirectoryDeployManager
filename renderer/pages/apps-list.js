// =================================================================
// AppsListModule — Lista, grid, selección y operaciones bulk de apps
// Dependencias: AppApi, ScriptApi, UpdateApi, SettingsApi, GpoApi,
//               AdApi, AppUtils (window.*)
// Coordinador: AppsPage (apps.js) — todos los onclick usan AppsPage.*
// =================================================================

const AppsListModule = {

  _state: {
    selectedIds:              new Set(),
    viewMode:                 'grid',
    groupBy:                  'none',
    uiMode:                   'simple',
    scriptUpdatePollTimer:    null,
    scriptUpdatePollToken:    0,
    scriptUpdateModalVisible: false,
    pendingFocusAppId:        null,
    currentFilter:            'all'
  },

  // ─── Público ─────────────────────────────────────────────────

  isAdvancedUIMode() { return this._state.uiMode === 'advanced'; },
  isSimpleUIMode()   { return !this.isAdvancedUIMode(); },

  // Called by wizard after creating/editing an app so the new card scrolls into view.
  setPendingFocus(id) { this._state.pendingFocusAppId = id; },

  // ─── Render principal ─────────────────────────────────────────

  async render(container) {
    this.stopScriptUpdatePolling(false);

    const [apps, templates, scriptUpdateStatus, config] = await Promise.all([
      AppApi.getAll(),
      ScriptApi.getTemplates(),
      UpdateApi.getScriptStatus().catch(() => null),
      SettingsApi.getConfig().catch(() => ({}))
    ]);

    this._state.uiMode = String(config?.uiMode || '').trim().toLowerCase() === 'advanced'
      ? 'advanced' : 'simple';

    const deployedCount = apps.filter(a => a.deployed !== false && a.deployedPath).length;
    const pendingCount  = apps.length - deployedCount;

    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1>
            <span class="header-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
            </span>
            ${t('apps.title')}
          </h1>
          <p class="page-subtitle">${t('apps.subtitle')}</p>
        </div>
        <div style="display:flex;gap:8px;">
          ${this.isAdvancedUIMode() ? `
            <button class="btn btn-secondary" id="btn-manage-templates">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z"/><path d="M12 12l8-4.5"/><path d="M12 12v9"/><path d="M12 12L4 7.5"/></svg>
              ${t('apps.manageTemplates', 'Plantillas')}
            </button>
          ` : ''}
          <button class="btn btn-secondary" id="btn-check-updates">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.2-8.55"/><polyline points="21 4 21 10 15 10"/></svg>
            ${t('apps.checkUpdates')}
          </button>
          <button class="btn btn-primary" id="btn-new-app">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            ${t('apps.newApp')}
          </button>
        </div>
      </div>

      <div class="apps-toolbar">
        <div class="apps-counters">
          <div class="apps-counter" data-filter="all">
            <span class="apps-counter-value">${apps.length}</span>
            <span class="apps-counter-label">Total</span>
          </div>
          <div class="apps-counter" data-filter="deployed">
            <span class="apps-counter-dot deployed"></span>
            <span class="apps-counter-value">${deployedCount}</span>
            <span class="apps-counter-label">${t('apps.deployedBadge')}</span>
          </div>
          <div class="apps-counter" data-filter="pending">
            <span class="apps-counter-dot pending"></span>
            <span class="apps-counter-value">${pendingCount}</span>
            <span class="apps-counter-label">${t('apps.detailNotDeployed')}</span>
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:var(--space-sm); flex:1; justify-content:flex-end;">
          <div style="position:relative; min-width:180px; max-width:280px; flex:1;">
            <svg style="position:absolute;left:10px;top:50%;transform:translateY(-50%);pointer-events:none;opacity:.4" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="text" class="form-input" id="apps-search" placeholder="${t('ous.searchApps')}" autocomplete="off" style="padding-left:34px;">
          </div>
          <select class="form-select" id="apps-group-by" style="width:auto; padding:6px 30px 6px 10px; min-width:120px;">
            <option value="none"     ${this._state.groupBy === 'none'     ? 'selected' : ''}>${t('apps.noGroup')        || t('gui.ungrouped')}</option>
            <option value="template" ${this._state.groupBy === 'template' ? 'selected' : ''}>${t('apps.groupByTemplate') || t('gui.byTemplate')}</option>
          </select>
          <div class="view-toggle">
            <button class="view-toggle-btn ${this._state.viewMode === 'grid' ? 'active' : ''}" data-view="grid" title="${t('gui.grid')}">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
            </button>
            <button class="view-toggle-btn ${this._state.viewMode === 'list' ? 'active' : ''}" data-view="list" title="Lista">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
            </button>
          </div>
        </div>
      </div>

      <div class="action-bar" id="bulk-action-bar">
        <div style="display:flex; align-items:center; gap:16px;">
          <span class="action-bar-text"><span id="selected-count">0</span> ${t('apps.selected')}</span>
          <button class="btn btn-ghost btn-sm" id="btn-select-all" onclick="AppsPage.selectAll()">${t('apps.filterAll')}</button>
        </div>
        <div class="action-bar-buttons" style="display:flex; gap:10px; align-items:center;">
          <select class="form-select" id="bulk-gpo-select" style="width:200px; padding:6px 10px;">
            <option value="">${t('apps.selectGpo')}</option>
          </select>
          <button class="btn btn-primary btn-sm" id="btn-bulk-gpo">${t('apps.deploy')}</button>
          <button class="btn btn-warning btn-sm" id="btn-bulk-disable">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
            ${t('apps.disable') || 'Deshabilitar'}
          </button>
          <button class="btn btn-danger btn-sm" id="btn-bulk-delete">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            ${t('common.delete') || 'Borrar'}
          </button>
          <button class="btn btn-ghost btn-sm" id="btn-clear-selection">${t('apps.cancel')}</button>
        </div>
      </div>

      <div id="apps-updates-panel" style="display:none;margin-bottom:var(--space-md);"></div>

      <div class="app-grid ${this._state.viewMode === 'list' ? 'list-view' : ''}" id="apps-grid">
        ${apps.length === 0 ? `
          <div class="empty-state" style="grid-column: 1/-1;">
            <div class="empty-state-icon">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
            </div>
            <p class="empty-state-title">${t('apps.noAppsConfigured')}</p>
            <p class="empty-state-text">${t('apps.clickNewApp')}</p>
            <button class="btn btn-primary" onclick="AppsPage.openWizard()">${t('apps.newApp')}</button>
          </div>
        ` : this._renderGroupedApps(apps, templates)}
      </div>
    `;

    this._state.selectedIds.clear();
    this._state.currentFilter = 'all';

    document.getElementById('btn-new-app').addEventListener('click', () => AppsPage.openWizard());
    document.getElementById('btn-manage-templates')?.addEventListener('click', () => AppsPage.openTemplateManager());
    document.getElementById('btn-check-updates')?.addEventListener('click', () => AppsPage.checkUpdates());
    document.getElementById('btn-bulk-gpo').addEventListener('click', () => this.bulkAssignGPO());
    document.getElementById('btn-bulk-delete')?.addEventListener('click', () => this.bulkDelete());
    document.getElementById('btn-bulk-disable')?.addEventListener('click', () => this.bulkDisable());
    document.getElementById('btn-clear-selection').addEventListener('click', () => this.clearSelection());

    document.querySelectorAll('.view-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._state.viewMode = btn.dataset.view;
        document.querySelectorAll('.view-toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const grid = document.getElementById('apps-grid');
        grid.classList.toggle('list-view', this._state.viewMode === 'list');
      });
    });

    document.getElementById('apps-group-by')?.addEventListener('change', (e) => {
      this._state.groupBy = e.target.value;
      App.navigate('apps');
    });

    document.querySelectorAll('.apps-counter').forEach(ctr => {
      ctr.addEventListener('click', () => {
        const filter = ctr.dataset.filter;
        this._state.currentFilter = filter;
        document.querySelectorAll('.apps-counter').forEach(c => c.classList.remove('active'));
        ctr.classList.add('active');
        const grid = document.getElementById('apps-grid');
        grid.querySelectorAll('.app-card').forEach(card => {
          const isDeployed = card.dataset.deployed === 'true';
          if (filter === 'all')      card.style.display = '';
          else if (filter === 'deployed') card.style.display = isDeployed  ? '' : 'none';
          else if (filter === 'pending')  card.style.display = !isDeployed ? '' : 'none';
        });
      });
    });
    document.querySelector('.apps-counter[data-filter="all"]')?.classList.add('active');

    document.getElementById('apps-search').addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      const grid = document.getElementById('apps-grid');
      let anyVisible = false;
      grid.querySelectorAll('.app-card').forEach(card => {
        const name = card.querySelector('.app-card-name')?.textContent.toLowerCase() || '';
        const tmpl = card.querySelector('.app-card-template')?.textContent.toLowerCase() || '';
        const matches = !q || name.includes(q) || tmpl.includes(q);
        card.style.display = matches ? '' : 'none';
        if (matches) anyVisible = true;
      });
      let noMatch = grid.querySelector('.search-no-match');
      if (!anyVisible && q) {
        if (!noMatch) {
          noMatch = document.createElement('p');
          noMatch.className = 'search-no-match';
          noMatch.style.cssText = 'grid-column:1/-1;text-align:center;color:var(--text-muted);padding:40px 0;';
          noMatch.textContent = t('ous.noAppsMatch');
          grid.appendChild(noMatch);
        }
      } else if (noMatch) {
        noMatch.remove();
      }
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.app-card-menu')) {
        document.querySelectorAll('.app-card-dropdown.visible').forEach(d => d.classList.remove('visible'));
      }
    });

    this.loadGPOsForBulk();

    if (this._state.pendingFocusAppId) {
      const focusId = this._state.pendingFocusAppId;
      this._state.pendingFocusAppId = null;
      this.keepAppCardVisible(focusId);
    }

    this.syncScriptUpdateState(scriptUpdateStatus);
  },

  // ─── Tarjeta de app ──────────────────────────────────────────

  renderAppCard(app, templates) {
    const templateInfo      = templates.find(tmpl => tmpl.id === app.template) || { name: app.templateDefinition?.name || app.template };
    const isDeployed        = app.deployed !== false && app.deployedPath;
    const canUninstall      = AppUtils.canGenerateUninstall(app);
    const publishedAction   = AppUtils.getPublishedAction(app);
    const statusClass       = AppUtils.getDeploymentVisualState(app);
    const statusText        = AppUtils.getDeploymentStatusLabel(app);
    const canPublishUninstall = isDeployed && publishedAction !== 'uninstall';
    const installActionLabel  = AppUtils.getInstallActionLabel(app);
    const icon              = AppUtils.templateIcon(app.template);
    return `
      <div class="app-card app-card--${statusClass} ${this._state.selectedIds?.has(app.id) ? 'selected' : ''}" data-id="${app.id}" data-deployed="${!!isDeployed}" onclick="AppsPage.showAppDetail('${app.id}')">
        <input type="checkbox" class="checkbox-select app-card-cb" data-id="${app.id}" onchange="AppsPage.toggleSelect('${app.id}', this.checked)" onclick="event.stopPropagation()" ${this._state.selectedIds?.has(app.id) ? 'checked' : ''}>
        <div class="app-card-top">
          <div class="app-card-icon">${icon}</div>
          <div class="app-card-info">
            <div class="app-card-name">${App._esc(app.name)}</div>
            <div class="app-card-template">${App._esc(templateInfo.name)}</div>
          </div>
        </div>
        <div class="app-card-badges">
          <span class="badge badge-info app-card-version">v${App._esc(app.version || '1.0.0')}</span>
          ${statusClass === 'uninstalling' ? `<span class="badge badge-warning">${t('apps.uninstallPublished', 'Desinstalacion')}</span>` : ''}
          ${app.gpoName ? `<span class="badge badge-info" title="GPO">${App._esc(app.gpoName)}</span>` : ''}
          ${(() => { const n = Array.isArray(app.assignedOUs) ? app.assignedOUs.length : (app.ouDN ? 1 : 0); return n > 0 ? `<span class="badge badge-neutral" title="${t('apps.detailAssignedOUs')}">&#127970; ${n} OU${n > 1 ? 's' : ''}</span>` : ''; })()}
        </div>
        <div class="app-card-footer" onclick="event.stopPropagation()">
          <div class="app-card-deploy-info">
            <span class="app-status-label ${statusClass}">${statusText}</span>
          </div>
          <div class="app-card-menu">
            <button class="app-card-menu-btn" onclick="event.stopPropagation(); AppsPage.toggleMenu(this)" title="${t('apps.edit')}">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
            </button>
            <div class="app-card-dropdown">
              <button class="dropdown-item" onclick="AppsPage.showAppDetail('${app.id}')">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                ${t('common.details') || 'Ver detalles'}
              </button>
              <button class="dropdown-item" onclick="AppsPage.previewScript('${app.id}')">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                ${t('apps.script')}
              </button>
              ${canUninstall ? `
                <button class="dropdown-item" onclick="AppsPage.previewUninstallScript('${app.id}')">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  ${t('apps.uninstallScript', 'Script uninstall')}
                </button>
              ` : ''}
              ${isDeployed ? `
                ${canPublishUninstall && app.template === 'winget' ? `
                <button class="dropdown-item" onclick="AppsPage.wingetUpdateDialog('${app.id}')">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.2-8.55"/><polyline points="21 4 21 10 15 10"/></svg>
                  ${t('apps.checkUpdates')}
                </button>
                ` : (canPublishUninstall ? `
                <button class="dropdown-item" onclick="AppsPage.quickUpdate('${app.id}')">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.2-8.55"/><polyline points="21 4 21 10 15 10"/></svg>
                  ${t('apps.quickUpdate')}
                </button>
                ` : '')}
                <button class="dropdown-item" onclick="AppsPage.regenerateScripts('${app.id}')">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
                  ${t('apps.regenerateScripts', 'Regenerar scripts')}
                </button>
                ${canPublishUninstall && canUninstall ? `
                  <button class="dropdown-item dropdown-item--warning" onclick="AppsPage.uninstallApp('${app.id}')">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    ${t('apps.uninstallAction', 'Desinstalar')}
                  </button>
                ` : ''}
                ${publishedAction === 'uninstall' ? `
                  <button class="dropdown-item dropdown-item--success" onclick="AppsPage.deployApp('${app.id}')">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                    ${installActionLabel}
                  </button>
                ` : ''}
                <button class="dropdown-item dropdown-item--warning" onclick="AppsPage.disableDeploy('${app.id}')">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
                  ${t('apps.disable')}
                </button>
              ` : `
                <button class="dropdown-item dropdown-item--success" onclick="AppsPage.deployApp('${app.id}')">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                  ${installActionLabel}
                </button>
              `}
              <button class="dropdown-item" onclick="AppsPage.editApp('${app.id}')">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                ${t('apps.edit')}
              </button>
              <div class="dropdown-divider"></div>
              <button class="dropdown-item dropdown-item--danger" onclick="AppsPage.deleteApp('${app.id}')">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                ${t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  },

  toggleMenu(btn) {
    this._closeFloatingMenu?.();
    const dropdown = btn.nextElementSibling.cloneNode(true);
    dropdown.classList.add('app-card-dropdown--floating');
    dropdown.classList.add('visible');
    const rect = btn.getBoundingClientRect();
    dropdown.style.position = 'fixed';
    dropdown.style.margin = '0';
    dropdown.style.right = 'auto';
    dropdown.style.minWidth = '0';
    dropdown.style.width = Math.min(190, Math.max(0, window.innerWidth - 16)) + 'px';
    dropdown.style.boxSizing = 'border-box';
    dropdown.style.maxHeight = Math.max(0, window.innerHeight - 16) + 'px';
    dropdown.style.overflowY = 'auto';
    dropdown.style.zIndex   = '9999';
    document.body.appendChild(dropdown);
    const size = dropdown.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const openAbove = size.height > below && above > below;
    const top = openAbove ? rect.top - size.height - 4 : rect.bottom + 4;
    dropdown.style.top = Math.max(8, Math.min(top, window.innerHeight - size.height - 8)) + 'px';
    dropdown.style.left = Math.max(8, Math.min(rect.right - size.width, window.innerWidth - size.width - 8)) + 'px';
    const cleanup = () => {
      dropdown.remove();
      document.removeEventListener('click', close, true);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', cleanup);
      if (this._closeFloatingMenu === cleanup) this._closeFloatingMenu = null;
    };
    const close = (e) => {
      if (!dropdown.contains(e.target) && !btn.contains(e.target)) cleanup();
    };
    const onScroll = e => { if (!dropdown.contains(e.target)) cleanup(); };
    this._closeFloatingMenu = cleanup;
    document.addEventListener('click', close, true);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', cleanup);
  },

  _renderGroupedApps(apps, templates) {
    if (this._state.groupBy === 'none') {
      return apps.map(app => this.renderAppCard(app, templates)).join('');
    }
    const groups = {};
    const tmplMap = {};
    templates.forEach(tmpl => { tmplMap[tmpl.id] = tmpl; });
    apps.forEach(app => {
      const tmpl = tmplMap[app.template] || {};
      const cat  = tmpl.category || tmpl.name || app.template || 'General';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(app);
    });
    return Object.keys(groups).sort().map(cat => {
      const catApps = groups[cat];
      return `
        <div class="app-folder-header" onclick="AppsPage.toggleFolder(this)">
          <div class="app-folder-toggle">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
          </div>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          <span class="app-folder-name">${App._esc(cat)}</span>
          <span class="app-folder-count">${catApps.length}</span>
        </div>
        ${catApps.map(app => this.renderAppCard(app, templates)).join('')}
      `;
    }).join('');
  },

  toggleFolder(header) {
    const toggle      = header.querySelector('.app-folder-toggle');
    const isCollapsing = !toggle.classList.contains('collapsed');
    toggle.classList.toggle('collapsed');
    let sibling = header.nextElementSibling;
    while (sibling && !sibling.classList.contains('app-folder-header')) {
      sibling.style.display = isCollapsing ? 'none' : '';
      sibling = sibling.nextElementSibling;
    }
  },

  keepAppCardVisible(id) {
    if (!id) return;
    requestAnimationFrame(() => {
      const card = document.querySelector(`.app-card[data-id="${id}"]`);
      if (card) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  },

  // ─── Script-update polling ────────────────────────────────────

  stopScriptUpdatePolling(closeModal = true) {
    if (this._state.scriptUpdatePollTimer) {
      clearTimeout(this._state.scriptUpdatePollTimer);
      this._state.scriptUpdatePollTimer = null;
    }
    this._state.scriptUpdatePollToken += 1;
    if (closeModal) this.closeScriptUpdateModal();
  },

  closeScriptUpdateModal() {
    if (!this._state.scriptUpdateModalVisible) return;
    this._state.scriptUpdateModalVisible = false;
    App.closeModal();
  },

  getScriptUpdateModalContent(status = {}) {
    const title         = t('apps.scriptUpdateTitle', 'Actualizando scripts');
    const isScanning    = status.status === 'scanning';
    const total         = Number(status?.progress?.total)     || 0;
    const completed     = Number(status?.progress?.completed) || 0;
    const updated       = Number(status?.progress?.updated)   || 0;
    const currentAppName = typeof status.currentAppName === 'string' ? status.currentAppName.trim() : '';
    const headline      = isScanning
      ? t('apps.scriptUpdateScanning',    'Comprobando scripts desplegados...')
      : t('apps.scriptUpdateInProgress',  'Los scripts se están actualizando...');
    const detail        = isScanning
      ? t('apps.scriptUpdateScanningHint', 'Estamos revisando si hay scripts generados con una versión anterior de la app.')
      : t('apps.scriptUpdateBusyHint',     'Esta vista se desbloqueará automáticamente cuando termine la regeneración.');
    const progressText  = total > 0
      ? t('apps.scriptUpdateProgress', '{done} de {total} apps procesadas').replace('{done}', String(completed)).replace('{total}', String(total))
      : '';
    const updatedText   = total > 0
      ? t('apps.scriptUpdateUpdatedCount', '{count} scripts regenerados').replace('{count}', String(updated))
      : '';
    const currentAppText = currentAppName
      ? t('apps.scriptUpdateCurrentApp', 'App actual: {app}').replace('{app}', currentAppName)
      : '';
    return {
      title,
      body: `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;min-height:180px;text-align:center;">
          <span class="spinner" style="width:28px;height:28px;border-width:3px;flex-shrink:0;"></span>
          <div style="font-size:15px;font-weight:700;color:var(--text-primary);">${App._esc(headline)}</div>
          <p style="margin:0;max-width:420px;color:var(--text-secondary);font-size:13px;line-height:1.5;">${App._esc(detail)}</p>
          ${progressText ? `<div style="display:flex;flex-direction:column;gap:4px;padding:12px 14px;border:1px solid var(--border-color);border-radius:10px;background:var(--bg-secondary);min-width:280px;">
            <span style="font-size:13px;font-weight:600;color:var(--text-primary);">${App._esc(progressText)}</span>
            ${updatedText    ? `<span style="font-size:12px;color:var(--text-muted);">${App._esc(updatedText)}</span>`    : ''}
            ${currentAppText ? `<span style="font-size:12px;color:var(--text-secondary);">${App._esc(currentAppText)}</span>` : ''}
          </div>` : ''}
        </div>
      `
    };
  },

  renderScriptUpdateModal(status = {}) {
    const modal = this.getScriptUpdateModalContent(status);
    if (!this._state.scriptUpdateModalVisible) {
      App.openModalLocked(modal.title, modal.body, '');
      this._state.scriptUpdateModalVisible = true;
      return;
    }
    document.getElementById('modal-title').textContent = modal.title;
    document.getElementById('modal-body').innerHTML    = modal.body;
    document.getElementById('modal-footer').innerHTML  = '';
  },

  syncScriptUpdateState(status = null) {
    if (!status?.running) {
      this.stopScriptUpdatePolling(true);
      return;
    }
    this.renderScriptUpdateModal(status);
    const pollToken = ++this._state.scriptUpdatePollToken;
    const poll = async () => {
      if (pollToken !== this._state.scriptUpdatePollToken) return;
      if (App.currentPage !== 'apps') { this.stopScriptUpdatePolling(true); return; }
      const nextStatus = await UpdateApi.getScriptStatus().catch(() => null);
      if (pollToken !== this._state.scriptUpdatePollToken) return;
      if (nextStatus?.running) {
        this.renderScriptUpdateModal(nextStatus);
        this._state.scriptUpdatePollTimer = setTimeout(poll, 1000);
        return;
      }
      this._state.scriptUpdatePollTimer = null;
      this.closeScriptUpdateModal();
      if (App.currentPage === 'apps') App.navigate('apps');
    };
    this._state.scriptUpdatePollTimer = setTimeout(poll, 1000);
  },

  // ─── Selección ───────────────────────────────────────────────

  toggleSelect(id, checked) {
    if (checked) this._state.selectedIds.add(id); else this._state.selectedIds.delete(id);
    const card = document.querySelector(`.app-card[data-id="${id}"]`);
    if (card) card.classList.toggle('selected', this._state.selectedIds.has(id));
    this.updateBulkBar();
  },

  clearSelection() {
    this._state.selectedIds.clear();
    document.querySelectorAll('#apps-grid .app-card').forEach(c => {
      c.classList.remove('selected');
      const cb = c.querySelector('.checkbox-select');
      if (cb) cb.checked = false;
    });
    this.updateBulkBar();
  },

  selectAll() {
    document.querySelectorAll('#apps-grid .app-card').forEach(card => {
      if (card.style.display !== 'none') {
        this._state.selectedIds.add(card.dataset.id);
        card.classList.add('selected');
        const cb = card.querySelector('.checkbox-select');
        if (cb) cb.checked = true;
      }
    });
    this.updateBulkBar();
  },

  toggleSelectAll(checked) {
    document.querySelectorAll('#apps-grid .app-card').forEach(card => {
      if (card.style.display !== 'none') {
        const cb = card.querySelector('.checkbox-select');
        if (checked) {
          this._state.selectedIds.add(card.dataset.id);
          card.classList.add('selected');
          if (cb) cb.checked = true;
        } else {
          this._state.selectedIds.delete(card.dataset.id);
          card.classList.remove('selected');
          if (cb) cb.checked = false;
        }
      }
    });
    this.updateBulkBar();
  },

  updateBulkBar() {
    const bar   = document.getElementById('bulk-action-bar');
    const count = this._state.selectedIds.size;
    const countEl = document.getElementById('selected-count');
    if (countEl) countEl.textContent = count;
    if (bar) bar.classList.toggle('visible', count > 0);

    const selectAllBtn = document.getElementById('btn-select-all');
    if (selectAllBtn) {
      const visibleCards = Array.from(document.querySelectorAll('#apps-grid .app-card')).filter(c => c.style.display !== 'none');
      const total = visibleCards.length;
      if (count === total && total > 0) {
        selectAllBtn.style.display = 'none';
      } else {
        selectAllBtn.style.display = '';
        selectAllBtn.textContent   = `${t('apps.filterAll')} (${total})`;
      }
    }

    const deployBtn = document.getElementById('btn-bulk-gpo');
    if (deployBtn) {
      deployBtn.textContent = count > 0
        ? `Aplicar ${count} Cambios Pendientes`
        : (t('apps.deploy') || 'Desplegar');
    }
  },

  // ─── Bulk GPO select ─────────────────────────────────────────

  async loadGPOsForBulk() {
    try {
      const [apps, cfg] = await Promise.all([
        AppApi.getAll().catch(() => []),
        SettingsApi.getConfig().catch(() => ({}))
      ]);
      const programGPOs = [...new Set([
        ...apps.filter(a => a.gpoName).map(a => a.gpoName),
        cfg.defaultGPO || null
      ].filter(Boolean))];
      const select = document.getElementById('bulk-gpo-select');
      if (select) {
        select.innerHTML = `<option value="">${t('apps.selectGpo')}</option>`;
        programGPOs.forEach(gpoName => {
          const opt = document.createElement('option');
          opt.value       = gpoName;
          opt.textContent = gpoName;
          select.appendChild(opt);
        });
      }
    } catch (e) {}
  },

  // ─── Operaciones bulk ────────────────────────────────────────

  async bulkAssignGPO() {
    const gpoName = document.getElementById('bulk-gpo-select').value;
    if (!gpoName) { App.toast(t('apps.selectGpoFirst'), 'warning'); return; }
    if (this._state.selectedIds.size === 0) return;
    try {
      const ids = Array.from(this._state.selectedIds);
      await AppApi.bulkAssignGPO(ids, gpoName);
      App.toast(t('apps.gpoAssignedBulk').replace('{gpo}', gpoName).replace('{count}', ids.length), 'success');
      if (App.rsatAvailable) {
        try {
          const allApps = await AppApi.getAll();
          const ouSet   = new Set();
          allApps.filter(a => ids.includes(a.id)).forEach(a => {
            const ous = Array.isArray(a.assignedOUs) ? a.assignedOUs : (a.ouDN ? [a.ouDN] : []);
            ous.forEach(ou => ou && ouSet.add(ou));
          });
          if (ouSet.size > 0) await GpoApi.bulkLink(gpoName, Array.from(ouSet));
        } catch (e) { /* non-fatal */ }
      }
      this.clearSelection();
      App.navigate('apps');
    } catch (err) {
      App.toast('Error: ' + err.message, 'error');
    }
  },

  async bulkDisable() {
    if (this._state.selectedIds.size === 0) return;
    try {
      const ids = Array.from(this._state.selectedIds);
      for (const id of ids) {
        const app = await AppApi.get(id);
        if (app && app.deployed) {
          await AppApi.update(id, { ...app, deployed: false, publishedAction: 'pending', publishedAt: '' });
        }
      }
      App.toast(t('apps.bulkDisableSuccess') || `Deshabilitadas ${ids.length} apps correctamente`, 'success');
      this.clearSelection();
      App.navigate('apps');
    } catch (err) {
      App.toast('Error: ' + err.message, 'error');
    }
  },

  async bulkDelete() {
    if (this._state.selectedIds.size === 0) return;
    const ids      = Array.from(this._state.selectedIds);
    const apps     = await Promise.all(ids.map(id => AppApi.get(id)));
    const validApps   = apps.filter(Boolean);
    const appsWithGPO = validApps.filter(a => a.gpoName);

    const listHtml = validApps.map(a => `
      <div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--bg-tertiary);border-radius:6px;">
        <span style="font-size:18px;">${AppUtils.templateIcon(a.template)}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${App._esc(a.name)}</div>
          ${a.gpoName ? `<div style="font-size:11px;color:var(--text-muted);">GPO: ${App._esc(a.gpoName)}</div>` : ''}
        </div>
      </div>`).join('');

    const { confirmed, adCleanup, deleteFiles } = await new Promise(resolve => {
      App.openModal(
        t('apps.bulkDeleteTitle'),
        `<div style="display:flex;flex-direction:column;gap:12px;">
          <div style="padding:10px 14px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:8px;font-size:13px;color:var(--text-secondary);">
            <strong style="color:var(--accent-danger);">&#9888;&#65039; ${t('apps.bulkDeleteWarning').replace('{count}', validApps.length)}</strong>
          </div>
          <div style="display:flex;flex-direction:column;gap:6px;max-height:200px;overflow-y:auto;">${listHtml}</div>
          <label style="display:flex;align-items:flex-start;gap:10px;padding:10px 14px;background:var(--bg-secondary);border-radius:8px;cursor:pointer;border:1px solid var(--border-color);">
            <input type="checkbox" id="_bulk-del-files" style="margin-top:2px;flex-shrink:0;" checked>
            <div>
              <div style="font-size:13px;font-weight:600;color:var(--text-primary);">${t('apps.bulkDeleteCleanFiles') || t('gui.deleteTheFolderOnTheNetworkShare')}</div>
              <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${t('apps.bulkDeleteCleanFilesHint') || t('gui.deleteInstallPs1VersionJsonAndInstallersFrom')}</div>
            </div>
          </label>
          ${appsWithGPO.length > 0 ? `
          <label style="display:flex;align-items:flex-start;gap:10px;padding:10px 14px;background:var(--bg-secondary);border-radius:8px;cursor:pointer;border:1px solid var(--border-color);">
            <input type="checkbox" id="_bulk-del-gpo" style="margin-top:2px;flex-shrink:0;" checked>
            <div>
              <div style="font-size:13px;font-weight:600;color:var(--text-primary);">${t('apps.bulkDeleteCleanGpo')}</div>
              <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${appsWithGPO.map(a => App._esc(a.gpoName)).join(', ')}</div>
            </div>
          </label>` : ''}
        </div>`,
        `<div style="display:flex;gap:8px;justify-content:flex-end;">
          <button class="btn btn-secondary" id="_bulk-del-cancel">${t('common.cancel')}</button>
          <button class="btn btn-danger" id="_bulk-del-confirm">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:6px;"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            ${t('apps.bulkDeleteConfirm').replace('{count}', validApps.length)}
          </button>
        </div>`
      );
      document.getElementById('_bulk-del-cancel').onclick  = () => { App.closeModal(); resolve({ confirmed: false }); };
      document.getElementById('_bulk-del-confirm').onclick = () => {
        const cbGpo   = document.getElementById('_bulk-del-gpo');
        const cbFiles = document.getElementById('_bulk-del-files');
        App.closeModal();
        resolve({ confirmed: true, adCleanup: cbGpo ? cbGpo.checked : false, deleteFiles: cbFiles ? cbFiles.checked : true });
      };
    });

    if (!confirmed) return;

    App.toast(t('apps.bulkDeleting').replace('{count}', validApps.length), 'info');
    try {
      let successCount = 0;
      for (const app of validApps) {
        if (adCleanup && app.gpoName) {
          try { await GpoApi.delete(app.gpoName); } catch (e) { console.warn('GPO cleanup failed for', app.gpoName); }
        }
        await AppApi.delete(app.id, deleteFiles);
        successCount++;
      }
      App.toast(t('apps.bulkDeleteSuccess').replace('{count}', successCount), 'success');
      this.clearSelection();
      App.navigate('apps');
    } catch (err) {
      App.toast('Error: ' + err.message, 'error');
    }
  }

};

window.AppsListModule = AppsListModule;
