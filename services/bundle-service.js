const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { resolveNamedSubdirectory, resolveWithinBase, sanitizeDeploymentName } = require('./path-utils');

let bundlesFilePath = null;

function getDedicatedRuntimeDetectionLogic() {
  return `# Detect dedicated logging before touching local log paths.
$ADDMDedicatedLogging = $false
$ADDMLoggingConfigPath = ""
function Find-AppDeployLoggingConfigPath {
    try {
        $dir = $PSScriptRoot
        for ($i = 0; $i -lt 6 -and $dir; $i++) {
            $candidate = Join-Path $dir "ADDeploy\\logging-config.json"
            if (Test-Path -LiteralPath $candidate) { return $candidate }
            $parent = Split-Path -Parent $dir
            if (-not $parent -or $parent -eq $dir) { break }
            $dir = $parent
        }
    } catch { }
    return ""
}
try {
    $ADDMLoggingConfigPath = Find-AppDeployLoggingConfigPath
    if ($ADDMLoggingConfigPath) {
        $candidateConfig = Get-Content -LiteralPath $ADDMLoggingConfigPath -Raw -ErrorAction Stop | ConvertFrom-Json
        if ($candidateConfig.mode -eq "dedicated" -and $candidateConfig.apiBaseUrl) {
            $ADDMDedicatedLogging = $true
        }
    }
} catch {
    $ADDMDedicatedLogging = $false
}`;
}

function getBundlesPath() {
  if (!bundlesFilePath) {
    const { app } = require('electron');
    bundlesFilePath = path.join(app.getPath('userData'), 'bundles-config.json');
  }
  return bundlesFilePath;
}

// ─── Share-backed storage (Option A: share is source of truth) ────────
const { createShareStore } = require('./share-store');
const bundlesShareStore = createShareStore('bundles-config.json');

function loadBundles() {
  // Share is authoritative
  const fromShare = bundlesShareStore.read();
  if (fromShare !== null) {
    const normalized = Array.isArray(fromShare) ? fromShare.map(normalizeBundleRecord) : [];
    try {
      fs.writeFileSync(getBundlesPath(), JSON.stringify(normalized, null, 2), 'utf-8');
    } catch (e) {}
    return normalized.map(hydrateBundleShareState);
  }
  // Fallback to local cache
  try {
    const p = getBundlesPath();
    if (fs.existsSync(p)) {
      const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
      const normalized = Array.isArray(parsed) ? parsed.map(normalizeBundleRecord) : [];
      return normalized.map(hydrateBundleShareState);
    }
  } catch (err) {
    console.error('Error loading bundles:', err);
  }
  return [];
}

function saveBundles(bundles) {
  const normalized = Array.isArray(bundles) ? bundles.map(normalizeBundleRecord) : [];
  fs.writeFileSync(getBundlesPath(), JSON.stringify(normalized, null, 2), 'utf-8');
  bundlesShareStore.write(normalized);
}

function generateId() {
  return 'b_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

const SAFE_RECORD_ID = /^[a-zA-Z0-9_-]{1,128}$/;

function normalizeRecordId(value, prefix = 'item') {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (SAFE_RECORD_ID.test(raw)) return raw;
  if (!raw) return generateId();
  const cleaned = raw
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96);
  const hash = crypto.createHash('sha1').update(raw).digest('hex').slice(0, 8);
  return `${cleaned || prefix}_${hash}`.slice(0, 128);
}

function normalizeDNArray(value) {
  const raw = Array.isArray(value)
    ? value
    : (typeof value === 'string' && value.trim() ? [value.trim()] : []);
  const seen = new Set();
  return raw
    .filter(item => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean)
    .filter(item => {
      if (seen.has(item)) return false;
      seen.add(item);
      return true;
    });
}

function normalizePublishedAction(value, fallback = 'pending') {
  const normalized = String(value || '').trim().toLowerCase();
  if (['install', 'uninstall', 'pending'].includes(normalized)) return normalized;
  return fallback;
}

