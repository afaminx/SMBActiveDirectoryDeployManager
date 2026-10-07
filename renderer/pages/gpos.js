const GposPage = {
  gposCache: null,
  linkCounts: null,
  localLinkCounts: null,
  filterAppOnly: true,
  searchQuery: '',
  selectedIds: new Set(),

  async render(container) {
    this.selectedIds = new Set();

    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">${t('gpos.title')}</h1>
          <p class="page-subtitle">${t('gpos.subtitle')}</p>
        </div>
        <div style="display: flex; align-items: center; gap: 12px;">
          <div style="position:relative;">
            <svg style="position:absolute;left:9px;top:50%;transform:translateY(-50%);pointer-events:none;opacity:.4" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="text" class="form-input" id="gpo-search" placeholder="${t('gpos.search')}" autocomplete="off" style="padding-left:32px;width:200px;">
          </div>
          <button class="btn btn-primary" id="btn-refresh-gpos">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 1 0 2.13-5.83L2 8"/></svg>
            ${t('gpos.refresh')}
          </button>
        </div>
      </div>

      ${App.rsatWarningHTML()}

      <div id="gpo-bulk-bar" style="display:none;padding:10px 16px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);border-radius:8px;margin-bottom:12px;display:none;align-items:center;gap:12px;">
        <span id="gpo-bulk-count" style="font-size:13px;font-weight:600;color:var(--text-primary);"></span>
        <div style="flex:1"></div>
        <button class="btn btn-sm btn-secondary" id="btn-gpo-deselect">${t('common.cancel') || 'Cancelar'}</button>
        <button class="btn btn-sm btn-danger" id="btn-gpo-bulk-delete">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          Eliminar seleccionados
        </button>
      </div>

      <div class="card mt-lg" style="padding: 0;">
        <div class="table-container">
          <table class="table" style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="border-bottom: 2px solid var(--border-color); text-align: left;">
                <th style="padding: 16px; width: 40px;">
                  <label class="checkbox-wrapper checkbox-wrapper--compact" style="width:22px;margin:0 auto;">
                    <input type="checkbox" class="checkbox-select" id="gpo-select-all">
                    <span class="sr-only">Seleccionar todas las GPOs</span>
                  </label>
                </th>
                <th style="padding: 16px;">${t('gpos.name')}</th>
                <th style="padding: 16px; width: 80px; text-align: center;">OUs</th>
                <th style="padding: 16px;">${t('gpos.id')}</th>
                <th style="padding: 16px;">${t('gpos.modified')}</th>
                <th style="padding: 16px; width: 100px; text-align: center;">${t('gpos.actions')}</th>
              </tr>
            </thead>
            <tbody id="gpos-tbody">
              <tr>
                <td colspan="6" style="text-align: center; padding: 40px; color: var(--text-muted);">
                  <span class="spinner" style="display:inline-block; border-color:var(--primary-color) transparent transparent; margin-bottom:10px;"></span>
                  <br>${t('gpos.loading')}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    `;

    document.getElementById('btn-refresh-gpos').addEventListener('click', () => {
      this.selectedIds = new Set();
      this.loadGPOs();
    });

    document.getElementById('gpo-search').addEventListener('input', (e) => {
      this.searchQuery = e.target.value;
      this.renderTable();
    });

    document.getElementById('gpo-select-all').addEventListener('change', (e) => {
      const checked = e.target.checked;
      const visible = this.getVisibleGPOs();
      if (checked) {
        visible.forEach(g => this.selectedIds.add(g.Id));
      } else {
        this.selectedIds.clear();
      }
      this.renderTable();
    });

    document.getElementById('btn-gpo-deselect')?.addEventListener('click', () => {
      this.selectedIds.clear();
      this.renderTable();
    });

    document.getElementById('btn-gpo-bulk-delete')?.addEventListener('click', () => {
      this.bulkDelete();
    });

    if (App.rsatAvailable && !App.rsatMissingGPMC) {
      await this.loadGPOs();
      this._installFocusRefresh();
    } else {
      document.getElementById('gpos-tbody').innerHTML = `
        <tr>
          <td colspan="6" style="text-align: center; padding: 40px; color: var(--danger-color);">
            ${t('gpos.rsatMissing')}
          </td>
        </tr>
      `;
    }
  },

  _installFocusRefresh() {
    if (this._focusListener) {
      document.removeEventListener('visibilitychange', this._focusListener);
    }
    this._focusListener = () => {
      if (document.hidden) return;
      if (!document.getElementById('gpos-tbody')) return;
      if (this._focusDebounceTimer) clearTimeout(this._focusDebounceTimer);
      this._focusDebounceTimer = setTimeout(() => {
        this._focusDebounceTimer = null;
        if (document.getElementById('gpos-tbody')) {
          this.loadGPOs();
        }
      }, 300);
    };
    document.addEventListener('visibilitychange', this._focusListener);
  },

  getVisibleGPOs() {
    if (!this.gposCache) return [];
    let list = this.gposCache;
    const q = this.searchQuery.trim().toLowerCase();
    if (q) list = list.filter(g => g.DisplayName.toLowerCase().includes(q));
    
    if (this.localLinkCounts) {
      list = list.filter(g => {
        const nameKey = (g.DisplayName || '').trim().toLowerCase();
        return Object.prototype.hasOwnProperty.call(this.localLinkCounts, nameKey);
      });
    }
    
    return list;
  },

  async loadGPOs() {
    const tbody = document.getElementById('gpos-tbody');
    // Always query AD fresh — no in-memory cache
    this.gposCache = null;
    this.linkCounts = null;
    this.localLinkCounts = null;
    try {
      const [gpoResult, localLinkCounts] = await Promise.all([
        window.api.ad.getGPOs(),
        this.loadLocalLinkCounts()
      ]);

      if (!gpoResult.success) throw new Error(gpoResult.error);
      this.gposCache = gpoResult.data.sort((a, b) => a.DisplayName.localeCompare(b.DisplayName));
      this.localLinkCounts = localLinkCounts;

      this.renderTable();

      // Load link counts asynchronously (may take a moment)
      window.api.ad.getGPOLinkCounts().then(res => {
        if (res.success) {
          this.linkCounts = res.data || {};
          this.renderTable();
        }
      }).catch(() => {});
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 40px; color: var(--danger-color);">${t('gpos.errorConnecting')} ${err.message}</td></tr>`;
    }
  },

  renderTable() {
    const tbody = document.getElementById('gpos-tbody');
    if (!tbody) return;

    const displayList = this.getVisibleGPOs();

    // Update bulk bar
    const bulkBar = document.getElementById('gpo-bulk-bar');
    const countEl = document.getElementById('gpo-bulk-count');
    if (bulkBar) {
      bulkBar.style.display = this.selectedIds.size > 0 ? 'flex' : 'none';
    }
    if (countEl) {
      countEl.textContent = `${this.selectedIds.size} GPO${this.selectedIds.size !== 1 ? 's' : ''} seleccionados`;
    }

    // Update select-all checkbox
    const selectAll = document.getElementById('gpo-select-all');
    if (selectAll) {
      selectAll.checked = displayList.length > 0 && displayList.every(g => this.selectedIds.has(g.Id));
      selectAll.indeterminate = !selectAll.checked && displayList.some(g => this.selectedIds.has(g.Id));
    }

    if (displayList.length === 0) {
      const q = this.searchQuery.trim().toLowerCase();
      const msg = q ? t('gpos.noGposMatch') : t('gpos.emptyFiltered');
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 40px;">${msg}</td></tr>`;
      return;
    }

    tbody.innerHTML = displayList.map(g => {
      const isSelected = this.selectedIds.has(g.Id);
      const guidLower = (g.Id || '').toLowerCase().replace(/[{}]/g, '');
      const gpoKey = (g.DisplayName || '').trim().toLowerCase();
      const localCount = this.localLinkCounts ? (this.localLinkCounts[gpoKey] ?? 0) : 0;
      const adCount = this.linkCounts ? (this.linkCounts[guidLower] ?? 0) : null;
      const effectiveCount = adCount === null ? localCount : Math.max(adCount, localCount);
      const isLoadingAdCount = adCount === null;
      const linkBadge = effectiveCount > 0
        ? `<span style="display:inline-flex;align-items:center;justify-content:center;min-width:24px;height:22px;padding:2px 6px;border-radius:12px;background:rgba(59,130,246,0.12);color:var(--accent-info);font-weight:600;font-size:12px;${isLoadingAdCount ? 'opacity:0.5;' : ''}">${effectiveCount}</span>`
        : `<span style="color:var(--text-muted);font-size:12px;display:inline-block;min-width:24px;height:22px;line-height:22px;text-align:center;${isLoadingAdCount ? 'opacity:0.5;' : ''}">0</span>`;

      return `
        <tr style="border-bottom: 1px solid var(--border-color); transition: background 0.2s;${isSelected ? 'background:rgba(59,130,246,0.06);' : ''}">
          <td style="padding: 16px;">
            <label class="checkbox-wrapper checkbox-wrapper--compact" style="width:22px;margin:0 auto;">
              <input type="checkbox" class="checkbox-select gpo-cb" data-id="${App._esc(g.Id)}" ${isSelected ? 'checked' : ''}>
              <span class="sr-only">Seleccionar ${App._esc(g.DisplayName)}</span>
            </label>
          </td>
          <td style="padding: 16px;">
            <div style="font-weight: 500; display:flex; align-items:center; gap:8px;">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
              ${App._esc(g.DisplayName)}
            </div>
          </td>
          <td style="padding: 16px; text-align: center;">
            ${linkBadge}
          </td>
          <td style="padding: 16px; font-family: monospace; font-size: 13px; color: var(--text-muted);">
            ${App._esc(g.Id)}
          </td>
          <td style="padding: 16px; font-size: 13px; color: var(--text-muted);">
            ${App.formatDate(g.ModificationTime)}
          </td>
          <td style="padding: 16px; text-align: center;">
            <button class="btn btn-sm btn-danger gpo-delete-btn" data-name="${App._esc(g.DisplayName)}">${t('common.delete')}</button>
          </td>
        </tr>`;
    }).join('');

    // Bind checkbox events
    tbody.querySelectorAll('.gpo-cb').forEach(cb => {
      cb.addEventListener('change', () => {
        const id = cb.dataset.id;
        if (cb.checked) this.selectedIds.add(id);
        else this.selectedIds.delete(id);
        this.renderTable();
      });
    });

    // Bind individual delete buttons
    tbody.querySelectorAll('.gpo-delete-btn').forEach(btn => {
      btn.addEventListener('click', () => this.deleteGPO(btn.dataset.name));
    });
  },

  async bulkDelete() {
    const count = this.selectedIds.size;
    if (count === 0) return;

    // Resolve GPO names from IDs
    const names = [];
    for (const id of this.selectedIds) {
      const g = this.gposCache?.find(gpo => gpo.Id === id);
      if (g) names.push(g.DisplayName);
    }

    const listHtml = names.length <= 8
      ? names.map(n => `<li style="font-family:monospace;font-size:13px;">${App._esc(n)}</li>`).join('')
      : names.slice(0, 6).map(n => `<li style="font-family:monospace;font-size:13px;">${App._esc(n)}</li>`).join('')
        + `<li style="color:var(--text-muted);font-size:13px;">... y ${names.length - 6} mas</li>`;

    App.openModal(t('apps.deleteConfirm'), `
      <p style="margin-bottom:12px;">Se van a eliminar <strong>${count} GPO${count > 1 ? 's' : ''}</strong>:</p>
      <ul style="max-height:200px;overflow-y:auto;margin:0 0 16px 0;padding-left:20px;list-style:disc;">
        ${listHtml}
      </ul>
      <div class="rsat-warning" style="margin-top:0;">
        ⚠️ ${t('gpos.deleteConsequence')}
      </div>
    `, `
      <button class="btn btn-secondary" onclick="App.closeModal()">${t('common.cancel')}</button>
      <button class="btn btn-danger" id="btn-confirm-bulk-gpo-delete">Eliminar ${count} GPO${count > 1 ? 's' : ''}</button>
    `);

    document.getElementById('btn-confirm-bulk-gpo-delete').addEventListener('click', async () => {
      App.closeModal();
      const tbody = document.getElementById('gpos-tbody');
      if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:20px;"><span class="spinner"></span> Eliminando ${count} GPOs...</td></tr>`;

      let successCount = 0;
      let failCount = 0;
      for (const name of names) {
        try {
          const res = await window.api.ad.deleteGPO(name);
          if (res.success) successCount++;
          else failCount++;
        } catch {
          failCount++;
        }
      }

      if (successCount > 0) App.toast(`${successCount} GPO${successCount > 1 ? 's' : ''} deleted successfully`, 'success');
      if (failCount > 0) App.toast(`${failCount} GPO${failCount > 1 ? 's' : ''} could not be deleted`, 'error');

      this.selectedIds.clear();
      this.gposCache = null;
      this.linkCounts = null;
      this.localLinkCounts = null;
      this.loadGPOs();
    });
  },

  async deleteGPO(gpoName) {
    App.openModal(t('apps.deleteConfirm'), `
      <p>${t('gpos.deleteWarning').replace('{gpo}', `<strong>${App._esc(gpoName)}</strong>`)}</p>
      <div class="rsat-warning" style="margin-top:16px;">
        ⚠️ ${t('gpos.deleteConsequence')}
      </div>
    `, `
      <button class="btn btn-secondary" onclick="App.closeModal()">${t('common.cancel')}</button>
      <button class="btn btn-danger" id="btn-confirm-gpo-delete">${t('gpos.confirmDelete')}</button>
    `);

    document.getElementById('btn-confirm-gpo-delete').addEventListener('click', async () => {
      App.closeModal();
      document.getElementById('gpos-tbody').innerHTML = `<tr><td colspan="6" style="text-align: center; padding:20px;"><span class="spinner"></span> ${t('gpos.deleting')}</td></tr>`;

      const res = await window.api.ad.deleteGPO(gpoName);
      if (res.success) {
        App.toast(`${t('gpos.deletedSuccess')} "${gpoName}"`, 'success');
        this.gposCache = null;
        this.linkCounts = null;
        this.localLinkCounts = null;
        this.loadGPOs();
      } else {
        App.toast(`${t('gpos.deleteFailed')}: ${res.error}`, 'error');
        this.loadGPOs();
      }
    });
  },

  async loadLocalLinkCounts() {
    const [apps, bundles] = await Promise.all([
      window.api.apps.getAll().catch(() => []),
      window.api.bundles.getAll().catch(() => [])
    ]);

    const counts = new Map();
    const addAssignments = (gpoName, value) => {
      const key = (gpoName || '').trim().toLowerCase();
      if (!key) return;
      if (!counts.has(key)) counts.set(key, new Set());
      const set = counts.get(key);
      this.normalizeOUDNs(value).forEach(dn => set.add(dn));
    };

    apps.forEach(app => addAssignments(
      app.gpoName,
      Array.isArray(app.assignedOUs) && app.assignedOUs.length > 0 ? app.assignedOUs : app.ouDN
    ));
    bundles.forEach(bundle => addAssignments(
      bundle.gpoName,
      Array.isArray(bundle.ouDNs) && bundle.ouDNs.length > 0 ? bundle.ouDNs : bundle.ouDN
    ));

    return Object.fromEntries(Array.from(counts.entries()).map(([key, set]) => [key, set.size]));
  },

  normalizeOUDNs(value) {
    const raw = Array.isArray(value)
      ? value
      : (typeof value === 'string' && value.trim() ? [value.trim()] : []);
    return [...new Set(raw.filter(Boolean))];
  },

};
