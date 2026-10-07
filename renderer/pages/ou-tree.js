// ═══════════════════════════════════════════════════════
// ou-tree.js — OUsPage: state, entry point, data loading,
//              OU tree rendering, search, expand/collapse,
//              multi-select, context menu.
//
// Loaded first. ou-assignments.js and ou-gpo-modal.js extend
// OUsPage via Object.assign after this file.
// ═══════════════════════════════════════════════════════

const OUsPage = {
  // ─── State ───────────────────────────────────────────
  state: {
    view: 'tree',                 // 'tree' | 'assignments'
    treeData: [],
    flatOUs: [],
    apps: [],
    selectedOUs: [],              // DNs for tree multi-select
    ouSearch: '',
    appSearch: '',
    // Pending: key = `${appId}::${ouDN}`, value = 'assign' | 'unassign'
    pending: new Map(),
    // Sync drift: ouDN -> [{ gpoName, reason }]
    syncWarnings: new Map(),
    managedRealLinks: {},
    // { [ouDN]: { direct, descendant } } — descendant excludes direct
    assignmentCounts: {},
    // IDs of apps whose gpoName no longer exists in AD
    orphanGPOAppIds: new Set(),

    loading: false,
    lastExpandedOUs: new Set(),
    // Assignments (matrix) view: which OUs the user picked to display
    assignmentOUs: [],            // ordered array of dn strings
    assignmentOUSearch: '',       // search inside the picker
    pickerOpen: false             // true = show OU picker step
  },

  // ─── Entry point ─────────────────────────────────────
  async render(container) {
    this.container = container;
    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1>
            <span class="header-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            </span>
            ${t('ous.title')}
          </h1>
          <p class="page-subtitle">${t('ous.subtitle')}</p>
        </div>
        <div class="flex gap-sm" style="flex-shrink:0;align-items:center;">
          <div class="view-toggle" id="ous-view-toggle">
            <button class="view-toggle-btn ${this.state.view === 'tree' ? 'active' : ''}" data-view="tree">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z"/></svg>
              ${t('ous.treeView')}
            </button>
            <button class="view-toggle-btn ${this.state.view === 'assignments' ? 'active' : ''}" data-view="assignments">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/></svg>
              ${t('ous.assignmentsView')}
            </button>
          </div>
          <button class="btn btn-secondary" id="btn-refresh-ous">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            ${t('ous.refresh')}
          </button>
        </div>
      </div>

      ${App.rsatWarningHTML()}

      <div id="ous-stats-bar" class="ous-stats-bar"></div>
      <div id="ous-main-area"></div>
      <div id="ous-pending-bar" class="ous-pending-bar hidden"></div>
    `;

    document.getElementById('btn-refresh-ous').addEventListener('click', () => this.loadData());
    document.getElementById('ous-view-toggle').addEventListener('click', (e) => {
      const btn = e.target.closest('.view-toggle-btn');
      if (!btn) return;
      this.switchView(btn.dataset.view);
    });

    this._installFocusRefresh();

    if (App.rsatAvailable) {
      await this.loadData();
    } else {
      document.getElementById('ous-main-area').innerHTML = `
        <div class="empty-state"><p class="empty-state-text">${t('ous.emptyOusRsat')}</p></div>`;
    }
  },

  // Auto-refresh when the user returns to the app — always queries AD live.
  // Uses 'visibilitychange' instead of 'focus' because the focus event can
  // fire on internal Electron clicks (e.g. switching between OU nodes),
  // causing spurious full reloads. visibilitychange only fires when the
  // user genuinely leaves/returns to the app window.
  _installFocusRefresh() {
    if (this._focusListener) {
      document.removeEventListener('visibilitychange', this._focusListener);
    }
    this._focusListener = () => {
      if (document.hidden) return;           // only act when becoming visible
      if (this.state.loading) return;
      if (!document.getElementById('ous-main-area')) return;
      // Small debounce to avoid double-fire edge cases
      if (this._focusDebounceTimer) clearTimeout(this._focusDebounceTimer);
      this._focusDebounceTimer = setTimeout(() => {
        this._focusDebounceTimer = null;
        if (!this.state.loading && document.getElementById('ous-main-area')) {
          this.loadData();
        }
      }, 300);
    };
    document.addEventListener('visibilitychange', this._focusListener);
  },

  // ─── Data loading ────────────────────────────────────
  async loadData() {
    this.state.loading = true;
    const mainArea = document.getElementById('ous-main-area');
    mainArea.innerHTML = `<div class="spinner"></div><p class="loading-text">${t('ous.loadingOus')}</p>`;

    try {
      // Fetch OUs and fresh GPO list in parallel. Pulling the GPO list here
      // (mirroring what the GPOs tab does on entry) makes orphan detection
      // possible and keeps both tabs in sync when another admin is editing AD.
      const [ouResult, gposResult] = await Promise.all([
        window.api.ad.getOUs(),
        window.api.ad.getGPOs().catch(err => ({ success: false, error: err?.message || String(err), data: [] }))
      ]);

      if (!ouResult.success) {
        mainArea.innerHTML = `<div class="empty-state"><p class="empty-state-text">${App._esc(ouResult.error || t('ous.noOusFound'))}</p></div>`;
        return;
      }

      this.state.treeData = ouResult.data || [];
      this.state.flatOUs = this.flattenOUs(this.state.treeData);
      const visibleOUs = this.state.flatOUs.map(ou => ou.dn);
      const reconcileResult = await window.api.apps.reconcileManagedAssignments(visibleOUs).catch(err => ({
        success: false,
        error: err?.message || 'Unknown error',
        data: []
      }));

      if (reconcileResult?.success && Array.isArray(reconcileResult.data)) {
        this.state.apps = reconcileResult.data;
      } else {
        this.state.apps = await window.api.apps.getAll();
      }
      this.state.managedRealLinks = reconcileResult?.success && reconcileResult.links && typeof reconcileResult.links === 'object'
        ? reconcileResult.links
        : {};

      // Orphan GPO detection — apps whose gpoName no longer exists in AD
      this.state.orphanGPOAppIds = new Set();
      if (gposResult?.success && Array.isArray(gposResult.data)) {
        const existingGpoNames = new Set(
          gposResult.data
            .map(g => (g && typeof g.DisplayName === 'string' ? g.DisplayName.trim() : ''))
            .filter(Boolean)
        );
        for (const app of this.state.apps) {
          const name = typeof app?.gpoName === 'string' ? app.gpoName.trim() : '';
          if (this.isProgramManagedGPOName(name) && !existingGpoNames.has(name)) {
            this.state.orphanGPOAppIds.add(app.id);
          }
        }
      }

      const validDNs = new Set(this.state.flatOUs.map(o => o.dn));
      this.state.selectedOUs = this.state.selectedOUs.filter(dn => validDNs.has(dn));

      const validAppIds = new Set(this.state.apps.map(a => a.id));
      const orphanKeys = [];
      this.state.pending.forEach((_, key) => {
        const [appId, ouDN] = key.split('::');
        if (!validAppIds.has(appId) || !validDNs.has(ouDN)) orphanKeys.push(key);
      });
      orphanKeys.forEach(k => this.state.pending.delete(k));

      this.state.syncWarnings.clear();
      this.state.assignmentCounts = this.computeAssignmentCounts();


      // Notify when reconcile picked up external changes (another admin
      // linked/unlinked GPOs, drift between local and AD, etc.)
      const externalChanged = Number(reconcileResult?.changed || 0);
      if (externalChanged > 0) {
        App.toast(t('ous.externalChangesDetected').replace('{n}', externalChanged), 'warning');
        try {
          await window.api.activity.add('ou_external_changes_detected', { changed: externalChanged });
        } catch (e) { /* best-effort */ }
      }
      if (this.state.orphanGPOAppIds.size > 0) {
        App.toast(t('ous.orphanGpoDetected').replace('{n}', this.state.orphanGPOAppIds.size), 'warning');
      }

      this.renderMain();
      this.renderStatsBar();
      this.renderPendingBar();
    } catch (err) {
      mainArea.innerHTML = `<div class="empty-state"><p class="empty-state-text">${t('ous.errorConnecting')} ${App._esc(err.message)}</p></div>`;
    } finally {
      this.state.loading = false;
    }
  },

  flattenOUs(nodes, depth = 0, parentDN = '', acc = []) {
    for (const node of nodes) {
      acc.push({ dn: node.dn, name: node.name, description: node.description, depth, parentDN });
      if (node.children && node.children.length) {
        this.flattenOUs(node.children, depth + 1, node.dn, acc);
      }
    }
    return acc;
  },

  isProgramManagedGPOName(gpoName) {
    return String(gpoName || '').trim().length > 0;
  },

  getManagedProgramGPONames() {
    return Array.from(new Set(
      this.state.apps
        .map(app => (typeof app?.gpoName === 'string' ? app.gpoName.trim() : ''))
        .filter(name => this.isProgramManagedGPOName(name))
    ));
  },

  getManagedRealLinksForOU(ouDN) {
    const links = this.state.managedRealLinks && typeof this.state.managedRealLinks === 'object'
      ? this.state.managedRealLinks[ouDN]
      : null;
    return Array.isArray(links) ? links.filter(name => this.isProgramManagedGPOName(name)) : [];
  },

  // ─── Computed helpers ────────────────────────────────
  assignmentCountByOU(ouDN) {
    return this.state.apps.filter(a => (a.assignedOUs || []).includes(ouDN)).length;
  },

  // Walks the tree once (post-order DFS) and returns
  // { [dn]: { direct, descendant } } where:
  //   direct     = apps assigned exactly to this OU
  //   descendant = sum of (direct + descendant) across all child subtrees
  //                (i.e. "apps in descendant OUs", EXCLUDING this OU's direct)
  computeAssignmentCounts() {
    const counts = {};
    const directByDN = Object.create(null);
    for (const ou of this.state.flatOUs) directByDN[ou.dn] = 0;
    for (const app of this.state.apps) {
      for (const dn of (app.assignedOUs || [])) {
        if (dn in directByDN) directByDN[dn]++;
      }
    }
    const dfs = (nodes) => {
      let sumForParent = 0;
      for (const node of nodes) {
        const childSum = (node.children && node.children.length) ? dfs(node.children) : 0;
        const d = directByDN[node.dn] || 0;
        counts[node.dn] = { direct: d, descendant: childSum };
        sumForParent += d + childSum;
      }
      return sumForParent;
    };
    dfs(this.state.treeData);
    return counts;
  },

  effectiveAssigned(appId, ouDN) {
    const key = `${appId}::${ouDN}`;
    const pending = this.state.pending.get(key);
    if (pending === 'assign') return true;
    if (pending === 'unassign') return false;
    const app = this.state.apps.find(a => a.id === appId);
    if (!app) return false;
    return (app.assignedOUs || []).includes(ouDN);
  },

  aggregateState(appId, ouDNs) {
    if (ouDNs.length === 0) return 'none';
    let assignedCount = 0;
    for (const dn of ouDNs) {
      if (this.effectiveAssigned(appId, dn)) assignedCount++;
    }
    if (assignedCount === 0) return 'none';
    if (assignedCount === ouDNs.length) return 'all';
    return 'some';
  },

  hasPending(appId, ouDN) {
    return this.state.pending.has(`${appId}::${ouDN}`);
  },

  // ─── Main render dispatch ────────────────────────────
  renderMain() {
    if (this.state.view === 'assignments') {
      this.renderAssignmentsView();
    } else {
      this.renderTreeView();
    }
  },

  switchView(view) {
    if (view === this.state.view) return;
    this.state.view = view;
    document.querySelectorAll('#ous-view-toggle .view-toggle-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === view);
    });
    this.renderMain();
    this.renderPendingBar();
  },

  // ─── Stats bar ───────────────────────────────────────
  renderStatsBar() {
    const bar = document.getElementById('ous-stats-bar');
    if (!bar) return;
    const totalApps = this.state.apps.length;
    const totalOUs = this.state.flatOUs.length;
    let totalAssignments = 0;
    const ousWithApps = new Set();
    for (const app of this.state.apps) {
      const ous = app.assignedOUs || [];
      totalAssignments += ous.length;
      ous.forEach(dn => ousWithApps.add(dn));
    }
    bar.innerHTML = `
      <div class="stat-pill"><span class="stat-pill-value">${totalApps}</span><span class="stat-pill-label">${t('ous.statsApps')}</span></div>
      <div class="stat-pill"><span class="stat-pill-value">${totalOUs}</span><span class="stat-pill-label">${t('ous.statsOUs')}</span></div>
      <div class="stat-pill"><span class="stat-pill-value">${totalAssignments}</span><span class="stat-pill-label">${t('ous.statsAssignments')}</span></div>
      <div class="stat-pill"><span class="stat-pill-value">${ousWithApps.size}</span><span class="stat-pill-label">${t('ous.statsActiveOUs')}</span></div>
    `;
  },

  // ─── Tree view ───────────────────────────────────────
  renderTreeView() {
    const mainArea = document.getElementById('ous-main-area');
    mainArea.innerHTML = `
      <div class="ous-layout">
        <div class="card ous-tree-card">
          <div class="card-title" style="margin-bottom:8px;">${t('ous.treeTitle')}</div>
          <div class="ous-search-box">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="text" class="form-input" id="ous-search-ou" placeholder="${t('ous.searchOUs')}" value="${App._esc(this.state.ouSearch)}">
          </div>
          <p class="text-muted text-sm mt-xs" style="padding: 0 4px;">${t('ous.ctrlClickHint')}</p>
          <div id="ou-tree-container" class="mt-md"></div>
        </div>

        <div class="card ous-panel-card" id="ous-assignment-panel">
          ${this.renderAssignmentPanelHTML()}
        </div>
      </div>
    `;

    this.renderTree();
    this.bindTreeEvents();

    document.getElementById('ous-search-ou').addEventListener('input', (e) => {
      this.state.ouSearch = e.target.value;
      this.renderTree();
      this.bindTreeEvents();
    });

    this.bindAssignmentPanelEvents();
  },

  renderTree() {
    const container = document.getElementById('ou-tree-container');
    if (!container) return;
    if (!this.state.treeData.length) {
      container.innerHTML = `<div class="empty-state"><p class="empty-state-text">${t('ous.noOusFound')}</p></div>`;
      return;
    }
    const matchingDNs = this.computeSearchMatches();
    container.innerHTML = this.treeHTML(this.state.treeData, matchingDNs);
  },

  computeSearchMatches() {
    const q = this.state.ouSearch.trim().toLowerCase();
    if (!q) return null;
    const matches = new Set();
    for (const ou of this.state.flatOUs) {
      if (ou.name.toLowerCase().includes(q)) {
        matches.add(ou.dn);
        let parent = ou.parentDN;
        while (parent) {
          matches.add(parent);
          const parentOU = this.state.flatOUs.find(o => o.dn === parent);
          parent = parentOU ? parentOU.parentDN : '';
        }
      }
    }
    return matches;
  },

  treeHTML(nodes, matchingDNs) {
    if (!nodes || nodes.length === 0) return '';
    let html = '<ul class="tree">';
    for (const node of nodes) {
      if (matchingDNs && !matchingDNs.has(node.dn)) continue;
      const hasChildren = node.children && node.children.length > 0;
      const counts = (this.state.assignmentCounts && this.state.assignmentCounts[node.dn]) || { direct: 0, descendant: 0 };
      const direct = counts.direct;
      const descendant = counts.descendant;
      const isSelected = this.state.selectedOUs.includes(node.dn);
      const hasAssignments = direct > 0;
      const shouldExpand = matchingDNs !== null || this.state.lastExpandedOUs.has(node.dn);

      html += `
        <li class="tree-item">
          <div class="tree-node ${isSelected ? 'selected' : ''} ${hasAssignments ? 'has-assignments' : ''}" data-dn="${this.escAttr(node.dn)}">
            <button class="tree-toggle ${hasChildren ? (shouldExpand ? 'expanded' : '') : 'empty'}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
            <span class="tree-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            </span>
            <span class="tree-label marquee-text-container"><span class="marquee-text">${App._esc(node.name)}</span></span>
            ${direct > 0 ? `<span class="tree-badge" title="${this.escAttr(t('ous.directBadgeTooltip'))}">${direct}</span>` : ''}
            ${descendant > 0 ? `<span class="tree-badge tree-badge-descendant" title="${this.escAttr(t('ous.descendantBadgeTooltip').replace('{n}', descendant))}">${descendant}</span>` : ''}
          </div>
          ${hasChildren ? `<div class="tree-children ${shouldExpand ? '' : 'collapsed'}">${this.treeHTML(node.children, matchingDNs)}</div>` : ''}
        </li>`;
    }
    html += '</ul>';
    return html;
  },

  bindTreeEvents() {
    document.querySelectorAll('#ou-tree-container .tree-toggle:not(.empty)').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const li = btn.closest('.tree-item');
        const children = li.querySelector('.tree-children');
        if (children) {
          children.classList.toggle('collapsed');
          btn.classList.toggle('expanded');
          const dn = li.querySelector('.tree-node').dataset.dn;
          if (children.classList.contains('collapsed')) {
            this.state.lastExpandedOUs.delete(dn);
          } else {
            this.state.lastExpandedOUs.add(dn);
          }
        }
      });
    });

    document.querySelectorAll('#ou-tree-container .tree-node').forEach(nodeEl => {
      nodeEl.addEventListener('click', (e) => {
        const dn = nodeEl.dataset.dn;
        if (e.ctrlKey || e.metaKey) {
          const idx = this.state.selectedOUs.indexOf(dn);
          if (idx >= 0) {
            this.state.selectedOUs.splice(idx, 1);
          } else {
            this.state.selectedOUs.push(dn);
          }
        } else {
          this.state.selectedOUs = [dn];
        }
        this.refreshTreeSelection();
        this.refreshAssignmentPanel();
      });

      nodeEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const dn = nodeEl.dataset.dn;
        this.showOUContextMenu(e.pageX, e.pageY, dn);
      });
    });
  },

  refreshTreeSelection() {
    document.querySelectorAll('#ou-tree-container .tree-node').forEach(nodeEl => {
      nodeEl.classList.toggle('selected', this.state.selectedOUs.includes(nodeEl.dataset.dn));
    });
  },

  // ─── Context menu (right-click on OU) ────────────────
  showOUContextMenu(x, y, ouDN) {
    const existing = document.querySelector('.ctx-menu');
    if (existing) existing.remove();

    const menu = document.createElement('div');
    menu.className = 'ctx-menu';
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.innerHTML = `
      <div class="ctx-item" data-action="copy-from">${t('ous.ctxCopyFrom')}</div>
      <div class="ctx-item" data-action="clear-all">${t('ous.ctxClearAll')}</div>
      <div class="ctx-item" data-action="sync-check">${t('ous.ctxSyncCheck')}</div>
    `;
    document.body.appendChild(menu);

    const close = () => menu.remove();
    setTimeout(() => document.addEventListener('click', close, { once: true }), 0);

    menu.querySelectorAll('.ctx-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = item.dataset.action;
        close();
        if (action === 'copy-from') this.copyAssignmentsFrom(ouDN);
        if (action === 'clear-all') this.clearAllForOU(ouDN);
        if (action === 'sync-check') {
          this.state.selectedOUs = [ouDN];
          this.refreshTreeSelection();
          this.runSyncCheck(ouDN).then(() => this.refreshAssignmentPanel());
        }
      });
    });
  },

  copyAssignmentsFrom(targetOuDN) {
    const otherOUs = this.state.flatOUs.filter(o => o.dn !== targetOuDN);
    const options = otherOUs.map(o => `<option value="${this.escAttr(o.dn)}">${App._esc(o.name)}</option>`).join('');
    const body = `
      <p>${t('ous.copyFromDesc').replace('{ou}', '<strong>' + App._esc(targetOuDN.split(',')[0].replace(/^OU=/i, '')) + '</strong>')}</p>
      <select class="form-select mt-md" id="copy-source-select">
        <option value="">${t('ous.selectSourceOu')}</option>
        ${options}
      </select>
    `;
    const footer = `
      <button class="btn btn-secondary" id="copy-cancel">${t('common.cancel')}</button>
      <button class="btn btn-primary" id="copy-confirm">${t('ous.copyConfirmBtn')}</button>
    `;
    App.openModal(t('ous.copyFromTitle'), body, footer);

    document.getElementById('copy-cancel').addEventListener('click', () => App.closeModal());
    document.getElementById('copy-confirm').addEventListener('click', () => {
      const sourceDN = document.getElementById('copy-source-select').value;
      if (!sourceDN) {
        App.toast(t('ous.selectSourceOu'), 'warning');
        return;
      }
      const sourceAssigned = this.state.apps.filter(a => a.gpoName && (a.assignedOUs || []).includes(sourceDN));
      for (const app of sourceAssigned) {
        if (!this.effectiveAssigned(app.id, targetOuDN)) {
          this.setPending(app.id, targetOuDN, 'assign');
        }
      }
      App.closeModal();
      App.toast(t('ous.copyStaged').replace('{n}', sourceAssigned.length), 'success');
      this.renderPendingBar();
      if (this.state.selectedOUs.includes(targetOuDN)) this.refreshAssignmentPanel();
    });
  },

  clearAllForOU(ouDN) {
    const assigned = this.state.apps.filter(a => a.gpoName && (a.assignedOUs || []).includes(ouDN));
    if (assigned.length === 0) {
      App.toast(t('ous.alreadyEmpty'), 'info');
      return;
    }
    for (const app of assigned) {
      this.setPending(app.id, ouDN, 'unassign');
    }
    App.toast(t('ous.clearStaged').replace('{n}', assigned.length), 'success');
    this.renderPendingBar();
    if (this.state.selectedOUs.includes(ouDN)) this.refreshAssignmentPanel();
  },

  // ─── Utilities ───────────────────────────────────────
  escAttr(str) {
    return (str == null ? '' : String(str))
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
};