function normalizeBundleApps(value) {
  return (Array.isArray(value) ? value : [])
    .filter(item => item && typeof item === 'object')
    .filter(item => typeof item.appId === 'string' && item.appId.trim())
    .map((item, index) => ({
      ...item,
      appId: normalizeRecordId(item.appId, 'app'),
      name: typeof item.name === 'string' ? item.name : '',
      order: Number.isFinite(Number(item.order)) ? Number(item.order) : index
    }));
}

function normalizeBundleRecord(bundle) {
  const ouDNs = normalizeDNArray(bundle?.ouDNs || bundle?.ouDN);
  return {
    ...bundle,
    id: normalizeRecordId(bundle?.id, 'bundle'),
    apps: normalizeBundleApps(bundle?.apps),
    ouDN: ouDNs[0] || '',
    ouDNs,
    uninstallDeployedPath: typeof bundle?.uninstallDeployedPath === 'string' ? bundle.uninstallDeployedPath : '',
    uninstallPreparedAt: typeof bundle?.uninstallPreparedAt === 'string' ? bundle.uninstallPreparedAt : '',
    publishedAction: normalizePublishedAction(bundle?.publishedAction, bundle?.deployed ? 'install' : 'pending'),
    publishedAt: typeof bundle?.publishedAt === 'string' ? bundle.publishedAt : ''
  };
}

function readBundleDeploymentManifest(bundleRecord) {
  try {
    const shareHealth = require('./share-health');
    if (!shareHealth.isAvailableSync()) return null;
    const configService = require('./config');
    const config = configService.getConfig();
    if (!config?.networkSharePath || !bundleRecord?.name) return null;

    const bundlesDir = resolveWithinBase(config.networkSharePath, '_bundles');
    const { path: bundleFolder } = resolveNamedSubdirectory(bundlesDir, bundleRecord.name, 'bundle');
    const manifestPath = path.join(bundleFolder, 'bundle.json');
    if (!fs.existsSync(manifestPath)) return null;
    return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  } catch (err) {
    return null;
  }
}

function hydrateBundleShareState(bundleRecord) {
  const normalized = normalizeBundleRecord(bundleRecord);
  const manifest = readBundleDeploymentManifest(normalized);
  if (!manifest || typeof manifest !== 'object') {
    return normalized;
  }

  const manifestActionValue = String(manifest.publishedAction || manifest.currentAction || '').trim().toLowerCase();
  const hasExplicitPublishedAction = ['install', 'uninstall', 'pending'].includes(manifestActionValue);
  let publishedAction = normalizePublishedAction(
    manifestActionValue,
    normalized.publishedAction
  );

  if (!hasExplicitPublishedAction && publishedAction === 'pending') {
    const activeScriptPath = String(manifest.activeScriptPath || '').trim().toLowerCase();
    const uninstallScriptPath = String(manifest.uninstallScriptPath || '').trim().toLowerCase();
    if (activeScriptPath && uninstallScriptPath && activeScriptPath === uninstallScriptPath) {
      publishedAction = 'uninstall';
    } else if (manifest.installScriptPath || manifest.deployedAt) {
      publishedAction = 'install';
    }
  }

  return normalizeBundleRecord({
    ...normalized,
    deployedPath: typeof manifest.installScriptPath === 'string' && manifest.installScriptPath
      ? manifest.installScriptPath
      : normalized.deployedPath,
    uninstallDeployedPath: typeof manifest.uninstallScriptPath === 'string' && manifest.uninstallScriptPath
      ? manifest.uninstallScriptPath
      : normalized.uninstallDeployedPath,
    uninstallPreparedAt: typeof manifest.lastUninstallPreparedAt === 'string' && manifest.lastUninstallPreparedAt
      ? manifest.lastUninstallPreparedAt
      : (
        typeof manifest.uninstallDeployedAt === 'string' && manifest.uninstallDeployedAt
          ? manifest.uninstallDeployedAt
          : normalized.uninstallPreparedAt
      ),
    publishedAction,
    publishedAt: typeof manifest.publishedAt === 'string' && manifest.publishedAt
      ? manifest.publishedAt
      : (
        typeof manifest.lastUninstallPreparedAt === 'string' && manifest.lastUninstallPreparedAt
          ? manifest.lastUninstallPreparedAt
          : (
            typeof manifest.lastInstallAt === 'string' && manifest.lastInstallAt
              ? manifest.lastInstallAt
              : normalized.publishedAt
          )
      )
  });
}

