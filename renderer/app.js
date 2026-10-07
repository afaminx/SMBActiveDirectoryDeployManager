// ═══════════════════════════════════════════════════════
// AD App Deploy Manager – Main Renderer (SPA Router)
// ═══════════════════════════════════════════════════════

window.langDict = {};

// Resolve a dotted i18n key. Returns the localized string, or empty
// string if missing — that lets callers fall back via `t('x') || 'def'`.
// Missing keys are logged once (per session) so they're easy to fix.
window._missingI18n = window._missingI18n || new Set();
window.t = function(key, fallback) {
  const parts = String(key || '').split('.');
  let val = window.langDict;
  for (const part of parts) {
    if (val === undefined || val === null) break;
    val = val[part];
  }
  if (typeof val === 'string') return val;
  if (!window._missingI18n.has(key)) {
    window._missingI18n.add(key);
    console.warn('[i18n] missing key:', key);
  }
  return fallback != null ? fallback : '';
};

window.initI18n = async function() {
  const config = await window.api.config.get();
  const lang = config.language || 'en';
  window.langDict = await window.api.i18n.getTranslations(lang);
  document.documentElement.lang = lang === 'es' ? 'es' : 'en';
  document.querySelectorAll('[data-i18n-title]').forEach(element => {
    element.title = window.t(element.getAttribute('data-i18n-title'));
  });
};

