const fs = require('fs');
const path = require('path');
const { resolveNamedSubdirectory } = require('./path-utils');
const { compareVersions, normalizeVersion } = require('./update-service');
const { getCurrentAppVersion, getCurrentGeneratorRevision } = require('./app-version');

function createEmptyStatus(currentAppVersion = '') {
  return {
    running: false,
    status: 'idle',
    currentAppVersion: currentAppVersion || '',
    startedAt: null,
    finishedAt: null,
    checkedAt: null,
    lastError: '',
    skippedReason: '',
    currentAppId: '',
    currentAppName: '',
    progress: {
      total: 0,
      completed: 0,
      updated: 0,
      failed: 0
    },
    outdatedApps: [],
    updatedApps: [],
    failedApps: []
  };
}

let runtimeStatus = createEmptyStatus();
let currentRunPromise = null;

function cloneStatus() {
  return JSON.parse(JSON.stringify(runtimeStatus));
}

function hasPublishedScripts(appRecord) {
  return !!(appRecord?.deployedPath || appRecord?.uninstallDeployedPath);
}

function normalizeScriptMeta(entry = {}, fallbackPath = '') {
  const pathValue = typeof entry.path === 'string' && entry.path
    ? entry.path
    : (typeof fallbackPath === 'string' ? fallbackPath : '');
  return {
    path: pathValue,
    generatedAt: typeof entry.generatedAt === 'string' ? entry.generatedAt : '',
    generatedByRevision: typeof entry.generatedByRevision === 'string' ? entry.generatedByRevision : '',
    generatedByAppVersion: normalizeVersion(entry.generatedByAppVersion || '')
      || (typeof entry.generatedByAppVersion === 'string' ? entry.generatedByAppVersion.trim() : '')
      || ''
  };
}

function inspectManifestVersions(manifest, appRecord, currentAppVersion) {
  const normalizedCurrentVersion = normalizeVersion(currentAppVersion || '') || String(currentAppVersion || '').trim() || '0.0.0';
  const manifestScripts = manifest?.scripts && typeof manifest.scripts === 'object'
    ? manifest.scripts
    : {};

  const installMeta = normalizeScriptMeta(
    manifestScripts.install,
    manifest?.installScriptPath || appRecord?.deployedPath || ''
  );
  const uninstallMeta = normalizeScriptMeta(
    manifestScripts.uninstall,
    manifest?.uninstall?.scriptPath || appRecord?.uninstallDeployedPath || ''
  );

  const reasons = [];
  const compareInstall = installMeta.path
    ? compareVersions(installMeta.generatedByAppVersion || '0.0.0', normalizedCurrentVersion)
    : 0;
  const compareUninstall = uninstallMeta.path
    ? compareVersions(uninstallMeta.generatedByAppVersion || '0.0.0', normalizedCurrentVersion)
    : 0;

  if (installMeta.path && (!installMeta.generatedByAppVersion || compareInstall < 0 || installMeta.generatedByRevision !== getCurrentGeneratorRevision())) {
    reasons.push('install-script-outdated');
  }
  if (uninstallMeta.path && (!uninstallMeta.generatedByAppVersion || compareUninstall < 0 || uninstallMeta.generatedByRevision !== getCurrentGeneratorRevision())) {
    reasons.push('uninstall-script-outdated');
  }

  return {
    needsUpdate: reasons.length > 0,
    reasons,
    install: installMeta,
    uninstall: uninstallMeta,
    currentAppVersion: normalizedCurrentVersion
  };
}