function syncBundleShareManifest(bundleRecord) {
  try {
    const normalized = normalizeBundleRecord(bundleRecord);
    const manifest = readBundleDeploymentManifest(normalized);
    if (!manifest || typeof manifest !== 'object') return;

    const publishedAction = normalizePublishedAction(
      normalized.publishedAction,
      manifest.publishedAction || (normalized.deployed ? 'install' : 'pending')
    );
    const publishedAt = typeof normalized.publishedAt === 'string' && normalized.publishedAt
      ? normalized.publishedAt
      : (typeof manifest.publishedAt === 'string' ? manifest.publishedAt : '');
    const installScriptPath = typeof normalized.deployedPath === 'string' && normalized.deployedPath
      ? normalized.deployedPath
      : (typeof manifest.installScriptPath === 'string' ? manifest.installScriptPath : '');
    const uninstallScriptPath = typeof normalized.uninstallDeployedPath === 'string' && normalized.uninstallDeployedPath
      ? normalized.uninstallDeployedPath
      : (typeof manifest.uninstallScriptPath === 'string' ? manifest.uninstallScriptPath : '');
    const activeScriptPath = publishedAction === 'uninstall'
      ? uninstallScriptPath
      : (publishedAction === 'install' ? installScriptPath : '');

    const nextManifest = {
      ...manifest,
      name: normalized.name || manifest.name,
      version: normalized.version || manifest.version || '1.0.0',
      apps: Array.isArray(normalized.apps) ? normalized.apps : (Array.isArray(manifest.apps) ? manifest.apps : []),
      notifyUser: typeof normalized.notifyUser === 'boolean' ? normalized.notifyUser : !!manifest.notifyUser,
      installScriptPath,
      uninstallScriptPath,
      publishedAction,
      activeScriptPath,
      publishedAt,
      deployedAt: publishedAction === 'install'
        ? (publishedAt || manifest.deployedAt || '')
        : (manifest.deployedAt || ''),
      uninstallDeployedAt: publishedAction === 'uninstall'
        ? (publishedAt || manifest.uninstallDeployedAt || '')
        : (manifest.uninstallDeployedAt || ''),
      lastInstallAt: publishedAction === 'install'
        ? (publishedAt || manifest.lastInstallAt || manifest.deployedAt || '')
        : (manifest.lastInstallAt || manifest.deployedAt || ''),
      lastUninstallPreparedAt: publishedAction === 'uninstall'
        ? (publishedAt || manifest.lastUninstallPreparedAt || manifest.uninstallDeployedAt || '')
        : (manifest.lastUninstallPreparedAt || manifest.uninstallDeployedAt || '')
    };

    const shareHealth = require('./share-health');
    if (!shareHealth.isAvailableSync()) return;
    const configService = require('./config');
    const config = configService.getConfig();
    if (!config?.networkSharePath || !normalized.name) return;

    const bundlesDir = resolveWithinBase(config.networkSharePath, '_bundles');
    const { path: bundleFolder } = resolveNamedSubdirectory(bundlesDir, normalized.name, 'bundle');
    const manifestPath = path.join(bundleFolder, 'bundle.json');
    fs.writeFileSync(manifestPath, JSON.stringify(nextManifest, null, 2), 'utf-8');
  } catch (err) {}
}