const App = {
  currentPage: 'dashboard',
  rsatAvailable: false,
  rsatMissingGPMC: false,
  shareAvailable: true,
  updateCheckResult: null,
  dismissedAppUpdateVersion: '',
  sessionDismissedAppUpdateVersion: '',
  _updateCheckPromise: null,
  _gpoSyncTimer: null,
  _gpoSyncVisibilityListener: null,

  async init() {
    await window.initI18n();

    this.bindWindowControls();
    this.bindNavigation();
    this.bindSidebarToggle();
    this.bindMarqueeHover();
    this.bindModal();
    await this.checkRSAT();

    const config = await window.api.config.get();
    this.dismissedAppUpdateVersion = config.dismissedAppUpdateVersion || '';
    this.sessionDismissedAppUpdateVersion = '';
    if (config.firstRun || !config.networkSharePath) {
      document.querySelector('.sidebar').style.display = 'none';
      this.navigate('setup');
    } else {
      // Check share health before first navigation
      await this.checkShareHealth();
      this.updateSidebarLanguage();
      this.navigate('dashboard');
    }

    this.checkAppUpdates().catch(() => {});
    if (this.rsatAvailable) {
      setTimeout(() => this._silentGpoSyncCheck(), 12_000);
      this.startGpoSyncPolling();
    }
  },

  updateSidebarLanguage() {
    document.querySelector('.nav-item[data-page="dashboard"] span').textContent = t('nav.dashboard');
    document.querySelector('.nav-item[data-page="ous"] span').textContent = t('nav.ous');
    document.querySelector('.nav-item[data-page="gpos"] span').textContent = t('nav.gpos');
    document.querySelector('.nav-item[data-page="apps"] span').textContent = t('nav.apps');
    document.querySelector('.nav-item[data-page="catalog"] span').textContent = t('nav.catalog');
    document.querySelector('.nav-item[data-page="bundles"] span').textContent = t('nav.bundles');
    document.querySelector('.nav-item[data-page="deployments"] span').textContent = t('nav.deployments');
    const logsNav = document.querySelector('.nav-item[data-page="logs"] span');
    if (logsNav) logsNav.textContent = t('nav.logs');
    document.querySelector('.nav-item[data-page="settings"] span').textContent = t('nav.settings');
  },

  // ─── Window Controls ───────────────────────────────
  bindWindowControls() {
    document.getElementById('btn-minimize')?.addEventListener('click', () => {
      window.api.window.minimize();
    });
    document.getElementById('btn-maximize')?.addEventListener('click', () => {
      window.api.window.maximize();
    });
    document.getElementById('btn-close')?.addEventListener('click', () => {
      window.api.window.close();
    });
  },

  // ─── Navigation ────────────────────────────────────
  bindNavigation() {
    document.querySelectorAll('.nav-item[data-page]').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        this.navigate(item.dataset.page);
      });
    });
  },

  navigate(page) {
    this.currentPage = page;
    // Update active nav
    document.querySelectorAll('.nav-item[data-page]').forEach(item => {
      item.classList.toggle('active', item.dataset.page === page);
    });
    // Render page
    const container = document.getElementById('main-content');
    container.innerHTML = '<div class="spinner"></div><p class="loading-text">' + t('common.loading') + '</p>';

    setTimeout(async () => {
      switch (page) {
        case 'setup': await SetupPage.render(container); break;
        case 'dashboard': await DashboardPage.render(container); break;
        case 'ous': await OUsPage.render(container); break;
        case 'gpos': await GposPage.render(container); break;
        case 'apps': await AppsPage.render(container); break;
        case 'catalog': await CatalogPage.render(container); break;
        case 'bundles': await BundlesPage.render(container); break;
        case 'deployments': await DeploymentsPage.render(container); break;
        case 'logs': await LogsPage.render(container); break;
        case 'settings': await SettingsPage.render(container); break;
        default: container.innerHTML = '<p>' + t('common.pageNotFound') + '</p>';
      }
    }, 80);
  },

  // ─── RSAT Check ────────────────────────────────────
  async checkRSAT() {
    const statusEl = document.getElementById('rsat-status');
    statusEl.className = 'rsat-status checking';
    statusEl.querySelector('.rsat-text').textContent = t('common.checkingRsat');

    try {
      const result = await window.api.ad.checkRSAT();
      this.rsatAvailable = result.available;
      this.rsatMissingGPMC = result.missingGPMC || false;
      
      if (this.rsatMissingGPMC && result.available) {
        statusEl.className = 'rsat-status warning';
        statusEl.querySelector('.rsat-text').textContent = t('common.rsatMissingGpmc');
      } else {
        statusEl.className = `rsat-status ${result.available ? 'ok' : 'error'}`;
        statusEl.querySelector('.rsat-text').textContent = result.available ? 'RSAT OK' : t('common.rsatNotAvailable');
      }
    } catch (err) {
      this.rsatAvailable = false;
      this.rsatMissingGPMC = false;
      statusEl.className = 'rsat-status error';
      statusEl.querySelector('.rsat-text').textContent = t('common.rsatError');
    }
  },

  // ─── Modal ─────────────────────────────────────────
  _modalLocked: false,
  _modalScrollRestore: null,

  bindModal() {
    const overlay = document.getElementById('modal-overlay');
    const closeBtn = document.getElementById('modal-close');

    closeBtn.addEventListener('click', () => { if (!this._modalLocked) this.closeModal(); });
    // overlay auto-close disabled to prevent accidental data loss
    /* overlay.addEventListener('click', (e) => {
      if (e.target === overlay && !this._modalLocked) this.closeModal();
    }); */

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this._modalLocked) this.closeModal();
    });
  },

  // ─── Sidebar Toggle ────────────────────────────────
  bindSidebarToggle() {
    const sidebar = document.querySelector('.sidebar');
    const toggleBtn = document.getElementById('sidebar-toggle');
    if (!sidebar || !toggleBtn) return;
    toggleBtn.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
    });
  },

  // ─── Marquee Hover Effect ──────────────────────────
  bindMarqueeHover() {
    document.addEventListener('mouseenter', (e) => {
      const target = e.target.closest && e.target.closest('.marquee-text');
      if (target && target.scrollWidth > target.clientWidth) {
        const overflow = target.scrollWidth - target.clientWidth;
        target.style.transition = `transform \${overflow * 18}ms linear`;
        target.style.transform = `translateX(-\${overflow + 10}px)`; // extra pixels to see end
      }
    }, true);
    document.addEventListener('mouseleave', (e) => {
      const target = e.target.closest && e.target.closest('.marquee-text');
      if (target) {
        target.style.transition = 'transform 0.2s ease-out';
        target.style.transform = 'translateX(0)';
      }
    }, true);
  },

  applyModalOptions(options = {}) {
    const modal = document.getElementById('modal');
    if (!modal) return;

    modal.classList.remove('modal-wide', 'modal-full');
    if (options.size === 'wide') modal.classList.add('modal-wide');
    if (options.size === 'full') modal.classList.add('modal-full');
  },

  capturePageScroll() {
    const mainContent = document.getElementById('main-content');
    return {
      mainScrollTop: mainContent ? mainContent.scrollTop : 0,
      windowScrollY: window.scrollY || window.pageYOffset || 0
    };
  },

  restorePageScroll(restore) {
    if (!restore) return;
    const mainContent = document.getElementById('main-content');
    if (mainContent && Number.isFinite(restore.mainScrollTop)) {
      mainContent.scrollTop = restore.mainScrollTop;
    }
    if (Number.isFinite(restore.windowScrollY)) {
      window.scrollTo({ top: restore.windowScrollY, behavior: 'auto' });
    }
  },

  openModal(title, bodyHTML, footerHTML = '', options = {}) {
    this._modalLocked = false;
    this._modalScrollRestore = this.capturePageScroll();
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = bodyHTML;
    document.getElementById('modal-footer').innerHTML = footerHTML;
    this.applyModalOptions(options);
    document.getElementById('modal-overlay').classList.add('visible');
    requestAnimationFrame(() => this.restorePageScroll(this._modalScrollRestore));
  },

  openModalLocked(title, bodyHTML, footerHTML = '', options = {}) {
    this._modalLocked = true;
    this._modalScrollRestore = this.capturePageScroll();
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = bodyHTML;
    document.getElementById('modal-footer').innerHTML = footerHTML;
    this.applyModalOptions(options);
    document.getElementById('modal-overlay').classList.add('visible');
    requestAnimationFrame(() => this.restorePageScroll(this._modalScrollRestore));
  },

  closeModal() {
    this._modalLocked = false;
    document.getElementById('modal-overlay').classList.remove('visible');
    this.applyModalOptions();
    requestAnimationFrame(() => this.restorePageScroll(this._modalScrollRestore));
  },

  // ─── Share error helper ────────────────────────────
  isShareError(errorStr) {
    return typeof errorStr === 'string' && errorStr.includes('SHARE_UNAVAILABLE');
  },

  handleShareError() {
    this.shareAvailable = false;
    this.updateShareBanner();
    this.toast(t('gui.theNetworkShareIsUnavailableCheckTheConnection'), 'error');
  },

  refreshSettingsUpdateSection() {
    if (this.currentPage !== 'settings') return;
    if (typeof SettingsPage === 'undefined' || typeof SettingsPage.renderUpdateSection !== 'function') return;
    SettingsPage.renderUpdateSection(
      SettingsPage.currentAppVersion,
      this.updateCheckResult,
      this.isCheckingAppUpdates()
    );
  },

  isUpdateReminderDismissedPersistently(result = this.updateCheckResult) {
    const latestVersion = result?.latestVersion;
    return !!latestVersion && this.dismissedAppUpdateVersion === latestVersion;
  },

  isUpdateReminderDismissedForSession(result = this.updateCheckResult) {
    const latestVersion = result?.latestVersion;
    return !!latestVersion && this.sessionDismissedAppUpdateVersion === latestVersion;
  },

  isUpdateBannerSuppressed(result = this.updateCheckResult) {
    return this.isUpdateReminderDismissedPersistently(result) || this.isUpdateReminderDismissedForSession(result);
  },

  async persistDismissedAppUpdateVersion(latestVersion) {
    const result = await window.api.config.set({ dismissedAppUpdateVersion: latestVersion || '' });
    if (!result?.success) {
      throw new Error(result?.error || t('updates.reminderSaveFailed'));
    }
    this.dismissedAppUpdateVersion = latestVersion || '';
    this.sessionDismissedAppUpdateVersion = latestVersion || '';
    return result;
  },

  async clearDismissedAppUpdateVersion() {
    const result = await window.api.config.set({ dismissedAppUpdateVersion: '' });
    if (!result?.success) {
      throw new Error(result?.error || t('updates.reminderSaveFailed'));
    }
    this.dismissedAppUpdateVersion = '';
    this.sessionDismissedAppUpdateVersion = '';
    return result;
  },
  async checkAppUpdates(options = {}) {
    const force = options?.force === true;
    if (this._updateCheckPromise) return this._updateCheckPromise;
    if (!force && this.updateCheckResult) return this.updateCheckResult;

    this._updateCheckPromise = window.api.updates.check()
      .then(result => {
        this.updateCheckResult = result;
        this.updateAppUpdateBanner();
        this.refreshSettingsUpdateSection();
        return result;
      })
      .catch(err => {
        const fallbackResult = {
          success: false,
          currentVersion: this.updateCheckResult?.currentVersion || '0.0.0',
          latestVersion: null,
          hasUpdate: false,
          tagName: null,
          releaseName: null,
          publishedAt: null,
          checkedAt: new Date().toISOString(),
          error: err?.message || 'Unable to check for updates'
        };
        this.updateCheckResult = fallbackResult;
        this.updateAppUpdateBanner();
        this.refreshSettingsUpdateSection();
        return fallbackResult;
      })
      .finally(() => {
        this._updateCheckPromise = null;
      });

    return this._updateCheckPromise;
  },
  isCheckingAppUpdates() {
    return !!this._updateCheckPromise;
  },
  async openLatestReleasePage() {
    const result = await window.api.updates.openReleasePage();
    if (!result?.success) {
      this.toast(t('updates.openReleaseFailed'), 'error');
    }
    return result;
  },

  // ─── Toast ─────────────────────────────────────────
  toast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const icons = {
      success: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
      error: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
      info: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
      warning: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
    };

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const iconSpan = document.createElement('span');
    iconSpan.className = 'toast-icon';
    iconSpan.innerHTML = icons[type] || icons.info;
    const msgSpan = document.createElement('span');
    msgSpan.textContent = message; // textContent prevents XSS
    toast.appendChild(iconSpan);
    toast.appendChild(msgSpan);
    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('removing');
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  },

  // ─── RSAT Warning Banner HTML ──────────────────────
  rsatWarningHTML() {
    if (this.rsatAvailable && !this.rsatMissingGPMC) return '';
    
    if (this.rsatMissingGPMC) {
      return `
        <div class="rsat-warning" style="background-color: var(--secondary-color); border-left-color: #f39c12;">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#f39c12" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          <div>
            <strong style="color:#f39c12">${t('common.rsatWarningTitle')}</strong> — ${t('common.rsatWarningMsg')}
            <code>Add-WindowsCapability -Online -Name Rsat.GroupPolicy.Management.Tools~~~~0.0.1.0</code>
          </div>
        </div>`;
    }
    
    return `
      <div class="rsat-warning">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        <div>
          <strong>${t('common.rsatNotInstalledTitle')}</strong> — ${t('common.rsatNotInstalledMsg')}
          Ejecuta como Administrador en PowerShell:
          <code>Add-WindowsCapability -Online -Name Rsat.GroupPolicy.Management.Tools~~~~0.0.1.0</code>
        </div>
      </div>`;
  },

  // ─── Background GPO Sync ──────────────────────────
  _flattenOUTree(nodes, result = []) {
    for (const n of (nodes || [])) {
      result.push(n.dn);
      if (n.children?.length) this._flattenOUTree(n.children, result);
    }
    return result;
  },

  async _silentGpoSyncCheck() {
    if (!this.rsatAvailable || document.hidden) return;
    try {
      const ouResult = await window.api.ad.getOUs().catch(() => null);
      if (!ouResult?.success || !Array.isArray(ouResult.data)) return;
      const visibleOUs = this._flattenOUTree(ouResult.data);
      if (!visibleOUs.length) return;
      const reconcile = await window.api.apps.reconcileManagedAssignments(visibleOUs).catch(() => null);
      const changed = Number(reconcile?.changed || 0);
      if (changed > 0 && this.currentPage !== 'ous') {
        this.toast(t('ous.externalChangesDetected').replace('{n}', changed), 'warning');
      }
    } catch (e) { /* silent */ }
  },

  startGpoSyncPolling(intervalMs = 8 * 60 * 1000) {
    this.stopGpoSyncPolling();
    if (!this.rsatAvailable) return;
    this._gpoSyncTimer = setInterval(() => this._silentGpoSyncCheck(), intervalMs);
    this._gpoSyncVisibilityListener = () => {
      if (!document.hidden) this._silentGpoSyncCheck();
    };
    document.addEventListener('visibilitychange', this._gpoSyncVisibilityListener);
  },

  stopGpoSyncPolling() {
    if (this._gpoSyncTimer) { clearInterval(this._gpoSyncTimer); this._gpoSyncTimer = null; }
    if (this._gpoSyncVisibilityListener) {
      document.removeEventListener('visibilitychange', this._gpoSyncVisibilityListener);
      this._gpoSyncVisibilityListener = null;
    }
  },

  // ─── Share Health Check ──────────────────────────────
  async checkShareHealth() {
    try {
      const status = await window.api.share.checkHealth();
      this.shareAvailable = !!status?.available;
    } catch {
      this.shareAvailable = false;
    }
    this.updateShareBanner();
    return this.shareAvailable;
  },

  updateShareBanner() {
    let banner = document.getElementById('share-offline-banner');
    if (this.shareAvailable) {
      if (banner) banner.remove();
      this.updateAppUpdateBanner();
      return;
    }
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'share-offline-banner';
      banner.style.cssText = 'position:fixed;left:0;right:0;z-index:9999;display:flex;align-items:center;justify-content:center;gap:10px;padding:10px 20px;background:rgba(239,68,68,0.95);color:#fff;font-size:13px;font-weight:600;backdrop-filter:blur(6px);';
      banner.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
        <span>${t('gui.theNetworkShareCannotBeReachedTheApplication')}</span>
        <button id="btn-retry-share" style="margin-left:auto;background:rgba(255,255,255,0.2);border:1px solid rgba(255,255,255,0.4);color:#fff;border-radius:6px;padding:4px 14px;cursor:pointer;font-size:12px;font-weight:600;white-space:nowrap;">${t('gui.retry')}</button>
      `;
      document.body.appendChild(banner);
      document.getElementById('btn-retry-share').addEventListener('click', async () => {
        const btn = document.getElementById('btn-retry-share');
        if (btn) { btn.disabled = true; btn.textContent = t('gui.checking'); }
        const ok = await this.checkShareHealth();
        if (ok) {
          this.toast('Conexion al share restablecida', 'success');
          // Re-render current page to refresh data
          this.navigate(this.currentPage);
        } else {
          this.toast(t('gui.theShareIsStillUnavailable'), 'error');
          if (btn) { btn.disabled = false; btn.textContent = t('gui.retry'); }
        }
      });
    }
    banner.style.top = `${this.getBannerTop('share')}px`;
    this.updateAppUpdateBanner();
  },

  getBannerTop(kind = 'share') {
    const titleBarOffset = 32;
    if (kind === 'update' && !this.shareAvailable) return 78;
    return titleBarOffset;
  },

  updateAppUpdateBanner() {
    let banner = document.getElementById('app-update-banner');
    const result = this.updateCheckResult;

    if (!result?.success || !result?.hasUpdate || !result?.latestVersion || this.isUpdateBannerSuppressed(result)) {
      if (banner) banner.remove();
      return;
    }

    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'app-update-banner';
      banner.style.cssText = 'position:fixed;left:0;right:0;z-index:9998;display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap;padding:10px 20px;background:rgba(245,158,11,0.97);color:#111827;font-size:13px;font-weight:700;backdrop-filter:blur(6px);';
      document.body.appendChild(banner);
    }

    banner.style.top = `${this.getBannerTop('update')}px`;
    banner.replaceChildren();

    const icon = document.createElement('span');
    icon.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:block;"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>';

    const message = document.createElement('span');
    message.textContent = t('updates.bannerMessage')
      .replace('{current}', result.currentVersion || '?')
      .replace('{latest}', result.latestVersion || '?');
    message.style.flex = '1 1 260px';

    const actions = document.createElement('div');
    actions.style.cssText = 'margin-left:auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap;';

    const openButton = document.createElement('button');
    openButton.type = 'button';
    openButton.textContent = t('updates.openRelease');
    openButton.style.cssText = 'background:rgba(17,24,39,0.14);border:1px solid rgba(17,24,39,0.28);color:#111827;border-radius:6px;padding:4px 14px;cursor:pointer;font-size:12px;font-weight:700;white-space:nowrap;';
    openButton.addEventListener('click', () => {
      this.openLatestReleasePage();
    });

    const dismissButton = document.createElement('button');
    dismissButton.type = 'button';
    dismissButton.textContent = t('updates.dismissButton');
    dismissButton.style.cssText = 'background:rgba(255,255,255,0.28);border:1px solid rgba(17,24,39,0.18);color:#111827;border-radius:6px;padding:4px 14px;cursor:pointer;font-size:12px;font-weight:700;white-space:nowrap;';
    dismissButton.addEventListener('click', () => {
      this.promptAppUpdateDismissal();
    });

    banner.appendChild(icon);
    banner.appendChild(message);
    actions.appendChild(openButton);
    actions.appendChild(dismissButton);
    banner.appendChild(actions);
  },

  promptAppUpdateDismissal() {
    const result = this.updateCheckResult;
    const latestVersion = result?.latestVersion;
    if (!result?.hasUpdate || !latestVersion) return;

    const safeVersion = this._esc(`v${latestVersion}`);
    const body = `
      <div style="display:grid;gap:12px;line-height:1.5;">
        <p style="margin:0;color:var(--text-primary);">${t('updates.dismissPrompt').replace('{version}', safeVersion)}</p>
        <div style="padding:12px;border:1px solid var(--border-color);border-radius:10px;background:var(--bg-secondary);">
          <strong style="display:block;margin-bottom:4px;color:var(--text-primary);">${t('updates.dismissOnce')}</strong>
          <span style="color:var(--text-secondary);font-size:13px;">${t('updates.dismissOnceDescription')}</span>
        </div>
        <div style="padding:12px;border:1px solid rgba(245,158,11,0.35);border-radius:10px;background:rgba(245,158,11,0.08);">
          <strong style="display:block;margin-bottom:4px;color:var(--text-primary);">${t('updates.dismissVersion')}</strong>
          <span style="color:var(--text-secondary);font-size:13px;">${t('updates.dismissVersionDescription').replace('{version}', safeVersion)}</span>
        </div>
      </div>
    `;
    const footer = `
      <button class="btn btn-secondary" id="btn-update-dismiss-cancel">${t('common.cancel')}</button>
      <button class="btn btn-secondary" id="btn-update-dismiss-once">${t('updates.dismissOnce')}</button>
      <button class="btn btn-primary" id="btn-update-dismiss-version">${t('updates.dismissVersion')}</button>
    `;

    this.openModal(t('updates.dismissTitle'), body, footer);

    document.getElementById('btn-update-dismiss-cancel')?.addEventListener('click', () => {
      this.closeModal();
    });

    document.getElementById('btn-update-dismiss-once')?.addEventListener('click', () => {
      this.sessionDismissedAppUpdateVersion = latestVersion;
      this.closeModal();
      this.updateAppUpdateBanner();
      this.refreshSettingsUpdateSection();
      this.toast(t('updates.dismissedSessionToast'), 'info');
    });

    document.getElementById('btn-update-dismiss-version')?.addEventListener('click', async () => {
      const onceBtn = document.getElementById('btn-update-dismiss-once');
      const versionBtn = document.getElementById('btn-update-dismiss-version');
      const cancelBtn = document.getElementById('btn-update-dismiss-cancel');
      [onceBtn, versionBtn, cancelBtn].forEach(btn => {
        if (btn) btn.disabled = true;
      });

      try {
        await this.persistDismissedAppUpdateVersion(latestVersion);
        this.closeModal();
        this.updateAppUpdateBanner();
        this.refreshSettingsUpdateSection();
        this.toast(t('updates.dismissedVersionToast').replace('{version}', `v${latestVersion}`), 'info');
      } catch (err) {
        [onceBtn, versionBtn, cancelBtn].forEach(btn => {
          if (btn) btn.disabled = false;
        });
        this.toast(`${t('common.error')}: ${err?.message || t('updates.reminderSaveFailed')}`, 'error');
      }
    });
  },

  shareWarningHTML() {
    if (this.shareAvailable) return '';
    return `
      <div class="rsat-warning" style="border-left-color:#ef4444;background:rgba(239,68,68,0.08);">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
        <div>
          <strong style="color:#ef4444;">${t('gui.shareUnavailable')}</strong> — ${t('gui.displayedDataMayBeOutdatedDeploymentOperationsAre')}
        </div>
      </div>`;
  },

  // ─── Utils ─────────────────────────────────────────
  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  },

  formatDate(dateStr) {
    if (!dateStr) return '—';
    let ts = dateStr;
    // Handle PowerShell /Date(timestamp)/ format
    if (typeof dateStr === 'string' && dateStr.includes('/Date(')) {
      const match = dateStr.match(/\/Date\((\d+)\)\//);
      ts = match ? parseInt(match[1]) : dateStr;
    }
    // Handle PowerShell Date(timestamp) format without slashes
    if (typeof dateStr === 'string' && dateStr.includes('Date(')) {
      const match = dateStr.match(/\d+/);
      ts = match ? parseInt(match[0]) : dateStr;
    }
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  },

  // ─── Shared OU Picker Component HTML ──────────────────
  ouPickerTreeHTML(nodes, query, selectedDN) {
    if (!nodes || !nodes.length) return '';
    const q = (query || '').trim().toLowerCase();
    const selectedDNs = Array.isArray(selectedDN)
      ? selectedDN.filter(Boolean)
      : (selectedDN ? [selectedDN] : []);
    let html = '<ul class="tree" style="margin:0;padding-left:0;">';
    for (const node of nodes) {
      if (q && !this.ouNodeMatchesSearch(node, q)) continue;
      const hasChildren = node.children && node.children.length > 0;
      const isSelected = selectedDNs.includes(node.dn);
      // Auto-expand: when searching, when selected, or when selected is a descendant
      const selectedIsDescendant = selectedDNs.some(dn => dn !== node.dn && dn.includes(node.dn));
      const shouldExpand = q ? true : (isSelected || !!selectedIsDescendant);
      
      const escName = this._esc(node.name);
      
      html += `
        <li class="tree-item">
          <div class="tree-node ${isSelected ? 'selected' : ''}" data-dn="${this._esc(node.dn)}" data-name="${escName}">
            <button class="tree-toggle ${hasChildren ? (shouldExpand ? 'expanded' : '') : 'empty'}" type="button">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
            <span class="tree-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            </span>
            <span class="tree-label">${escName}</span>
          </div>
          ${hasChildren ? `<div class="tree-children ${shouldExpand ? '' : 'collapsed'}">${this.ouPickerTreeHTML(node.children, query, selectedDN)}</div>` : ''}
        </li>`;
    }
    html += '</ul>';
    return html;
  },

  ouNodeMatchesSearch(node, q) {
    if (node.name.toLowerCase().includes(q)) return true;
    if (node.children) {
      for (const child of node.children) {
        if (this.ouNodeMatchesSearch(child, q)) return true;
      }
    }
    return false;
  },
  
  _esc(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
};

// Start the app
document.addEventListener('DOMContentLoaded', () => App.init());