async function defaultReadManifest(appRecord, deps = {}) {
  const shareHealth = deps.shareHealth || require('./share-health');
  const configService = deps.configService || require('./config');
  if (!shareHealth.isAvailableSync()) return null;

  const config = configService.getConfig();
  if (!config?.networkSharePath || !appRecord?.name) return null;

  const { path: appFolder } = resolveNamedSubdirectory(config.networkSharePath, appRecord.name, 'App');
  const manifestPath = path.join(appFolder, 'version.json');
  try {
    const raw = await fs.promises.readFile(manifestPath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

async function defaultWriteManifest(appRecord, manifest, deps = {}) {
  const configService = deps.configService || require('./config');
  const config = configService.getConfig();
  if (!config?.networkSharePath || !appRecord?.name) return false;

  const { path: appFolder } = resolveNamedSubdirectory(config.networkSharePath, appRecord.name, 'App');
  const manifestPath = path.join(appFolder, 'version.json');
  await fs.promises.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  return true;
}

async function persistUpdaterState(appRecord, patch = {}, deps = {}, existingManifest = null) {
  const readManifest = deps.readManifest || defaultReadManifest;
  const writeManifest = deps.writeManifest || defaultWriteManifest;
  const manifest = existingManifest || await readManifest(appRecord, deps);
  if (!manifest || typeof manifest !== 'object') return null;

  const scripts = manifest.scripts && typeof manifest.scripts === 'object'
    ? manifest.scripts
    : {};
  const updater = scripts.updater && typeof scripts.updater === 'object'
    ? scripts.updater
    : {};
  const nextManifest = {
    ...manifest,
    scripts: {
      ...scripts,
      updater: {
        lastCheckedAt: patch.lastCheckedAt ?? updater.lastCheckedAt ?? '',
        lastUpdatedAt: patch.lastUpdatedAt ?? updater.lastUpdatedAt ?? '',
        lastError: patch.lastError ?? updater.lastError ?? '',
        needsUpdate: patch.needsUpdate ?? updater.needsUpdate ?? false,
        status: patch.status ?? updater.status ?? 'current'
      }
    }
  };

  await writeManifest(appRecord, nextManifest, deps);
  return nextManifest;
}

async function runUpdateCycle(currentAppVersion = getCurrentAppVersion(), options = {}) {
  const effectiveVersion = normalizeVersion(currentAppVersion || '') || String(currentAppVersion || '').trim() || '0.0.0';
  const appService = options.appService || require('./app-service');
  const scriptService = options.scriptService || require('./script-service');
  const activityLog = options.activityLog || require('./log-sink');
  const shareHealth = options.shareHealth || require('./share-health');
  const readManifest = options.readManifest || defaultReadManifest;
  const listApps = options.listApps
    || (typeof appService.getCachedAll === 'function'
      ? () => appService.getCachedAll()
      : () => appService.getAll());

  runtimeStatus = createEmptyStatus(effectiveVersion);
  runtimeStatus.running = true;
  runtimeStatus.status = 'scanning';
  runtimeStatus.startedAt = new Date().toISOString();

  if (!shareHealth.isAvailableSync()) {
    runtimeStatus.running = false;
    runtimeStatus.status = 'skipped';
    runtimeStatus.skippedReason = 'share_unavailable';
    runtimeStatus.lastError = 'SHARE_UNAVAILABLE';
    runtimeStatus.finishedAt = new Date().toISOString();
    runtimeStatus.checkedAt = runtimeStatus.finishedAt;
    return cloneStatus();
  }

  // Yield back to the event loop before touching any local manifest/cache data.
  await new Promise(resolve => setTimeout(resolve, 0));

  const listedApps = await Promise.resolve(listApps());
  const apps = Array.isArray(listedApps) ? listedApps : [];
  const appsById = new Map(
    apps
      .filter(app => app && typeof app === 'object' && app.id)
      .map(app => [app.id, app])
  );
  const outdatedApps = [];

  for (const appRecord of apps) {
    if (!hasPublishedScripts(appRecord)) continue;
    const manifest = await readManifest(appRecord, options);
    const report = inspectManifestVersions(manifest, appRecord, effectiveVersion);
    if (!report.needsUpdate) {
      await persistUpdaterState(appRecord, {
        lastCheckedAt: new Date().toISOString(),
        needsUpdate: false,
        status: 'current',
        lastError: ''
      }, options, manifest);
      continue;
    }

    outdatedApps.push({
      appId: appRecord.id,
      appName: appRecord.name,
      reasons: report.reasons,
      installVersion: report.install.generatedByAppVersion || '',
      uninstallVersion: report.uninstall.generatedByAppVersion || ''
    });

    await persistUpdaterState(appRecord, {
      lastCheckedAt: new Date().toISOString(),
      needsUpdate: true,
      status: 'pending',
      lastError: ''
    }, options, manifest);
  }

  runtimeStatus.progress.total = outdatedApps.length;
  runtimeStatus.outdatedApps = outdatedApps;

  if (outdatedApps.length === 0) {
    runtimeStatus.running = false;
    runtimeStatus.status = 'completed';
    runtimeStatus.finishedAt = new Date().toISOString();
    runtimeStatus.checkedAt = runtimeStatus.finishedAt;
    return cloneStatus();
  }

  activityLog.add('script_update_background_started', {
    appVersion: effectiveVersion,
    outdatedCount: outdatedApps.length
  });

  runtimeStatus.status = 'updating';
  for (let index = 0; index < outdatedApps.length; index += 1) {
    const entry = outdatedApps[index];
    const appRecord = appsById.get(entry.appId);
    if (!appRecord) continue;

    runtimeStatus.currentAppId = entry.appId;
    runtimeStatus.currentAppName = entry.appName;

    await persistUpdaterState(appRecord, {
      lastCheckedAt: new Date().toISOString(),
      needsUpdate: true,
      status: 'running',
      lastError: ''
    }, options);

    await new Promise(resolve => setTimeout(resolve, 0));

    try {
      const result = await Promise.resolve(scriptService.regenerateScripts(appRecord));
      if (!result?.success) {
        throw new Error(result?.error || 'Unable to regenerate scripts');
      }

      runtimeStatus.progress.updated += 1;
      runtimeStatus.updatedApps.push({ appId: entry.appId, appName: entry.appName });
      await persistUpdaterState(appRecord, {
        lastCheckedAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
        needsUpdate: false,
        status: 'current',
        lastError: ''
      }, options);
    } catch (err) {
      runtimeStatus.progress.failed += 1;
      runtimeStatus.failedApps.push({
        appId: entry.appId,
        appName: entry.appName,
        error: err?.message || 'Unknown script update error'
      });
      await persistUpdaterState(appRecord, {
        lastCheckedAt: new Date().toISOString(),
        needsUpdate: true,
        status: 'error',
        lastError: err?.message || 'Unknown script update error'
      }, options);
    } finally {
      runtimeStatus.progress.completed = index + 1;
    }
  }

  runtimeStatus.currentAppId = '';
  runtimeStatus.currentAppName = '';
  runtimeStatus.running = false;
  runtimeStatus.status = runtimeStatus.progress.failed > 0 ? 'completed_with_errors' : 'completed';
  runtimeStatus.finishedAt = new Date().toISOString();
  runtimeStatus.checkedAt = runtimeStatus.finishedAt;
  runtimeStatus.lastError = runtimeStatus.failedApps[0]?.error || '';

  activityLog.add('script_update_background_completed', {
    appVersion: effectiveVersion,
    outdatedCount: outdatedApps.length,
    updatedCount: runtimeStatus.progress.updated,
    failedCount: runtimeStatus.progress.failed
  });

  return cloneStatus();
}

function ensureBackgroundSync(currentAppVersion = getCurrentAppVersion(), options = {}) {
  if (currentRunPromise) return currentRunPromise;
  currentRunPromise = runUpdateCycle(currentAppVersion, options)
    .finally(() => {
      currentRunPromise = null;
    });
  return currentRunPromise;
}

module.exports = {
  inspectManifestVersions,
  runUpdateCycle,
  ensureBackgroundSync,
  getStatus: () => cloneStatus()
};