const bundleService = {
  getAll() {
    return loadBundles();
  },

  get(id) {
    const bundles = loadBundles();
    return bundles.find(b => b.id === id) || null;
  },

  create(data) {
    const bundles = loadBundles();
    const ouDNs = normalizeDNArray(data.ouDNs || data.ouDN);
    const newBundle = normalizeBundleRecord({
      id: generateId(),
      name: data.name || 'Nuevo Bundle',
      description: data.description || '',
      apps: data.apps || [],       // [{ appId, name, order }]
      notifyUser: data.notifyUser || false,
      gpoName: data.gpoName || '',
      createGPO: data.createGPO || false,
      ouDN: ouDNs[0] || '',
      ouDNs,
      version: data.version || '1.0.0',
      deployed: false,
      deployedPath: '',
      uninstallDeployedPath: data.uninstallDeployedPath || '',
      uninstallPreparedAt: data.uninstallPreparedAt || '',
      publishedAction: data.publishedAction || 'pending',
      publishedAt: data.publishedAt || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    bundles.push(newBundle);
    saveBundles(bundles);
    syncBundleShareManifest(newBundle);
    return hydrateBundleShareState(newBundle);
  },

  update(id, data) {
    const bundles = loadBundles();
    const idx = bundles.findIndex(b => b.id === id);
    if (idx === -1) return null;
    const ouDNs = normalizeDNArray(
      data.ouDNs !== undefined ? data.ouDNs : (data.ouDN !== undefined ? data.ouDN : bundles[idx].ouDNs || bundles[idx].ouDN)
    );
    bundles[idx] = normalizeBundleRecord({
      ...bundles[idx],
      ...data,
      ouDN: ouDNs[0] || '',
      ouDNs,
      updatedAt: new Date().toISOString()
    });
    saveBundles(bundles);
    syncBundleShareManifest(bundles[idx]);
    return hydrateBundleShareState(bundles[idx]);
  },

  remove(id) {
    const bundles = loadBundles();
    const filtered = bundles.filter(b => b.id !== id);
    saveBundles(filtered);
    return { success: true };
  },

  replaceAll(bundles) {
    saveBundles(Array.isArray(bundles) ? bundles : []);
    return { success: true };
  },

  generateBundleScript(bundle, apps, config, action = 'install') {
    const isUninstall = action === 'uninstall';
    const safeBundleName = sanitizeDeploymentName(bundle.name, 'Bundle');
    const orderedApps = [...bundle.apps].sort((a, b) => a.order - b.order);
    const appEntries = (isUninstall ? orderedApps.reverse() : orderedApps)
      .map(entry => {
        const app = apps.find(a => a.id === entry.appId);
        if (!app) return null;
        const safeAppName = sanitizeDeploymentName(app.name, 'App');
        const appFolder = path.join(
          resolveNamedSubdirectory(config.networkSharePath, app.name, 'App').path,
          isUninstall ? 'uninstall.ps1' : 'install.ps1'
        );
        return { name: safeAppName, scriptPath: appFolder };
      })
      .filter(Boolean);

    const { getToastSnippet } = require('./ps-snippets');
    const notifyBlock = bundle.notifyUser ? getToastSnippet() : '';
    const startMsg = isUninstall
      ? `Uninstalling ${appEntries.length} applications. Please do not turn off your computer.`
      : `Installing ${appEntries.length} applications. Please do not turn off your computer.`;
    const endMsg = isUninstall
      ? `All applications in ${safeBundleName} have been uninstalled.`
      : `All applications in ${safeBundleName} have completed successfully.`;
    const notifyStartTitle = isUninstall ? 'Uninstallation in progress' : 'Installation in progress';
    const notifyEndTitle = isUninstall ? 'Uninstallation complete' : 'Installation complete';
    const trackerSuffix = isUninstall ? '_Uninstall' : '';
    const transcriptPrefix = isUninstall ? 'BundleUninstallLog' : 'BundleLog';
    const actionLabel = isUninstall ? 'uninstall' : 'install';

    const notifyStart = bundle.notifyUser
      ? `Send-UserToast -ToastTitle "${notifyStartTitle}" -ToastMessage "${startMsg}" -IconType "Warning"`
      : '';

    const notifyEnd = bundle.notifyUser
      ? `Send-UserToast -ToastTitle "${notifyEndTitle}" -ToastMessage "${endMsg}" -IconType "Information"`
      : '';

    const appBlocks = appEntries.map((app, i) => {
      return `
# ── App ${i + 1}/${appEntries.length}: ${app.name} ──
$AppScript = '${app.scriptPath.replace(/'/g, "''")}'
if (Test-Path $AppScript) {
    Write-Output "[$(Get-Date -Format 'HH:mm:ss')] Running: ${app.name}..."
    try {
        $LASTEXITCODE = 1
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File $AppScript
        $appExitCode = $LASTEXITCODE
        if ($appExitCode -in @(0, 3010, 1641)) {
            Write-Output "[$(Get-Date -Format 'HH:mm:ss')] OK: ${app.name} (exit $appExitCode)"
        } elseif ($appExitCode -eq 60001) {
            $BundlePending++
            Write-Output "[$(Get-Date -Format 'HH:mm:ss')] PENDING: ${app.name} - waiting for user sign-in or a dependency"
        } else { throw "Deployment script exited with code $appExitCode" }
    } catch {
        $BundleFailures++
        Write-Output "[$(Get-Date -Format 'HH:mm:ss')] ERROR: ${app.name} - $_"
    }
} else {
    $BundleFailures++
    Write-Output "[$(Get-Date -Format 'HH:mm:ss')] ERROR: ${app.name} - deployment script not found"
}`;
    }).join('\n');

    return `# =========================================================================
# BUNDLE: ${safeBundleName}
# Apps: ${appEntries.map(a => a.name).join(', ')}
# Version: ${bundle.version}
# Generated: ${new Date().toISOString()}
# =========================================================================

If ($ENV:PROCESSOR_ARCHITEW6432 -eq "AMD64") {
    Try { &"$ENV:WINDIR\\SysNative\\WindowsPowershell\\v1.0\\PowerShell.exe" -ExecutionPolicy Bypass -WindowStyle Hidden -File $PSCOMMANDPATH ; Exit $LASTEXITCODE } Catch { Exit 1 }
}

if (-not $PSScriptRoot) { $PSScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $PSScriptRoot) { $PSScriptRoot = $PWD.Path }
${getDedicatedRuntimeDetectionLogic()}

$BundleName = '${safeBundleName.replace(/'/g, "''")}'
$LogDir = "C:\\ProgramData\\AppDeploy_Logs"
if (-not $ADDMDedicatedLogging -and -not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
$BundleTracker = if ($ADDMDedicatedLogging) { $null } else { "$LogDir\\Tracker_Bundle_$($BundleName -replace '\\s','_')${trackerSuffix}.txt" }
$BundleVersion = "${(bundle.version || '1.0.0').replace(/[^a-zA-Z0-9.]/g, '')}"

# Check whether this exact version has already run
$LastVersion = if ($BundleTracker -and (Test-Path -LiteralPath $BundleTracker)) { Get-Content -LiteralPath $BundleTracker } else { "" }
try {
    $previous = $LastVersion | ConvertFrom-Json -ErrorAction Stop
    if ($previous.schema -eq 2 -and $previous.generatorRevision -eq 'mod-rev-2.1' -and $previous.version -eq $BundleVersion -and $previous.result -eq 'success') { exit 0 }
} catch { }
$BundleFailures = 0
$BundlePending = 0

if (-not $ADDMDedicatedLogging) { Start-Transcript -Path "$LogDir\\${transcriptPrefix}_$($BundleName -replace '\\s','_').log" -Append -Force }
Write-Output "=========================================="
Write-Output "Bundle: $BundleName v$BundleVersion [${actionLabel}]"
Write-Output "Started: $(Get-Date)"
Write-Output "=========================================="
${notifyBlock}
${notifyStart}
${appBlocks}

if ($BundleFailures -eq 0 -and $BundlePending -eq 0) {
    ${notifyEnd}
    if ($BundleTracker) { @{ schema=2; generatorRevision='mod-rev-2.1'; version=$BundleVersion; result='success' } | ConvertTo-Json -Compress | Set-Content -LiteralPath $BundleTracker -Force }
} elseif ($BundleTracker -and (Test-Path -LiteralPath $BundleTracker)) {
    Remove-Item -LiteralPath $BundleTracker -Force -ErrorAction SilentlyContinue
}
Write-Output "=========================================="
Write-Output "Bundle finished: $(Get-Date); failed=$BundleFailures; pending=$BundlePending"
Write-Output "=========================================="
    if (-not $ADDMDedicatedLogging) { Stop-Transcript -ErrorAction SilentlyContinue }
if ($BundleFailures -gt 0) { exit 1 }
if ($BundlePending -gt 0) { exit 60001 }
exit 0
    `;
  },

  generateBundleUninstallScript(bundle, apps, config) {
    return this.generateBundleScript(bundle, apps, config, 'uninstall');
  },

  async deployBundle(bundle, apps, config) {
    return this.deployBundleAction(bundle, apps, config, 'install');
  },

  async deployBundleUninstall(bundle, apps, config) {
    return this.deployBundleAction(bundle, apps, config, 'uninstall');
  },

  async deployBundleAction(bundle, apps, config, action = 'install') {
    try {
      const shareHealth = require('./share-health');
      if (!shareHealth.isAvailableSync()) return { success: false, error: 'SHARE_UNAVAILABLE' };
      const bundlesDir = resolveWithinBase(config.networkSharePath, '_bundles');
      const { safeName, path: bundleFolder } = resolveNamedSubdirectory(bundlesDir, bundle.name, 'bundle');

      if (!fs.existsSync(bundleFolder)) {
        fs.mkdirSync(bundleFolder, { recursive: true });
      }

      const isUninstall = action === 'uninstall';
      const script = isUninstall
        ? this.generateBundleUninstallScript(bundle, apps, config)
        : this.generateBundleScript(bundle, apps, config, 'install');
      const scriptPath = path.join(bundleFolder, isUninstall ? 'bundle_uninstall.ps1' : 'bundle_install.ps1');
      fs.writeFileSync(scriptPath, '\uFEFF' + script, 'utf-8');

      const manifestPath = path.join(bundleFolder, 'bundle.json');
      let existingManifest = {};
      try {
        if (fs.existsSync(manifestPath)) {
          existingManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        }
      } catch (e) {}
      const publishedAt = new Date().toISOString();
      const manifest = {
        ...existingManifest,
        name: bundle.name,
        deploymentFolder: safeName,
        version: bundle.version,
        apps: bundle.apps,
        notifyUser: bundle.notifyUser,
        deployedAt: !isUninstall ? publishedAt : (existingManifest.deployedAt || ''),
        uninstallDeployedAt: isUninstall ? publishedAt : (existingManifest.uninstallDeployedAt || ''),
        lastInstallAt: !isUninstall ? publishedAt : (existingManifest.lastInstallAt || existingManifest.deployedAt || ''),
        lastUninstallPreparedAt: isUninstall
          ? publishedAt
          : (existingManifest.lastUninstallPreparedAt || existingManifest.uninstallDeployedAt || ''),
        installScriptPath: !isUninstall ? scriptPath : (existingManifest.installScriptPath || path.join(bundleFolder, 'bundle_install.ps1')),
        uninstallScriptPath: isUninstall ? scriptPath : (existingManifest.uninstallScriptPath || ''),
        publishedAction: isUninstall ? 'uninstall' : 'install',
        activeScriptPath: scriptPath,
        publishedAt
      };
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

      return { success: true, path: scriptPath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
};

module.exports = bundleService;
