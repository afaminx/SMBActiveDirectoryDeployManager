const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { getCurrentAppVersion } = require('./services/app-version');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    frame: false,           
    backgroundColor: '#0a0e1a',
    // icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Security: Prevent navigation
  mainWindow.webContents.on('will-navigate', (event, url) => {
    event.preventDefault();
    console.warn('Navigation blocked:', url);
  });

  // Security: Prevent creating new windows/tabs
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    console.warn('New window blocked:', url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer]: ${message} (line ${line})`);
  });

  // Log any renderer errors
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDesc) => {
    console.error('Failed to load:', errorCode, errorDesc);
  });

  mainWindow.webContents.on('crashed', () => {
    console.error('Renderer process crashed');
  });
}

app.whenReady().then(() => {
  console.log('App ready, loading services...');

  const adService = require('./services/ad-service');
  const appService = require('./services/app-service');
  const { assertString, assertStringOrNull, assertArray, assertBoolean, assertObject, assertId } = require('./services/ipc-validators');
  const { ipcLog } = require('./services/ipc-logger');
  const scriptService = require('./services/script-service');
  const fileService = require('./services/file-service');
  const configService = require('./services/config');
  const bundleService = require('./services/bundle-service');
  const activityLog = require('./services/activity-log');
  const logSink = require('./services/log-sink');
  const i18nService = require('./services/i18n');
  const catalogService = require('./services/catalog-service');
  const templateService = require('./services/template-service');
  const shareHealth = require('./services/share-health');
  const updateService = require('./services/update-service');
  const scriptUpdateService = require('./services/script-update-service');

  console.log('Initialize i18n...');
  i18nService.initialize();

  // Sweep orphaned temp PS scripts from previous sessions
  try {
    const swept = appService.cleanupTempFiles();
    if (swept && swept.removed) console.log(`Temp cleanup: removed ${swept.removed} orphan script(s)`);
  } catch (e) {
    console.warn('Temp cleanup failed:', e.message);
  }

  console.log('Services loaded, creating window...');
  createWindow();
  console.log('Window created');

  scriptUpdateService.ensureBackgroundSync(getCurrentAppVersion()).catch(err => {
    console.warn('Background script update sync failed:', err?.message || err);
  });

  // Run initial share health check (non-blocking) so the cache is warm
  // before the renderer starts making sync share calls.
  shareHealth.check().then(s => {
    console.log(`[share-health] Initial check: ${s.available ? 'OK' : 'UNAVAILABLE'} ${s.error || ''}`);
  });

  // ─── Window Controls (frameless) ───────────────────────────────
  ipcMain.on('window:minimize', () => mainWindow.minimize());
  ipcMain.on('window:maximize', () => {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on('window:close', () => mainWindow.close());

  // ─── IPC Handlers: Share Health ───────────────────────────────────
  ipcMain.handle('share:checkHealth', () => shareHealth.check());
  ipcMain.handle('share:getStatus', () => shareHealth.getStatus());

  // ─── IPC Handlers: Config ────────────────────────────────────────
  ipcMain.handle('config:get', () => configService.getConfig());
  ipcMain.handle('config:set', (_, data) => {
    try { assertObject(data, 'data'); }
    catch (e) { return { success: false, error: 'Invalid arguments' }; }
    const result = configService.setConfig(data);
    // If share path changed, invalidate the health cache
    if (data?.networkSharePath !== undefined) shareHealth.invalidate();
    return result;
  });
  ipcMain.handle('config:selectFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory']
    });
    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0];
    }
    return null;
  });
  ipcMain.handle('config:selectFile', async (_, filters) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: filters || [{ name: 'Todos los archivos', extensions: ['*'] }]
    });
    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0];
    }
    return null;
  });

  // ─── IPC Handlers: AD Service ────────────────────────────────────
  ipcMain.handle('ad:checkRSAT', () => adService.checkRSAT());
  ipcMain.handle('ad:testADConnection', () => adService.testADConnection());
  ipcMain.handle('ad:getOUs', (_, ignoreBaseOU = false) => {
    try { assertBoolean(ignoreBaseOU, 'ignoreBaseOU'); }
    catch (e) { return { success: false, error: 'Invalid arguments', data: [] }; }
    return adService.getOUs(ignoreBaseOU);
  });
  ipcMain.handle('ad:getGPOs', () => adService.getGPOs());
  ipcMain.handle('ad:getGPOLinkCounts', () => adService.getGPOLinkCounts());
  ipcMain.handle('ad:createGPO', ipcLog('ad:createGPO', async (_, name, scriptPath, ouDN) => {
    try {
      assertString(name, 'name');
      assertString(scriptPath, 'scriptPath');
      if (Array.isArray(ouDN)) ouDN.forEach((dn, idx) => assertString(dn, `ouDN[${idx}]`));
      else assertStringOrNull(ouDN, 'ouDN');
    } catch (e) { return { success: false, error: 'Invalid arguments' }; }
    const result = await adService.createGPO(name, scriptPath, ouDN);
    if (result.success) {
      logSink.addSync('gpo_create', {
        source: 'ad', level: 'info',
        message: `GPO creada: ${name}`,
        gpoName: name
      });
    }
    return result;
  }));
  ipcMain.handle('ad:linkGPOtoOU', (_, gpoName, ouDN) => {
    try { assertString(gpoName, 'gpoName'); assertString(ouDN, 'ouDN'); }
    catch (e) { return { success: false, error: 'Invalid arguments' }; }
    return adService.linkGPOtoOU(gpoName, ouDN);
  });
  ipcMain.handle('ad:bulkLinkGPO', (_, gpoName, ouDNs) => {
    try { assertString(gpoName, 'gpoName'); assertArray(ouDNs, 'ouDNs'); }
    catch (e) { return { success: false, error: 'Invalid arguments' }; }
    return adService.bulkLinkGPO(gpoName, ouDNs);
  });
  ipcMain.handle('ad:deleteGPO', ipcLog('ad:deleteGPO', async (_, gpoName) => {
    try { assertString(gpoName, 'gpoName'); }
    catch (e) { return { success: false, error: 'Invalid arguments' }; }
    const result = await adService.deleteGPO(gpoName);
    if (result.success) {
      logSink.addSync('gpo_delete', {
        source: 'ad', level: 'warn',
        message: `GPO eliminada: ${gpoName}`,
        gpoName
      });
    }
    return result;
  }));
  ipcMain.handle('ad:checkGPOExists', (_, gpoName) => {
    try { assertString(gpoName, 'gpoName'); }
    catch (e) { return { exists: false }; }
    return adService.checkGPOExists(gpoName);
  });
  ipcMain.handle('ad:unlinkGPOfromOU', (_, gpoName, ouDN) => {
    try { assertString(gpoName, 'gpoName'); assertString(ouDN, 'ouDN'); }
    catch (e) { return { success: false, error: 'Invalid arguments' }; }
    return adService.unlinkGPOfromOU(gpoName, ouDN);
  });
  ipcMain.handle('ad:removeGPOStartupScript', (_, gpoName) => {
    try { assertString(gpoName, 'gpoName'); }
    catch (e) { return { success: false, error: 'Invalid arguments' }; }
    return adService.removeGPOStartupScript(gpoName);
  });
  ipcMain.handle('ad:checkGPOConflicts', (_, ouDN) => {
    try { assertString(ouDN, 'ouDN'); }
    catch (e) { return { success: false, error: 'Invalid arguments' }; }
    return adService.checkGPOConflicts(ouDN);
  });
  ipcMain.handle('ad:getManagedGPOLinks', (_, gpoNames, ouDNs = []) => {
    try {
      assertArray(gpoNames, 'gpoNames');
      assertArray(ouDNs, 'ouDNs');
    } catch (e) {
      return { success: false, error: 'Invalid arguments', data: {} };
    }
    return adService.getManagedGPOLinks(gpoNames, ouDNs);
  });

  // ─── IPC Handlers: App Service ───────────────────────────────────
  ipcMain.handle('apps:getAll', () => appService.getAll());
  ipcMain.handle('apps:get', (_, id) => {
    try { assertString(id, 'id'); } catch (e) { return null; }
    return appService.get(id);
  });
  ipcMain.handle('apps:create', (_, data) => {
    try { assertObject(data, 'data'); } catch (e) { return { success: false, error: 'Invalid arguments' }; }
    return appService.create(data);
  });
  ipcMain.handle('apps:update', (_, id, data) => {
    try { assertString(id, 'id'); assertObject(data, 'data'); }
    catch (e) { return { success: false, error: 'Invalid arguments' }; }
    return appService.update(id, data);
  });
  ipcMain.handle('apps:delete', (_, id, deleteFiles) => {
    try {
      assertString(id, 'id');
      if (deleteFiles !== undefined) assertBoolean(deleteFiles, 'deleteFiles');
    }
    catch (e) { return { success: false, error: 'Invalid arguments' }; }
    return appService.remove(id, deleteFiles);
  });
  ipcMain.handle('apps:bulkAssignGPO', (_, ids, gpoName) => {
    try { assertArray(ids, 'ids'); assertString(gpoName, 'gpoName'); }
    catch (e) { return { success: false, error: 'Invalid arguments' }; }
    return appService.bulkAssignGPO(ids, gpoName);
  });
  ipcMain.handle('apps:applyAssignmentPlan', (_, plan, allVisibleOUs) => {
    try { assertObject(plan, 'plan'); }
    catch (e) { return { success: false, error: 'Invalid arguments' }; }
    const safeOUs = Array.isArray(allVisibleOUs) ? allVisibleOUs : [];
    return appService.applyAssignmentPlan(plan, safeOUs);
  });
  ipcMain.handle('apps:reconcileManagedAssignments', (_, ouDNs = []) => {
    try { assertArray(ouDNs, 'ouDNs'); }
    catch (e) { return { success: false, error: 'Invalid arguments', data: [], links: {} }; }
    return appService.reconcileManagedAssignments(ouDNs);
  });
  ipcMain.handle('apps:getInstallerVersion', (_, filePath) => {
    try { assertString(filePath, 'filePath', 1024); }
    catch (e) { return { success: false, error: 'Invalid arguments' }; }
    return appService.getInstallerVersion(filePath);
  });
  ipcMain.handle('apps:detectInstallerSignature', (_, filePath) => {
    try { assertString(filePath, 'filePath', 1024); }
    catch (e) { return { success: false, error: 'Invalid arguments' }; }
    return appService.detectInstallerSignature(filePath);
  });
  ipcMain.handle('apps:computeHash', (_, filePath) => {
    try { assertString(filePath, 'filePath', 1024); }
    catch (e) { return { hash: null, error: 'Invalid arguments' }; }
    return { hash: appService.computeFileHash(filePath) };
  });

  // ─── IPC Handlers: Script Service ────────────────────────────────
  ipcMain.handle('scripts:generate', (_, appConfig) => {
    try { assertObject(appConfig, 'appConfig'); }
    catch (e) { return ''; }
    return scriptService.generateScript(appConfig);
  });
  ipcMain.handle('scripts:generateUninstall', (_, appConfig) => {
    try { assertObject(appConfig, 'appConfig'); }
    catch (e) { return ''; }
    try {
      return scriptService.generateUninstallScript(appConfig);
    } catch (err) {
      return '';
    }
  });
  const _deployingScripts = new Set();
  ipcMain.handle('scripts:deploy', ipcLog('scripts:deploy', async (_, appConfig) => {
    try { assertObject(appConfig, 'appConfig'); }
    catch (e) { return { success: false, error: 'Invalid arguments' }; }

    const appId = appConfig.id || appConfig.name;
    if (_deployingScripts.has(appId)) return { success: false, error: 'Deploy in progress' };
    _deployingScripts.add(appId);

    try {
      const result = await scriptService.deployScript(appConfig);
      if (result.success) {
        logSink.addSync('script_deploy', {
          source: 'deploy', level: 'info',
          message: `Script desplegado: ${appConfig.name || appId}`,
          appName: appConfig.name || appId
        });
      }
      return result;
    } finally {
      _deployingScripts.delete(appId);
    }
  }));
  ipcMain.handle('scripts:regenerate', ipcLog('scripts:regenerate', async (_, appConfig) => {
    try { assertObject(appConfig, 'appConfig'); }
    catch (e) { return { success: false, error: 'Invalid arguments' }; }

    const appId = appConfig.id || appConfig.name;
    if (_deployingScripts.has(appId)) return { success: false, error: 'Deploy in progress' };
    _deployingScripts.add(appId);

    try {
      return await scriptService.regenerateScripts(appConfig);
    } finally {
      _deployingScripts.delete(appId);
    }
  }));
  ipcMain.handle('scripts:deployUninstall', (_, appConfig) => {
    try { assertObject(appConfig, 'appConfig'); }
    catch (e) { return { success: false, error: 'Invalid arguments' }; }
    return scriptService.deployUninstallScript(appConfig);
  });
  ipcMain.handle('scripts:getTemplates', () => scriptService.getTemplateList());
  ipcMain.handle('templates:getAll', () => templateService.getAll());
  ipcMain.handle('templates:get', (_, id) => {
    try { assertId(id, 'id'); } catch (e) { return null; }
    return templateService.get(id);
  });
  ipcMain.handle('templates:create', (_, data) => {
    try { assertObject(data, 'data'); } catch (e) { return { success: false, error: 'Invalid arguments' }; }
    return templateService.create(data);
  });
  ipcMain.handle('templates:update', (_, id, data) => {
    try { assertId(id, 'id'); assertObject(data, 'data'); }
    catch (e) { return { success: false, error: 'Invalid arguments' }; }
    return templateService.update(id, data);
  });
  ipcMain.handle('templates:delete', (_, id) => {
    try { assertId(id, 'id'); } catch (e) { return { success: false, error: 'Invalid arguments' }; }
    return templateService.remove(id);
  });

  ipcMain.handle('templates:saveInstaller', async (_, templateId, localPath) => {
    try {
      const fs = require('fs');
      const pathMod = require('path');
      assertId(templateId, 'templateId');
      if (typeof localPath !== 'string' || !localPath.trim()) return { success: false, error: 'Invalid path' };
      if (!fs.existsSync(localPath)) return { success: false, error: 'File not found' };
      const health = await shareHealth.check();
      if (!health.available) return { success: false, error: 'SHARE_UNAVAILABLE' };
      const config = configService.getConfig();
      if (!config.networkSharePath) return { success: false, error: 'Network share not configured' };
      const templatesRoot = pathMod.resolve(config.networkSharePath, '_templates');
      const destDir = pathMod.resolve(templatesRoot, String(templateId).replace(/[^a-zA-Z0-9_\-]/g, '_'));
      const relativeDestDir = pathMod.relative(templatesRoot, destDir);
      if (relativeDestDir.startsWith('..') || pathMod.isAbsolute(relativeDestDir)) {
        return { success: false, error: 'Invalid template path' };
      }
      await fs.promises.mkdir(destDir, { recursive: true });
      const fileName = pathMod.basename(localPath);
      const tempName = `.__uploading__${Date.now()}_${fileName}`;
      const tempPath = pathMod.join(destDir, tempName);
      const destPath = pathMod.join(destDir, fileName);
      await fs.promises.copyFile(localPath, tempPath);

      const entries = await fs.promises.readdir(destDir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (!entry.name.startsWith('.__uploading__')) {
          await fs.promises.rm(pathMod.join(destDir, entry.name), { recursive: true, force: true });
        }
      }

      await fs.promises.rename(tempPath, destPath);
      return { success: true, sharePath: destPath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('templates:deleteInstaller', async (_, templateId) => {
    try {
      const fs = require('fs');
      const pathMod = require('path');
      assertId(templateId, 'templateId');
      const health = await shareHealth.check();
      if (!health.available) return { success: false, error: 'SHARE_UNAVAILABLE' };
      const config = configService.getConfig();
      if (!config.networkSharePath) return { success: false, error: 'Network share not configured' };
      const templatesRoot = pathMod.resolve(config.networkSharePath, '_templates');
      const destDir = pathMod.resolve(templatesRoot, String(templateId).replace(/[^a-zA-Z0-9_\-]/g, '_'));
      const relativeDestDir = pathMod.relative(templatesRoot, destDir);
      if (relativeDestDir.startsWith('..') || pathMod.isAbsolute(relativeDestDir)) {
        return { success: false, error: 'Invalid template path' };
      }
      await fs.promises.rm(destDir, { recursive: true, force: true });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ─── IPC Handlers: Catalog Service (replaces old winget handlers) ──
  // Backward-compatible aliases (used by apps.js wizard)
  ipcMain.handle('winget:getCatalog', () => catalogService.getCatalog());
  ipcMain.handle('winget:checkVersions', (_, catalogIds) => {
    try { assertArray(catalogIds, 'catalogIds'); }
    catch (e) { return []; }
    return catalogService.checkVersions(catalogIds);
  });
  // New catalog endpoints (used by catalog page)
  ipcMain.handle('catalog:getCatalog', () => catalogService.getCatalog());
  ipcMain.handle('catalog:search', (_, query, category) => {
    try {
      if (query !== undefined && query !== null) assertString(query, 'query', 256);
      if (category !== undefined && category !== null) assertString(category, 'category', 64);
    } catch (e) { return []; }
    return catalogService.search(query, category);
  });
  ipcMain.handle('catalog:searchCLI', (_, query) => {
    if (typeof query !== 'string' || query.length > 256) return [];
    return catalogService.searchCLI(query);
  });
  ipcMain.handle('catalog:checkVersions', (_, catalogIds) => {
    try { assertArray(catalogIds, 'catalogIds'); }
    catch (e) { return []; }
    return catalogService.checkVersions(catalogIds);
  });
  ipcMain.handle('catalog:checkSingle', (_, wingetId, wingetSource, name) => {
    try {
      if (wingetId !== undefined && wingetId !== null) assertString(wingetId, 'wingetId', 256);
      if (wingetSource !== undefined && wingetSource !== null) assertString(wingetSource, 'wingetSource', 64);
      if (name !== undefined && name !== null) assertString(name, 'name', 256);
    }
    catch (e) { return { wingetId: null, wingetSource: null, latestVersion: null }; }
    return catalogService.checkSingle(wingetId, wingetSource, name);
  });
  ipcMain.handle('catalog:resolvePackage', (_, reference) => {
    try { assertObject(reference, 'reference'); }
    catch (e) { return { wingetId: '', wingetSource: 'winget', latestVersion: null, name: '', available: false }; }
    return catalogService.resolvePackage(reference);
  });
  ipcMain.handle('scriptUpdates:getStatus', () => scriptUpdateService.getStatus());
  ipcMain.handle('updates:getCurrent', () => ({
    currentVersion: getCurrentAppVersion()
  }));
  ipcMain.handle('updates:check', async () => updateService.checkForUpdates(getCurrentAppVersion()));
  ipcMain.handle('updates:openReleasePage', async () => {
    try {
      await shell.openExternal(updateService.RELEASE_PAGE_URL);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ─── IPC Handlers: File Service ──────────────────────────────────
  ipcMain.handle('files:listDeployed', () => fileService.listDeployedApps());
  ipcMain.handle('files:getContents', (_, name) => {
    try { assertString(name, 'name', 256); }
    catch (e) { return { success: false, error: 'Invalid arguments', data: [] }; }
    return fileService.getAppContents(name);
  });
  ipcMain.handle('files:createFolder', (_, name) => {
    try { assertString(name, 'name', 256); }
    catch (e) { return { success: false, error: 'Invalid arguments' }; }
    return fileService.createAppFolder(name);
  });

  // ─── IPC Handlers: Bundle Service ─────────────────────────────────
  ipcMain.handle('bundles:getAll', () => bundleService.getAll());
  ipcMain.handle('bundles:get', (_, id) => {
    try { assertString(id, 'id'); } catch (e) { return null; }
    return bundleService.get(id);
  });
  ipcMain.handle('bundles:create', (_, data) => {
    try { assertObject(data, 'data'); }
    catch (e) { return { success: false, error: 'Invalid arguments' }; }
    return bundleService.create(data);
  });
  ipcMain.handle('bundles:update', (_, id, data) => {
    try { assertString(id, 'id'); assertObject(data, 'data'); }
    catch (e) { return { success: false, error: 'Invalid arguments' }; }
    return bundleService.update(id, data);
  });
  ipcMain.handle('bundles:delete', (_, id) => {
    try { assertString(id, 'id'); }
    catch (e) { return { success: false, error: 'Invalid arguments' }; }
    return bundleService.remove(id);
  });

  // Backend guard: reject duplicate deploy requests for the same bundle
  const _deployingBundles = new Set();
  ipcMain.handle('bundles:deploy', async (_, bundleId) => {
    try { assertString(bundleId, 'bundleId'); }
    catch (e) { return { success: false, error: 'Invalid arguments' }; }
    if (_deployingBundles.has(bundleId)) {
      return { success: false, error: 'already_deploying' };
    }
    _deployingBundles.add(bundleId);
    try {
      const bundle = bundleService.get(bundleId);
      if (!bundle) return { success: false, error: 'Bundle not found' };
      const apps = appService.getAll();
      const config = configService.getConfig();
      const result = await bundleService.deployBundle(bundle, apps, config);
      if (result.success) {
        bundleService.update(bundleId, {
          deployed: true,
          deployedPath: result.path,
          publishedAction: 'install',
          publishedAt: new Date().toISOString()
        });
        logSink.addSync('bundle_deploy', {
          bundleName: bundle.name,
          version: bundle.version,
          source: 'bundle',
          message: `Bundle desplegado: ${bundle.name}`
        });
      }
      return result;
    } finally {
      _deployingBundles.delete(bundleId);
    }
  });
  ipcMain.handle('bundles:deployUninstall', async (_, bundleId) => {
    try { assertString(bundleId, 'bundleId'); }
    catch (e) { return { success: false, error: 'Invalid arguments' }; }
    if (_deployingBundles.has(bundleId)) {
      return { success: false, error: 'already_deploying' };
    }
    _deployingBundles.add(bundleId);
    try {
      const bundle = bundleService.get(bundleId);
      if (!bundle) return { success: false, error: 'Bundle not found' };
      const apps = appService.getAll();
      const config = configService.getConfig();
      const result = await bundleService.deployBundleUninstall(bundle, apps, config);
      if (result.success) {
        bundleService.update(bundleId, {
          uninstallDeployedPath: result.path,
          uninstallPreparedAt: new Date().toISOString(),
          publishedAction: 'uninstall',
          publishedAt: new Date().toISOString()
        });
        logSink.addSync('bundle_uninstall_prepare', {
          bundleName: bundle.name,
          version: bundle.version,
          source: 'bundle',
          message: `Desinstalacion de bundle preparada: ${bundle.name}`
        });
      }
      return result;
    } finally {
      _deployingBundles.delete(bundleId);
    }
  });
  ipcMain.handle('bundles:generateScript', (_, bundleId) => {
    try { assertString(bundleId, 'bundleId'); }
    catch (e) { return ''; }
    const bundle = bundleService.get(bundleId);
    if (!bundle) return '';
    const apps = appService.getAll();
    const config = configService.getConfig();
    return bundleService.generateBundleScript(bundle, apps, config);
  });
  ipcMain.handle('bundles:generateUninstallScript', (_, bundleId) => {
    try { assertString(bundleId, 'bundleId'); }
    catch (e) { return ''; }
    const bundle = bundleService.get(bundleId);
    if (!bundle) return '';
    const apps = appService.getAll();
    const config = configService.getConfig();
    return bundleService.generateBundleUninstallScript(bundle, apps, config);
  });

  // ─── IPC Handlers: Activity Log ───────────────────────────────────
  ipcMain.handle('activity:getRecent', (_, count) => activityLog.getRecent(count));
  ipcMain.handle('activity:add', async (_, action, details) => {
    try { assertString(action, 'action', 128); assertObject(details || {}, 'details'); }
    catch (e) { return { success: false, error: 'Invalid arguments' }; }
    // Allowlist the fields the renderer is permitted to log — prevents
    // accidental credential leakage from renderer-side app config objects.
    const allowed = new Set([
      'message', 'source', 'level', 'severity',
      'appName', 'bundleName', 'gpoName', 'ouDN', 'version', 'context'
    ]);
    const safe = {};
    for (const k of allowed) {
      if ((details || {})[k] !== undefined) safe[k] = details[k];
    }
    return logSink.add(action, safe);
  });

  // ─── IPC Handlers: Logging backend (local vs dedicated) ──────────
  const configShare = require('./services/config-share');
  const secretStore = require('./services/secret-store');
  const os = require('os');

  ipcMain.handle('logs:query', async (_, filters) => {
    try { assertObject(filters || {}, 'filters'); } catch (e) { return { items: [], nextCursor: null, error: 'Invalid arguments' }; }
    try { return await logSink.query(filters || {}); }
    catch (err) { return { items: [], nextCursor: null, error: err.message }; }
  });
  ipcMain.handle('logs:recent', async (_, count) => {
    try { return await logSink.getRecent(Number(count) || 10); }
    catch (err) { return []; }
  });
  ipcMain.handle('logs:statsSummary', async (_, win) => {
    try { return await logSink.statsSummary(typeof win === 'string' ? win : '24h'); }
    catch (err) { return { error: err.message }; }
  });
  ipcMain.handle('logs:equipos', async (_, search) => {
    try { return await logSink.equipos(typeof search === 'string' ? search : ''); }
    catch (err) { return []; }
  });
  ipcMain.handle('logs:status', async () => {
    try { return await logSink.status(); }
    catch (err) { return { mode: 'local', online: true, queueSize: 0, error: err.message }; }
  });
  ipcMain.handle('logs:reload', async () => {
    try { await logSink.reload(); return { success: true }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  // Peek the share for a logging-config.json (called on setup).
  ipcMain.handle('share:detectLoggingConfig', async () => {
    try {
      const cfg = configService.getConfig();
      if (!cfg.networkSharePath) return { present: false };
      const peek = await configShare.peekSharedConfig(cfg.networkSharePath);
      if (!peek) return { present: false };
      const configFingerprint = configShare.fingerprint(peek);
      const remote = cfg.remoteLogging || {};
      return {
        present: true,
        apiBaseUrl: peek.apiBaseUrl,
        tlsFingerprint: peek.tlsFingerprint || null,
        shareId: peek.shareId,
        issuedAt: peek.issuedAt,
        signaturePresent: !!peek.signature,
        readKeyPresent: !!peek.readApiKey,
        configFingerprint,
        changed: !!(remote.configFingerprint && remote.configFingerprint !== configFingerprint),
        readonly: true
      };
    } catch (err) {
      return { present: false, error: err.message };
    }
  });

  // Consume the share config and enroll this equipo.
  ipcMain.handle('share:enrollFromConfig', async () => {
    try {
      const cfg = configService.getConfig();
      if (!cfg.networkSharePath) return { success: false, error: 'no_share_path' };
      const peek = await configShare.peekSharedConfig(cfg.networkSharePath);
      if (!peek) return { success: false, error: 'no_shared_config' };
      if (!peek.signature) return { success: false, error: 'shared_config_unsigned' };

      const configFingerprint = configShare.fingerprint(peek);
      // Trust share content unconditionally: re-publishing the config
      // (e.g. cert rotation) must not block re-enrollment.
      const enroll = await configShare.enrollWithShare(peek, os.hostname());
      if (!enroll || !enroll.apiKey) {
        return { success: false, error: 'enrollment_failed' };
      }

      if (!secretStore.available()) {
        return { success: false, error: 'safe_storage_unavailable' };
      }
      secretStore.set('ingest_api_key', enroll.apiKey);
      if (peek.readApiKey) {
        secretStore.set('read_api_key', peek.readApiKey);
      } else {
        secretStore.delete('read_api_key');
      }

      configService.setConfig({
        logMode: 'dedicated',
        shareId: peek.shareId,
        remoteLogging: {
          apiBaseUrl: peek.apiBaseUrl,
          tlsFingerprint: peek.tlsFingerprint || null,
          readonly: true,
          enrolledAt: new Date().toISOString(),
          equipoId: enroll.equipoId,
          configFingerprint,
          configSignature: peek.signature
        }
      });
      await logSink.reload();
      await logSink.add('log_backend_enrolled', {
        apiBaseUrl: peek.apiBaseUrl,
        equipoId: enroll.equipoId,
        source: 'logging',
        message: `Equipo enrolado en servidor dedicado: ${peek.apiBaseUrl}`
      });
      return { success: true, equipoId: enroll.equipoId };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Admin helper: publish a signed logging-config.json to the share.
  ipcMain.handle('share:publishLoggingConfig', async (_, options = {}) => {
    try {
      try { assertObject(options || {}, 'options'); }
      catch { return { success: false, error: 'Invalid arguments' }; }

      let cfg = configService.getConfig();
      if (!cfg.networkSharePath) return { success: false, error: 'no_share_path' };

      if (!cfg.shareId) {
        const saved = configService.setConfig({});
        if (!saved.success) return { success: false, error: saved.error || 'share_id_failed' };
        cfg = saved.data || configService.getConfig();
      }

      const remote = cfg.remoteLogging || {};
      const apiBaseUrl = String(options.apiBaseUrl || remote.apiBaseUrl || '').trim();
      if (!apiBaseUrl) return { success: false, error: 'no_api_base_url' };

      const admin = require('./services/admin-service');
      // Default: per-app token with no expiry and unlimited uses.
      // Caller can pass explicit ttlHours/usesLeft to restrict.
      const ttlHours = options.ttlHours == null ? null : Number(options.ttlHours);
      const usesLeft = options.usesLeft == null ? null : Number(options.usesLeft);
      const unlimited = options.unlimited !== false && ttlHours == null && usesLeft == null;
      const shareSecret = await admin.createShareSecret(cfg.shareId);
      const token = await admin.createEnrollmentToken({
        shareId: cfg.shareId,
        ttlHours,
        usesLeft,
        unlimited
      });
      const readKey = options.publishReadKey === false
        ? null
        : await admin.createKey({
            name: `share-read-${cfg.shareId}`,
            scope: 'read'
          });

      const written = await configShare.writeSharedConfig(cfg.networkSharePath, {
        apiBaseUrl,
        enrollmentToken: token.enrollmentToken,
        readApiKey: readKey?.apiKey || '',
        shareId: cfg.shareId,
        tlsFingerprint: options.tlsFingerprint ?? remote.tlsFingerprint ?? null
      }, shareSecret.secret);
      if (readKey?.apiKey && secretStore.available()) {
        secretStore.set('read_api_key', readKey.apiKey);
      }

      await logSink.add('log_share_config_published', {
        source: 'logging',
        message: `Configuracion de logs publicada en share: ${cfg.shareId}`,
        shareId: cfg.shareId,
        apiBaseUrl
      });

      return {
        success: true,
        path: written.path,
        shareId: cfg.shareId,
        expiresInHours: token.expiresInHours,
        usesLeft: token.usesLeft,
        readKeyPublished: !!readKey?.apiKey
      };
    } catch (err) {
      return { success: false, error: err.message || String(err) };
    }
  });

  // Switch to local mode (reversible). Does not touch the share file.
  ipcMain.handle('logs:useLocal', async () => {
    configService.setConfig({ logMode: 'local' });
    secretStore.delete('ingest_api_key');
    secretStore.delete('read_api_key');
    await logSink.reload();
    return { success: true };
  });

  // ─── IPC Handlers: Admin (API key management) ─────────────────────
  const adminService = require('./services/admin-service');

  function wrapAdmin(fn) {
    return async (...args) => {
      try { return { success: true, data: await fn(...args) }; }
      catch (err) { return { success: false, error: err.message || String(err) }; }
    };
  }

  ipcMain.handle('admin:status', () => adminService.status());
  ipcMain.handle('admin:login', (_, payload) => {
    try { assertObject(payload, 'payload'); }
    catch (e) { return { success: false, error: 'Invalid arguments' }; }
    return adminService.login(payload);
  });
  ipcMain.handle('admin:logout', () => adminService.logout());

  ipcMain.handle('admin:listKeys',           wrapAdmin(() => adminService.listKeys()));
  ipcMain.handle('admin:createKey',          wrapAdmin((_, p) => adminService.createKey(p)));
  ipcMain.handle('admin:revokeKey',          wrapAdmin((_, id) => adminService.revokeKey(id)));
  ipcMain.handle('admin:listShareSecrets',   wrapAdmin(() => adminService.listShareSecrets()));
  ipcMain.handle('admin:createShareSecret',  wrapAdmin((_, id) => adminService.createShareSecret(id)));
  ipcMain.handle('admin:listEnrollTokens',   wrapAdmin(() => adminService.listEnrollmentTokens()));
  ipcMain.handle('admin:createEnrollToken',  wrapAdmin((_, p) => adminService.createEnrollmentToken(p)));
  ipcMain.handle('admin:provisionIngestKey', wrapAdmin(async (_, name) => {
    const r = await adminService.provisionIngestKey(name);
    await logSink.reload();
    return r;
  }));

  // ─── IPC Handlers: TLS cert inspection / trust ────────────────────
  const certTrust = require('./services/cert-trust');
  ipcMain.handle('cert:inspect', async (_, baseUrl) => {
    try { assertString(baseUrl, 'baseUrl', 512); }
    catch { return { success: false, error: 'invalid_arguments' }; }
    try { return { success: true, data: await certTrust.inspect(baseUrl) }; }
    catch (err) { return { success: false, error: err.message }; }
  });
  ipcMain.handle('cert:trust', async (_, baseUrl) => {
    try { assertString(baseUrl, 'baseUrl', 512); }
    catch { return { success: false, error: 'invalid_arguments' }; }
    try { return { success: true, data: await certTrust.trust(baseUrl) }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  // Prime the log sink so queued entries drain on boot. The
  // sink reads its API key from the encrypted secret store, so
  // nothing sensitive is handed to the renderer.
  if (configService.getConfig().logMode === 'dedicated') {
    logSink.reload().catch(err => console.warn('log-sink init:', err.message));
  }

  // ─── IPC Handlers: Export/Import ──────────────────────────────────
  ipcMain.handle('apps:exportAll', () => appService.exportAll());
  ipcMain.handle('apps:importAll', (_, data) => appService.importAll(data));
  ipcMain.handle('config:saveFile', async (_, content, defaultName) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: defaultName,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (!result.canceled && result.filePath) {
      const fsSave = require('fs');
      fsSave.writeFileSync(result.filePath, content, 'utf-8');
      return { success: true, path: result.filePath };
    }
    return { success: false };
  });
  ipcMain.handle('config:loadFile', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (!result.canceled && result.filePaths.length > 0) {
      try {
        const fsLoad = require('fs');
        const content = fsLoad.readFileSync(result.filePaths[0], 'utf-8');
        return { success: true, data: JSON.parse(content) };
      } catch (err) {
        return { success: false, error: 'Invalid JSON file' };
      }
    }
    return { success: false };
  });

  // ─── IPC Handlers: i18n Service ──────────────────────────────────
  ipcMain.handle('i18n:getAvailable', () => i18nService.getAvailableLanguages());
  ipcMain.handle('i18n:getTranslations', (_, langCode) => i18nService.getTranslations(langCode));

}).catch(err => {
  console.error('FATAL ERROR:', err);
  process.exit(1);
});

app.on('window-all-closed', () => {
  app.quit();
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});
