const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const configService = require('./config');
const i18nService = require('./i18n');
const templateService = require('./template-service');
const { resolveNamedSubdirectory } = require('./path-utils');
const { getCurrentAppVersion } = require('./app-version');

function sanitizePSForEmbedding(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/`/g, '``')
    .replace(/\$/g, '`$')
    .replace(/"/g, '`"')
    .replace(/'/g, "''");
}

function sanitizeAppName(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[^a-zA-Z0-9\s\-_.,()[\]@#]/g, '').trim().substring(0, 128);
}

function sanitizeWingetSource(str) {
  if (typeof str !== 'string') return '';
  const normalized = str.trim().toLowerCase();
  return /^[a-z0-9._-]{1,64}$/.test(normalized) ? normalized : '';
}

function decorateGeneratedPowerShellScript(scriptBody, options = {}) {
  const generatorVersion = sanitizePSForEmbedding(getCurrentAppVersion());
  const scriptKind = sanitizePSForEmbedding(options.kind || 'install');
  const appName = sanitizePSForEmbedding(options.appName || '');
  const metadataHeader = [
    '# =========================================================================',
    '# AD DEPLOY MANAGER - GENERATED SCRIPT METADATA',
    `# generator_app_version: ${generatorVersion}`,
    `# script_kind: ${scriptKind}`,
    appName ? `# app_name: ${appName}` : '',
    '# =========================================================================',
    `$ADDMGeneratorAppVersion = "${generatorVersion}"`,
    `$ADDMGeneratedScriptKind = "${scriptKind}"`,
    appName ? `$ADDMGeneratedAppName = "${appName}"` : '',
    ''
  ].filter(Boolean).join('\n');

  return `${metadataHeader}\n${String(scriptBody || '').trimStart()}`;
}

function buildManifestScriptInfo(existingInfo = {}, details = {}) {
  const pathValue = typeof details.path === 'string'
    ? details.path
    : (typeof existingInfo.path === 'string' ? existingInfo.path : '');
  const generatedAt = details.written
    ? (details.generatedAt || new Date().toISOString())
    : (typeof existingInfo.generatedAt === 'string' ? existingInfo.generatedAt : '');
  const generatedByAppVersion = details.written
    ? (details.generatorAppVersion || '')
    : (typeof existingInfo.generatedByAppVersion === 'string' ? existingInfo.generatedByAppVersion : '');

  return {
    path: pathValue,
    generatedAt,
    generatedByAppVersion
  };
}

function isInstallerArtifactName(fileName) {
  const normalized = String(fileName || '').toLowerCase();
  return normalized.endsWith('.exe')
    || normalized.endsWith('.msi')
    || (normalized.endsWith('.ps1') && normalized !== 'install.ps1' && normalized !== 'uninstall.ps1');
}

const TEMPLATES = {
  generic: { category: 'General', name: 'Generic (MSI/EXE)', description: 'Universal Drop & Run template for any installer', fields: [] },
  office: { category: 'General', name: 'Microsoft Office (XML)', description: 'Executes setup.exe with an existing XML file', fields: [] },
  custom: { category: 'General', name: 'Custom Script', description: 'Write your own raw PowerShell code', fields: [{ key: 'customScript', label: 'PowerShell Code', type: 'textarea', default: '# Write your PowerShell code here\\n', hint: 'This code will not be wrapped. Use with caution.' }] },
  winget: { category: 'General', name: 'Winget Package', description: 'Installs from Windows Package Manager', fields: [], noInstaller: true },
  odt: { category: 'General', name: 'Microsoft Office (ODT)', description: 'Office 365/LTSC without manual download — generates XML automatically', fields: [], noInstaller: true },
  wazuh: { category: 'Security', name: 'Wazuh Agent', description: 'Wazuh SIEM/XDR agent deployment', fields: [{key:'manager', label:'WAZUH_MANAGER', default:'', hint:'Wazuh server IP or FQDN'}, {key:'group', label:'WAZUH_AGENT_GROUP', default:'default', hint:'Assignment group'}, {key:'password', label:'WAZUH_REGISTRATION_PASSWORD', default:'', hint:'Registration password (optional)'}] },
  sentinelone: { category: 'Security', name: 'SentinelOne', description: 'Deployment with SITE_TOKEN injection', fields: [{key:'siteToken', label:'SITE_TOKEN', default:'', hint:'SentinelOne tenant unique string'}] },
  cortexxdr: { category: 'Security', name: 'Cortex XDR', description: 'Cortex XDR Deployment (Palo Alto)', fields: [{key:'installDir', label:'Directory (Optional)', default:'', hint:'Leave empty for default directory'}] },
  bitdefender: { category: 'Security', name: 'Bitdefender BEST', description: 'Standard BEST deployment', fields: [] },
  crowdstrike: { category: 'Security', name: 'CrowdStrike Falcon', description: 'Installs EXE with CID injection', fields: [{ key: 'cid', label: 'Customer ID (CID)', default: '', hint: 'CrowdStrike Falcon CID' }] },
  zscaler: { category: 'Connectivity', name: 'Zscaler Client Connector', description: 'Zscaler ZCC deployment', fields: [{key:'cloudName', label:'CLOUDNAME', default:'zscaler', hint:'i.e: zscaler, zscalerone'}, {key:'userDomain', label:'USERDOMAIN', default:'', hint:'Company domain for SSO'}, {key:'strictEnforcement', label:'Strict Enforcement', type:'checkbox', default:true, hint:'Prevent user disabling'}] },
  globalprotect: { category: 'Connectivity', name: 'GlobalProtect', description: 'MSI installer with PORTAL injection', fields: [{key:'portal', label:'VPN Portal', default:'', hint:'Portal FQDN (i.e. vpn.company.com)'}] },
  ciscosecureclient: { category: 'Connectivity', name: 'Cisco Secure Client', description: 'Installs MSI and copies XML profiles', fields: [{key:'profileXml', label:'XML Profile', default:'profile.xml', hint:'XML must be next to the MSI'}] },
  forticlient: { category: 'Connectivity', name: 'FortiClient VPN', description: 'Installs MSI + configures VPN tunnel', fields: [ { key: 'vpnName', label: 'VPN Tunnel Name', default: '', hint: 'VPN Profile Name' }, { key: 'vpnDescription', label: 'Description', default: 'Corporate VPN', hint: '' }, { key: 'vpnServer', label: 'Server:Port', default: '', hint: 'i.e: 192.168.1.1:10443' }, { key: 'ssoEnabled', label: 'Enable Single Sign-On (SSO)', type: 'checkbox', default: true, hint: 'Use SAML/SSO for authentication' }, { key: 'serverCert', label: 'Validate CA Server', type: 'checkbox', default: false, hint: 'Unchecked (0) internally by default' }, { key: 'noWarnInvalidCert', label: 'Silence Invalid Cert Warning', type: 'checkbox', default: true, hint: 'Do not alert on self-signed certs' } ] },
  lansweeper: { category: 'RMM', name: 'Lansweeper (LsAgent)', description: 'Local inventory LsAgent', fields: [{key:'server', label:'SERVER', default:'', hint:'Lansweeper IP/FQDN (if local)'}, {key:'port', label:'PORT', default:'9524', hint:'Port'}, {key:'agentKey', label:'AGENTKEY (Cloud Relay)', default:'', hint:'For cloud synchronization'}] },
  ninjaone: { category: 'RMM', name: 'NinjaOne / Datto RMM', description: 'Generic RMM installation via token', fields: [{key:'token', label:'Token / Key', default:'', hint:'Organization token'}] },
  freshservice: { category: 'RMM', name: 'Freshservice Agent', description: 'Installs MSI with Registration Token injection', fields: [{ key: 'token', label: 'Registration Token', default: '', hint: 'Freshservice console Token' }] },
  teamviewer: { category: 'RMM', name: 'TeamViewer Host', description: 'MSI Host Deployment with APIToken', fields: [{key:'customId', label:'CUSTOMCONFIGID', default:'', hint:'Host config ID'}, {key:'apiToken', label:'APITOKEN', default:'', hint:'For account auto-assignment'}] },
  anydesk: { category: 'RMM', name: 'AnyDesk Custom Client', description: 'Generic AnyDesk MSI installation', fields: [] },
  veeam: { category: 'Backups', name: 'Veeam Agent', description: 'Deployment with server XML configuration', fields: [{key:'configXml', label:'Configuration XML', default:'veeam_config.xml', hint:'Extracted from your Veeam B&R server'}] },
  crashplan: { category: 'Backups', name: 'CrashPlan Enterprise', description: 'Endpoint backup deployment', fields: [{key:'url', label:'DEPLOYMENT_URL', default:'', hint:'Authority server URL'}, {key:'token', label:'DEPLOYMENT_TOKEN', default:'', hint:'Organization Token'}] },
  'sap-gui': { category: 'Corporate', name: 'SAP GUI', description: 'Installs EXE + copies configuration XML', fields: [ { key: 'sapTheme', label: 'SAP Theme', type: 'select', default: '256', hint: '', options: [ {value:'1', label:'SAP Signature (1)'}, {value:'128', label:'Blue Crystal (128)'}, {value:'256', label:'Belize (256)'}, {value:'2048', label:'Quartz (2048)'}, {value:'16384', label:'Quartz Dark (16384)'} ] } ] }
};

// ─── Generator map — adding a new template only requires one entry here ───
// (declared after all generateX functions are hoisted / defined)
let GENERATORS;
function getGenerators() {
  if (!GENERATORS) {
    GENERATORS = {
      generic:           generateGeneric,
      office:            generateOffice,
      custom:            generateCustom,
      winget:            generateWinget,
      odt:               generateODT,
      wazuh:             generateWazuh,
      sentinelone:       generateSentinelOne,
      cortexxdr:         generateCortexXDR,
      bitdefender:       generateBitdefender,
      crowdstrike:       generateCrowdstrike,
      zscaler:           generateZscaler,
      globalprotect:     generateGlobalProtect,
      ciscosecureclient: generateCiscoSecureClient,
      forticlient:       generateForticlient,
      lansweeper:        generateLansweeper,
      ninjaone:          generateNinjaOne,
      freshservice:      generateFreshservice,
      teamviewer:        generateTeamViewer,
      anydesk:           generateAnyDesk,
      veeam:             generateVeeam,
      crashplan:         generateCrashPlan,
      'sap-gui':         generateSapGui,
    };
  }
  return GENERATORS;
}

function getBuiltInTemplateList() {
  const config = configService.getConfig();
  const dict = i18nService.getTranslations(config.language || 'en');

  return Object.entries(TEMPLATES).map(([key, val]) => {
    const tplDict = dict.templates?.[key] || {};

    const localizedFields = (val.fields || []).map(f => {
      const fieldDict = tplDict.fields?.[f.key] || {};
      return {
        ...f,
        label: fieldDict.label || f.label,
        hint: fieldDict.hint || f.hint
      };
    });

    return {
      id: key,
      category: tplDict.category || val.category || 'General',
      name: tplDict.name || val.name,
      description: tplDict.description || val.description,
      fields: localizedFields,
      noInstaller: val.noInstaller || false
    };
  });
}

const scriptService = {
  getTemplateList() {
    return [
      ...getBuiltInTemplateList(),
      ...templateService.getWizardTemplates()
    ];
  },

  generateScript(appConfig) {
    const customTemplate = templateService.resolve(appConfig?.template, appConfig?.templateDefinition);
    setCurrentAppCtx(appConfig);
    try {
      let scriptBody = '';
      if (customTemplate) {
        scriptBody = generateUserTemplate(appConfig, customTemplate);
      } else {
        const generators = getGenerators();
        const fn = generators[appConfig.template] ?? generators.generic;
        scriptBody = fn(appConfig);
      }
      return decorateGeneratedPowerShellScript(scriptBody, {
        kind: 'install',
        appName: appConfig?.name || ''
      });
    } finally {
      setCurrentAppCtx(null);
    }
  },

  generateUninstallScript(appConfig) {
    return decorateGeneratedPowerShellScript(generateAppUninstallScript(appConfig), {
      kind: 'uninstall',
      appName: appConfig?.name || ''
    });
  },

  async deployScript(appConfig) {
    return deployAppScripts(appConfig, { writeInstall: true, writeUninstall: true });
  },

  async regenerateScripts(appConfig) {
    const uninstallConfig = resolveEffectiveUninstallConfig(appConfig || {});
    const currentAction = String(appConfig?.publishedAction || '').trim().toLowerCase() === 'uninstall'
      ? 'uninstall'
      : 'install';
    return deployAppScripts(appConfig, {
      writeInstall: true,
      writeUninstall: supportsUninstallScript(appConfig || {}, uninstallConfig),
      currentAction,
      preservePublicationTimestamps: true
    });
  },

  async deployUninstallScript(appConfig) {
    return deployAppScripts(appConfig, { writeInstall: false, writeUninstall: true });
  }
};

async function deployAppScripts(appConfig, options = {}) {
  const writeInstall = options.writeInstall !== false;
  const writeUninstall = !!options.writeUninstall;

  if (!writeInstall && !writeUninstall) {
    return { success: false, error: 'Nothing to deploy' };
  }

  try {
    const shareHealth = require('./share-health');
    if (!shareHealth.isAvailableSync()) {
      return { success: false, error: 'SHARE_UNAVAILABLE' };
    }

    try { require('./app-service').cleanupTempFiles(); } catch (e) {}

    let resolvedAppConfig = appConfig || {};
    if (resolvedAppConfig?.template === 'winget') {
      try {
        const catalogService = require('./catalog-service');
        const resolvedPackage = await catalogService.resolvePackage({
          wingetId: resolvedAppConfig.wingetId,
          wingetSource: resolvedAppConfig.wingetSource,
          name: resolvedAppConfig.name
        });
        if (resolvedPackage?.available && resolvedPackage.wingetId) {
          resolvedAppConfig = {
            ...resolvedAppConfig,
            wingetId: resolvedPackage.wingetId,
            wingetSource: resolvedPackage.wingetSource || resolvedAppConfig.wingetSource || 'winget'
          };
        }
      } catch (e) { /* keep configured package reference if resolution fails */ }
    }

    const uninstallConfig = resolveEffectiveUninstallConfig(resolvedAppConfig);
    if (!writeInstall && !supportsUninstallScript(resolvedAppConfig, uninstallConfig)) {
      return { success: false, error: 'UNINSTALL_NOT_CONFIGURED' };
    }

    const config = configService.getConfig();
    const { safeName, path: appFolder } = resolveNamedSubdirectory(
      config.networkSharePath,
      resolvedAppConfig.name,
      'App'
    );

    if (!fs.existsSync(appFolder)) {
      await fs.promises.mkdir(appFolder, { recursive: true });
    }

    const customTemplate = templateService.resolve(
      resolvedAppConfig?.template,
      resolvedAppConfig?.templateDefinition
    );
    const isNoInstaller = resolvedAppConfig.template === 'winget' || resolvedAppConfig.template === 'odt';

    let installerHash = '';
    if (!isNoInstaller && resolvedAppConfig.installerPath && fs.existsSync(resolvedAppConfig.installerPath)) {
      const sourceResolved = path.resolve(resolvedAppConfig.installerPath).toLowerCase();
      const folderResolved = path.resolve(appFolder).toLowerCase();
      const isAlreadyInFolder = sourceResolved.startsWith(folderResolved + path.sep);

      if (isAlreadyInFolder) {
        const buffer = await fs.promises.readFile(resolvedAppConfig.installerPath);
        installerHash = crypto.createHash('sha256').update(buffer).digest('hex');
      } else {
        const files = await fs.promises.readdir(appFolder);
        for (const file of files) {
          if (isInstallerArtifactName(file)) {
            try { await fs.promises.unlink(path.join(appFolder, file)); } catch (e) {}
          }
        }

        const fileName = path.basename(resolvedAppConfig.installerPath);
        await fs.promises.copyFile(resolvedAppConfig.installerPath, path.join(appFolder, fileName));

        const buffer = await fs.promises.readFile(path.join(appFolder, fileName));
        installerHash = crypto.createHash('sha256').update(buffer).digest('hex');
      }
    } else if (!isNoInstaller) {
      const files = await fs.promises.readdir(appFolder);
      for (const file of files) {
        if (isInstallerArtifactName(file)) {
          const buffer = await fs.promises.readFile(path.join(appFolder, file));
          installerHash = crypto.createHash('sha256').update(buffer).digest('hex');
          break;
        }
      }
    }

    if (!isNoInstaller && resolvedAppConfig.configXmlPath && fs.existsSync(resolvedAppConfig.configXmlPath)) {
      const files = await fs.promises.readdir(appFolder);
      for (const file of files) {
        if (file.toLowerCase().endsWith('.xml')) {
          try { await fs.promises.unlink(path.join(appFolder, file)); } catch (e) {}
        }
      }
      const fileName = path.basename(resolvedAppConfig.configXmlPath);
      await fs.promises.copyFile(resolvedAppConfig.configXmlPath, path.join(appFolder, fileName));
    }

    if (customTemplate) {
      await copyCustomTemplateFiles(appFolder, resolvedAppConfig, customTemplate);
    }

    let installPath = '';
    if (writeInstall) {
      const installScript = scriptService.generateScript(resolvedAppConfig);
      installPath = path.join(appFolder, 'install.ps1');
      await fs.promises.writeFile(installPath, '\uFEFF' + installScript, 'utf-8');
    }

    let uninstallPath = '';
    if (writeUninstall) {
      const targetUninstallPath = path.join(appFolder, 'uninstall.ps1');
      if (supportsUninstallScript(resolvedAppConfig, uninstallConfig)) {
        const uninstallScript = decorateGeneratedPowerShellScript(generateAppUninstallScript({
          ...resolvedAppConfig,
          uninstall: uninstallConfig
        }), {
          kind: 'uninstall',
          appName: resolvedAppConfig?.name || ''
        });
        uninstallPath = targetUninstallPath;
        await fs.promises.writeFile(uninstallPath, '\uFEFF' + uninstallScript, 'utf-8');
      } else {
        try { await fs.promises.unlink(targetUninstallPath); } catch (e) {}
      }
    }

    const manifestPath = path.join(appFolder, 'version.json');
    let existingManifest = {};
    try {
      if (fs.existsSync(manifestPath)) {
        existingManifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf-8'));
      }
    } catch (e) {}

    const deployedAt = new Date().toISOString();
    const currentAction = options.currentAction === 'uninstall'
      ? 'uninstall'
      : (options.currentAction === 'install' ? 'install' : (writeInstall ? 'install' : 'uninstall'));
    const manifest = buildAppDeploymentManifest(resolvedAppConfig, {
      safeName,
      customTemplate,
      installerHash,
      writeInstall,
      writeUninstall,
      preservePublicationTimestamps: options.preservePublicationTimestamps === true,
      installPath: writeInstall ? (installPath || path.join(appFolder, 'install.ps1')) : path.join(appFolder, 'install.ps1'),
      uninstallPath,
      uninstallConfig,
      deployedAt,
      currentAction,
      existingManifest
    });

    await fs.promises.writeFile(
      manifestPath,
      JSON.stringify(manifest, null, 2),
      'utf-8'
    );

    return {
      success: true,
      path: installPath || uninstallPath,
      installPath,
      uninstallPath,
      publishedAction: currentAction,
      hash: installerHash,
      uninstallMode: uninstallConfig.mode
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function buildAppDeploymentManifest(appConfig, details = {}) {
  const cfgForManifest = require('./config').getConfig();
  const existingManifest = details.existingManifest && typeof details.existingManifest === 'object'
    ? details.existingManifest
    : {};
  const uninstallConfig = resolveEffectiveUninstallConfig({
    ...appConfig,
    uninstall: details.uninstallConfig || appConfig?.uninstall
  });
  const generatedAt = details.deployedAt || new Date().toISOString();
  const generatorAppVersion = getCurrentAppVersion();
  const currentAction = details.currentAction === 'uninstall' ? 'uninstall' : 'install';
  const installScriptPath = details.installPath || existingManifest.installScriptPath || '';
  const uninstallScriptPath = details.uninstallPath || existingManifest?.uninstall?.scriptPath || '';
  const preservePublicationTimestamps = details.preservePublicationTimestamps === true;
  const existingScripts = existingManifest.scripts && typeof existingManifest.scripts === 'object'
    ? existingManifest.scripts
    : {};
  const existingInstallScript = existingScripts.install && typeof existingScripts.install === 'object'
    ? existingScripts.install
    : {};
  const existingUninstallScript = existingScripts.uninstall && typeof existingScripts.uninstall === 'object'
    ? existingScripts.uninstall
    : {};
  const existingUpdater = existingScripts.updater && typeof existingScripts.updater === 'object'
    ? existingScripts.updater
    : {};
  const publishedAt = preservePublicationTimestamps
    ? (existingManifest.publishedAt || '')
    : generatedAt;
  const deployedAt = preservePublicationTimestamps
    ? (existingManifest.deployedAt || '')
    : (currentAction === 'install' ? generatedAt : (existingManifest.deployedAt || ''));
  const lastInstallAt = preservePublicationTimestamps
    ? (existingManifest.lastInstallAt || existingManifest.deployedAt || '')
    : (currentAction === 'install' ? generatedAt : (existingManifest.lastInstallAt || existingManifest.deployedAt || ''));
  const lastUninstallPreparedAt = preservePublicationTimestamps
    ? (existingManifest.lastUninstallPreparedAt || existingManifest?.uninstall?.generatedAt || '')
    : (currentAction === 'uninstall' ? generatedAt : (existingManifest.lastUninstallPreparedAt || existingManifest?.uninstall?.generatedAt || ''));
  const scriptsMeta = {
    install: buildManifestScriptInfo(existingInstallScript, {
      path: installScriptPath,
      written: details.writeInstall === true,
      generatedAt,
      generatorAppVersion
    }),
    uninstall: buildManifestScriptInfo(existingUninstallScript, {
      path: uninstallScriptPath,
      written: details.writeUninstall === true && supportsUninstallScript(appConfig, uninstallConfig) && !!uninstallScriptPath,
      generatedAt,
      generatorAppVersion
    }),
    updater: {
      lastCheckedAt: typeof existingUpdater.lastCheckedAt === 'string' ? existingUpdater.lastCheckedAt : '',
      lastUpdatedAt: generatedAt,
      lastError: '',
      needsUpdate: false,
      status: 'current'
    }
  };
  return {
    ...existingManifest,
    app: appConfig.name,
    deploymentFolder: details.safeName || '',
    version: appConfig.version || '1.0.0',
    hash: details.installerHash || '',
    primaryInstallerName: appConfig.installerPath
      ? sanitizeTemplateFileName(path.basename(appConfig.installerPath))
      : '',
    template: appConfig.template || 'generic',
    templateSource: details.customTemplate ? 'user' : 'builtin',
    notifyUser: appConfig.notifyUser || false,
    appVersion: generatorAppVersion,
    deployedAt,
    lastInstallAt,
    lastUninstallPreparedAt,
    publishedAction: currentAction,
    activeScriptPath: currentAction === 'uninstall' ? uninstallScriptPath : installScriptPath,
    publishedAt,
    shareId: cfgForManifest.shareId || '',
    installScriptPath,
    scripts: scriptsMeta,
    uninstall: {
      mode: uninstallConfig.mode,
      available: supportsUninstallScript(appConfig, uninstallConfig) && !!uninstallScriptPath,
      command: uninstallConfig.command || '',
      args: uninstallConfig.args || '',
      registryMatchName: uninstallConfig.registryMatchName || '',
      registryMatchPublisher: uninstallConfig.registryMatchPublisher || '',
      productCode: uninstallConfig.productCode || '',
      wingetId: uninstallConfig.wingetId || '',
      wingetSource: uninstallConfig.wingetSource || '',
      scriptPath: uninstallScriptPath,
      generatedAt
    },
    // Baked at deploy time — used by install detection without querying the binary
    productCode: appConfig.msiProductCode || uninstallConfig.productCode || existingManifest.productCode || '',
    installerSignature: appConfig.installerSignature && typeof appConfig.installerSignature === 'object'
      ? { type: appConfig.installerSignature.type || '', confidence: appConfig.installerSignature.confidence || '', publisher: appConfig.installerSignature.publisher || '' }
      : (existingManifest.installerSignature || null)
  };
}

function inferInstallerType(appConfig) {
  if (appConfig?.template === 'winget') return 'winget';
  if (appConfig?.template === 'odt') return 'odt';
  if (appConfig?.template === 'custom') return 'custom';
  const explicit = String(appConfig?.installerType || '').trim().toLowerCase();
  if (explicit) return explicit;
  const ext = path.extname(String(appConfig?.installerPath || '')).toLowerCase();
  if (ext === '.msi') return 'msi';
  if (ext === '.ps1') return 'ps1';
  return 'exe';
}

function resolveEffectiveUninstallConfig(appConfig) {
  const raw = appConfig?.uninstall && typeof appConfig.uninstall === 'object'
    ? appConfig.uninstall
    : {};
  const installerType = inferInstallerType(appConfig);

  let mode = typeof raw.mode === 'string' ? raw.mode.trim().toLowerCase() : '';
  if (!mode) {
    if (appConfig?.template === 'winget') mode = 'winget';
    else if (installerType === 'msi') mode = 'auto-msi';
    else if (appConfig?.template === 'custom' || appConfig?.template === 'odt') mode = 'none';
    else mode = 'auto-registry';
  }

  return {
    mode,
    command: typeof raw.command === 'string' ? raw.command.trim() : '',
    args: typeof raw.args === 'string' ? raw.args.trim() : '',
    registryMatchName: typeof raw.registryMatchName === 'string' && raw.registryMatchName.trim()
      ? raw.registryMatchName.trim()
      : String(appConfig?.name || '').trim(),
    registryMatchPublisher: typeof raw.registryMatchPublisher === 'string' ? raw.registryMatchPublisher.trim() : '',
    productCode: typeof raw.productCode === 'string' ? raw.productCode.trim() : '',
    wingetId: typeof raw.wingetId === 'string' && raw.wingetId.trim()
      ? raw.wingetId.trim()
      : String(appConfig?.wingetId || '').trim(),
    wingetSource: sanitizeWingetSource(
      (typeof raw.wingetSource === 'string' && raw.wingetSource.trim())
        ? raw.wingetSource
        : (appConfig?.wingetSource || 'winget')
    ) || 'winget',
    scriptPath: typeof raw.scriptPath === 'string' ? raw.scriptPath.trim() : '',
    preparedAt: typeof raw.preparedAt === 'string' ? raw.preparedAt.trim() : ''
  };
}

function supportsUninstallScript(appConfig, uninstallConfig = resolveEffectiveUninstallConfig(appConfig)) {
  switch (uninstallConfig.mode) {
    case 'auto-msi':
      return inferInstallerType(appConfig) === 'msi' || !!uninstallConfig.productCode;
    case 'winget':
      return !!uninstallConfig.wingetId;
    case 'manual':
      return !!uninstallConfig.command;
    case 'auto-registry':
      return !!(uninstallConfig.productCode || uninstallConfig.registryMatchName || uninstallConfig.registryMatchPublisher || appConfig?.name);
    default:
      return false;
  }
}

function generateAppUninstallScript(appConfig) {
  const uninstallConfig = resolveEffectiveUninstallConfig(appConfig);
  if (!supportsUninstallScript(appConfig, uninstallConfig)) {
    throw new Error('Uninstall is not configured for this app');
  }

  switch (uninstallConfig.mode) {
    case 'auto-msi':
      return generateMsiUninstallScript(appConfig, uninstallConfig);
    case 'winget':
      return generateWingetUninstallScript(appConfig, uninstallConfig);
    case 'manual':
      return generateManualUninstallScript(appConfig, uninstallConfig);
    case 'auto-registry':
      return generateRegistryUninstallScript(appConfig, uninstallConfig);
    default:
      throw new Error(`Unsupported uninstall mode: ${uninstallConfig.mode}`);
  }
}

function buildUninstallScriptShell(appConfig, uninstallConfig, body, options = {}) {
  const safeName = sanitizeAppName(appConfig?.name || 'App');
  const version = sanitizePSForEmbedding(appConfig?.version || '1.0.0');
  const mode = sanitizePSForEmbedding(uninstallConfig.mode || 'manual');
  const title = sanitizePSForEmbedding(options.title || 'UNINSTALL');
  const detectionHelpers = options.includeDetectionHelpers ? `${getInstallerConflictLogic()}\n` : '';
  const appPresenceDetection = buildUninstallPresenceDetectionSnippet(appConfig);
  const appPresenceGuard = appPresenceDetection ? `
if (-not (Test-AppPresentForUninstall)) {
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] SKIPPED: The detection rule indicates that $NombreApp is no longer installed."
    Save-UninstallTracker -Result 'removed' -Method $UninstallMode -Extra @{ note = 'detection-rule-absent' }
    Stop-Transcript -ErrorAction SilentlyContinue
    exit 0
}
` : '';
  const extraFunctions = options.extraFunctions ? `${options.extraFunctions}\n` : '';

  return `# =========================================================================
# ${title} - DROP & RUN
# App: ${safeName}
# Version: ${version}
# Generado: ${new Date().toISOString()}
# =========================================================================
If ($ENV:PROCESSOR_ARCHITEW6432 -eq "AMD64") {
    Try { &"$ENV:WINDIR\\SysNative\\WindowsPowershell\\v1.0\\PowerShell.exe" -ExecutionPolicy Bypass -WindowStyle Hidden -File $PSCOMMANDPATH } Catch { }
    Exit
}

if (-not $PSScriptRoot) { $PSScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $PSScriptRoot) { $PSScriptRoot = $PWD.Path }

${getDedicatedRuntimeDetectionLogic()}

$NombreApp = if ($PSScriptRoot) { Split-Path -Leaf $PSScriptRoot } else { "${safeName}" }
$LogDir = "C:\\ProgramData\\AppDeploy_Logs"
if (-not $ADDMDedicatedLogging -and -not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
if (-not $ADDMDedicatedLogging) { Get-ChildItem "$LogDir\\*.log" -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-7) } | Remove-Item -Force -ErrorAction SilentlyContinue }
$LogFile = if ($ADDMDedicatedLogging) { $null } else { "$LogDir\\Uninstall_$($NombreApp)_$(Get-Date -Format 'yyyyMMdd_HHmmss').log" }
$TrackerFile = if ($ADDMDedicatedLogging) { $null } else { "$LogDir\\Tracker_$NombreApp.json" }
$VersionFile = Join-Path $PSScriptRoot "version.json"
$CurrentVersion = "${version}"
$CurrentHash = ""
$Manifest = $null
$ManifestUninstall = $null
$UninstallMode = "${mode}"

if ($LogFile) { Start-Transcript -Path $LogFile -Force -ErrorAction SilentlyContinue }
Write-Host "[$(Get-Date -Format 'HH:mm:ss')] ===== AppDeploy Manager ============================="
Write-Host "[$(Get-Date -Format 'HH:mm:ss')] App     : $NombreApp"
Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Action  : uninstall [$UninstallMode]"
Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Computer: $env:COMPUTERNAME"
Write-Host "[$(Get-Date -Format 'HH:mm:ss')] User    : $env:USERNAME"
Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Source  : $PSScriptRoot"
Write-Host "[$(Get-Date -Format 'HH:mm:ss')] ====================================================="

${getRemoteScriptLoggingLogic()}

if (Test-Path -LiteralPath $VersionFile) {
    try {
        $Manifest = Get-Content -LiteralPath $VersionFile -Raw | ConvertFrom-Json
        if ($Manifest.version) { $CurrentVersion = [string]$Manifest.version }
        if ($Manifest.hash) { $CurrentHash = [string]$Manifest.hash }
        if ($Manifest.uninstall) { $ManifestUninstall = $Manifest.uninstall }
    } catch {
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] WARNING: Could not read version.json - $_"
    }
}

function Save-UninstallTracker {
    param(
        [string]$Result,
        [string]$Method,
        [string]$ErrorMessage = '',
        [hashtable]$Extra = @{}
    )

    $payload = [ordered]@{
        version = $CurrentVersion
        hash = $CurrentHash
        computer = $env:COMPUTERNAME
        result = $Result
        method = $Method
    }

    if ($Result -eq 'removed') {
        $payload.removedAt = (Get-Date).ToString('o')
    } elseif ($Result -eq 'failed') {
        $payload.failedAt = (Get-Date).ToString('o')
        if ($ErrorMessage) {
            $payload.error = $ErrorMessage
        }
    } else {
        $payload.checkedAt = (Get-Date).ToString('o')
    }

    foreach ($key in $Extra.Keys) {
        $payload[$key] = $Extra[$key]
    }

    if ($TrackerFile) {
        try { $payload | ConvertTo-Json | Set-Content -Path $TrackerFile -Force -Encoding UTF8 } catch { }
    }
    $eventName = if ($Result -eq 'failed') { 'uninstall_failed' } elseif ($Result -eq 'removed') { 'uninstall_success' } else { 'uninstall_checked' }
    $eventLevel = if ($Result -eq 'failed') { 'error' } else { 'info' }
    Send-AppDeployLog -Level $eventLevel -Source "uninstall" -Message $eventName -Context @{ appName = $NombreApp; version = $CurrentVersion; hash = $CurrentHash; method = $Method; result = $Result; error = $ErrorMessage }
}

${detectionHelpers}${appPresenceDetection}${extraFunctions}${appPresenceGuard}try {
Send-AppDeployLog -Level "info" -Source "uninstall" -Message "uninstall_start" -Context @{ appName = $NombreApp; version = $CurrentVersion; hash = $CurrentHash; method = $UninstallMode }
${body}
} catch {
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] ERROR: $_"
    Save-UninstallTracker -Result 'failed' -Method $UninstallMode -ErrorMessage $_.ToString()
    Stop-Transcript -ErrorAction SilentlyContinue
    exit 1
}
`;
}

function generateMsiUninstallScript(appConfig, uninstallConfig) {
  const preferredProductCode = sanitizePSForEmbedding(uninstallConfig.productCode || '');
  const installerName = sanitizePSForEmbedding(
    sanitizeTemplateFileName(path.basename(appConfig?.installerPath || ''))
  );
  const matchName = sanitizePSForEmbedding(uninstallConfig.registryMatchName || appConfig?.name || '');
  const extraFunctions = `
function Resolve-MsiProductCode {
    param(
        [string]$PreferredCode,
        [string]$InstallerName,
        [string]$DisplayMatchName
    )

    if ($PreferredCode) { return $PreferredCode }
    if ($ManifestUninstall -and $ManifestUninstall.productCode) { return [string]$ManifestUninstall.productCode }

    if ($InstallerName) {
        $installerPath = Join-Path $PSScriptRoot $InstallerName
        if (Test-Path -LiteralPath $installerPath) {
            $productCode = Get-MsiPackageProperty -Path $installerPath -PropertyName 'ProductCode'
            if ($productCode) { return [string]$productCode }
        }
    }

    $normalizedName = Normalize-DetectedAppName -Value $DisplayMatchName
    if (-not $normalizedName) { return '' }

    foreach ($entry in Get-InstalledApplicationEntries) {
        if (-not $entry.ProductCode) { continue }
        if ($entry.NormalizedDisplayName -eq $normalizedName) {
            return [string]$entry.ProductCode
        }
        if ($normalizedName.Length -ge 8 -and ($entry.NormalizedDisplayName.StartsWith($normalizedName) -or $normalizedName.StartsWith($entry.NormalizedDisplayName))) {
            return [string]$entry.ProductCode
        }
    }

    return ''
}`.trim();

  const body = `    $PreferredProductCode = "${preferredProductCode}"
    $PrimaryInstallerName = "${installerName}"
    $RegistryMatchName = "${matchName}"
    $ProductCode = Resolve-MsiProductCode -PreferredCode $PreferredProductCode -InstallerName $PrimaryInstallerName -DisplayMatchName $RegistryMatchName

    if (-not $ProductCode) {
        throw "Could not determine the MSI ProductCode for $NombreApp"
    }

    $InstalledEntry = Get-InstalledApplicationEntries | Where-Object { $_.ProductCode -eq $ProductCode } | Select-Object -First 1
    if (-not $InstalledEntry) {
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] SKIPPED: The MSI product is no longer installed ($ProductCode)"
        Save-UninstallTracker -Result 'removed' -Method $UninstallMode -Extra @{ productCode = $ProductCode; note = 'already-absent' }
        Stop-Transcript -ErrorAction SilentlyContinue
        exit 0
    }

    $MsiArgs = "/x $ProductCode REBOOT=ReallySuppress /qn /norestart"
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Running: msiexec.exe $MsiArgs"
    $Process = Start-Process -FilePath 'msiexec.exe' -ArgumentList $MsiArgs -Wait -NoNewWindow -PassThru
    if ($Process.ExitCode -notin @(0, 3010, 1641, 1605)) {
        throw "msiexec returned $($Process.ExitCode)"
    }

    Save-UninstallTracker -Result 'removed' -Method $UninstallMode -Extra @{ productCode = $ProductCode }
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] OK: MSI uninstalled"
    Stop-Transcript -ErrorAction SilentlyContinue
    exit 0`;

  return buildUninstallScriptShell(appConfig, uninstallConfig, body, {
    title: 'MSI UNINSTALL',
    includeDetectionHelpers: true,
    extraFunctions
  });
}

function generateRegistryUninstallScript(appConfig, uninstallConfig) {
  const matchName = sanitizePSForEmbedding(uninstallConfig.registryMatchName || appConfig?.name || '');
  const matchPublisher = sanitizePSForEmbedding(uninstallConfig.registryMatchPublisher || '');
  const productCode = sanitizePSForEmbedding(uninstallConfig.productCode || '');
  const extraFunctions = `
function Get-RegistryUninstallEntries {
    return @(
        Get-ItemProperty \`
            "HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*",
            "HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*" \`
            -ErrorAction SilentlyContinue |
            Where-Object { $_.DisplayName } |
            ForEach-Object {
                $entryProductCode = ''
                if ([string]$_.PSChildName -match '^\\{[0-9A-F-]+\\}$') {
                    $entryProductCode = $Matches[0]
                } elseif ([string]$_.UninstallString -match '\\{[0-9A-F-]+\\}') {
                    $entryProductCode = $Matches[0]
                } elseif ([string]$_.QuietUninstallString -match '\\{[0-9A-F-]+\\}') {
                    $entryProductCode = $Matches[0]
                }

                [pscustomobject]@{
                    DisplayName = [string]$_.DisplayName
                    NormalizedDisplayName = Normalize-DetectedAppName -Value $_.DisplayName
                    Publisher = [string]$_.Publisher
                    PublisherNormalized = Normalize-DetectedAppName -Value $_.Publisher
                    ProductCode = $entryProductCode
                    QuietUninstallString = [string]$_.QuietUninstallString
                    UninstallString = [string]$_.UninstallString
                }
            }
    )
}

function Resolve-RegistryUninstallEntry {
    param(
        [string]$MatchName,
        [string]$MatchPublisher,
        [string]$PreferredProductCode
    )

    $effectiveProductCode = if ($PreferredProductCode) { $PreferredProductCode } elseif ($ManifestUninstall -and $ManifestUninstall.productCode) { [string]$ManifestUninstall.productCode } else { '' }
    $effectiveName = if ($MatchName) { $MatchName } elseif ($ManifestUninstall -and $ManifestUninstall.registryMatchName) { [string]$ManifestUninstall.registryMatchName } else { '' }
    $effectivePublisher = if ($MatchPublisher) { $MatchPublisher } elseif ($ManifestUninstall -and $ManifestUninstall.registryMatchPublisher) { [string]$ManifestUninstall.registryMatchPublisher } else { '' }

    $normalizedName = Normalize-DetectedAppName -Value $effectiveName
    $normalizedPublisher = Normalize-DetectedAppName -Value $effectivePublisher
    $best = $null
    $bestScore = -1

    foreach ($entry in Get-RegistryUninstallEntries) {
        $score = 0
        if ($effectiveProductCode -and $entry.ProductCode -and $entry.ProductCode -eq $effectiveProductCode) {
            $score = 100
        }

        if ($normalizedName) {
            if ($entry.NormalizedDisplayName -eq $normalizedName) {
                $score = [Math]::Max($score, 85)
            } elseif ($normalizedName.Length -ge 8 -and ($entry.NormalizedDisplayName.StartsWith($normalizedName) -or $normalizedName.StartsWith($entry.NormalizedDisplayName))) {
                $score = [Math]::Max($score, 70)
            }
        }

        if ($normalizedPublisher -and $entry.PublisherNormalized -eq $normalizedPublisher -and $score -gt 0) {
            $score += 5
        }

        if ($score -gt $bestScore) {
            $best = $entry
            $bestScore = $score
        }
    }

    if (-not $best -or $bestScore -lt 70) { return $null }
    return $best
}

function Split-CommandLine {
    param([string]$CommandLine)
    $line = [string]$CommandLine
    if (-not $line.Trim()) { return $null }
    $line = $line.Trim()
    if ($line.StartsWith('"')) {
        $closingQuote = $line.IndexOf('"', 1)
        if ($closingQuote -gt 0) {
            return [pscustomobject]@{
                FilePath = $line.Substring(1, $closingQuote - 1)
                Arguments = $line.Substring($closingQuote + 1).Trim()
            }
        }
    }

    $parts = $line -split '\\s+', 2
    return [pscustomobject]@{
        FilePath = $parts[0]
        Arguments = if ($parts.Length -gt 1) { $parts[1] } else { '' }
    }
}

function Get-MsiUninstallArguments {
    param(
        [string]$CommandLine,
        [string]$PreferredProductCode
    )

    if ($PreferredProductCode) {
        return "/x $PreferredProductCode REBOOT=ReallySuppress /qn /norestart"
    }

    if ([string]$CommandLine -match '\\{[0-9A-F-]+\\}') {
        return "/x $($Matches[0]) REBOOT=ReallySuppress /qn /norestart"
    }

    return ''
}`.trim();

  const body = `    $RegistryMatchName = "${matchName}"
    $RegistryMatchPublisher = "${matchPublisher}"
    $PreferredProductCode = "${productCode}"
    $TargetEntry = Resolve-RegistryUninstallEntry -MatchName $RegistryMatchName -MatchPublisher $RegistryMatchPublisher -PreferredProductCode $PreferredProductCode

    if (-not $TargetEntry) {
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] SKIPPED: No installed match was found to uninstall"
        Save-UninstallTracker -Result 'removed' -Method $UninstallMode -Extra @{ note = 'not-found' }
        Stop-Transcript -ErrorAction SilentlyContinue
        exit 0
    }

    $CommandLine = if ($TargetEntry.QuietUninstallString) { [string]$TargetEntry.QuietUninstallString } else { [string]$TargetEntry.UninstallString }
    $MsiArgs = Get-MsiUninstallArguments -CommandLine $CommandLine -PreferredProductCode $TargetEntry.ProductCode
    if ($MsiArgs) {
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Running silent MSI uninstall for $($TargetEntry.DisplayName)"
        $Process = Start-Process -FilePath 'msiexec.exe' -ArgumentList $MsiArgs -Wait -NoNewWindow -PassThru
        if ($Process.ExitCode -notin @(0, 3010, 1641, 1605)) {
            throw "msiexec returned $($Process.ExitCode)"
        }
    } else {
        if (-not $CommandLine) {
            throw "The registry entry has no uninstall command"
        }

        $ParsedCommand = Split-CommandLine -CommandLine $CommandLine
        if (-not $ParsedCommand -or -not $ParsedCommand.FilePath) {
            throw "Could not parse the uninstall command: $CommandLine"
        }

        $ExpandedPath = [System.Environment]::ExpandEnvironmentVariables([string]$ParsedCommand.FilePath)
        $ExpandedArgs = [System.Environment]::ExpandEnvironmentVariables([string]$ParsedCommand.Arguments)
        if ($ExpandedPath.ToLowerInvariant().EndsWith('.ps1')) {
            $Process = Start-Process -FilePath 'PowerShell.exe' -ArgumentList "-ExecutionPolicy Bypass -File \`"$ExpandedPath\`" $ExpandedArgs" -Wait -NoNewWindow -PassThru
        } else {
            $Process = Start-Process -FilePath $ExpandedPath -ArgumentList $ExpandedArgs -Wait -NoNewWindow -PassThru
        }

        if ($Process.ExitCode -notin @(0, 3010, 1641, 1605)) {
            throw "The uninstaller returned $($Process.ExitCode)"
        }
    }

    Save-UninstallTracker -Result 'removed' -Method $UninstallMode -Extra @{ displayName = $TargetEntry.DisplayName; productCode = $TargetEntry.ProductCode }
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] OK: Uninstall completed for $($TargetEntry.DisplayName)"
    Stop-Transcript -ErrorAction SilentlyContinue
    exit 0`;

  return buildUninstallScriptShell(appConfig, uninstallConfig, body, {
    title: 'REGISTRY UNINSTALL',
    includeDetectionHelpers: true,
    extraFunctions
  });
}

function generateManualUninstallScript(appConfig, uninstallConfig) {
  const command = sanitizePSForEmbedding(uninstallConfig.command || '');
  const args = sanitizePSForEmbedding(uninstallConfig.args || '');
  const body = `    $CommandPath = [System.Environment]::ExpandEnvironmentVariables("${command}")
    $CommandArgs = [System.Environment]::ExpandEnvironmentVariables("${args}")
    if (-not $CommandPath) {
        throw "No uninstall command is configured"
    }

    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Running manual command: $CommandPath $CommandArgs"
    if ($CommandPath.ToLowerInvariant().EndsWith('.ps1')) {
        $Process = Start-Process -FilePath 'PowerShell.exe' -ArgumentList "-ExecutionPolicy Bypass -File \`"$CommandPath\`" $CommandArgs" -Wait -NoNewWindow -PassThru
    } else {
        $Process = Start-Process -FilePath $CommandPath -ArgumentList $CommandArgs -Wait -NoNewWindow -PassThru
    }

    if ($Process.ExitCode -notin @(0, 3010, 1641, 1605)) {
        throw "The manual command returned $($Process.ExitCode)"
    }

    Save-UninstallTracker -Result 'removed' -Method $UninstallMode -Extra @{ command = $CommandPath; args = $CommandArgs }
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] OK: Manual command completed"
    Stop-Transcript -ErrorAction SilentlyContinue
    exit 0`;

  return buildUninstallScriptShell(appConfig, uninstallConfig, body, {
    title: 'MANUAL UNINSTALL'
  });
}

function generateWingetUninstallScript(appConfig, uninstallConfig) {
  const wingetId = sanitizePSForEmbedding(uninstallConfig.wingetId || appConfig?.wingetId || '');
  const wingetSource = sanitizePSForEmbedding(uninstallConfig.wingetSource || appConfig?.wingetSource || 'winget');
  const extraFunctions = `
function Resolve-WingetPath {
    $candidates = @(
        (Join-Path $env:LOCALAPPDATA 'Microsoft\\WindowsApps\\winget.exe'),
        (Join-Path $env:ProgramFiles 'WindowsApps\\Microsoft.DesktopAppInstaller_8wekyb3d8bbwe\\winget.exe'),
        'winget.exe'
    )

    foreach ($candidate in $candidates) {
        try {
            $cmd = Get-Command $candidate -ErrorAction SilentlyContinue
            if ($cmd) { return $cmd.Source }
        } catch {}
        if ($candidate -ne 'winget.exe' -and (Test-Path -LiteralPath $candidate)) {
            return $candidate
        }
    }

    return $null
}

function Test-WingetPackageInstalled {
    param(
        [string]$WingetPath,
        [string]$PackageId,
        [string]$PackageSource
    )

    if (-not $WingetPath -or -not $PackageId) { return $false }
    $args = @('list', '--id', $PackageId, '--exact', '--accept-source-agreements')
    if ($PackageSource) { $args += @('--source', $PackageSource) }

    try {
        $output = & $WingetPath @args 2>$null
        return [string]::Join("\`n", $output) -match [regex]::Escape($PackageId)
    } catch {
        return $false
    }
}`.trim();

  const body = `    $wingetId = "${wingetId}"
    $wingetSource = "${wingetSource}"
    if (-not $wingetId) {
        throw "No winget package ID is configured"
    }

    $Winget = Resolve-WingetPath
    if (-not $Winget) {
        throw "winget.exe was not found on this computer"
    }

    if (-not (Test-WingetPackageInstalled -WingetPath $Winget -PackageId $wingetId -PackageSource $wingetSource)) {
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] SKIPPED: $wingetId is no longer installed"
        Save-UninstallTracker -Result 'removed' -Method $UninstallMode -Extra @{ wingetId = $wingetId; note = 'already-absent' }
        Stop-Transcript -ErrorAction SilentlyContinue
        exit 0
    }

    $args = @('uninstall', '--id', $wingetId, '--exact', '--silent', '--accept-source-agreements', '--disable-interactivity')
    if ($wingetSource) { $args += @('--source', $wingetSource) }

    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Running: winget $($args -join ' ')"
    & $Winget @args 2>&1 | Out-Null
    $exitCode = $LASTEXITCODE
    if ($exitCode -notin @(0, 1605, 1614)) {
        throw "winget returned $exitCode"
    }

    Save-UninstallTracker -Result 'removed' -Method $UninstallMode -Extra @{ wingetId = $wingetId; source = $wingetSource }
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] OK: Winget uninstalled"
    Stop-Transcript -ErrorAction SilentlyContinue
    exit 0`;

  return buildUninstallScriptShell(appConfig, uninstallConfig, body, {
    title: 'WINGET UNINSTALL',
    extraFunctions
  });
}

function sanitizeTemplateFileName(fileName) {
  if (typeof fileName !== 'string') return '';
  const base = path.basename(fileName.trim());
  const clean = base
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 128);
  if (!clean || clean === '.' || clean === '..') return '';
  return clean;
}

function isTemplateInstallerAttachment(fileDef) {
  return fileDef?.storageKind === 'installer';
}

function normalizeTemplateFileSelection(value) {
  if (typeof value === 'string') return { sourcePath: value };
  if (value && typeof value === 'object' && typeof value.sourcePath === 'string') return value;
  return { sourcePath: '' };
}

function resolveCustomTemplateFileEntries(template, appConfig) {
  const selections = (appConfig && appConfig.templateFiles && typeof appConfig.templateFiles === 'object')
    ? appConfig.templateFiles
    : {};

  return (template?.files || []).map(fileDef => {
    const selection = normalizeTemplateFileSelection(selections[fileDef.key]);
    const sourcePath = selection.sourcePath || '';
    const defaultExt = Array.isArray(fileDef.extensions) && fileDef.extensions.length === 1 && fileDef.extensions[0] !== '*'
      ? `.${fileDef.extensions[0]}`
      : '';
    const targetName = sanitizeTemplateFileName(
      fileDef.destinationName
      || (sourcePath ? path.basename(sourcePath) : '')
      || `${fileDef.key}${defaultExt}`
    ) || `${fileDef.key}${defaultExt || '.dat'}`;
    const relativePath = isTemplateInstallerAttachment(fileDef)
      ? path.join('attached-installers', targetName)
      : targetName;

    return {
      ...fileDef,
      sourcePath,
      targetName,
      relativePath
    };
  });
}

function getSelectedXmlTemplateFileEntry(fileEntries) {
  return (Array.isArray(fileEntries) ? fileEntries : []).find(entry => {
    if (!entry?.sourcePath) return false;
    const extensions = Array.isArray(entry.extensions) ? entry.extensions : [];
    return extensions.some(item => String(item || '').trim().toLowerCase() === 'xml');
  }) || null;
}

async function copyCustomTemplateFiles(appFolder, appConfig, template) {
  const fileEntries = resolveCustomTemplateFileEntries(template, appConfig);

  for (const entry of fileEntries) {
    if (!entry.sourcePath) {
      if (entry.required) {
        throw new Error(`Missing required configuration file: ${entry.label}`);
      }
      continue;
    }

    if (!fs.existsSync(entry.sourcePath)) {
      if (entry.required) {
        throw new Error(`Configuration file not found: ${entry.label}`);
      }
      continue;
    }

    const allowedExts = Array.isArray(entry.extensions) ? entry.extensions : ['*'];
    const sourceExt = path.extname(entry.sourcePath).replace(/^\./, '').toLowerCase();
    if (allowedExts.length > 0 && !allowedExts.includes('*') && !allowedExts.includes(sourceExt)) {
      throw new Error(`Invalid file type for ${entry.label}`);
    }

    const destinationPath = path.join(appFolder, entry.relativePath || entry.targetName);
    const sourceResolved = path.resolve(entry.sourcePath).toLowerCase();
    const destinationResolved = path.resolve(destinationPath).toLowerCase();
    if (sourceResolved !== destinationResolved) {
      await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true });
      await fs.promises.copyFile(entry.sourcePath, destinationPath);
    }
  }
}

function buildPsObjectLiteral(entries) {
  if (!entries.length) return '([pscustomobject]@{})';
  return [
    '([pscustomobject]@{',
    ...entries.map(entry => `    '${entry.key}' = ${entry.expression}`),
    '})'
  ].join('\n');
}

function buildPsArgumentExpression(name, joiner, quoteValue, valueExpression) {
  const separator = name ? (joiner === 'space' ? ' ' : '=') : '';
  const prefix = sanitizePSForEmbedding(`${name || ''}${separator}`);
  if (quoteValue) {
    return `"${prefix}\`"$(${valueExpression})\`""`;
  }
  return `"${prefix}$(${valueExpression})"`;
}

function getDeployCacheCleanupLogic() {
  return `
function Test-DeployCachePathSafety {
    param([string]$Path)
    if (-not $Path) { return $false }
    try {
        $fullPath = [System.IO.Path]::GetFullPath($Path)
        $cacheRoot = [System.IO.Path]::GetFullPath("C:\\Temp\\Deploy")
        return $fullPath.StartsWith($cacheRoot.TrimEnd("\\") + "\\", [System.StringComparison]::OrdinalIgnoreCase) -and $fullPath.Length -gt ($cacheRoot.Length + 1)
    } catch {
        return $false
    }
}

function Clear-DeployCacheCleanupPending {
    param([string]$MarkerPath)
    if (-not $MarkerPath -or -not (Test-Path -LiteralPath $MarkerPath)) { return }
    try {
        Remove-Item -LiteralPath $MarkerPath -Force -ErrorAction Stop
    } catch {
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] WARNING: Could not delete the cleanup marker: $_"
    }
}

function Register-DeployCacheCleanupPending {
    param(
        [string]$CacheDir,
        [string]$MarkerPath
    )
    if (-not (Test-DeployCachePathSafety -Path $CacheDir) -or -not $MarkerPath) {
        return $false
    }
    try {
        @{
            cacheDir = $CacheDir
            createdAt = (Get-Date).ToString('o')
            computer = $env:COMPUTERNAME
        } | ConvertTo-Json | Set-Content -LiteralPath $MarkerPath -Force -Encoding UTF8
        return $true
    } catch {
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] WARNING: Could not register deferred cleanup: $_"
        return $false
    }
}

function Invoke-DeployCacheCleanup {
    param(
        [string]$CacheDir,
        [int]$MaxAttempts = 5,
        [int]$SleepSeconds = 2,
        [string]$MarkerPath = ""
    )
    if (-not (Test-DeployCachePathSafety -Path $CacheDir)) {
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] WARNING: Unsafe cache path; skipping cleanup: $CacheDir"
        return $false
    }
    if (-not (Test-Path -LiteralPath $CacheDir)) {
        if ($MarkerPath) { Clear-DeployCacheCleanupPending -MarkerPath $MarkerPath }
        return $true
    }
    for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
        try {
            Remove-Item -LiteralPath $CacheDir -Recurse -Force -ErrorAction Stop
            if ($MarkerPath) { Clear-DeployCacheCleanupPending -MarkerPath $MarkerPath }
            Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Local cache removed: $CacheDir"
            return $true
        } catch {
            if ($attempt -lt $MaxAttempts) {
                Write-Host "[$(Get-Date -Format 'HH:mm:ss')] WARNING: Cache in use; retrying cleanup ($attempt/$MaxAttempts)..."
                Start-Sleep -Seconds $SleepSeconds
            } else {
                Write-Host "[$(Get-Date -Format 'HH:mm:ss')] WARNING: Could not remove the local cache: $_"
            }
        }
    }
    return $false
}

function Start-DeployCacheCleanupWorker {
    param(
        [string]$CacheDir,
        [string]$MarkerPath
    )
    if (-not (Test-DeployCachePathSafety -Path $CacheDir)) {
        return $false
    }
    try {
        $cacheDirLiteral = $CacheDir.Replace("'", "''")
        $markerLiteral = ([string]$MarkerPath).Replace("'", "''")
        $workerScript = @"
$TargetCacheDir = '$cacheDirLiteral'
$TargetMarkerPath = '$markerLiteral'

function Test-DeployCachePathSafety {
    param([string]$Path)
    if (-not $Path) { return $false }
    try {
        $fullPath = [System.IO.Path]::GetFullPath($Path)
        $cacheRoot = [System.IO.Path]::GetFullPath('C:\\Temp\\Deploy')
        return $fullPath.StartsWith($cacheRoot.TrimEnd('\\') + '\\', [System.StringComparison]::OrdinalIgnoreCase) -and $fullPath.Length -gt ($cacheRoot.Length + 1)
    } catch {
        return $false
    }
}

if (-not (Test-DeployCachePathSafety -Path $TargetCacheDir)) { exit 1 }

for ($attempt = 1; $attempt -le 90; $attempt++) {
    if (-not (Test-Path -LiteralPath $TargetCacheDir)) {
        if ($TargetMarkerPath -and (Test-Path -LiteralPath $TargetMarkerPath)) {
            Remove-Item -LiteralPath $TargetMarkerPath -Force -ErrorAction SilentlyContinue
        }
        exit 0
    }

    try {
        Remove-Item -LiteralPath $TargetCacheDir -Recurse -Force -ErrorAction Stop
        if ($TargetMarkerPath -and (Test-Path -LiteralPath $TargetMarkerPath)) {
            Remove-Item -LiteralPath $TargetMarkerPath -Force -ErrorAction SilentlyContinue
        }
        exit 0
    } catch {
        Start-Sleep -Seconds 10
    }
}

exit 1
"@
        $encodedWorker = [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes($workerScript))
        $workerShell = Join-Path $env:WINDIR "System32\\WindowsPowerShell\\v1.0\\powershell.exe"
        if (-not (Test-Path -LiteralPath $workerShell)) { $workerShell = "PowerShell.exe" }
        Start-Process -FilePath $workerShell -ArgumentList @("-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-EncodedCommand", $encodedWorker) -WindowStyle Hidden | Out-Null
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] WARNING: Cache busy; deferred cleanup started."
        return $true
    } catch {
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] WARNING: Could not start deferred cleanup: $_"
        return $false
    }
}

function Invoke-DeployCacheCleanupWithFallback {
    param(
        [string]$CacheDir,
        [string]$MarkerPath
    )
    if (Invoke-DeployCacheCleanup -CacheDir $CacheDir -MarkerPath $MarkerPath) {
        return $true
    }
    if (-not $MarkerPath) {
        return (Start-DeployCacheCleanupWorker -CacheDir $CacheDir -MarkerPath "")
    }
    if (Register-DeployCacheCleanupPending -CacheDir $CacheDir -MarkerPath $MarkerPath) {
        return (Start-DeployCacheCleanupWorker -CacheDir $CacheDir -MarkerPath $MarkerPath)
    }
    return $false
}

function Invoke-PendingDeployCacheCleanups {
    param([string]$MarkerDirectory)
    if (-not $MarkerDirectory -or -not (Test-Path -LiteralPath $MarkerDirectory)) {
        return
    }
    Get-ChildItem -LiteralPath $MarkerDirectory -Filter "*.json" -File -ErrorAction SilentlyContinue | ForEach-Object {
        $markerFile = $_.FullName
        try {
            $pending = Get-Content -LiteralPath $markerFile -Raw -ErrorAction Stop | ConvertFrom-Json
            $pendingCacheDir = [string]$pending.cacheDir
        } catch {
            Remove-Item -LiteralPath $markerFile -Force -ErrorAction SilentlyContinue
            return
        }

        if (-not (Test-DeployCachePathSafety -Path $pendingCacheDir)) {
            Remove-Item -LiteralPath $markerFile -Force -ErrorAction SilentlyContinue
            return
        }

        if (Invoke-DeployCacheCleanup -CacheDir $pendingCacheDir -MaxAttempts 2 -SleepSeconds 1 -MarkerPath $markerFile) {
            Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Deferred cleanup completed: $pendingCacheDir"
        }
    }
}

Invoke-PendingDeployCacheCleanups -MarkerDirectory $CleanupMarkerDir
`.trim();
}

function getInstallerConflictLogic() {
  return `
$InstallDisposition = 'pending'
$ManagedInstallerMaxAttempts = 5
$ManagedInstallerRetryDelaySeconds = 15
$ManagedInstallerBusyPollSeconds = 15
$ManagedInstallerBusyMaxWaitSeconds = 3600
$TrackerRetryBase = 0

function Convert-DetectedAppVersion {
    param([string]$Value)
    $match = [regex]::Match([string]$Value, '\\d+(\\.\\d+){0,3}')
    if (-not $match.Success) { return $null }
    try {
        return [version]$match.Value
    } catch {
        return $null
    }
}

function Normalize-DetectedAppName {
    param([string]$Value)
    return ([string]$Value).ToLowerInvariant() -replace '[^a-z0-9]+', ''
}

function Get-InstalledApplicationEntries {
    if ($script:CachedInstalledApplicationEntries) {
        return $script:CachedInstalledApplicationEntries
    }

    $script:CachedInstalledApplicationEntries = @(
        Get-ItemProperty \`
            "HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*",
            "HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*" \`
            -ErrorAction SilentlyContinue |
            Where-Object { $_.DisplayName } |
            ForEach-Object {
                $productCode = ''
                if ([string]$_.PSChildName -match '^\\{[0-9A-F-]+\\}$') {
                    $productCode = $Matches[0]
                } elseif ([string]$_.UninstallString -match '\\{[0-9A-F-]+\\}') {
                    $productCode = $Matches[0]
                }

                [pscustomobject]@{
                    DisplayName = [string]$_.DisplayName
                    NormalizedDisplayName = Normalize-DetectedAppName -Value $_.DisplayName
                    DisplayVersion = [string]$_.DisplayVersion
                    VersionObject = Convert-DetectedAppVersion -Value $_.DisplayVersion
                    ProductCode = $productCode
                    Publisher = [string]$_.Publisher
                    PublisherNormalized = Normalize-DetectedAppName -Value $_.Publisher
                }
            }
    )

    return $script:CachedInstalledApplicationEntries
}

function Reset-InstalledApplicationEntriesCache {
    $script:CachedInstalledApplicationEntries = $null
}

function Get-MsiPackageProperty {
    param(
        [string]$Path,
        [string]$PropertyName
    )

    $windowsInstaller = $null
    $database = $null
    $view = $null
    $record = $null

    try {
        $windowsInstaller = New-Object -ComObject WindowsInstaller.Installer
        $database = $windowsInstaller.GetType().InvokeMember('OpenDatabase', 'InvokeMethod', $null, $windowsInstaller, @($Path, 0))
        $query = "SELECT \`Value\` FROM \`Property\` WHERE \`Property\`='$PropertyName'"
        $view = $database.GetType().InvokeMember('OpenView', 'InvokeMethod', $null, $database, @($query))
        $view.GetType().InvokeMember('Execute', 'InvokeMethod', $null, $view, $null) | Out-Null
        $record = $view.GetType().InvokeMember('Fetch', 'InvokeMethod', $null, $view, $null)
        if ($record) {
            return [string]$record.StringData(1)
        }
    } catch {
        return ''
    } finally {
        foreach ($comObject in @($record, $view, $database, $windowsInstaller)) {
            if ($comObject) {
                try { [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($comObject) | Out-Null } catch {}
            }
        }
    }

    return ''
}

function Get-InstallerDetectionMetadata {
    param(
        [string]$InstallerPath,
        [string]$FallbackDisplayName
    )

    $extension = [System.IO.Path]::GetExtension([string]$InstallerPath).ToLowerInvariant()
    $displayCandidates = New-Object System.Collections.Generic.List[string]
    $normalizedCandidates = New-Object System.Collections.Generic.List[string]
    $productCode = ''
    $publisher = ''
    $productVersionRaw = ''

    $candidateSeed = @()
    $fileBaseName = [System.IO.Path]::GetFileNameWithoutExtension([string]$InstallerPath)
    $fileBaseNameWithoutVersion = ($fileBaseName -replace '([._-]?\d+(\.\d+){1,4}.*)$', '')
    if ($extension -eq '.msi') {
        $candidateSeed += Get-MsiPackageProperty -Path $InstallerPath -PropertyName 'ProductName'
        $productVersionRaw = Get-MsiPackageProperty -Path $InstallerPath -PropertyName 'ProductVersion'
        $publisher = Get-MsiPackageProperty -Path $InstallerPath -PropertyName 'Manufacturer'
        $productCode = Get-MsiPackageProperty -Path $InstallerPath -PropertyName 'ProductCode'
    } else {
        $fileInfo = $null
        try { $fileInfo = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($InstallerPath) } catch {}
        if ($fileInfo) {
            $candidateSeed += [string]$fileInfo.ProductName
            $candidateSeed += [string]$fileInfo.FileDescription
            $candidateSeed += [System.IO.Path]::GetFileNameWithoutExtension([string]$fileInfo.OriginalFilename)
            $candidateSeed += [string]$fileInfo.InternalName
            $publisher = [string]$fileInfo.CompanyName
            $productVersionRaw = [string]$fileInfo.ProductVersion
        }
    }

    $candidateSeed += $fileBaseName
    $candidateSeed += $fileBaseNameWithoutVersion
    $candidateSeed += $FallbackDisplayName
    foreach ($candidate in $candidateSeed) {
        $candidateText = [string]$candidate
        if (-not $candidateText) { continue }
        if (-not $displayCandidates.Contains($candidateText)) {
            $displayCandidates.Add($candidateText)
        }

        $normalized = Normalize-DetectedAppName -Value $candidateText
        if ($normalized -and -not $normalizedCandidates.Contains($normalized)) {
            $normalizedCandidates.Add($normalized)
        }
    }

    [pscustomobject]@{
        InstallerPath = $InstallerPath
        Extension = $extension
        DisplayCandidates = @($displayCandidates.ToArray())
        NameCandidates = @($normalizedCandidates.ToArray())
        Publisher = $publisher
        PublisherNormalized = Normalize-DetectedAppName -Value $publisher
        ProductCode = $productCode
        InstallerVersionRaw = $productVersionRaw
        InstallerVersionObject = Convert-DetectedAppVersion -Value $productVersionRaw
    }
}

function Get-InstalledApplicationMatch {
    param([pscustomobject]$InstallerMetadata)

    $bestMatch = $null
    $bestScore = -1
    $bestPublisherMatched = $false

    foreach ($entry in Get-InstalledApplicationEntries) {
        $score = 0
        $publisherMatched = $false

        if ($InstallerMetadata.ProductCode -and $entry.ProductCode -and $InstallerMetadata.ProductCode -eq $entry.ProductCode) {
            $score = 100
        }

        foreach ($candidate in @($InstallerMetadata.NameCandidates)) {
            if (-not $candidate) { continue }
            if ($entry.NormalizedDisplayName -eq $candidate) {
                $score = [Math]::Max($score, 85)
            } elseif ($candidate.Length -ge 8 -and ($entry.NormalizedDisplayName.StartsWith($candidate) -or $candidate.StartsWith($entry.NormalizedDisplayName))) {
                $score = [Math]::Max($score, 70)
            }
        }

        if ($InstallerMetadata.PublisherNormalized -and $entry.PublisherNormalized -eq $InstallerMetadata.PublisherNormalized) {
            $publisherMatched = $true
            if ($score -gt 0) {
                $score += 5
            }
        }

        if ($score -gt $bestScore) {
            $bestScore = $score
            $bestMatch = $entry
            $bestPublisherMatched = $publisherMatched
        }
    }

    if (-not $bestMatch -or $bestScore -lt 70) {
        return $null
    }

    [pscustomobject]@{
        DisplayName = $bestMatch.DisplayName
        DisplayVersion = $bestMatch.DisplayVersion
        VersionObject = $bestMatch.VersionObject
        ProductCode = $bestMatch.ProductCode
        MatchScore = $bestScore
        PublisherMatched = $bestPublisherMatched
    }
}

function Resolve-InstallerConflictState {
    param(
        [pscustomobject]$InstallerMetadata,
        [string]$TargetVersion
    )

    $targetVersionObject = Convert-DetectedAppVersion -Value $TargetVersion
    if (-not $targetVersionObject -and $InstallerMetadata.InstallerVersionObject) {
        $targetVersionObject = $InstallerMetadata.InstallerVersionObject
    }

    $match = Get-InstalledApplicationMatch -InstallerMetadata $InstallerMetadata
    $skipInstall = $false
    $canAutoUninstall = $false
    $reason = ''

    if ($match) {
        $trustedUpgradeMatch = $match.ProductCode -and (
            $match.MatchScore -ge 85 -or
            ($match.PublisherMatched -and $match.MatchScore -ge 75)
        )

        if ($InstallerMetadata.ProductCode -and $match.ProductCode -and $InstallerMetadata.ProductCode -eq $match.ProductCode) {
            $skipInstall = $true
            $reason = 'same-product-code'
        } elseif ($match.VersionObject -and $targetVersionObject -and $match.VersionObject -ge $targetVersionObject) {
            $skipInstall = $true
            $reason = 'same-or-newer-version'
        } elseif ($trustedUpgradeMatch -and $match.VersionObject -and $targetVersionObject -and $match.VersionObject -lt $targetVersionObject) {
            $canAutoUninstall = $true
            $reason = 'older-version-conflict'
        } else {
            $reason = 'existing-installation-detected'
        }
    }

    [pscustomobject]@{
        Match = $match
        TargetVersionObject = $targetVersionObject
        SkipInstall = $skipInstall
        CanAutoUninstall = $canAutoUninstall
        Reason = $reason
    }
}

function Get-InstallerConflictLabel {
    param([pscustomobject]$Conflict)

    if (-not $Conflict -or -not $Conflict.Match) { return '' }
    if ($Conflict.Match.DisplayVersion) {
        return "$($Conflict.Match.DisplayName) (v$($Conflict.Match.DisplayVersion))"
    }
    return [string]$Conflict.Match.DisplayName
}

function Test-InstallerExecutionInProgress {
    $mutexNames = @('_MSIExecute', 'Global\\_MSIExecute')
    foreach ($mutexName in $mutexNames) {
        $mutex = $null
        try {
            $mutex = [System.Threading.Mutex]::OpenExisting($mutexName)
            if ($mutex) { return $true }
        } catch [System.Threading.WaitHandleCannotBeOpenedException] {
        } catch {
        } finally {
            if ($mutex) {
                try { $mutex.Dispose() } catch {}
            }
        }
    }

    try {
        if (Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Installer\\InProgress') {
            $inProgress = Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Installer\\InProgress' -ErrorAction SilentlyContinue
            if ($inProgress) { return $true }
        }
    } catch {}

    return $false
}

function Wait-InstallerExecutionIdle {
    param(
        [int]$MaxWaitSeconds = $ManagedInstallerBusyMaxWaitSeconds,
        [int]$PollSeconds = $ManagedInstallerBusyPollSeconds
    )

    $deadline = (Get-Date).AddSeconds([Math]::Max($MaxWaitSeconds, $PollSeconds))
    $waitNotified = $false
    while (Test-InstallerExecutionInProgress) {
        if (-not $waitNotified) {
            Write-Host "[$(Get-Date -Format 'HH:mm:ss')] WARNING: Another installation is running. Waiting for it to finish..."
            $waitNotified = $true
        } else {
            Write-Host "[$(Get-Date -Format 'HH:mm:ss')] WARNING: Another installation is still running. Checking again in $PollSeconds seconds."
        }

        if ((Get-Date) -ge $deadline) {
            throw "another installation is still running after waiting $MaxWaitSeconds seconds"
        }

        Start-Sleep -Seconds $PollSeconds
    }

    if ($waitNotified) {
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] The other installation has finished. Continuing..."
        Start-Sleep -Seconds 5
    }
}

function Test-ManagedInstallerInstalled {
    param(
        [pscustomobject]$InstallerMetadata,
        [string]$TargetVersion
    )

    $hasDetectionRule = $false
    try {
        $appDetectionFn = Get-Command 'Test-AppInstalled' -CommandType Function -ErrorAction SilentlyContinue
        if ($appDetectionFn) {
            $hasDetectionRule = $true
            if (Test-AppInstalled) { return $true }
        }
    } catch {}

    $match = Get-InstalledApplicationMatch -InstallerMetadata $InstallerMetadata
    if (-not $match) { return $false }
    if ($InstallerMetadata.ProductCode -and $match.ProductCode -and $InstallerMetadata.ProductCode -eq $match.ProductCode) {
        return $true
    }

    $targetVersionObject = Convert-DetectedAppVersion -Value $TargetVersion
    if (-not $targetVersionObject -and $InstallerMetadata.InstallerVersionObject) {
        $targetVersionObject = $InstallerMetadata.InstallerVersionObject
    }

    if ($match.VersionObject -and $targetVersionObject) {
        return ($match.VersionObject -ge $targetVersionObject)
    }

    if ($hasDetectionRule) { return $false }
    if ($match.MatchScore -ge 85) { return $true }
    return ($match.PublisherMatched -and $match.MatchScore -ge 75)
}

function Wait-ManagedInstallerInstalled {
    param(
        [pscustomobject]$InstallerMetadata,
        [string]$TargetVersion,
        [int]$MaxAttempts = 6,
        [int]$SleepSeconds = 10
    )

    for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
        Reset-InstalledApplicationEntriesCache
        if (Test-ManagedInstallerInstalled -InstallerMetadata $InstallerMetadata -TargetVersion $TargetVersion) {
            return $true
        }

        if ($attempt -lt $MaxAttempts) {
            Start-Sleep -Seconds $SleepSeconds
        }
    }

    return $false
}

function Invoke-ManagedInstaller {
    param(
        [ValidateSet('msi', 'exe', 'ps1')][string]$Kind,
        [string]$InstallerPath,
        [string]$ArgumentList = '',
        [string]$FallbackDisplayName = '',
        [int[]]$SuccessCodes = @(0, 3010, 1641)
    )

    if (-not $InstallerPath) {
        throw 'installer path is missing'
    }

    $installerMetadata = Get-InstallerDetectionMetadata -InstallerPath $InstallerPath -FallbackDisplayName $FallbackDisplayName
    $conflictState = Resolve-InstallerConflictState -InstallerMetadata $installerMetadata -TargetVersion $CurrentVersion

    if ($conflictState.SkipInstall) {
        $InstallDisposition = 'skipped'
        $conflictLabel = Get-InstallerConflictLabel -Conflict $conflictState
        if ($conflictLabel) {
            Write-Host "[$(Get-Date -Format 'HH:mm:ss')] SKIPPED: An equal or newer version of $conflictLabel is already installed. Skipping the installer."
        } else {
            Write-Host "[$(Get-Date -Format 'HH:mm:ss')] SKIPPED: An equal or newer version is already installed. Skipping the installer."
        }
        return [pscustomobject]@{ Status = 'skipped'; ExitCode = 1638 }
    }

    $launchPath = switch ($Kind) {
        'msi' { 'msiexec.exe' }
        'ps1' { 'PowerShell.exe' }
        default { $InstallerPath }
    }

    $lastExitCode = $null
    $lastFailureMessage = ''
    for ($attempt = 1; $attempt -le $ManagedInstallerMaxAttempts; $attempt++) {
        if ($attempt -gt 1) {
            Write-Host "[$(Get-Date -Format 'HH:mm:ss')] WARNING: Retrying installation ($attempt/$ManagedInstallerMaxAttempts)..."
            Start-Sleep -Seconds $ManagedInstallerRetryDelaySeconds
        }

        Wait-InstallerExecutionIdle
        $process = Start-Process -FilePath $launchPath -ArgumentList $ArgumentList -Wait -NoNewWindow -PassThru
        $lastExitCode = $process.ExitCode
        Reset-InstalledApplicationEntriesCache

        if ($SuccessCodes -contains $process.ExitCode) {
            if (Wait-ManagedInstallerInstalled -InstallerMetadata $installerMetadata -TargetVersion $CurrentVersion) {
                $InstallDisposition = 'installed'
                return [pscustomobject]@{ Status = 'success'; ExitCode = $process.ExitCode; Attempts = $attempt; Retried = ($attempt -gt 1) }
            }

            $lastFailureMessage = "installer finished with code $($process.ExitCode), but the installation could not be confirmed"
            Write-Host "[$(Get-Date -Format 'HH:mm:ss')] WARNING: $lastFailureMessage."
            continue
        }

        if ($process.ExitCode -eq 1618) {
            $lastFailureMessage = 'installer returned 1618: another installation is running'
            Write-Host "[$(Get-Date -Format 'HH:mm:ss')] WARNING: $lastFailureMessage."
            continue
        }

        if ($process.ExitCode -eq 1638) {
            $conflictState = Resolve-InstallerConflictState -InstallerMetadata $installerMetadata -TargetVersion $CurrentVersion

            if ($conflictState.SkipInstall) {
                $InstallDisposition = 'skipped'
                $conflictLabel = Get-InstallerConflictLabel -Conflict $conflictState
                if ($conflictLabel) {
                    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] SKIPPED: Conflict 1638 resolved. A valid version is already installed for $conflictLabel."
                } else {
                    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] SKIPPED: Conflict 1638 resolved. A valid version is already installed."
                }
                return [pscustomobject]@{ Status = 'skipped'; ExitCode = 1638 }
            }

            if ($conflictState.CanAutoUninstall) {
                $conflictLabel = Get-InstallerConflictLabel -Conflict $conflictState
                Write-Host "[$(Get-Date -Format 'HH:mm:ss')] WARNING: An older version is blocking the update ($conflictLabel). Uninstalling and retrying..."
                Wait-InstallerExecutionIdle
                $uninstallArgs = "/x $($conflictState.Match.ProductCode) REBOOT=ReallySuppress /qn"
                $uninstallProcess = Start-Process -FilePath 'msiexec.exe' -ArgumentList $uninstallArgs -Wait -NoNewWindow -PassThru
                $lastExitCode = $uninstallProcess.ExitCode
                Reset-InstalledApplicationEntriesCache
                if ($uninstallProcess.ExitCode -eq 1618) {
                    $lastFailureMessage = 'uninstaller returned 1618: another installation is running'
                    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] WARNING: $lastFailureMessage."
                    continue
                }
                if ($uninstallProcess.ExitCode -notin @(0, 3010, 1641, 1605)) {
                    throw "uninstaller exited with code $($uninstallProcess.ExitCode)"
                }

                Start-Sleep -Seconds 5
                Wait-InstallerExecutionIdle
                $retryProcess = Start-Process -FilePath $launchPath -ArgumentList $ArgumentList -Wait -NoNewWindow -PassThru
                $lastExitCode = $retryProcess.ExitCode
                Reset-InstalledApplicationEntriesCache
                if ($SuccessCodes -contains $retryProcess.ExitCode) {
                    if (Wait-ManagedInstallerInstalled -InstallerMetadata $installerMetadata -TargetVersion $CurrentVersion) {
                        $InstallDisposition = 'installed'
                        return [pscustomobject]@{ Status = 'success'; ExitCode = $retryProcess.ExitCode; Attempts = $attempt; Retried = $true }
                    }

                    $lastFailureMessage = "installer finished with code $($retryProcess.ExitCode) after resolving conflict 1638, but the installation could not be confirmed"
                    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] WARNING: $lastFailureMessage."
                    continue
                }

                if (Wait-ManagedInstallerInstalled -InstallerMetadata $installerMetadata -TargetVersion $CurrentVersion -MaxAttempts 2 -SleepSeconds 5) {
                    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] WARNING: The installer returned code $($retryProcess.ExitCode) after resolving conflict 1638, but the app was installed. Treating this as success."
                    $InstallDisposition = 'installed'
                    return [pscustomobject]@{ Status = 'success'; ExitCode = $retryProcess.ExitCode; Attempts = $attempt; Retried = $true }
                }

                $lastFailureMessage = "installer exited with code $($retryProcess.ExitCode) after retrying for conflict 1638"
                Write-Host "[$(Get-Date -Format 'HH:mm:ss')] WARNING: $lastFailureMessage."
                continue
            }

            $conflictLabel = Get-InstallerConflictLabel -Conflict $conflictState
            if ($conflictLabel) {
                throw "installer exited with code 1638: another version is already installed ($conflictLabel)"
            }
            throw 'installer exited with code 1638: another version is already installed'
        }

        if (Wait-ManagedInstallerInstalled -InstallerMetadata $installerMetadata -TargetVersion $CurrentVersion -MaxAttempts 2 -SleepSeconds 5) {
            Write-Host "[$(Get-Date -Format 'HH:mm:ss')] WARNING: The installer returned code $($process.ExitCode), but the app was installed. Treating this as success."
            $InstallDisposition = 'installed'
            return [pscustomobject]@{ Status = 'success'; ExitCode = $process.ExitCode; Attempts = $attempt; Retried = ($attempt -gt 1) }
        }

        $lastFailureMessage = "installer exited with code $($process.ExitCode)"
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] WARNING: $lastFailureMessage."
    }

    if (-not $lastFailureMessage) {
        $lastFailureMessage = 'installer could not complete'
    }
    if ($null -ne $lastExitCode) {
        throw "$lastFailureMessage after $ManagedInstallerMaxAttempts attempts (last code: $lastExitCode)"
    }
    throw "$lastFailureMessage after $ManagedInstallerMaxAttempts attempts"
}
`.trim();
}

function getManagedInstallerInvocation(kind, argumentExpression, options = {}) {
  const installerPathExpression = options.installerPathExpression || '$Instalador.FullName';
  const fallbackDisplayNameExpression = options.fallbackDisplayNameExpression || '$NombreApp';
  const successCodesExpression = options.successCodesExpression || '@(0, 3010, 1641)';
  return `Invoke-ManagedInstaller -Kind '${kind}' -InstallerPath ${installerPathExpression} -ArgumentList ${argumentExpression} -FallbackDisplayName ${fallbackDisplayNameExpression} -SuccessCodes ${successCodesExpression} | Out-Null`;
}

function getCustomTemplateValues(template, appConfig) {
  const params = (appConfig && appConfig.customParams && typeof appConfig.customParams === 'object')
    ? appConfig.customParams
    : {};

  return (template?.arguments || []).map(arg => {
    const raw = params[arg.key];
    const value = raw === undefined || raw === null || raw === ''
      ? String(arg.defaultValue || '')
      : String(raw);
    return {
      ...arg,
      value
    };
  });
}

function buildCustomTemplateArgumentLines(template, appConfig) {
  const argumentValues = getCustomTemplateValues(template, appConfig);
  const fileEntries = resolveCustomTemplateFileEntries(template, appConfig);
  const lines = [];

  for (const arg of argumentValues) {
    if (!arg.value) continue;
    lines.push(
      `    if ($TemplateValues.${arg.key}) { $ArgumentSegments += ${buildPsArgumentExpression(arg.token, arg.joiner, arg.quoteValue !== false, `$TemplateValues.${arg.key}`)} }`
    );
  }

  for (const fileEntry of fileEntries) {
    if (!fileEntry.sourcePath || !fileEntry.argumentName) continue;
    lines.push(
      `    if (Test-Path -LiteralPath $TemplateFiles.${fileEntry.key}) { $ArgumentSegments += ${buildPsArgumentExpression(fileEntry.argumentName, fileEntry.joiner, fileEntry.quoteValue !== false, `$TemplateFiles.${fileEntry.key}`)} }`
    );
  }

  return lines.length > 0 ? lines.join('\n') : '    # No template-specific arguments';
}

function generateUserTemplate(cfg, template) {
  const notify = cfg.notifyUser || false;
  const safeName = sanitizeAppName(cfg.name);
  const silentArgs = sanitizePSForEmbedding(cfg.silentArgs || '/S');
  const valueEntries = getCustomTemplateValues(template, cfg);
  const fileEntries = resolveCustomTemplateFileEntries(template, cfg);
  const templateValuesObject = buildPsObjectLiteral(
    valueEntries.map(entry => ({
      key: entry.key,
      expression: `"${sanitizePSForEmbedding(entry.value)}"`
    }))
  );
  const templateFileNamesObject = buildPsObjectLiteral(
    fileEntries.map(entry => ({
      key: entry.key,
      expression: `"${sanitizePSForEmbedding(entry.targetName)}"`
    }))
  );
  const templateFilesObject = buildPsObjectLiteral(
    fileEntries.map(entry => ({
      key: entry.key,
      expression: `Join-Path -Path $CacheDir -ChildPath "${sanitizePSForEmbedding(entry.relativePath || entry.targetName)}"`
    }))
  );
  const selectedXmlEntry = getSelectedXmlTemplateFileEntry(fileEntries);
  const configXmlName = cfg.configXmlPath
    ? sanitizeTemplateFileName(path.basename(cfg.configXmlPath))
    : (selectedXmlEntry?.targetName
        ? sanitizeTemplateFileName(selectedXmlEntry.targetName)
        : '');
  const customScript = typeof template.script === 'string' && template.script.trim()
    ? `${template.script.trimEnd()}\n`
    : '';

  return `# =========================================================================
# USER TEMPLATE - DROP & RUN
# Template: ${sanitizeAppName(template.name)}
# App: ${safeName}
# Version: ${cfg.version || '1.0.0'}
# Generado: ${new Date().toISOString()}
# =========================================================================
$BaseSilentArgs = "${silentArgs}"

If ($ENV:PROCESSOR_ARCHITEW6432 -eq "AMD64") {
    Try { &"$ENV:WINDIR\\SysNative\\WindowsPowershell\\v1.0\\PowerShell.exe" -ExecutionPolicy Bypass -WindowStyle Hidden -File $PSCOMMANDPATH } Catch { } ; Exit
}
${getLocalCachingLogic(undefined, notify, safeName)}
$TemplateValues = ${templateValuesObject}
$TemplateFileNames = ${templateFileNamesObject}
$TemplateFiles = ${templateFilesObject}
$ConfigXmlName = "${sanitizePSForEmbedding(configXmlName)}"
$ConfigXmlPath = if ($ConfigXmlName) { Join-Path -Path $CacheDir -ChildPath $ConfigXmlName } else { $null }
$HasConfigXml = [bool]($ConfigXmlPath -and (Test-Path -LiteralPath $ConfigXmlPath))
$ArgumentSegments = @()
if ($BaseSilentArgs) { $ArgumentSegments += $BaseSilentArgs }
${buildCustomTemplateArgumentLines(template, cfg)}
$ArgumentosExe = ($ArgumentSegments | Where-Object { $_ -and $_.Trim() }) -join ' '

try {
    if ($Instalador.Extension -eq ".msi") {
        $msiArgs = "/i \`"$($Instalador.FullName)\`""
        if ($ArgumentosExe) { $msiArgs += " " + $ArgumentosExe }
        ${getManagedInstallerInvocation('msi', '$msiArgs')}
    } else {
        ${getManagedInstallerInvocation('exe', '$ArgumentosExe')}
    }
${customScript}${getTrackerSaveLogic(notify)}
`;
}

const { getToastSnippet } = require('./ps-snippets');
function getNotificationLogic(_appName) {
  return getToastSnippet();
}

let _currentAppCtx = null;
function setCurrentAppCtx(cfg) { _currentAppCtx = cfg; }
function getCurrentAppCtx() { return _currentAppCtx || {}; }

// Escape a string for embedding inside a PS single-quoted literal.
function psSingleQuote(str) {
  return String(str == null ? '' : str).replace(/'/g, "''");
}

// Build the PS function Test-AppInstalled for the current app's detection rule.
// Returns '' when the rule is 'tracker' (the caller's existing tracker logic handles it).
function buildDetectionSnippet(cfg) {
  const d = cfg?.detection;
  const installerType = inferInstallerType(cfg);

  // MSI: prefer ProductCode registry check — zero invasive, reads Windows Installer registry
  // Auto-apply when detection type is 'tracker' (default) and installer is MSI
  const useMsiProductCode = (
    d?.type === 'msi-productcode'
    || ((!d?.type || d?.type === 'tracker') && installerType === 'msi')
  );

  if (useMsiProductCode) {
    return `
function Test-AppInstalled {
    $pc = if ($Manifest) { [string]($Manifest.productCode) } else { '' }
    if (-not $pc -and $TrackerFile -and (Test-Path -LiteralPath $TrackerFile)) {
        try { $t = Get-Content -LiteralPath $TrackerFile -Raw | ConvertFrom-Json; $pc = [string]($t.detectedProductCode) } catch {}
    }
    if (-not $pc) { return $false }
    $paths = @(
        "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\$pc",
        "HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\$pc",
        "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\$pc"
    )
    $hit = $paths | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $hit) { return $false }
    # Version gate: if target version known, installed version must be >= target
    if ($CurrentVersion) {
        try {
            $dv = (Get-ItemProperty -LiteralPath $hit -ErrorAction SilentlyContinue).DisplayVersion
            if ($dv) {
                $iv = [version]($dv -replace '[^0-9\\.]','')
                $tv = [version]($CurrentVersion -replace '[^0-9\\.]','')
                return ($iv -ge $tv)
            }
        } catch {}
    }
    return $true
}`;
  }

  if (!d || !d.type || d.type === 'tracker') return '';

  if (d.type === 'file') {
    if (!d.filePath) return '';
    const safePath = psSingleQuote(d.filePath);
    const expected = psSingleQuote(d.fileVersionValue || '');
    const op = ['=', '>', '>=', '<', '<=', '!='].includes(d.fileVersionOp) ? d.fileVersionOp : '>=';
    if (d.fileCheck === 'version' && expected) {
      return `
function Test-AppInstalled {
    $p = '${safePath}'
    if (-not (Test-Path -LiteralPath $p)) { return $false }
    try {
        $info = (Get-Item -LiteralPath $p).VersionInfo
        $raw = if ($info.ProductVersion) { $info.ProductVersion } else { $info.FileVersion }
        if (-not $raw) { return $false }
        $actual = [version]($raw -replace '[^0-9\\.]','' -replace '^\\.+|\\.+$','')
        $target = [version]'${expected}'
        switch ('${op}') {
            '='  { return ($actual -eq $target) }
            '!=' { return ($actual -ne $target) }
            '>'  { return ($actual -gt $target) }
            '>=' { return ($actual -ge $target) }
            '<'  { return ($actual -lt $target) }
            '<=' { return ($actual -le $target) }
        }
    } catch { return $false }
    return $false
}`;
    }
    return `
function Test-AppInstalled {
    return (Test-Path -LiteralPath '${safePath}')
}`;
  }

  if (d.type === 'registry') {
    if (!d.registryKey) return '';
    const hive = d.registryHive === 'HKCU' ? 'HKCU' : 'HKLM';
    const key = psSingleQuote(d.registryKey.replace(/^\\+|\\+$/g, ''));
    const valueName = psSingleQuote(d.registryValueName || '');
    const expected = psSingleQuote(d.registryExpectedValue || '');
    const op = ['=', '>', '>=', '<', '<=', '!='].includes(d.registryOp) ? d.registryOp : '>=';
    const check = d.registryCheck || 'exists';
    return `
function Test-AppInstalled {
    $path = '${hive}:\\${key}'
    if (-not (Test-Path -LiteralPath $path)) { return $false }
    $valueName = '${valueName}'
    if (-not $valueName) { return $true }
    try {
        $item = Get-ItemProperty -LiteralPath $path -Name $valueName -ErrorAction Stop
        $actual = $item.$valueName
    } catch { return $false }
    if ($null -eq $actual) { return $false }
    $expected = '${expected}'
    switch ('${check}') {
        'exists'   { return $true }
        'contains' { return ([string]$actual -like "*$expected*") }
        'equals'   { return ([string]$actual -eq $expected) }
        'version'  {
            try {
                $av = [version](([string]$actual) -replace '[^0-9\\.]','' -replace '^\\.+|\\.+$','')
                $ev = [version]$expected
                switch ('${op}') {
                    '='  { return ($av -eq $ev) }
                    '!=' { return ($av -ne $ev) }
                    '>'  { return ($av -gt $ev) }
                    '>=' { return ($av -ge $ev) }
                    '<'  { return ($av -lt $ev) }
                    '<=' { return ($av -le $ev) }
                }
            } catch { return $false }
        }
    }
    return $false
}`;
  }

  return '';
}

// Build a broader presence check for uninstall scripts. Install detection may
// include version/value comparisons; for uninstall we only need to know whether
// the configured detection anchor is still present before attempting removal.
function buildUninstallPresenceDetectionSnippet(cfg) {
  const d = cfg?.detection;
  if (!d || !d.type || d.type === 'tracker') return '';

  if (d.type === 'file') {
    if (!d.filePath) return '';
    const safePath = psSingleQuote(d.filePath);
    return `
function Test-AppPresentForUninstall {
    return (Test-Path -LiteralPath '${safePath}')
}
`;
  }

  if (d.type === 'registry') {
    if (!d.registryKey) return '';
    const hive = d.registryHive === 'HKCU' ? 'HKCU' : 'HKLM';
    const key = psSingleQuote(d.registryKey.replace(/^\\+|\\+$/g, ''));
    const valueName = psSingleQuote(d.registryValueName || '');
    return `
function Test-AppPresentForUninstall {
    $path = '${hive}:\\${key}'
    if (-not (Test-Path -LiteralPath $path)) { return $false }
    $valueName = '${valueName}'
    if (-not $valueName) { return $true }
    try {
        $item = Get-ItemProperty -LiteralPath $path -Name $valueName -ErrorAction Stop
        return ($null -ne $item.$valueName)
    } catch {
        return $false
    }
}
`;
  }

  return '';
}

// PS code that runs early and blocks until a dependency app's tracker shows success,
// or the timeout elapses. Behavior controls whether timeout skips or fails.
function buildDependencyWaitSnippet(cfg) {
  const dep = cfg?.dependsOn;
  if (!dep || !dep.appName) return '';
  const safeName = sanitizeAppName(dep.appName);
  if (!safeName) return '';
  const timeoutMin = Number.isFinite(dep.timeoutMinutes) && dep.timeoutMinutes > 0
    ? Math.floor(dep.timeoutMinutes) : 30;
  const behavior = dep.behavior === 'fail' ? 'fail' : 'skip';
  return `
# ── Esperar a que termine la dependencia (${safeName}) ───────────────────────
$DepName = '${psSingleQuote(safeName)}'
if ($ADDMDedicatedLogging) {
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] WARNING: Dependency '$DepName' does not use a local tracker in dedicated mode; continuing without writing local state."
} else {
$DepTracker = "$LogDir\\Tracker_$DepName.json"
$DepTimeoutSec = ${timeoutMin * 60}
$DepBehavior = '${behavior}'
$DepStart = Get-Date
$DepReady = $false
while (((Get-Date) - $DepStart).TotalSeconds -lt $DepTimeoutSec) {
    if (Test-Path -LiteralPath $DepTracker) {
        try {
            $dt = Get-Content -LiteralPath $DepTracker -Raw | ConvertFrom-Json
            if ($dt.result -eq 'success') { $DepReady = $true; break }
        } catch {}
    }
    Start-Sleep -Seconds 30
}
if (-not $DepReady) {
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] WARNING: Dependency '$DepName' not confirmed after $DepTimeoutSec seconds."
    if ($DepBehavior -eq 'fail') {
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] ERROR: Aborting installation because a dependency is not satisfied."
        Stop-Transcript -ErrorAction SilentlyContinue
        exit 1
    } else {
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] SKIPPED: Skipping this installation until the dependency finishes."
        Stop-Transcript -ErrorAction SilentlyContinue
        exit 0
    }
}
Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Dependency '$DepName' is ready."
}
`.trim();
}

function getDedicatedRuntimeDetectionLogic() {
  return [
    '# Detect dedicated logging before touching local log paths.',
    '$ADDMDedicatedLogging = $false',
    '$ADDMLoggingConfig = $null',
    '$ADDMLoggingConfigPath = ""',
    'function Find-AppDeployLoggingConfigPath {',
    '    try {',
    '        $dir = $PSScriptRoot',
    '        for ($i = 0; $i -lt 6 -and $dir; $i++) {',
    '            $candidate = Join-Path $dir "ADDeploy\\logging-config.json"',
    '            if (Test-Path -LiteralPath $candidate) { return $candidate }',
    '            $parent = Split-Path -Parent $dir',
    '            if (-not $parent -or $parent -eq $dir) { break }',
    '            $dir = $parent',
    '        }',
    '    } catch { }',
    '    return ""',
    '}',
    'try {',
    '    $ADDMLoggingConfigPath = Find-AppDeployLoggingConfigPath',
    '    if ($ADDMLoggingConfigPath) {',
    '        $candidateConfig = Get-Content -LiteralPath $ADDMLoggingConfigPath -Raw -ErrorAction Stop | ConvertFrom-Json',
    '        if ($candidateConfig.mode -eq "dedicated" -and $candidateConfig.apiBaseUrl) {',
    '            $ADDMLoggingConfig = $candidateConfig',
    '            $ADDMDedicatedLogging = $true',
    '        }',
    '    }',
    '} catch {',
    '    $ADDMDedicatedLogging = $false',
    '    $ADDMLoggingConfig = $null',
    '}',
    'function Save-AppDeployTracker {',
    '    param([hashtable]$Payload)',
    '    if (-not $TrackerFile) { return }',
    '    try { $Payload | ConvertTo-Json | Set-Content -Path $TrackerFile -Force -Encoding UTF8 } catch { }',
    '}',
    'function Get-UninstallSnapshot {',
    '    $snap = @{}',
    '    $paths = @(',
    '        "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",',
    '        "HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall",',
    '        "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall"',
    '    )',
    '    foreach ($path in $paths) {',
    '        if (-not (Test-Path $path)) { continue }',
    '        Get-ChildItem -Path $path -ErrorAction SilentlyContinue | ForEach-Object {',
    '            $n = $_.PSChildName',
    '            if ($n -match "^\\{[0-9A-Fa-f\\-]{36}\\}$") {',
    '                try { $dn = ($_ | Get-ItemProperty -ErrorAction SilentlyContinue).DisplayName; if ($dn) { $snap[$n] = $dn } } catch {}',
    '            }',
    '        }',
    '    }',
    '    return $snap',
    '}'
  ].join('\n');
}

function getRemoteScriptLoggingLogic() {
  return [
    '# Remote logging to dedicated server (best effort, non-blocking for deployment)',
    '$RemoteLogState = @{ Enabled = $false; ApiBaseUrl = ""; ApiKey = ""; ShareId = ""; TlsFingerprint = "" }',
    'function Initialize-AppDeployRemoteLog {',
    '    try {',
    '        $cfg = $ADDMLoggingConfig',
    '        if (-not $cfg) {',
    '            $cfgPath = Find-AppDeployLoggingConfigPath',
    '            if (-not $cfgPath -or -not (Test-Path -LiteralPath $cfgPath)) { return }',
    '            $cfg = Get-Content -LiteralPath $cfgPath -Raw -ErrorAction Stop | ConvertFrom-Json',
    '        }',
    '        if ($cfg.mode -ne "dedicated" -or -not $cfg.apiBaseUrl) { return }',
    '        $RemoteLogState.ApiBaseUrl = ([string]$cfg.apiBaseUrl).TrimEnd("/")',
    '        $RemoteLogState.ShareId = [string]$cfg.shareId',
    '        $RemoteLogState.TlsFingerprint = [string]$cfg.tlsFingerprint',
    '        try { [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor [System.Net.SecurityProtocolType]::Tls12 } catch { }',
    '        [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { param($sender, $cert, $chain, $errors) return $true }',
    '        if ($cfg.enrollmentToken) {',
    '            $body = @{ hostname = $env:COMPUTERNAME; shareId = $RemoteLogState.ShareId; enrollmentToken = [string]$cfg.enrollmentToken } | ConvertTo-Json -Compress',
    '            $enroll = Invoke-RestMethod -Method Post -Uri ($RemoteLogState.ApiBaseUrl + "/api/enroll") -ContentType "application/json" -Body $body -TimeoutSec 10 -ErrorAction Stop',
    '            if ($enroll.apiKey) {',
    '                $RemoteLogState.ApiKey = [string]$enroll.apiKey',
    '            }',
    '        }',
    '        if ($RemoteLogState.ApiBaseUrl -and $RemoteLogState.ApiKey) { $RemoteLogState.Enabled = $true }',
    '    } catch {',
    '        Write-Host "[$(Get-Date -Format \'HH:mm:ss\')] WARNING: remote logging is not initialized - $_"',
    '    }',
    '}',
    'function Send-AppDeployLogBatch {',
    '    param([object[]]$Entries, [switch]$NoQueue)',
    '    if (-not $RemoteLogState.Enabled -or -not $Entries -or $Entries.Count -eq 0) { return $false }',
    '    try {',
    '        $headers = @{ "X-API-Key" = $RemoteLogState.ApiKey }',
    '        $body = @{ hostname = $env:COMPUTERNAME; shareId = $RemoteLogState.ShareId; entries = @($Entries) } | ConvertTo-Json -Compress -Depth 10',
    '        Invoke-RestMethod -Method Post -Uri ($RemoteLogState.ApiBaseUrl + "/api/logs/batch") -Headers $headers -ContentType "application/json" -Body $body -TimeoutSec 10 -ErrorAction Stop | Out-Null',
    '        return $true',
    '    } catch {',
    '        return $false',
    '    }',
    '}',
    'function Flush-AppDeployLogQueue {',
    '    return',
    '}',
    'function Send-AppDeployLog {',
    '    param([string]$Level = "info", [string]$Source = "install", [string]$Message, [hashtable]$Context = @{})',
    '    try {',
    '        $entry = @{ ts = (Get-Date).ToUniversalTime().ToString("o"); level = $Level; source = $Source; message = $Message; context = $Context }',
    '        [void](Send-AppDeployLogBatch -Entries @($entry))',
    '    } catch { }',
    '}',
    'Initialize-AppDeployRemoteLog',
    'Flush-AppDeployLogQueue'
  ].join('\n');
}

function getLocalCachingLogic(filter = "\\.(exe|msi)$", notifyUser = false, appDisplayName = '') {
  const config = configService.getConfig();
  const dict = i18nService.getTranslations(config.language || 'en');
  const ToastTitleProcess = dict.apps?.toastTitleProcess || "Installation in progress";
  const ToastMsgProcess = dict.apps?.toastMsgProcess || "Installing. Please do not turn off your computer.";

  const { getToastSnippet } = require('./ps-snippets');
  const notifyPrefix = notifyUser ? getToastSnippet(ToastTitleProcess, ToastMsgProcess) : '';
  const notifyBefore = '';
  const safeFilter = String(filter || "\\.(exe|msi)$").replace(/"/g, '""');

  const appCtx = getCurrentAppCtx();
  const depWait = buildDependencyWaitSnippet(appCtx);
  const detectionFn = buildDetectionSnippet(appCtx);
  const detectionCall = detectionFn ? `
# ── Detección de instalación previa (regla definida por el usuario) ─────────
if (Test-AppInstalled) {
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] SKIPPED: Detection rule confirms that the app is already installed."
    Save-AppDeployTracker -Payload @{ version = $CurrentVersion; hash = $CurrentHash; installedAt = (Get-Date).ToString('o'); computer = $env:COMPUTERNAME; result = 'success'; method = 'detection-rule' }
    Send-AppDeployLog -Level "info" -Source "install" -Message "install_skipped" -Context @{ appName = $NombreApp; version = $CurrentVersion; hash = $CurrentHash; reason = "detection-rule" }
    Stop-Transcript -ErrorAction SilentlyContinue
    exit 0
}` : '';
  return [
    '# ── Guardia $PSScriptRoot (puede estar vacío en GPO startup / PS4) ────────',
    'if (-not $PSScriptRoot) { $PSScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path }',
    'if (-not $PSScriptRoot) { $PSScriptRoot = $PWD.Path }',
    '',
    getDedicatedRuntimeDetectionLogic(),
    '',
    '# ── Logging ────────────────────────────────────────────────────────────',
    '$LogDir = "C:\\ProgramData\\AppDeploy_Logs"',
    'if (-not $ADDMDedicatedLogging -and -not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }',
    '# ── Limpieza de logs antiguos (>7 días) ─────────────────────────────────',
    'if (-not $ADDMDedicatedLogging) { Get-ChildItem "$LogDir\\*.log" -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-7) } | Remove-Item -Force -ErrorAction SilentlyContinue }',
    '',
    '# Split-Path es pura string — no necesita acceso de red (evita fallo si el share aún no responde)',
    '$NombreApp = if ($PSScriptRoot) { Split-Path -Leaf $PSScriptRoot } else { "UnknownApp" }',
    '$LogFile   = if ($ADDMDedicatedLogging) { $null } else { "$LogDir\\Install_$($NombreApp)_$(Get-Date -Format \'yyyyMMdd_HHmmss\').log" }',
    'if ($LogFile) { Start-Transcript -Path $LogFile -Force -ErrorAction SilentlyContinue }',
    '',
    'Write-Host "[$(Get-Date -Format \'HH:mm:ss\')] ===== AppDeploy Manager ============================="',
    'Write-Host "[$(Get-Date -Format \'HH:mm:ss\')] App     : $NombreApp"',
    'Write-Host "[$(Get-Date -Format \'HH:mm:ss\')] Computer: $env:COMPUTERNAME"',
    'Write-Host "[$(Get-Date -Format \'HH:mm:ss\')] User    : $env:USERNAME"',
    'Write-Host "[$(Get-Date -Format \'HH:mm:ss\')] Source  : $PSScriptRoot"',
    'Write-Host "[$(Get-Date -Format \'HH:mm:ss\')] ====================================================="',
    '',
    '$TrackerFile = if ($ADDMDedicatedLogging) { $null } else { "$LogDir\\Tracker_$NombreApp.json" }',
    '$CleanupMarkerDir = if ($ADDMDedicatedLogging) { "" } else { Join-Path $LogDir "PendingCacheCleanup" }',
    'if ($CleanupMarkerDir -and -not (Test-Path -LiteralPath $CleanupMarkerDir)) { New-Item -ItemType Directory -Path $CleanupMarkerDir -Force | Out-Null }',
    '$CleanupMarkerPath = if ($CleanupMarkerDir) { Join-Path $CleanupMarkerDir "$NombreApp.json" } else { "" }',
    getRemoteScriptLoggingLogic(),
    depWait,
    getDeployCacheCleanupLogic(),
    '',
    '# ── Leer manifiesto ─────────────────────────────────────────────────────',
    '$VersionFile = Join-Path $PSScriptRoot "version.json"',
    'if (-not (Test-Path $VersionFile)) {',
    '    Write-Host "[$(Get-Date -Format \'HH:mm:ss\')] SKIPPED: version.json was not found in $PSScriptRoot"',
    '    Stop-Transcript -ErrorAction SilentlyContinue',
    '    exit 0',
    '}',
    'try {',
    '    $Manifest       = Get-Content $VersionFile -Raw | ConvertFrom-Json',
    '    $CurrentHash    = $Manifest.hash',
    '    $CurrentVersion = $Manifest.version',
    '    $PrimaryInstallerName = [string]($Manifest.primaryInstallerName)',
    '} catch {',
    '    Write-Host "[$(Get-Date -Format \'HH:mm:ss\')] ERROR: corrupt version.json - $_"',
    '    Stop-Transcript -ErrorAction SilentlyContinue',
    '    exit 1',
    '}',
    'Write-Host "[$(Get-Date -Format \'HH:mm:ss\')] Version : $CurrentVersion | Hash: $CurrentHash"',
    'Send-AppDeployLog -Level "info" -Source "install" -Message "install_start" -Context @{ appName = $NombreApp; version = $CurrentVersion; hash = $CurrentHash; scriptRoot = $PSScriptRoot }',
    '',
    getInstallerConflictLogic(),
    '',
    detectionFn,
    detectionCall,
    '# ── Comprobar si ya instalado ────────────────────────────────────────────',
    'if ($TrackerFile -and (Test-Path -LiteralPath $TrackerFile)) {',
    '    try {',
    '        $t = Get-Content -LiteralPath $TrackerFile -Raw | ConvertFrom-Json',
    '        if ($t.hash -eq $CurrentHash -and $t.result -eq \'success\') {',
    '            Write-Host "[$(Get-Date -Format \'HH:mm:ss\')] SKIPPED: Already installed (v$($t.version), matching hash)"',
    '            Send-AppDeployLog -Level "info" -Source "install" -Message "install_skipped" -Context @{ appName = $NombreApp; version = $CurrentVersion; hash = $CurrentHash; reason = "tracker-success" }',
    '            Stop-Transcript -ErrorAction SilentlyContinue',
    '            exit 0',
    '        }',
    '        if ($t.hash -eq $CurrentHash -and $t.result -eq \'failed\') {',
    '            $PreviousFailureCount = 1',
    '            if ($null -ne $t.retryCount) {',
    '                try { $PreviousFailureCount = [Math]::Max([int]$t.retryCount, 1) } catch { $PreviousFailureCount = 1 }',
    '            }',
    '            if ($PreviousFailureCount -ge $ManagedInstallerMaxAttempts) {',
    '                Write-Host "[$(Get-Date -Format \'HH:mm:ss\')] SKIPPED: Installation has failed $PreviousFailureCount times with this hash. Update the app or review the installer before resetting retries."',
    '                Send-AppDeployLog -Level "warn" -Source "install" -Message "install_skipped" -Context @{ appName = $NombreApp; version = $CurrentVersion; hash = $CurrentHash; reason = "max-retries"; retryCount = $PreviousFailureCount }',
    '                Stop-Transcript -ErrorAction SilentlyContinue',
    '                exit 0',
    '            }',
    '            $TrackerRetryBase = $PreviousFailureCount',
    '            Write-Host "[$(Get-Date -Format \'HH:mm:ss\')] WARNING: Installation previously failed with this hash (attempt $($PreviousFailureCount + 1)/$ManagedInstallerMaxAttempts). Retrying."',
    '        }',
    '        Write-Host "[$(Get-Date -Format \'HH:mm:ss\')] Previous hash: $($t.hash) - updating to $CurrentHash"',
    '    } catch {',
    '        Write-Host "[$(Get-Date -Format \'HH:mm:ss\')] WARNING: Corrupt tracker; reinstalling"',
    '    }',
    '}',
    '',
    '# ── Localizar instalador en share ────────────────────────────────────────',
    'Write-Host "[$(Get-Date -Format \'HH:mm:ss\')] Looking for the installer on the share..."',
    '$InstaladorRed = $null',
    'if ($PrimaryInstallerName) {',
    '    $PrimaryInstallerPath = Join-Path -Path $PSScriptRoot -ChildPath $PrimaryInstallerName',
    '    if (Test-Path -LiteralPath $PrimaryInstallerPath) {',
    '        $InstaladorRed = Get-Item -LiteralPath $PrimaryInstallerPath -ErrorAction SilentlyContinue',
    '    }',
    '}',
    'if (-not $InstaladorRed) {',
    '    $InstaladorRed = Get-ChildItem -Path $PSScriptRoot -File -ErrorAction SilentlyContinue |',
    '                     Where-Object { $_.Extension -match "' + safeFilter + '" -and $_.Name -ne "install.ps1" -and $_.Name -ne "uninstall.ps1" } |',
    '                     Select-Object -First 1',
    '}',
    'if (-not $InstaladorRed) {',
    '    Write-Host "[$(Get-Date -Format \'HH:mm:ss\')] ERROR: Installer not found (' + safeFilter + ') in $PSScriptRoot"',
    '    if (Test-Path $VersionFile) {',
    '        Save-AppDeployTracker -Payload @{ hash = $CurrentHash; version = $CurrentVersion; failedAt = (Get-Date).ToString(\'o\'); computer = $env:COMPUTERNAME; result = \'failed\'; retryCount = ($TrackerRetryBase + 1); error = \'Installer not found in share\' }',
    '    }',
    '    Send-AppDeployLog -Level "error" -Source "install" -Message "install_failed" -Context @{ appName = $NombreApp; version = $CurrentVersion; hash = $CurrentHash; error = "Installer not found in share" }',
    '    Stop-Transcript -ErrorAction SilentlyContinue',
    '    exit 1',
    '}',
    'Write-Host "[$(Get-Date -Format \'HH:mm:ss\')] Installer: $($InstaladorRed.Name) ($([Math]::Round($InstaladorRed.Length/1MB,1)) MB)"',
    '',
    '# ── Copiar a cache local ─────────────────────────────────────────────────',
    '$CacheDir = "C:\\Temp\\Deploy\\$NombreApp"',
    'Write-Host "[$(Get-Date -Format \'HH:mm:ss\')] Copying to cache: $CacheDir"',
    'try {',
    '    if (-not (Test-Path $CacheDir)) { New-Item -ItemType Directory -Path $CacheDir -Force | Out-Null }',
    '    Copy-Item -Path "$PSScriptRoot\\*" -Destination $CacheDir -Recurse -Force -ErrorAction Stop',
    '    Write-Host "[$(Get-Date -Format \'HH:mm:ss\')] Copy completed."',
    '} catch {',
    '    Write-Host "[$(Get-Date -Format \'HH:mm:ss\')] ERROR copying from share: $_"',
    '    Send-AppDeployLog -Level "error" -Source "install" -Message "install_failed" -Context @{ appName = $NombreApp; version = $CurrentVersion; hash = $CurrentHash; error = $_.ToString(); stage = "copy-from-share" }',
    '    Stop-Transcript -ErrorAction SilentlyContinue',
    '    exit 1',
    '}',
    '',
    '# ── Localizar instalador en cache ────────────────────────────────────────',
    '$Instalador = $null',
    'if ($PrimaryInstallerName) {',
    '    $PrimaryInstallerCachePath = Join-Path -Path $CacheDir -ChildPath $PrimaryInstallerName',
    '    if (Test-Path -LiteralPath $PrimaryInstallerCachePath) {',
    '        $Instalador = Get-Item -LiteralPath $PrimaryInstallerCachePath -ErrorAction SilentlyContinue',
    '    }',
    '}',
    'if (-not $Instalador) {',
    '    $Instalador = Get-ChildItem -Path $CacheDir -File |',
    '                  Where-Object { $_.Extension -match "' + safeFilter + '" -and $_.Name -ne "install.ps1" -and $_.Name -ne "uninstall.ps1" } |',
    '                  Select-Object -First 1',
    '}',
    'if (-not $Instalador) {',
    '    Write-Host "[$(Get-Date -Format \'HH:mm:ss\')] ERROR: Installer not found in cache after copying"',
    '    Send-AppDeployLog -Level "error" -Source "install" -Message "install_failed" -Context @{ appName = $NombreApp; version = $CurrentVersion; hash = $CurrentHash; error = "Installer not found in cache"; stage = "cache" }',
    '    Stop-Transcript -ErrorAction SilentlyContinue',
    '    exit 1',
    '}',
    'Write-Host "[$(Get-Date -Format \'HH:mm:ss\')] Running installation..."',
    '# NOTA: $PSScriptRoot sigue apuntando al share (solo lectura). Usar $CacheDir para rutas locales.',
    notifyPrefix,
    notifyBefore,
  ].join('\n');
}

function getTrackerSaveLogic(notifyUser = false, useSnapshotDiff = false) {
  const config = configService.getConfig();
  const dict = i18nService.getTranslations(config.language || 'en');
  const ToastTitleDone = dict.apps?.toastTitleDone || "Installation complete";
  const ToastMsgDone = dict.apps?.toastMsgDone || "Installation completed successfully. You may continue.";

  const { getToastSnippet } = require('./ps-snippets');
  const toastBlock = notifyUser ? getToastSnippet(ToastTitleDone, ToastMsgDone) : '';
  const notifyAfter = notifyUser
    ? `    Send-UserToast -ToastTitle "${ToastTitleDone.replace(/"/g, '\\"')}" -ToastMessage "${ToastMsgDone.replace(/"/g, '\\"')}" -IconType "Information"`
    : '';
  return `
    # ── Exito ──────────────────────────────────────────────────────────
    if ($InstallDisposition -eq 'skipped') {
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] SKIPPED: Installer skipped; a valid version was already installed for $NombreApp."
    } else {
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] OK: $NombreApp installed successfully (v$CurrentVersion)"
    }
${notifyAfter}
    ${useSnapshotDiff ? `$_tp = @{ hash = $CurrentHash; version = $CurrentVersion; installedAt = (Get-Date).ToString('o'); computer = $env:COMPUTERNAME; result = 'success' }
    if ($DetectedProductCode) { $_tp.detectedProductCode = $DetectedProductCode; $_tp.detectedDisplayName = $DetectedDisplayName }
    Save-AppDeployTracker -Payload $_tp` : `Save-AppDeployTracker -Payload @{ hash = $CurrentHash; version = $CurrentVersion; installedAt = (Get-Date).ToString('o'); computer = $env:COMPUTERNAME; result = 'success' }`}
    Send-AppDeployLog -Level "info" -Source "install" -Message "install_success" -Context @{ appName = $NombreApp; version = $CurrentVersion; hash = $CurrentHash; disposition = $InstallDisposition }
    Invoke-DeployCacheCleanupWithFallback -CacheDir $CacheDir -MarkerPath $CleanupMarkerPath | Out-Null

} catch {
    # ── Error ──────────────────────────────────────────────────────────
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] ERROR: Failed to install $NombreApp - $_"
    Save-AppDeployTracker -Payload @{ hash = $CurrentHash; version = $CurrentVersion; failedAt = (Get-Date).ToString('o'); computer = $env:COMPUTERNAME; result = 'failed'; retryCount = ($TrackerRetryBase + 1); error = $_.ToString() }
    Send-AppDeployLog -Level "error" -Source "install" -Message "install_failed" -Context @{ appName = $NombreApp; version = $CurrentVersion; hash = $CurrentHash; retryCount = ($TrackerRetryBase + 1); error = $_.ToString() }
    Invoke-DeployCacheCleanupWithFallback -CacheDir $CacheDir -MarkerPath $CleanupMarkerPath | Out-Null
}
Stop-Transcript -ErrorAction SilentlyContinue`;
}

function generateGeneric(cfg) {
  const silentArgs = sanitizePSForEmbedding(cfg.silentArgs || cfg.customParams?.silentArgs || '/S');
  const notify = cfg.notifyUser || false;
  const safeName = sanitizeAppName(cfg.name);
  return `# =========================================================================
# PLANTILLA GENÉRICA "DROP & RUN"
# App: ${safeName}
# Versión: ${cfg.version || '1.0.0'}
# Generado: ${new Date().toISOString()}
# =========================================================================
$ArgumentosExe = "${silentArgs}"

If ($ENV:PROCESSOR_ARCHITEW6432 -eq "AMD64") {
    Try { &"$ENV:WINDIR\\SysNative\\WindowsPowershell\\v1.0\\PowerShell.exe" -ExecutionPolicy Bypass -WindowStyle Hidden -File $PSCOMMANDPATH } Catch { } ; Exit
}
${getLocalCachingLogic("\\.(exe|msi|ps1)$", notify, safeName)}
try {
    if ($Instalador.Extension -eq ".msi") {
        $msiArgs = "/i \`"$($Instalador.FullName)\`" " + $ArgumentosExe
        ${getManagedInstallerInvocation('msi', '$msiArgs')}
    } elseif ($Instalador.Extension -eq ".ps1") {
        $psArgs = "-ExecutionPolicy Bypass -File \`"$($Instalador.FullName)\`""
        if ($ArgumentosExe) { $psArgs += " " + $ArgumentosExe }
        ${getManagedInstallerInvocation('ps1', '$psArgs')}
    } else {
        $UninstallSnapshot = Get-UninstallSnapshot
        ${getManagedInstallerInvocation('exe', '$ArgumentosExe')}
        $DetectedProductCode = $null
        $DetectedDisplayName = $null
        if ($null -ne $UninstallSnapshot) {
            $afterSnap = Get-UninstallSnapshot
            $newKeys = @($afterSnap.Keys | Where-Object { -not $UninstallSnapshot.ContainsKey($_) })
            if ($newKeys.Count -gt 0) {
                $DetectedProductCode = $newKeys[0]
                $DetectedDisplayName = $afterSnap[$DetectedProductCode]
                Write-Host "[$(Get-Date -Format 'HH:mm:ss')] ProductCode detected after installation: $DetectedProductCode ($DetectedDisplayName)"
            }
        }
    }
${getTrackerSaveLogic(notify, true)}
`;
}

function generateFreshservice(cfg) {
  const token = sanitizePSForEmbedding(cfg.customParams?.token || '');
  const notify = cfg.notifyUser || false;
  return `# =========================================================================
# FRESHSERVICE AGENT - DROP & RUN
# App: ${sanitizeAppName(cfg.name)}
# Version: ${cfg.version || '1.0.0'}
# Generado: ${new Date().toISOString()}
# =========================================================================
$Token = "${token}"

If ($ENV:PROCESSOR_ARCHITEW6432 -eq "AMD64") {
    Try { &"$ENV:WINDIR\\SysNative\\WindowsPowershell\\v1.0\\PowerShell.exe" -ExecutionPolicy Bypass -WindowStyle Hidden -File $PSCOMMANDPATH } Catch { } ; Exit
}
${getLocalCachingLogic("\\.(exe|msi)$", notify, sanitizeAppName(cfg.name))}
try {
    if ($Instalador.Extension -eq ".msi") {
        $msiArgs = "/i \`"$($Instalador.FullName)\`" REGISTRATIONTOKEN=\`"$Token\`" /qn /norestart"
        ${getManagedInstallerInvocation('msi', '$msiArgs')}
    } else {
        ${getManagedInstallerInvocation('exe', '"/S REGISTRATIONTOKEN=\`"$Token\`""')}
    }
${getTrackerSaveLogic(notify)}
`;
}

function generateCrowdstrike(cfg) {
  const cid = sanitizePSForEmbedding(cfg.customParams?.cid || '');
  const notify = cfg.notifyUser || false;
  return `# =========================================================================
# CROWDSTRIKE FALCON - DROP & RUN
# App: ${sanitizeAppName(cfg.name)}
# Version: ${cfg.version || '1.0.0'}
# Generado: ${new Date().toISOString()}
# =========================================================================
$CID = "${cid}"

If ($ENV:PROCESSOR_ARCHITEW6432 -eq "AMD64") {
    Try { &"$ENV:WINDIR\\SysNative\\WindowsPowershell\\v1.0\\PowerShell.exe" -ExecutionPolicy Bypass -WindowStyle Hidden -File $PSCOMMANDPATH } Catch { } ; Exit
}
${getLocalCachingLogic("\\.exe$", notify, sanitizeAppName(cfg.name))}
try {
    ${getManagedInstallerInvocation('exe', '"/S /quiet /install CID=$CID"')}
${getTrackerSaveLogic(notify)}
`;
}

function generateSapGui(cfg) {
  const notify = cfg.notifyUser || false;
  const safeName = sanitizeAppName(cfg.name);
  const sapTheme = /^\d+$/.test(String(cfg.customParams?.sapTheme)) ? parseInt(cfg.customParams.sapTheme) : 1;
  return `# =========================================================================
# SAP GUI - DROP & RUN
# App: ${safeName}
# Generado: ${new Date().toISOString()}
# =========================================================================
If ($ENV:PROCESSOR_ARCHITEW6432 -eq "AMD64") {
    Try { &"$ENV:WINDIR\\SysNative\\WindowsPowershell\\v1.0\\PowerShell.exe" -ExecutionPolicy Bypass -WindowStyle Hidden -File $PSCOMMANDPATH } Catch { } ; Exit
}
${getLocalCachingLogic("\\.exe$", notify, safeName)}
try {
    ${getManagedInstallerInvocation('exe', '"/silent"')}

    $xmlSource = Join-Path -Path $CacheDir -ChildPath "SAPUILandscapeGlobal.xml"
    $xmlDestDir = "C:\\connectionsap"
    $xmlDestFile = "$xmlDestDir\\SAPUILandscapeGlobal.xml"

    if (-not (Test-Path $xmlDestDir)) { New-Item -Path $xmlDestDir -ItemType Directory -Force | Out-Null }
    if (Test-Path $xmlSource) {
        Copy-Item -Path $xmlSource -Destination $xmlDestFile -Force
        [Environment]::SetEnvironmentVariable("SAPLOGON_LSXML_FILE", $xmlDestFile, "Machine")

        if (!(Test-Path "HKLM:\\SOFTWARE\\SAP\\SAPLogon\\Options")) { New-Item "HKLM:\\SOFTWARE\\SAP\\SAPLogon\\Options" -Force | Out-Null }
        New-ItemProperty -Path "HKLM:\\SOFTWARE\\SAP\\SAPLogon\\Options" -Name "LandscapeFileOnServer" -Value $xmlDestFile -PropertyType String -Force | Out-Null

        if (!(Test-Path "HKLM:\\SOFTWARE\\WOW6432Node\\SAP\\SAPLogon\\Options")) { New-Item "HKLM:\\SOFTWARE\\WOW6432Node\\SAP\\SAPLogon\\Options" -Force | Out-Null }
        New-ItemProperty -Path "HKLM:\\SOFTWARE\\WOW6432Node\\SAP\\SAPLogon\\Options" -Name "LandscapeFileOnServer" -Value $xmlDestFile -PropertyType String -Force | Out-Null
    }

    $themePath = "HKLM:\\SOFTWARE\\SAP\\General\\Appearance"
    if (!(Test-Path $themePath)) { New-Item -Path $themePath -Force | Out-Null }
    New-ItemProperty -Path $themePath -Name "SelectedTheme" -Value ${sapTheme} -PropertyType DWord -Force | Out-Null
${getTrackerSaveLogic(notify)}
`;
}

function generateForticlient(cfg) {
  const vpnName = sanitizeAppName(cfg.customParams?.vpnName || 'VPN');
  const vpnDesc = sanitizePSForEmbedding(cfg.customParams?.vpnDescription || 'VPN Corporativa');
  const vpnServer = sanitizePSForEmbedding(cfg.customParams?.vpnServer || '0.0.0.0:443');
  const sso = cfg.customParams?.ssoEnabled === false ? 0 : 1;
  const srvCert = cfg.customParams?.serverCert === true ? 1 : 0;
  const noWarn = cfg.customParams?.noWarnInvalidCert === false ? 0 : 1;
  const notify = cfg.notifyUser || false;
  
  return `# =========================================================================
# FORTICLIENT VPN - DROP & RUN
# App: ${sanitizeAppName(cfg.name)}
# Generado: ${new Date().toISOString()}
# =========================================================================
$FcVpnName   = "${vpnName}"
$FcVpnDesc   = "${vpnDesc}"
$FcVpnServer = "${vpnServer}"
If ($ENV:PROCESSOR_ARCHITEW6432 -eq "AMD64") {
    Try { &"$ENV:WINDIR\\SysNative\\WindowsPowershell\\v1.0\\PowerShell.exe" -ExecutionPolicy Bypass -WindowStyle Hidden -File $PSCOMMANDPATH } Catch { } ; Exit
}
${getLocalCachingLogic("\\.(exe|msi)$", notify, vpnName)}
try {
    if ($Instalador.Extension -eq ".msi") {
        $msiArgs = "/i \`"$($Instalador.FullName)\`" REBOOT=ReallySuppress /qn"
        ${getManagedInstallerInvocation('msi', '$msiArgs')}
    } else {
        ${getManagedInstallerInvocation('exe', '"/S /silent /NORESTART"')}
    }

    $vpnPath = "HKLM:\\SOFTWARE\\Fortinet\\FortiClient\\Sslvpn\\Tunnels\\$FcVpnName"
    if (-not (Test-Path -LiteralPath $vpnPath)) { New-Item $vpnPath -Force -ea SilentlyContinue | Out-Null }

    New-ItemProperty -LiteralPath $vpnPath -Name 'Description' -Value $FcVpnDesc  -PropertyType String -Force -ea SilentlyContinue | Out-Null
    New-ItemProperty -LiteralPath $vpnPath -Name 'Server'      -Value $FcVpnServer -PropertyType String -Force -ea SilentlyContinue | Out-Null
    New-ItemProperty -LiteralPath $vpnPath -Name 'sso_enabled' -Value ${sso} -PropertyType DWord -Force -ea SilentlyContinue | Out-Null
    New-ItemProperty -LiteralPath $vpnPath -Name 'ServerCert' -Value '${srvCert}' -PropertyType String -Force -ea SilentlyContinue | Out-Null

    $sslPath = "HKLM:\\SOFTWARE\\Fortinet\\FortiClient\\Sslvpn"
    if (-not (Test-Path -LiteralPath $sslPath)) { New-Item $sslPath -Force -ea SilentlyContinue | Out-Null }
    New-ItemProperty -LiteralPath $sslPath -Name 'no_warn_invalid_cert' -Value ${noWarn} -PropertyType DWord -Force -ea SilentlyContinue | Out-Null
${getTrackerSaveLogic(notify)}
`;
}

function generateOffice(cfg) {
  const configXml = cfg.configXmlPath
    ? sanitizeTemplateFileName(path.basename(cfg.configXmlPath))
    : (sanitizeTemplateFileName(cfg.customParams?.configXml || 'config_office.xml') || 'config_office.xml');
  const notify = cfg.notifyUser || false;
  return `# =========================================================================
# MICROSOFT OFFICE - DROP & RUN
# App: ${sanitizeAppName(cfg.name)}
# Generado: ${new Date().toISOString()}
# =========================================================================
If ($ENV:PROCESSOR_ARCHITEW6432 -eq "AMD64") {
    Try { &"$ENV:WINDIR\\SysNative\\WindowsPowershell\\v1.0\\PowerShell.exe" -ExecutionPolicy Bypass -WindowStyle Hidden -File $PSCOMMANDPATH } Catch { } ; Exit
}
${getLocalCachingLogic("\\.exe$", notify, sanitizeAppName(cfg.name))}
try {
    $RutaXML = Join-Path -Path $CacheDir -ChildPath "${configXml}"
    ${getManagedInstallerInvocation('exe', '"/configure \`"$RutaXML\`""')}
${getTrackerSaveLogic(notify)}
`;
}

function generateCustom(cfg) {
  const safeName = sanitizeAppName(cfg.name);
  const code = cfg.customParams?.customScript || '';
  const safeCode = String(code).replace(/\r\n/g, '\n');
  const hasInstaller = !!(cfg.installerPath || cfg.customParams?.installerPath);
  const silentArgs = sanitizePSForEmbedding(cfg.silentArgs || cfg.customParams?.silentArgs || '');

  if (hasInstaller) {
    // Include full caching infrastructure so $Instalador/$CacheDir/$CurrentVersion/$ArgumentosExe are available
    return `# =========================================================================
# SCRIPT CUSTOM - CON INSTALADOR
# App: ${safeName}
# Versión: ${cfg.version || '1.0.0'}
# Generado: ${new Date().toISOString()}
# Variables disponibles: $Instalador, $CacheDir, $CurrentVersion, $ArgumentosExe, $NombreApp
# =========================================================================
$ArgumentosExe = "${silentArgs}"

If ($ENV:PROCESSOR_ARCHITEW6432 -eq "AMD64") {
    Try { &"$ENV:WINDIR\\SysNative\\WindowsPowershell\\v1.0\\PowerShell.exe" -ExecutionPolicy Bypass -WindowStyle Hidden -File $PSCOMMANDPATH } Catch { } ; Exit
}
${getLocalCachingLogic("\\.(exe|msi|ps1)$", cfg.notifyUser || false, safeName)}
try {
${safeCode}
${getTrackerSaveLogic(cfg.notifyUser || false)}
`;
  }

  return `# =========================================================================
# SCRIPT CUSTOM RAW
# App: ${safeName}
# Generado: ${new Date().toISOString()}
# ADVERTENCIA: Este script ejecuta codigo personalizado. Usar con cautela.
# =========================================================================
${safeCode}
`;
}

function generateWazuh(cfg) {
  const manager = sanitizePSForEmbedding(cfg.customParams?.manager || '');
  const group = sanitizePSForEmbedding(cfg.customParams?.group || 'default');
  const pwd = sanitizePSForEmbedding(cfg.customParams?.password || '');
  const notify = cfg.notifyUser || false;
  return `# =========================================================================
# WAZUH AGENT - DROP & RUN
# App: ${sanitizeAppName(cfg.name)}
# =========================================================================
$WazuhManager = "${manager}"
$WazuhGroup   = "${group}"
$WazuhPwd     = "${pwd}"
If ($ENV:PROCESSOR_ARCHITEW6432 -eq "AMD64") { Try { &"$ENV:WINDIR\\SysNative\\WindowsPowershell\\v1.0\\PowerShell.exe" -ExecutionPolicy Bypass -WindowStyle Hidden -File $PSCOMMANDPATH } Catch { } ; Exit }
${getLocalCachingLogic("\\.(exe|msi)$", notify, sanitizeAppName(cfg.name))}
try {
    if ($Instalador.Extension -eq ".msi") {
        $msiArgs = "/i \`"$($Instalador.FullName)\`" WAZUH_MANAGER=\`"$WazuhManager\`" WAZUH_AGENT_GROUP=\`"$WazuhGroup\`""
        if ($WazuhPwd) { $msiArgs += " WAZUH_REGISTRATION_PASSWORD=\`"$WazuhPwd\`"" }
        $msiArgs += " /qn"
        ${getManagedInstallerInvocation('msi', '$msiArgs')}
    } else {
        $exeArgs = "WAZUH_MANAGER=\`"$WazuhManager\`" WAZUH_AGENT_GROUP=\`"$WazuhGroup\`""
        if ($WazuhPwd) { $exeArgs += " WAZUH_REGISTRATION_PASSWORD=\`"$WazuhPwd\`"" }
        $exeArgs += " /S"
        ${getManagedInstallerInvocation('exe', '$exeArgs')}
    }

    # ── Wazuh service start (avoids reboot requirement) ──────────────────
    if ($InstallDisposition -ne 'skipped') {
        $wazuhSvc = Get-Service -Name 'WazuhSvc' -ErrorAction SilentlyContinue
        if ($null -eq $wazuhSvc) {
            Write-Host "[$(Get-Date -Format 'HH:mm:ss')] WARNING: WazuhSvc service not found. A reboot may be required."
        } elseif ($wazuhSvc.Status -ne 'Running') {
            Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Starting WazuhSvc service..."
            Set-Service -Name 'WazuhSvc' -StartupType Automatic -ErrorAction SilentlyContinue
            Start-Service -Name 'WazuhSvc' -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 4
            $svcStatus = (Get-Service -Name 'WazuhSvc' -ErrorAction SilentlyContinue).Status
            if ($svcStatus -eq 'Running') {
                Write-Host "[$(Get-Date -Format 'HH:mm:ss')] OK: WazuhSvc started successfully."
            } else {
                Write-Host "[$(Get-Date -Format 'HH:mm:ss')] WARNING: Could not start WazuhSvc (status: $svcStatus). Check manually."
            }
        } else {
            Write-Host "[$(Get-Date -Format 'HH:mm:ss')] WazuhSvc is already running."
        }
    }
${getTrackerSaveLogic(notify)}
`;
}

function generateSentinelOne(cfg) {
  const st = sanitizePSForEmbedding(cfg.customParams?.siteToken || '');
  const notify = cfg.notifyUser || false;
  return `# =========================================================================
# SENTINELONE - DROP & RUN
# =========================================================================
$SiteToken = "${st}"
If ($ENV:PROCESSOR_ARCHITEW6432 -eq "AMD64") { Try { &"$ENV:WINDIR\\SysNative\\WindowsPowershell\\v1.0\\PowerShell.exe" -ExecutionPolicy Bypass -WindowStyle Hidden -File $PSCOMMANDPATH } Catch { } ; Exit }
${getLocalCachingLogic("\\.(exe|msi)$", notify, sanitizeAppName(cfg.name))}
try {
    if ($Instalador.Extension -eq ".msi") {
        $msiArgs = "/i \`"$($Instalador.FullName)\`" SITE_TOKEN=\`"$SiteToken\`" /qn"
        ${getManagedInstallerInvocation('msi', '$msiArgs')}
    } else {
        ${getManagedInstallerInvocation('exe', '"-t $SiteToken -q"')}
    }
${getTrackerSaveLogic(notify)}
`;
}

function generateCortexXDR(cfg) {
  const dir = sanitizePSForEmbedding(cfg.customParams?.installDir || '');
  const notify = cfg.notifyUser || false;
  return `# =========================================================================
# CORTEX XDR - DROP & RUN
# =========================================================================
$CortexDir = "${dir}"
If ($ENV:PROCESSOR_ARCHITEW6432 -eq "AMD64") { Try { &"$ENV:WINDIR\\SysNative\\WindowsPowershell\\v1.0\\PowerShell.exe" -ExecutionPolicy Bypass -WindowStyle Hidden -File $PSCOMMANDPATH } Catch { } ; Exit }
${getLocalCachingLogic("\\.(exe|msi)$", notify, sanitizeAppName(cfg.name))}
try {
    if ($Instalador.Extension -eq ".msi") {
        $msiArgs = "/i \`"$($Instalador.FullName)\`" /qn"
        if ($CortexDir) { $msiArgs += " INSTALLDIR=\`"$CortexDir\`"" }
        ${getManagedInstallerInvocation('msi', '$msiArgs')}
    } else {
        $exeArgs = "/S /quiet"
        if ($CortexDir) { $exeArgs += " /D=\`"$CortexDir\`"" }
        ${getManagedInstallerInvocation('exe', '$exeArgs')}
    }
${getTrackerSaveLogic(notify)}
`;
}

function generateBitdefender(cfg) {
  const notify = cfg.notifyUser || false;
  return `# =========================================================================
# BITDEFENDER BEST - DROP & RUN
# =========================================================================
If ($ENV:PROCESSOR_ARCHITEW6432 -eq "AMD64") { Try { &"$ENV:WINDIR\\SysNative\\WindowsPowershell\\v1.0\\PowerShell.exe" -ExecutionPolicy Bypass -WindowStyle Hidden -File $PSCOMMANDPATH } Catch { } ; Exit }
${getLocalCachingLogic("\\.(exe|msi)$", notify, sanitizeAppName(cfg.name))}
try {
    if ($Instalador.Extension -eq ".msi") {
        $msiArgs = "/i \`"$($Instalador.FullName)\`" /qn"
        ${getManagedInstallerInvocation('msi', '$msiArgs')}
    } else {
        ${getManagedInstallerInvocation('exe', '"/silent"')}
    }
${getTrackerSaveLogic(notify)}
`;
}

function generateZscaler(cfg) {
  const cloud = sanitizePSForEmbedding(cfg.customParams?.cloudName || 'zscaler');
  const domain = sanitizePSForEmbedding(cfg.customParams?.userDomain || '');
  const strict = cfg.customParams?.strictEnforcement ? '1' : '0';
  const notify = cfg.notifyUser || false;
  return `# =========================================================================
# ZSCALER ZCC - DROP & RUN
# =========================================================================
$ZscCloud  = "${cloud}"
$ZscDomain = "${domain}"
If ($ENV:PROCESSOR_ARCHITEW6432 -eq "AMD64") { Try { &"$ENV:WINDIR\\SysNative\\WindowsPowershell\\v1.0\\PowerShell.exe" -ExecutionPolicy Bypass -WindowStyle Hidden -File $PSCOMMANDPATH } Catch { } ; Exit }
${getLocalCachingLogic("\\.(exe|msi)$", notify, sanitizeAppName(cfg.name))}
try {
    if ($Instalador.Extension -eq ".msi") {
        $msiArgs = "/i \`"$($Instalador.FullName)\`" CLOUDNAME=\`"$ZscCloud\`" STRICTENFORCEMENT=${strict} /qn"
        if ($ZscDomain) { $msiArgs += " USERDOMAIN=\`"$ZscDomain\`"" }
        ${getManagedInstallerInvocation('msi', '$msiArgs')}
    } else {
        $exeArgs = "/S /CLOUDNAME=\`"$ZscCloud\`" /STRICTENFORCEMENT=${strict}"
        if ($ZscDomain) { $exeArgs += " /USERDOMAIN=\`"$ZscDomain\`"" }
        ${getManagedInstallerInvocation('exe', '$exeArgs')}
    }
${getTrackerSaveLogic(notify)}
`;
}

function generateGlobalProtect(cfg) {
  const portal = sanitizePSForEmbedding(cfg.customParams?.portal || '');
  const notify = cfg.notifyUser || false;
  return `# =========================================================================
# GLOBALPROTECT - DROP & RUN
# =========================================================================
$VpnPortal = "${portal}"
If ($ENV:PROCESSOR_ARCHITEW6432 -eq "AMD64") { Try { &"$ENV:WINDIR\\SysNative\\WindowsPowershell\\v1.0\\PowerShell.exe" -ExecutionPolicy Bypass -WindowStyle Hidden -File $PSCOMMANDPATH } Catch { } ; Exit }
${getLocalCachingLogic("\\.(exe|msi)$", notify, sanitizeAppName(cfg.name))}
try {
    if ($Instalador.Extension -eq ".msi") {
        $msiArgs = "/i \`"$($Instalador.FullName)\`" PORTAL=\`"$VpnPortal\`" /qn"
        ${getManagedInstallerInvocation('msi', '$msiArgs')}
    } else {
        $exeArgs = "/s"
        if ($VpnPortal) { $exeArgs += " PORTAL=\`"$VpnPortal\`"" }
        ${getManagedInstallerInvocation('exe', '$exeArgs')}
    }
${getTrackerSaveLogic(notify)}
`;
}

function generateCiscoSecureClient(cfg) {
  const xml = sanitizeAppName(cfg.customParams?.profileXml || 'profile.xml');
  const notify = cfg.notifyUser || false;
  return `# =========================================================================
# CISCO SECURE CLIENT - DROP & RUN
# =========================================================================
$XmlProfile = "${xml}"
If ($ENV:PROCESSOR_ARCHITEW6432 -eq "AMD64") { Try { &"$ENV:WINDIR\\SysNative\\WindowsPowershell\\v1.0\\PowerShell.exe" -ExecutionPolicy Bypass -WindowStyle Hidden -File $PSCOMMANDPATH } Catch { } ; Exit }
${getLocalCachingLogic("\\.(exe|msi)$", notify, sanitizeAppName(cfg.name))}
try {
    if ($Instalador.Extension -eq ".msi") {
        $msiArgs = "/i \`"$($Instalador.FullName)\`" /qn"
        ${getManagedInstallerInvocation('msi', '$msiArgs')}
    } else {
        ${getManagedInstallerInvocation('exe', '"/S /s"')}
    }

    $xmlSource = Join-Path -Path $CacheDir -ChildPath $XmlProfile
    $xmlDestDir = "C:\\ProgramData\\Cisco\\Cisco Secure Client\\VPN\\Profile"
    if (-not (Test-Path $xmlDestDir)) { New-Item -ItemType Directory -Path $xmlDestDir -Force | Out-Null }
    if (Test-Path $xmlSource) {
        Copy-Item -Path $xmlSource -Destination "$xmlDestDir\\$XmlProfile" -Force
    }
${getTrackerSaveLogic(notify)}
`;
}

function generateLansweeper(cfg) {
  const srv = sanitizePSForEmbedding(cfg.customParams?.server || '');
  const port = sanitizePSForEmbedding(cfg.customParams?.port || '9524');
  const key = sanitizePSForEmbedding(cfg.customParams?.agentKey || '');
  const notify = cfg.notifyUser || false;
  return `# =========================================================================
# LANSWEEPER LSAGENT - DROP & RUN
# =========================================================================
$LsServer = "${srv}"
$LsPort   = "${port}"
$LsKey    = "${key}"
If ($ENV:PROCESSOR_ARCHITEW6432 -eq "AMD64") { Try { &"$ENV:WINDIR\\SysNative\\WindowsPowershell\\v1.0\\PowerShell.exe" -ExecutionPolicy Bypass -WindowStyle Hidden -File $PSCOMMANDPATH } Catch { } ; Exit }
${getLocalCachingLogic("\\.(exe|msi)$", notify, sanitizeAppName(cfg.name))}
try {
    $args = "--mode unattended"
    if ($LsServer) { $args += " --server $LsServer --port $LsPort" }
    if ($LsKey)    { $args += " --agentkey $LsKey" }
    ${getManagedInstallerInvocation('exe', '$args')}
${getTrackerSaveLogic(notify)}
`;
}

function generateNinjaOne(cfg) {
  const tk = sanitizePSForEmbedding(cfg.customParams?.token || '');
  const notify = cfg.notifyUser || false;
  return `# =========================================================================
# NINJAONE / DATTO RMM - DROP & RUN
# =========================================================================
$NinjaTk = "${tk}"
If ($ENV:PROCESSOR_ARCHITEW6432 -eq "AMD64") { Try { &"$ENV:WINDIR\\SysNative\\WindowsPowershell\\v1.0\\PowerShell.exe" -ExecutionPolicy Bypass -WindowStyle Hidden -File $PSCOMMANDPATH } Catch { } ; Exit }
${getLocalCachingLogic("\\.(exe|msi)$", notify, sanitizeAppName(cfg.name))}
try {
    if ($Instalador.Extension -eq ".msi") {
        $msiArgs = "/i \`"$($Instalador.FullName)\`" /qn"
        if ($NinjaTk) { $msiArgs += " TOKEN=\`"$NinjaTk\`"" }
        ${getManagedInstallerInvocation('msi', '$msiArgs')}
    } else {
        $exeArgs = "/S /silent"
        if ($NinjaTk) { $exeArgs += " /TOKEN=\`"$NinjaTk\`"" }
        ${getManagedInstallerInvocation('exe', '$exeArgs')}
    }
${getTrackerSaveLogic(notify)}
`;
}

function generateTeamViewer(cfg) {
  const cid = sanitizePSForEmbedding(cfg.customParams?.customId || '');
  const api = sanitizePSForEmbedding(cfg.customParams?.apiToken || '');
  const notify = cfg.notifyUser || false;
  return `# =========================================================================
# TEAMVIEWER HOST - DROP & RUN
# =========================================================================
$TvCid = "${cid}"
$TvApi = "${api}"
If ($ENV:PROCESSOR_ARCHITEW6432 -eq "AMD64") { Try { &"$ENV:WINDIR\\SysNative\\WindowsPowershell\\v1.0\\PowerShell.exe" -ExecutionPolicy Bypass -WindowStyle Hidden -File $PSCOMMANDPATH } Catch { } ; Exit }
${getLocalCachingLogic("\\.(exe|msi)$", notify, sanitizeAppName(cfg.name))}
try {
    if ($Instalador.Extension -eq ".msi") {
        $msiArgs = "/i \`"$($Instalador.FullName)\`" /qn"
        if ($TvCid) { $msiArgs += " CUSTOMCONFIGID=\`"$TvCid\`"" }
        if ($TvApi) { $msiArgs += " APITOKEN=\`"$TvApi\`"" }
        $msiArgs += " ASSIGNMENTOPTIONS=\`"--grant-easy-access\`""
        ${getManagedInstallerInvocation('msi', '$msiArgs')}
    } else {
        $exeArgs = "--silent"
        if ($TvCid) { $exeArgs += " --id $TvCid" }
        if ($TvApi) { $exeArgs += " --token $TvApi" }
        ${getManagedInstallerInvocation('exe', '$exeArgs')}
    }
${getTrackerSaveLogic(notify)}
`;
}

function generateAnyDesk(cfg) {
  const notify = cfg.notifyUser || false;
  return `# =========================================================================
# ANYDESK CUSTOM - DROP & RUN
# =========================================================================
If ($ENV:PROCESSOR_ARCHITEW6432 -eq "AMD64") { Try { &"$ENV:WINDIR\\SysNative\\WindowsPowershell\\v1.0\\PowerShell.exe" -ExecutionPolicy Bypass -WindowStyle Hidden -File $PSCOMMANDPATH } Catch { } ; Exit }
${getLocalCachingLogic("\\.(exe|msi)$", notify, sanitizeAppName(cfg.name))}
try {
    if ($Instalador.Extension -eq ".msi") {
        $msiArgs = "/i \`"$($Instalador.FullName)\`" /qn"
        Invoke-ManagedInstaller -Kind 'msi' -InstallerPath $Instalador.FullName -ArgumentList $msiArgs -FallbackDisplayName $NombreApp -SuccessCodes @(0, 3010, 1641) | Out-Null
    } else {
        Start-Process -FilePath $Instalador.FullName -ArgumentList "--install --start-with-win --silent" -Wait -NoNewWindow
    }
${getTrackerSaveLogic(notify)}
`;
}

function generateVeeam(cfg) {
  const xml = sanitizeAppName(cfg.customParams?.configXml || 'veeam_config.xml');
  const notify = cfg.notifyUser || false;
  return `# =========================================================================
# VEEAM AGENT - DROP & RUN
# =========================================================================
$XmlProfile = "${xml}"
If ($ENV:PROCESSOR_ARCHITEW6432 -eq "AMD64") { Try { &"$ENV:WINDIR\\SysNative\\WindowsPowershell\\v1.0\\PowerShell.exe" -ExecutionPolicy Bypass -WindowStyle Hidden -File $PSCOMMANDPATH } Catch { } ; Exit }
${getLocalCachingLogic("\\.(exe|msi)$", notify, sanitizeAppName(cfg.name))}
try {
    if ($Instalador.Extension -eq ".msi") {
        $msiArgs = "/i \`"$($Instalador.FullName)\`" /qn /norestart"
        Invoke-ManagedInstaller -Kind 'msi' -InstallerPath $Instalador.FullName -ArgumentList $msiArgs -FallbackDisplayName $NombreApp -SuccessCodes @(0, 3010, 1641) | Out-Null
    } else {
        Invoke-ManagedInstaller -Kind 'exe' -InstallerPath $Instalador.FullName -ArgumentList "/silent /norestart" -FallbackDisplayName $NombreApp -SuccessCodes @(0, 3010, 1641) | Out-Null
    }

    $xmlSource = Join-Path -Path $CacheDir -ChildPath $XmlProfile
    if (Test-Path $xmlSource) {
        Start-Sleep -Seconds 15
        Start-Process -FilePath "C:\\Program Files\\Veeam\\Endpoint Backup\\Veeam.Agent.Configurator.exe" -ArgumentList "-setVBRsettings /f:\`"$xmlSource\`"" -Wait -NoNewWindow
    }
${getTrackerSaveLogic(notify)}
`;
}

function generateCrashPlan(cfg) {
  const url = sanitizePSForEmbedding(cfg.customParams?.url || '');
  const token = sanitizePSForEmbedding(cfg.customParams?.token || '');
  const notify = cfg.notifyUser || false;
  return `# =========================================================================
# CRASHPLAN ENTERPRISE - DROP & RUN
# =========================================================================
$CpUrl   = "${url}"
$CpToken = "${token}"
If ($ENV:PROCESSOR_ARCHITEW6432 -eq "AMD64") { Try { &"$ENV:WINDIR\\SysNative\\WindowsPowershell\\v1.0\\PowerShell.exe" -ExecutionPolicy Bypass -WindowStyle Hidden -File $PSCOMMANDPATH } Catch { } ; Exit }
${getLocalCachingLogic("\\.(exe|msi)$", notify, sanitizeAppName(cfg.name))}
try {
    if ($Instalador.Extension -eq ".msi") {
        $msiArgs = "/i \`"$($Instalador.FullName)\`" /qn"
        if ($CpUrl)   { $msiArgs += " DEPLOYMENT_URL=\`"$CpUrl\`"" }
        if ($CpToken) { $msiArgs += " DEPLOYMENT_TOKEN=\`"$CpToken\`"" }
        Invoke-ManagedInstaller -Kind 'msi' -InstallerPath $Instalador.FullName -ArgumentList $msiArgs -FallbackDisplayName $NombreApp -SuccessCodes @(0, 3010, 1641) | Out-Null
    } else {
        $exeArgs = "/S"
        if ($CpUrl)   { $exeArgs += " /DEPLOYMENT_URL=\`"$CpUrl\`"" }
        if ($CpToken) { $exeArgs += " /DEPLOYMENT_TOKEN=\`"$CpToken\`"" }
        Invoke-ManagedInstaller -Kind 'exe' -InstallerPath $Instalador.FullName -ArgumentList $exeArgs -FallbackDisplayName $NombreApp -SuccessCodes @(0, 3010, 1641) | Out-Null
    }
${getTrackerSaveLogic(notify)}
`;
}

function generateWinget(cfg) {
  const wingetId = sanitizePSForEmbedding(cfg.wingetId || '');
  const wingetSource = sanitizePSForEmbedding(sanitizeWingetSource(cfg.wingetSource || 'winget'));
  const version  = sanitizePSForEmbedding(cfg.version || '1.0.0');
  const notify   = cfg.notifyUser || false;
  const config   = configService.getConfig();
  const dict     = i18nService.getTranslations(config.language || 'en');
  const ToastTitleProcess = dict.apps?.toastTitleProcess || 'Installation in progress';
  const ToastMsgProcess   = dict.apps?.toastMsgProcess   || 'Installing. Please do not turn off your computer.';
  const ToastTitleDone    = dict.apps?.toastTitleDone    || 'Installation complete';
  const ToastMsgDone      = dict.apps?.toastMsgDone      || 'Installation completed successfully.';

  const { getToastSnippet } = require('./ps-snippets');
  const notifyPrefix = notify ? getToastSnippet(ToastTitleProcess, ToastMsgProcess) : '';
  const notifyAfter  = notify ? `    Send-UserToast -ToastTitle "${ToastTitleDone.replace(/"/g, '\\"')}" -ToastMessage "${ToastMsgDone.replace(/"/g, '\\"')}" -IconType "Information"` : '';

  return `# =========================================================================
# WINGET INSTALL - DROP & RUN
# App: ${sanitizeAppName(cfg.name)} [${wingetId}]
# Version: ${version}
# Generado: ${new Date().toISOString()}
# =========================================================================
$wingetId = "${wingetId}"
$wingetSource = "${wingetSource}"
If ($ENV:PROCESSOR_ARCHITEW6432 -eq "AMD64") {
    Try { &"$ENV:WINDIR\\SysNative\\WindowsPowershell\\v1.0\\PowerShell.exe" -ExecutionPolicy Bypass -WindowStyle Hidden -File $PSCOMMANDPATH } Catch { } ; Exit
}

# Guardia $PSScriptRoot (puede estar vacío en GPO startup / PS4)
if (-not $PSScriptRoot) { $PSScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $PSScriptRoot) { $PSScriptRoot = $PWD.Path }

${getDedicatedRuntimeDetectionLogic()}

$LogDir = "C:\\ProgramData\\AppDeploy_Logs"
if (-not $ADDMDedicatedLogging -and -not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
if (-not $ADDMDedicatedLogging) { Get-ChildItem "$LogDir\\*.log" -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-7) } | Remove-Item -Force -ErrorAction SilentlyContinue }
# Split-Path es pura string — no necesita acceso de red
$NombreApp = if ($PSScriptRoot) { Split-Path -Leaf $PSScriptRoot } else { "UnknownApp" }
$LogFile   = if ($ADDMDedicatedLogging) { $null } else { "$LogDir\\Install_$($NombreApp)_$(Get-Date -Format 'yyyyMMdd_HHmmss').log" }
if ($LogFile) { Start-Transcript -Path $LogFile -Force -ErrorAction SilentlyContinue }

Write-Host "[$(Get-Date -Format 'HH:mm:ss')] ===== AppDeploy Manager ============================="
Write-Host "[$(Get-Date -Format 'HH:mm:ss')] App     : $NombreApp [winget: $wingetId | source: $wingetSource]"
Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Computer: $env:COMPUTERNAME"
Write-Host "[$(Get-Date -Format 'HH:mm:ss')] User    : $env:USERNAME"
Write-Host "[$(Get-Date -Format 'HH:mm:ss')] ====================================================="

$TrackerFile = if ($ADDMDedicatedLogging) { $null } else { "$LogDir\\Tracker_$NombreApp.json" }
$UserTaskRoot = if ($ADDMDedicatedLogging) { Join-Path $env:TEMP ("ADDM_" + $NombreApp) } else { $LogDir }
if (-not (Test-Path -LiteralPath $UserTaskRoot)) { New-Item -ItemType Directory -Path $UserTaskRoot -Force | Out-Null }
$UserTaskName = "ADDM_Install_$NombreApp"
$UserTaskPs1  = Join-Path $UserTaskRoot ("WingetUserInstall_" + $NombreApp + ".ps1")
$UserTaskVbs  = Join-Path $UserTaskRoot ("WingetUserInstall_" + $NombreApp + ".vbs")

function Clear-UserWingetArtifacts {
    param(
        [switch]$Quiet
    )

    try { Unregister-ScheduledTask -TaskName $UserTaskName -Confirm:$false -ErrorAction SilentlyContinue | Out-Null } catch {}
    foreach ($artifact in @($UserTaskPs1, $UserTaskVbs)) {
        try {
            if (Test-Path $artifact) { Remove-Item -Path $artifact -Force -ErrorAction SilentlyContinue }
        } catch {}
    }
    if (-not $Quiet) {
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] INFO: User-scope artifacts cleaned for $NombreApp"
    }
}

# ── Leer version desde manifiesto de red ─────────────────
$CurrentVersion = "$version"
$VersionFile = Join-Path $PSScriptRoot "version.json"
if (Test-Path $VersionFile) {
    try { $CurrentVersion = (Get-Content $VersionFile -Raw | ConvertFrom-Json).version } catch {}
}
Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Version : $CurrentVersion"

# ── Salir si ya esta instalado en esta version ───────────
${notifyPrefix}

# ── Localizar winget (contexto SYSTEM / GPO startup) ─────
# Varios métodos porque SYSTEM no tiene acceso normal a WindowsApps
$Winget = $null

# Método 1: PATH / stub sistema (Windows 11 22H2+)
$fromPath = (Get-Command winget.exe -ErrorAction SilentlyContinue).Source
if ($fromPath -and (Test-Path $fromPath)) { $Winget = $fromPath }

# Método 2: Symlink en System32 (Windows 11 23H2+)
if (-not $Winget) {
    $p = "$env:SystemRoot\System32\winget.exe"
    if (Test-Path $p) { $Winget = $p }
}

# Método 3: Enumerar WindowsApps con cmd /c dir (evita ACL de SYSTEM)
if (-not $Winget) {
    $appsBase = "$env:ProgramFiles\WindowsApps"
    $entry = (& cmd.exe /c "dir /b /ad \`"$appsBase\`" 2>nul") -split "\`n" |
             Where-Object { $_ -like 'Microsoft.DesktopAppInstaller_*_x64__8wekyb3d8bbwe' } |
             Sort-Object -Descending | Select-Object -First 1
    if ($entry) { $Winget = "$appsBase\$($entry.Trim())\winget.exe" }
}

# Método 4: Get-AppxPackage (puede fallar en inicio, pero se intenta)
if (-not $Winget) {
    try {
        $pkg = Get-AppxPackage -AllUsers "Microsoft.DesktopAppInstaller" -ErrorAction SilentlyContinue |
               Sort-Object { [version]($_.Version -replace '[^0-9.]','') } -Descending | Select-Object -First 1
        if ($pkg) {
            $p = Join-Path $pkg.InstallLocation "winget.exe"
            if (Test-Path $p) { $Winget = $p }
        }
    } catch {}
}

if (-not $Winget) {
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] ERROR: winget.exe not found. Windows 10 21H2+ with App Installer (Microsoft Store) is required."
    Stop-Transcript -ErrorAction SilentlyContinue
    exit 1
}
Write-Host "[$(Get-Date -Format 'HH:mm:ss')] winget: $Winget"

function Test-WingetPackageInstalled {
    param(
        [string]$WingetPath,
        [string]$PackageId,
        [string]$PackageSource = ''
    )

    try {
        $listArgs = @('list', '--id', "$PackageId", '--exact', '--accept-source-agreements', '--disable-interactivity')
        if ($PackageSource) { $listArgs += @('--source', "$PackageSource") }
        $output = & $WingetPath @listArgs 2>&1 | Out-String
        return ($LASTEXITCODE -eq 0 -and $output -match [regex]::Escape($PackageId))
    } catch {
        return $false
    }
}

function Wait-WingetPackageInstalled {
    param(
        [string]$WingetPath,
        [string]$PackageId,
        [string]$PackageSource = '',
        [int]$MaxAttempts = 5,
        [int]$SleepSeconds = 3
    )

    for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
        if (Test-WingetPackageInstalled -WingetPath $WingetPath -PackageId $PackageId -PackageSource $PackageSource) {
            return $true
        }
        if ($attempt -lt $MaxAttempts) {
            Start-Sleep -Seconds $SleepSeconds
        }
    }
    return $false
}

function Test-WingetUserTaskPending {
    try {
        return [bool](Get-ScheduledTask -TaskName $UserTaskName -ErrorAction SilentlyContinue)
    } catch {
        return $false
    }
}

if ($TrackerFile -and (Test-Path -LiteralPath $TrackerFile)) {
    try {
        $t = Get-Content -LiteralPath $TrackerFile -Raw | ConvertFrom-Json
        if ($t.version -eq $CurrentVersion -and $t.result -in @('success', 'scheduled')) {
            $installedNow = Wait-WingetPackageInstalled -WingetPath $Winget -PackageId $wingetId -PackageSource $wingetSource -MaxAttempts 2 -SleepSeconds 2
            if ($installedNow) {
                Clear-UserWingetArtifacts -Quiet
                Write-Host "[$(Get-Date -Format 'HH:mm:ss')] SKIPPED: Already installed (v$CurrentVersion, installation verified)"
                Stop-Transcript -ErrorAction SilentlyContinue
                exit 0
            }

            if ($t.result -eq 'scheduled' -and (Test-WingetUserTaskPending)) {
                Write-Host "[$(Get-Date -Format 'HH:mm:ss')] SKIPPED: Scheduled installation pending for $wingetId"
                Stop-Transcript -ErrorAction SilentlyContinue
                exit 0
            }

            if ($t.result -eq 'success') {
                Write-Host "[$(Get-Date -Format 'HH:mm:ss')] WARNING: Tracker reported success, but $wingetId is not installed. Retrying."
            } else {
                Write-Host "[$(Get-Date -Format 'HH:mm:ss')] WARNING: Tracker reported a scheduled installation, but neither the app nor a pending task exists. Retrying."
            }
            Clear-UserWingetArtifacts -Quiet
        }
    } catch {}
}

# Actualizar fuentes (necesario en contexto SYSTEM; ignorar error si falla)
try { & $Winget source update --disable-interactivity 2>&1 | Out-Null } catch {}

# ── Instalar ─────────────────────────────────────────────
# Códigos de salida conocidos de winget:
#   0            = éxito
#   1618         = otra instalación en curso (Windows Installer busy)
#  -1978335212  = APPINSTALLER_CLI_ERROR_UPDATE_NOT_APPLICABLE (ya actualizado, éxito)
#  -1978335189  = APPINSTALLER_CLI_ERROR_PACKAGE_ALREADY_INSTALLED (éxito)
#  -1978335140  = APPINSTALLER_CLI_ERROR_NO_APPLICABLE_UPDATE (sin actualización, éxito)
#  -1978335160  = APPINSTALLER_CLI_ERROR_NO_APPLICABLE_INSTALLER → reintentar sin --scope machine
$WingetSuccess = @(0, 1618, -1978335212, -1978335189, -1978335140)
$WingetNoScope = @(-1978335160, -1978335215, -1978335216)  # no machine-scope installer → retry sin scope
$WingetUserOnly = @(-1978335146, -1978335215, -1978335216) # app solo usuario → instalar via tarea programada
# MS Store apps are user-scope only — skip machine-scope attempt
$IsMsStore = ($wingetSource -eq 'msstore')
if ($IsMsStore) { Write-Host "[$(Get-Date -Format 'HH:mm:ss')] INFO: MS Store source: machine scope does not apply; installing in user scope" }
try {
    $packageInstalled = $false
    if (-not $IsMsStore) {
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Running: winget install --id $wingetId --source $wingetSource --scope machine"
        & $Winget install --id "$wingetId" --source "$wingetSource" --silent --accept-package-agreements --accept-source-agreements --scope machine 2>&1 | Out-Null
        $ec = $LASTEXITCODE
        if ($ec -in $WingetNoScope) {
            Write-Host "[$(Get-Date -Format 'HH:mm:ss')] WARNING: --scope machine is unsupported (code $ec). Retrying without --scope..."
            & $Winget install --id "$wingetId" --source "$wingetSource" --silent --accept-package-agreements --accept-source-agreements 2>&1 | Out-Null
            $ec = $LASTEXITCODE
        }
    } else {
        $ec = -1
    }
    if ($ec -in $WingetSuccess) {
        $packageInstalled = Wait-WingetPackageInstalled -WingetPath $Winget -PackageId $wingetId -PackageSource $wingetSource
        if (-not $packageInstalled) {
            Write-Host "[$(Get-Date -Format 'HH:mm:ss')] WARNING: winget returned success ($ec), but $wingetId could not be detected. Trying the user context."
            $ec = -1
        }
    }
    if ($ec -notin $WingetSuccess) {
        # Último intento: --scope user (apps solo usuario)
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] WARNING: Retrying with --scope user (user-only app, code $ec)..."
        & $Winget install --id "$wingetId" --source "$wingetSource" --silent --accept-package-agreements --accept-source-agreements --scope user 2>&1 | Out-Null
        $ec = $LASTEXITCODE
        if ($ec -in $WingetSuccess) {
            $packageInstalled = Wait-WingetPackageInstalled -WingetPath $Winget -PackageId $wingetId -PackageSource $wingetSource -MaxAttempts 3 -SleepSeconds 2
            if (-not $packageInstalled) {
                Write-Host "[$(Get-Date -Format 'HH:mm:ss')] WARNING: winget returned success with --scope user ($ec), but SYSTEM could not detect the app. Scheduling installation at the next sign-in."
                $ec = -1
            }
        }
    }
    if ($ec -notin $WingetSuccess) {
        # App solo usuario que no puede instalarse en contexto SYSTEM → programar tarea de usuario
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] WARNING: User app ($wingetId). Creating a scheduled task to install at the next sign-in..."
        $taskName = $UserTaskName
        try {
            Clear-UserWingetArtifacts -Quiet
            $userInstallPs1 = $UserTaskPs1
            $userInstallVbs = $UserTaskVbs
            $userInstallScript = @'
$taskName = '__TASKNAME__'
$wingetId = '__WINGET_ID__'
$wingetSource = '__WINGET_SOURCE__'
$trackerFile = '__TRACKER_FILE__'
$currentVersion = '__CURRENT_VERSION__'
$helperPs1 = '__HELPER_PS1__'
$helperVbs = '__HELPER_VBS__'
$appName = '__APP_NAME__'
$successCodes = @(0, 1618, -1978335212, -1978335189, -1978335140)

function Complete-UserWingetTask {
    param(
        [string]$Method = 'winget-usertask'
    )

    try {
        @{
            version = $currentVersion
            installedAt = (Get-Date).ToString('o')
            computer = $env:COMPUTERNAME
            user = $env:USERNAME
            result = 'success'
            method = $Method
            wingetId = $wingetId
        } | ConvertTo-Json | Set-Content -Path $trackerFile -Force -Encoding UTF8
    } catch {}

    try { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue | Out-Null } catch {}
    foreach ($file in @($helperPs1, $helperVbs)) {
        try { Remove-Item -Path $file -Force -ErrorAction SilentlyContinue } catch {}
    }
    exit 0
}

function Test-WingetPackageInstalled {
    param(
        [string]$WingetPath,
        [string]$PackageId,
        [string]$PackageSource = ''
    )

    try {
        $listArgs = @('list', '--id', "$PackageId", '--exact', '--accept-source-agreements', '--disable-interactivity')
        if ($PackageSource) { $listArgs += @('--source', "$PackageSource") }
        $output = & $WingetPath @listArgs 2>&1 | Out-String
        return ($LASTEXITCODE -eq 0 -and $output -match [regex]::Escape($PackageId))
    } catch {
        return $false
    }
}

function Wait-WingetPackageInstalled {
    param(
        [string]$WingetPath,
        [string]$PackageId,
        [string]$PackageSource = '',
        [int]$MaxAttempts = 5,
        [int]$SleepSeconds = 3
    )

    for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
        if (Test-WingetPackageInstalled -WingetPath $WingetPath -PackageId $PackageId -PackageSource $PackageSource) {
            return $true
        }
        if ($attempt -lt $MaxAttempts) {
            Start-Sleep -Seconds $SleepSeconds
        }
    }
    return $false
}

$WingetUser = (Get-Command winget.exe -ErrorAction SilentlyContinue).Source
if (-not $WingetUser -or -not (Test-Path $WingetUser)) {
    $candidate = Join-Path $env:LOCALAPPDATA 'Microsoft\\WindowsApps\\winget.exe'
    if (Test-Path $candidate) { $WingetUser = $candidate }
}
if (-not $WingetUser) {
    $candidate = "$env:SystemRoot\\System32\\winget.exe"
    if (Test-Path $candidate) { $WingetUser = $candidate }
}
if (-not $WingetUser) { exit 1 }

if (Test-WingetPackageInstalled -WingetPath $WingetUser -PackageId $wingetId -PackageSource $wingetSource) {
    Complete-UserWingetTask -Method 'winget-usertask-detected'
}

& $WingetUser install --id "$wingetId" --source "$wingetSource" --silent --accept-package-agreements --accept-source-agreements --scope user 2>&1 | Out-Null
$ec = $LASTEXITCODE
if (($ec -in $successCodes) -and (Wait-WingetPackageInstalled -WingetPath $WingetUser -PackageId $wingetId -PackageSource $wingetSource)) {
    Complete-UserWingetTask
}
exit $ec
'@
            $userInstallScript = $userInstallScript.Replace('__TASKNAME__', $taskName)
            $userInstallScript = $userInstallScript.Replace('__WINGET_ID__', $wingetId)
            $userInstallScript = $userInstallScript.Replace('__WINGET_SOURCE__', $wingetSource)
            $userInstallScript = $userInstallScript.Replace('__TRACKER_FILE__', $TrackerFile)
            $userInstallScript = $userInstallScript.Replace('__CURRENT_VERSION__', $CurrentVersion)
            $userInstallScript = $userInstallScript.Replace('__HELPER_PS1__', $userInstallPs1)
            $userInstallScript = $userInstallScript.Replace('__HELPER_VBS__', $userInstallVbs)
            $userInstallScript = $userInstallScript.Replace('__APP_NAME__', $NombreApp)
            Set-Content -Path $userInstallPs1 -Value $userInstallScript -Encoding UTF8 -Force

            $userInstallVbsContent = @'
Dim shell
Set shell = CreateObject("WScript.Shell")
shell.Run "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""__HELPER_PS1__""", 0, False
'@
            $userInstallVbsContent = $userInstallVbsContent.Replace('__HELPER_PS1__', $userInstallPs1)
            Set-Content -Path $userInstallVbs -Value $userInstallVbsContent -Encoding ASCII -Force

            $action   = New-ScheduledTaskAction -Execute "wscript.exe" \`
                          -Argument "//B //NoLogo \`"$userInstallVbs\`""
            $trigger  = New-ScheduledTaskTrigger -AtLogOn
            $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries \`
                          -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -StartWhenAvailable
            # Ejecutar como usuario interactivo que inicie sesion; evita depender de GroupId/idioma del SO
            $principal = New-ScheduledTaskPrincipal -UserId "NT AUTHORITY\\INTERACTIVE" -LogonType Interactive -RunLevel Limited
            Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger \`
                -Settings $settings -Principal $principal \`
                -Description "Installation of $NombreApp via AD Deploy Manager" -Force -ErrorAction Stop | Out-Null
            Write-Host "[$(Get-Date -Format 'HH:mm:ss')] OK: Scheduled task '$taskName' created; installation will run at the next user sign-in"
            if ($TrackerFile) {
                @{ version = $CurrentVersion; scheduledAt = (Get-Date).ToString('o'); computer = $env:COMPUTERNAME; result = 'scheduled'; method = 'winget-usertask'; wingetId = "$wingetId" } |
                    ConvertTo-Json | Set-Content -Path $TrackerFile -Force -Encoding UTF8
            }
            Stop-Transcript -ErrorAction SilentlyContinue
            exit 0
        } catch {
            throw "Could not create scheduled task '$taskName': $($_.Exception.Message)"
        }
    }

    if (-not $packageInstalled) {
        throw "winget completed without a blocking error, but the installation could not be confirmed for $wingetId"
    }

    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] OK: $NombreApp installed successfully (v$CurrentVersion)"
    Clear-UserWingetArtifacts -Quiet
${notifyAfter}
    if ($TrackerFile) {
        @{ version = $CurrentVersion; installedAt = (Get-Date).ToString('o'); computer = $env:COMPUTERNAME; result = 'success'; method = 'winget'; wingetId = "$wingetId" } |
            ConvertTo-Json | Set-Content -Path $TrackerFile -Force -Encoding UTF8
    }
} catch {
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] ERROR: Failed to install $NombreApp - $_"
    if ($TrackerFile) {
        @{ version = $CurrentVersion; failedAt = (Get-Date).ToString('o'); computer = $env:COMPUTERNAME; result = 'failed'; error = $_.ToString() } |
            ConvertTo-Json | Set-Content -Path $TrackerFile -Force -Encoding UTF8
    }
}
Stop-Transcript -ErrorAction SilentlyContinue
`;
}

function generateODT(cfg) {
  const odtConfig  = cfg.odtConfig || {};
  const productId  = odtConfig.product  || 'O365BusinessRetail';
  const channel    = odtConfig.channel  || 'MonthlyEnterprise';
  const language   = odtConfig.language || 'es-es';
  const arch       = odtConfig.arch     || '64';
  const version    = cfg.version || '1.0.0';
  const notify     = cfg.notifyUser || false;
  const config     = configService.getConfig();
  const dict       = i18nService.getTranslations(config.language || 'en');
  const ToastTitleProcess = dict.apps?.toastTitleProcess || 'Installation in progress';
  const ToastMsgProcess   = dict.apps?.toastMsgProcess   || 'Installing $NombreApp. Please do not turn off your computer.';
  const ToastTitleDone    = dict.apps?.toastTitleDone    || 'Installation complete';
  const ToastMsgDone      = dict.apps?.toastMsgDone      || '$NombreApp has been installed successfully.';
  const notifyPrefix = notify ? getNotificationLogic(cfg.name) : '';
  const notifyBefore = notify ? `Send-UserToast -ToastTitle "${ToastTitleProcess}" -ToastMessage "${ToastMsgProcess}" -IconType "Warning"` : '';
  const notifyAfter  = notify ? `    Send-UserToast -ToastTitle "${ToastTitleDone}" -ToastMessage "${ToastMsgDone}" -IconType "Information"` : '';

  // All known ODT apps that can be excluded
  const ALL_ODT_APPS = ['Access', 'Excel', 'Groove', 'InfoPath', 'Lync', 'OneNote', 'OneDrive', 'Outlook', 'PowerPoint', 'Publisher', 'SharePointDesigner', 'Teams', 'Word'];
  const alwaysExclude = ['Groove', 'Lync'];

  // If user selected specific apps, exclude everything else
  let userExclude = odtConfig.excludeApps || [];
  if (Array.isArray(odtConfig.apps) && odtConfig.apps.length > 0) {
    // apps contains the IDs to INCLUDE; exclude everything not in the list
    userExclude = ALL_ODT_APPS.filter(a => !odtConfig.apps.includes(a));
  }
  const allExcluded   = [...new Set([...alwaysExclude, ...userExclude])];
  const excludeLines  = allExcluded.map(a => `      <ExcludeApp ID="${a}" />`).join('\n');

  return `# =========================================================================
# MICROSOFT OFFICE ODT - DROP & RUN
# Product: ${productId}  Canal: ${channel}  Idioma: ${language}
# Versión: ${version}
# Generado: ${new Date().toISOString()}
# =========================================================================
If ($ENV:PROCESSOR_ARCHITEW6432 -eq "AMD64") {
    Try { &"$ENV:WINDIR\\SysNative\\WindowsPowershell\\v1.0\\PowerShell.exe" -ExecutionPolicy Bypass -WindowStyle Hidden -File $PSCOMMANDPATH } Catch { } ; Exit
}

# Guardia $PSScriptRoot (puede estar vacío en GPO startup / PS4)
if (-not $PSScriptRoot) { $PSScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $PSScriptRoot) { $PSScriptRoot = $PWD.Path }

${getDedicatedRuntimeDetectionLogic()}

$LogDir = "C:\\ProgramData\\AppDeploy_Logs"
if (-not $ADDMDedicatedLogging -and -not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
if (-not $ADDMDedicatedLogging) { Get-ChildItem "$LogDir\\*.log" -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-7) } | Remove-Item -Force -ErrorAction SilentlyContinue }
$NombreApp = if ($PSScriptRoot) { Split-Path -Leaf $PSScriptRoot } else { "UnknownApp" }
$LogFile   = if ($ADDMDedicatedLogging) { $null } else { "$LogDir\\Install_$($NombreApp)_$(Get-Date -Format 'yyyyMMdd_HHmmss').log" }
if ($LogFile) { Start-Transcript -Path $LogFile -Force -ErrorAction SilentlyContinue }

Write-Host "[$(Get-Date -Format 'HH:mm:ss')] ===== AppDeploy Manager ============================="
Write-Host "[$(Get-Date -Format 'HH:mm:ss')] App     : $NombreApp (Office ODT)"
Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Product: ${productId} | Channel: ${channel} | Language: ${language} | Architecture: ${arch}"
Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Computer: $env:COMPUTERNAME"
Write-Host "[$(Get-Date -Format 'HH:mm:ss')] User    : $env:USERNAME"
Write-Host "[$(Get-Date -Format 'HH:mm:ss')] ====================================================="

$TrackerFile = if ($ADDMDedicatedLogging) { $null } else { "$LogDir\\Tracker_$NombreApp.json" }
function Save-AppDeployTracker {
    param([hashtable]$Payload)
    if (-not $TrackerFile) { return }
    try { $Payload | ConvertTo-Json | Set-Content -Path $TrackerFile -Force -Encoding UTF8 } catch { }
}

# ── Leer manifiesto ──────────────────────────────────────
$CurrentVersion = "${version}"
$VersionFile = Join-Path $PSScriptRoot "version.json"
if (-not (Test-Path $VersionFile)) {
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] SKIPPED: version.json was not found in $PSScriptRoot"
    Stop-Transcript -ErrorAction SilentlyContinue
    exit 0
}
try {
    $Manifest       = Get-Content $VersionFile -Raw | ConvertFrom-Json
    $CurrentHash    = $Manifest.hash
    $CurrentVersion = $Manifest.version
} catch {
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] ERROR: corrupt version.json - $_"
    Stop-Transcript -ErrorAction SilentlyContinue
    exit 1
}
Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Version : $CurrentVersion"

# ── Comprobar si ya instalado (Office en registro + tracker) ─
$OfficeInstalled = Get-ItemProperty \`
    "HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*",
    "HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*" \`
    -ErrorAction SilentlyContinue |
    Where-Object {
        ($_.DisplayName -like "*Microsoft Office*" -or $_.DisplayName -like "*Microsoft 365*") -and
        $_.DisplayName -notlike "*Language Pack*" -and
        $_.DisplayName -notlike "*Proofing Tools*" -and
        $_.DisplayName -notlike "*Update*"
    } |
    Select-Object -First 1
$ClickToRunConfig = Get-ItemProperty "HKLM:\\SOFTWARE\\Microsoft\\Office\\ClickToRun\\Configuration" -ErrorAction SilentlyContinue
$InstalledOfficeProducts = @()
if ($ClickToRunConfig -and $ClickToRunConfig.ProductReleaseIds) {
    $InstalledOfficeProducts = @($ClickToRunConfig.ProductReleaseIds -split '[,;]') |
        ForEach-Object { $_.Trim() } |
        Where-Object { $_ }
}
$TargetOfficeInstalled = $InstalledOfficeProducts -contains "${productId}"
if ($TargetOfficeInstalled -or $OfficeInstalled) {
    $OfficeDetectedName = if ($TargetOfficeInstalled) { "${productId}" } else { $OfficeInstalled.DisplayName }
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] SKIPPED: Office is already installed - $OfficeDetectedName"
    Save-AppDeployTracker -Payload @{ version = $CurrentVersion; hash = $CurrentHash; installedAt = (Get-Date).ToString('o'); computer = $env:COMPUTERNAME; result = 'success'; method = 'odt-detected'; product = "${productId}" }
    Stop-Transcript -ErrorAction SilentlyContinue
    exit 0
}

# ── Localizar ODT setup.exe ──────────────────────────────
# Si el admin dejó setup.exe en el share, usarlo directamente
$OdtSetup = Join-Path $PSScriptRoot "setup.exe"

if (-not (Test-Path $OdtSetup)) {
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] setup.exe not found on the share. Downloading Office Deployment Tool..."
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] RECOMMENDED: place ODT setup.exe in $PSScriptRoot to avoid this download."
    $OdtTemp    = "$env:TEMP\\odt_installer_$(Get-Random).exe"
    $OdtExtract = "$env:TEMP\\odt_$(Get-Random)"
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

    # ── Intento 1: FWLink oficial (descarga directa sin HEAD) ──
    if (-not (Test-Path $OdtSetup -ErrorAction SilentlyContinue)) {
        try {
            $wc1 = New-Object System.Net.WebClient
            $wc1.Headers.Add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
            $wc1.DownloadFile("https://go.microsoft.com/fwlink/?linkid=2232433", $OdtTemp)
            if ((Get-Item $OdtTemp -ErrorAction SilentlyContinue).Length -gt 512KB) {
                New-Item -ItemType Directory -Path $OdtExtract -Force | Out-Null
                Start-Process $OdtTemp -ArgumentList "/quiet /extract:\`"$OdtExtract\`"" -Wait -NoNewWindow
                $candidate = Join-Path $OdtExtract "setup.exe"
                if (Test-Path $candidate) { $OdtSetup = $candidate; Write-Host "[$(Get-Date -Format 'HH:mm:ss')] ODT ready via FWLink: $OdtSetup" }
            } else { Write-Host "[$(Get-Date -Format 'HH:mm:ss')] WARNING: FWLink returned an invalid file (probably a redirect)" }
        } catch { Write-Host "[$(Get-Date -Format 'HH:mm:ss')] WARNING: FWLink attempt failed: $_" }
    }

    # ── Intento 2: URL de fallback conocida ──
    if (-not (Test-Path $OdtSetup -ErrorAction SilentlyContinue)) {
        try {
            $OdtUrl2 = "https://download.microsoft.com/download/2/7/A/27AF1BE6-DD20-4CB4-B154-EBAB8A7D4A7E/officedeploymenttool_17531-20046.exe"
            $OdtTemp2 = "$env:TEMP\\odt2_$(Get-Random).exe"
            $OdtExtract2 = "$env:TEMP\\odt2_$(Get-Random)"
            $wc2 = New-Object System.Net.WebClient
            $wc2.Headers.Add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
            $wc2.DownloadFile($OdtUrl2, $OdtTemp2)
            if ((Get-Item $OdtTemp2 -ErrorAction SilentlyContinue).Length -gt 512KB) {
                New-Item -ItemType Directory -Path $OdtExtract2 -Force | Out-Null
                Start-Process $OdtTemp2 -ArgumentList "/quiet /extract:\`"$OdtExtract2\`"" -Wait -NoNewWindow
                $candidate2 = Join-Path $OdtExtract2 "setup.exe"
                if (Test-Path $candidate2) { $OdtSetup = $candidate2; Write-Host "[$(Get-Date -Format 'HH:mm:ss')] ODT ready via fallback URL: $OdtSetup" }
            }
        } catch { Write-Host "[$(Get-Date -Format 'HH:mm:ss')] WARNING: Fallback URL attempt failed: $_" }
    }

    if (-not (Test-Path $OdtSetup -ErrorAction SilentlyContinue)) {
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] ERROR: Could not download ODT using any method"
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] SOLUTION: manually place ODT setup.exe in $PSScriptRoot"
        Stop-Transcript -ErrorAction SilentlyContinue
        exit 1
    }
}

# ── Generar XML de configuración ─────────────────────────
$OfficeLogConfig = if ($ADDMDedicatedLogging) { "" } else { "  <Logging Level=\`"Standard\`" Path=\`"$LogDir\`" />" }
$XmlContent = @"
<Configuration>
  <Add OfficeClientEdition="${arch}" Channel="${channel}">
    <Product ID="${productId}">
      <Language ID="${language}" />
${excludeLines}
    </Product>
  </Add>
  <Display Level="None" AcceptEULA="TRUE" />
  <Property Name="FORCEAPPSHUTDOWN" Value="TRUE" />
  <Property Name="SharedComputerLicensing" Value="0" />
  <Updates Enabled="TRUE" />
$OfficeLogConfig
</Configuration>
"@

$XmlPath = "$env:TEMP\\office_config_${productId}_$(Get-Random).xml"
$XmlContent | Set-Content -Path $XmlPath -Encoding UTF8
Write-Host "[$(Get-Date -Format 'HH:mm:ss')] XML generated: $XmlPath"
${notifyPrefix}
${notifyBefore}
Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Installing Office. WARNING: this process may take 20 to 60 minutes."

# ── Instalar ─────────────────────────────────────────────
try {
    Start-Process -FilePath $OdtSetup -ArgumentList "/configure \`"$XmlPath\`"" -Wait -NoNewWindow
    if ($LASTEXITCODE -ne 0) { throw "ODT setup.exe exited with code $LASTEXITCODE" }

    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] OK: $NombreApp installed successfully (v$CurrentVersion)"
${notifyAfter}
    Save-AppDeployTracker -Payload @{ version = $CurrentVersion; hash = $CurrentHash; installedAt = (Get-Date).ToString('o'); computer = $env:COMPUTERNAME; result = 'success'; method = 'odt'; product = "${productId}" }
} catch {
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] ERROR: Failed to install $NombreApp - $_"
    Save-AppDeployTracker -Payload @{ version = $CurrentVersion; hash = $CurrentHash; failedAt = (Get-Date).ToString('o'); computer = $env:COMPUTERNAME; result = 'failed'; error = $_.ToString() }
}
Stop-Transcript -ErrorAction SilentlyContinue
`;
}

module.exports = scriptService;
