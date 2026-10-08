// vitest globals: describe, it, expect, vi are injected automatically

// vi.mock calls are hoisted to the top of the module by Vitest's transform —
// they must be declared before any require() of the mocked modules.

vi.mock('../services/config', () => ({
  default: { getConfig: () => ({ networkSharePath: '\\\\SERVER\\Share', language: 'en' }) },
  getConfig: () => ({ networkSharePath: '\\\\SERVER\\Share', language: 'en' })
}));

vi.mock('../services/i18n', () => ({
  default: { getTranslations: () => ({}) },
  getTranslations: () => ({})
}));

vi.mock('../services/template-service', () => ({
  default: {
    getWizardTemplates: () => ([
      {
        id: 'user-cid-template',
        category: 'Custom',
        name: 'CID Template',
        description: 'Custom template',
        fields: [],
        fileFields: [],
        noInstaller: false,
        isUserDefined: true
      }
    ]),
    resolve: (_id, snapshot) => (snapshot?.kind === 'user-template' ? snapshot : null)
  },
  getWizardTemplates: () => ([
    {
      id: 'user-cid-template',
      category: 'Custom',
      name: 'CID Template',
      description: 'Custom template',
      fields: [],
      fileFields: [],
      noInstaller: false,
      isUserDefined: true
    }
  ]),
  resolve: (_id, snapshot) => (snapshot?.kind === 'user-template' ? snapshot : null)
}));

const svc = require('../services/script-service');

describe('deployment script diagnostics', () => {
  it('emits English comments for every built-in template and preserves custom code', () => {
    for (const template of svc.getTemplateList().filter(item => !item.isUserDefined)) {
      const script = svc.generateScript(base({ template: template.id, wingetId: 'Mozilla.Firefox' }));
      expect(script, template.id).not.toMatch(/PLANTILLA|Versión:|Generado:|Guardia|Limpieza|Comprobar|Localizar|ADVERTENCIA|Canal:|Idioma:|Intento|Detección|Leer manifiesto|Copiar a cache/);
    }
    const code = '# Comentario personalizado\nWrite-Output "Texto del usuario"';
    expect(svc.generateScript(base({ template: 'custom', customParams: { customScript: code } }))).toContain(code);
  });
  it('parses generated install/uninstall scripts after translating their diagnostics', () => {
    const fs = require('fs');
    const path = require('path');
    const { execFileSync } = require('child_process');
    const directory = path.join(__dirname, 'generated-powershell', 'deployment-syntax');
    fs.mkdirSync(directory, { recursive: true });
    const scripts = ['generic', 'wazuh', 'winget', 'office'].map(template => svc.generateScript(base({
      template, wingetId: 'Notepad++.Notepad++',
      customParams: { manager: 'dc.example.test', group: 'test' }
    })));
    for (const uninstall of [
      { mode: 'auto-msi' }, { mode: 'auto-registry', registryMatchName: 'TestApp' },
      { mode: 'manual', command: 'C:\\Tools\\uninstall.exe', args: '/quiet' },
      { mode: 'winget', wingetId: 'Notepad++.Notepad++' }
    ]) scripts.push(svc.generateUninstallScript(base({ template: 'generic', installerType: 'msi', uninstall, wingetId: 'Notepad++.Notepad++' })));
    scripts.forEach((script, index) => {
      expect(script).not.toMatch(/AVISO:|OMITIDO:|Fallo instalando|No se pudo|instalador devolvio/);
      fs.writeFileSync(path.join(directory, `operation-${index}.ps1`), '\uFEFF' + script);
    });
    const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'validate-powershell.ps1'), '-Directory', directory], { encoding: 'utf8', windowsHide: true });
    expect(output).toContain('8 scripts parsed');
  });
});

// ── Helpers ────────────────────────────────────────────────────────────────
function base(overrides = {}) {
  return {
    name: 'TestApp',
    version: '2.0.0',
    notifyUser: false,
    silentArgs: '/S',
    customParams: {},
    ...overrides
  };
}

// ═══════════════════════════════════════════════════════════════════════════
describe('generateScript — generic template', () => {
  it('returns a string containing the app name', () => {
    const script = svc.generateScript(base({ template: 'generic' }));
    expect(typeof script).toBe('string');
    expect(script).toContain('TestApp');
  });

  it('embeds silentArgs in the script', () => {
    const script = svc.generateScript(base({ template: 'generic', silentArgs: '/SILENT /NORESTART' }));
    expect(script).toContain('/SILENT /NORESTART');
  });

  it('prepends generator metadata including the app version and script kind', () => {
    const script = svc.generateScript(base({ template: 'generic' }));
    expect(script).toContain('# AD DEPLOY MANAGER - GENERATED SCRIPT METADATA');
    expect(script).toContain('# generator_app_version:');
    expect(script).toContain('# script_kind: install');
    expect(script).toContain('$ADDMGeneratorAppVersion =');
    expect(script).toContain('$ADDMGeneratedScriptKind = "install"');
    expect(script).toContain('$ADDMGeneratedAppName = "TestApp"');
  });

  it('includes best-effort dedicated-server logging hooks', () => {
    const script = svc.generateScript(base({ template: 'generic' }));
    expect(script).toContain('Initialize-AppDeployRemoteLog');
    expect(script).toContain('Send-AppDeployLog -Level "info" -Source "install" -Message "install_start"');
    expect(script).toContain('Send-AppDeployLog -Level "info" -Source "install" -Message "install_success"');
    expect(script).not.toContain('PendingRemoteLogs.ndjson');
    expect(script).not.toContain('RemoteLogKey_');
  });

  it('includes the 32→64 bit redirect guard', () => {
    const script = svc.generateScript(base({ template: 'generic' }));
    expect(script).toContain('PROCESSOR_ARCHITEW6432');
  });

  it('falls back to generic when template is unknown', () => {
    const script = svc.generateScript(base({ template: 'nonexistent-template-xyz' }));
    expect(typeof script).toBe('string');
    expect(script.length).toBeGreaterThan(0);
  });

  it('uses a valid installer regex without over-escaping it', () => {
    const script = svc.generateScript(base({ template: 'generic' }));
    expect(script).toContain('-match "\\.(exe|msi|ps1)$"');
    expect(script).not.toContain('-match "\\\\.(exe|msi|ps1)$"');
    expect(script).toContain('$_.Name -ne "install.ps1"');
    expect(script).toContain('$PrimaryInstallerName = [string]($Manifest.primaryInstallerName)');
  });

  it('builds installer detection candidates from the file metadata and filename', () => {
    const script = svc.generateScript(base({ template: 'generic' }));
    expect(script).toContain('GetFileNameWithoutExtension([string]$InstallerPath)');
    expect(script).toContain('$fileBaseNameWithoutVersion = ($fileBaseName -replace');
    expect(script).toContain('GetFileNameWithoutExtension([string]$fileInfo.OriginalFilename)');
    expect(script).toContain('[string]$fileInfo.InternalName');
  });

  it('supports ps1 wrappers in the generic installer flow', () => {
    const script = svc.generateScript(base({ template: 'generic', silentArgs: '-Mode Silent' }));
    expect(script).toContain('$Instalador.Extension -eq ".ps1"');
    expect(script).toContain("'ps1' { 'PowerShell.exe' }");
    expect(script).toContain('$psArgs = "-ExecutionPolicy Bypass -File');
  });

  it('cleans up the local cache directory after a successful install', () => {
    const script = svc.generateScript(base({ template: 'generic' }));
    expect(script).toContain('function Test-DeployCachePathSafety');
    expect(script).toContain('Remove-Item -LiteralPath $CacheDir -Recurse -Force -ErrorAction Stop');
    expect(script).toContain('Invoke-PendingDeployCacheCleanups -MarkerDirectory $CleanupMarkerDir');
    expect(script).toContain('function Invoke-DeployCacheCleanupWithFallback');
    expect(script).toContain('Invoke-DeployCacheCleanupWithFallback -CacheDir $CacheDir -MarkerPath $CleanupMarkerPath | Out-Null');
    expect(script).toContain('function Register-DeployCacheCleanupPending');
    expect(script).toContain('function Start-DeployCacheCleanupWorker');
    expect(script).toContain('-EncodedCommand');
  });

  it('handles MSI conflict 1638 generically for wrapped executables too', () => {
    const script = svc.generateScript(base({ template: 'generic' }));
    expect(script).toContain('PublisherMatched = $bestPublisherMatched');
    expect(script).toContain("$trustedUpgradeMatch = $match.ProductCode -and (");
    expect(script).toContain('if ($conflictState.CanAutoUninstall) {');
    expect(script).not.toContain("if ($Kind -eq 'msi' -and $conflictState.CanAutoUninstall)");
    expect(script).toContain("Start-Process -FilePath 'msiexec.exe' -ArgumentList $uninstallArgs");
    expect(script).toContain('$retryProcess = Start-Process -FilePath $launchPath -ArgumentList $ArgumentList -Wait -NoNewWindow -PassThru');
  });

  it('waits for other installations and retries up to five times before failing', () => {
    const script = svc.generateScript(base({ template: 'generic' }));
    expect(script).toContain('$ManagedInstallerMaxAttempts = 5');
    expect(script).toContain('function Test-InstallerExecutionInProgress');
    expect(script).toContain('function Wait-InstallerExecutionIdle');
    expect(script).toContain("WARNING: Another installation is running. Waiting for it to finish...");
    expect(script).toContain('for ($attempt = 1; $attempt -le $ManagedInstallerMaxAttempts; $attempt++)');
    expect(script).toContain("installer returned 1618: another installation is running");
    expect(script).toContain('throw "$lastFailureMessage after $ManagedInstallerMaxAttempts attempts');
  });

  it('retries failed trackers with the same hash up to five times instead of requiring an app update immediately', () => {
    const script = svc.generateScript(base({ template: 'generic' }));
    expect(script).toContain('$PreviousFailureCount = 1');
    expect(script).toContain('$TrackerRetryBase = $PreviousFailureCount');
    expect(script).toContain('Installation previously failed with this hash');
    expect(script).toContain("retryCount = ($TrackerRetryBase + 1)");
    expect(script).not.toContain('Actualiza la app para reintentar.');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('generateScript — wazuh template', () => {
  it('embeds the manager address', () => {
    const script = svc.generateScript(base({
      template: 'wazuh',
      customParams: { manager: '192.168.1.10', group: 'linux', password: '' }
    }));
    expect(script).toContain('192.168.1.10');
    expect(script).toContain('WAZUH_MANAGER');
  });

  it('includes the agent group', () => {
    const script = svc.generateScript(base({
      template: 'wazuh',
      customParams: { manager: '10.0.0.1', group: 'servers', password: '' }
    }));
    expect(script).toContain('servers');
    expect(script).toContain('WAZUH_AGENT_GROUP');
  });

  it('includes registration password when provided', () => {
    const script = svc.generateScript(base({
      template: 'wazuh',
      customParams: { manager: '10.0.0.1', group: 'default', password: 'mysecret' }
    }));
    expect(script).toContain('WAZUH_REGISTRATION_PASSWORD');
    expect(script).toContain('mysecret');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('generateScript — winget template', () => {
  it('uses the supported module for machine scope and never falls back to user', () => {
    const script=svc.generateScript(base({template:'winget',wingetId:'Google.Chrome',wingetScope:'machine'}));
    expect(script).toContain('Install-WinGetPackage'); expect(script).toContain('-Scope System');
    expect(script).toContain('PowerShell 7 is required'); expect(script).toContain('-MTA');
    expect(script).not.toContain('--scope machine');
  });
  it('retains a group task for later users and tracks each user independently', () => {
    const script=svc.generateScript(base({template:'winget',wingetId:'Spotify.Spotify',wingetScope:'user'}));
    expect(script).toContain('-GroupId "S-1-5-4"'); expect(script).toContain('LOCALAPPDATA');
    expect(script).toContain('exit 60001'); expect(script).not.toContain('Unregister-ScheduledTask');
    expect(script).toContain('--scope user'); expect(script).toContain('Test-UserPackage');
  });
  it('rejects invalid IDs and Store machine scope', () => {
    expect(()=>svc.generateScript(base({template:'winget',wingetId:'x; Remove-Item'}))).toThrow();
    expect(()=>svc.generateScript(base({template:'winget',wingetId:'9ABC',wingetSource:'msstore',wingetScope:'machine'}))).toThrow();
  });
});

describe('generateScript — odt template', () => {
  it('embeds the product id', () => {
    const script = svc.generateScript(base({
      template: 'odt',
      odtConfig: { product: 'O365ProPlusRetail', channel: 'Current', language: 'en-us', arch: '64' }
    }));
    expect(script).toContain('O365ProPlusRetail');
  });

  it('embeds the channel', () => {
    const script = svc.generateScript(base({
      template: 'odt',
      odtConfig: { product: 'O365BusinessRetail', channel: 'MonthlyEnterprise', language: 'es-es', arch: '64' }
    }));
    expect(script).toContain('MonthlyEnterprise');
  });

  it('always excludes Groove and Lync', () => {
    const script = svc.generateScript(base({
      template: 'odt',
      odtConfig: { product: 'O365BusinessRetail', channel: 'Current', language: 'en-us', arch: '64', excludeApps: [] }
    }));
    expect(script).toContain('Groove');
    expect(script).toContain('Lync');
  });

  it('adds extra excluded apps from odtConfig', () => {
    const script = svc.generateScript(base({
      template: 'odt',
      odtConfig: { product: 'O365BusinessRetail', channel: 'Current', language: 'en-us', arch: '64', excludeApps: ['Teams', 'Publisher'] }
    }));
    expect(script).toContain('Teams');
    expect(script).toContain('Publisher');
  });

  it('skips ODT install when Office is already detected locally', () => {
    const script = svc.generateScript(base({
      template: 'odt',
      odtConfig: { product: 'O365BusinessRetail', channel: 'Current', language: 'en-us', arch: '64' }
    }));
    expect(script).toContain('$ClickToRunConfig = Get-ItemProperty "HKLM:\\SOFTWARE\\Microsoft\\Office\\ClickToRun\\Configuration"');
    expect(script).toContain('$TargetOfficeInstalled = $InstalledOfficeProducts -contains "O365BusinessRetail"');
    expect(script).toContain("method = 'odt-detected'; product = \"O365BusinessRetail\"");
    expect(script).not.toContain('$LastTracker');
  });
});

describe('generateScript — office template', () => {
  it('uses the uploaded xml filename directly when configXmlPath is provided', () => {
    const script = svc.generateScript(base({
      template: 'office',
      configXmlPath: 'C:\\Temp\\empresa_office.xml'
    }));
    expect(script).toContain('$RutaXML = Join-Path -Path $CacheDir -ChildPath "empresa_office.xml"');
    expect(script).not.toContain('config_office.xml');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('generateScript — crowdstrike template', () => {
  it('embeds the CID', () => {
    const script = svc.generateScript(base({
      template: 'crowdstrike',
      customParams: { cid: 'ABCDEF1234567890-AB' }
    }));
    expect(script).toContain('ABCDEF1234567890-AB');
    expect(script).toContain('CID=');
  });

  it('uses empty CID when not provided', () => {
    const script = svc.generateScript(base({ template: 'crowdstrike' }));
    expect(script).toContain('CID=');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('generateScript — forticlient template', () => {
  it('uses the shared installer conflict handler instead of bespoke per-app logic', () => {
    const script = svc.generateScript(base({
      template: 'forticlient',
      customParams: { vpnName: 'Corp VPN', vpnServer: 'vpn.example.com:443' }
    }));
    expect(script).toContain("Invoke-ManagedInstaller -Kind 'msi'");
    expect(script).toContain("Invoke-ManagedInstaller -Kind 'exe'");
    expect(script).not.toContain('Get-FortiClientInstallation');
    expect(script).not.toContain('Convert-FortiClientVersion');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('generateScript — custom template', () => {
  it('inlines the raw custom script code', () => {
    const code = 'Write-Host "hello world"';
    const script = svc.generateScript(base({
      template: 'custom',
      customParams: { customScript: code }
    }));
    expect(script).toContain(code);
  });

  it('uses placeholder when no customScript provided', () => {
    const script = svc.generateScript(base({ template: 'custom', customParams: {} }));
    expect(typeof script).toBe('string');
    expect(script.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('generateScript — notifyUser flag', () => {
  it('does NOT include Send-UserToast when notifyUser is false', () => {
    const script = svc.generateScript(base({ template: 'generic', notifyUser: false }));
    expect(script).not.toContain('Send-UserToast');
  });

  it('includes Send-UserToast when notifyUser is true', () => {
    const script = svc.generateScript(base({
      template: 'wazuh',
      notifyUser: true,
      customParams: { manager: '10.0.0.1', group: 'default', password: '' }
    }));
    expect(script).toContain('Send-UserToast');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('getTemplateList', () => {
  it('returns an array of template objects', () => {
    const list = svc.getTemplateList();
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThan(0);
  });

  it('every template has id, name, category, fields, noInstaller', () => {
    const list = svc.getTemplateList();
    for (const tpl of list) {
      expect(tpl).toHaveProperty('id');
      expect(tpl).toHaveProperty('name');
      expect(tpl).toHaveProperty('category');
      expect(tpl).toHaveProperty('fields');
      expect(tpl).toHaveProperty('noInstaller');
    }
  });

  it('winget and odt have noInstaller = true', () => {
    const list = svc.getTemplateList();
    const winget = list.find(t => t.id === 'winget');
    const odt = list.find(t => t.id === 'odt');
    expect(winget?.noInstaller).toBe(true);
    expect(odt?.noInstaller).toBe(true);
  });

  it('generic template has noInstaller = false', () => {
    const list = svc.getTemplateList();
    const generic = list.find(t => t.id === 'generic');
    expect(generic?.noInstaller).toBe(false);
  });
});

describe('generateUninstallScript', () => {
  it('prepends uninstall generator metadata including the app version and script kind', () => {
    const script = svc.generateUninstallScript(base({
      template: 'generic',
      installerType: 'msi',
      installerPath: 'C:\\temp\\agent.msi',
      uninstall: { mode: 'auto-msi' }
    }));

    expect(script).toContain('# AD DEPLOY MANAGER - GENERATED SCRIPT METADATA');
    expect(script).toContain('# generator_app_version:');
    expect(script).toContain('# script_kind: uninstall');
    expect(script).toContain('$ADDMGeneratedScriptKind = "uninstall"');
    expect(script).toContain('$ADDMGeneratedAppName = "TestApp"');
  });

  it('includes best-effort dedicated-server logging hooks in uninstall scripts', () => {
    const script = svc.generateUninstallScript(base({
      template: 'generic',
      installerType: 'msi',
      installerPath: 'C:\\temp\\agent.msi',
      uninstall: { mode: 'auto-msi' }
    }));

    expect(script).toContain('Initialize-AppDeployRemoteLog');
    expect(script).toContain('Send-AppDeployLog -Level "info" -Source "uninstall" -Message "uninstall_start"');
    expect(script).toContain('uninstall_success');
    expect(script).not.toContain('PendingRemoteLogs.ndjson');
    expect(script).not.toContain('RemoteLogKey_');
  });

  it('builds MSI uninstall scripts that resolve ProductCode automatically', () => {
    const script = svc.generateUninstallScript(base({
      template: 'generic',
      installerType: 'msi',
      installerPath: 'C:\\temp\\agent.msi',
      uninstall: { mode: 'auto-msi' }
    }));

    expect(script).toContain('Resolve-MsiProductCode');
    expect(script).toContain('/x $ProductCode REBOOT=ReallySuppress /qn /norestart');
    expect(script).toContain("Save-UninstallTracker -Result 'removed'");
  });

  it('builds registry uninstall scripts for generic EXE apps', () => {
    const script = svc.generateUninstallScript(base({
      template: 'generic',
      installerType: 'exe',
      uninstall: {
        mode: 'auto-registry',
        registryMatchName: 'PDF24 Creator',
        registryMatchPublisher: 'geek software GmbH'
      }
    }));

    expect(script).toContain('Resolve-RegistryUninstallEntry');
    expect(script).toContain('QuietUninstallString');
    expect(script).toContain('PDF24 Creator');
    expect(script).toContain('geek software GmbH');
  });

  it('builds manual uninstall scripts when a command is provided', () => {
    const script = svc.generateUninstallScript(base({
      template: 'custom',
      uninstall: {
        mode: 'manual',
        command: 'C:\\Program Files\\Tool\\uninstall.exe',
        args: '/quiet /norestart'
      }
    }));

    expect(script).toContain('C:\\Program Files\\Tool\\uninstall.exe');
    expect(script).toContain('/quiet /norestart');
    expect(script).toContain('Running manual command');
  });

  it('skips uninstall when a configured file detection anchor is absent', () => {
    const script = svc.generateUninstallScript(base({
      template: 'custom',
      detection: {
        type: 'file',
        filePath: 'C:\\Program Files\\Tool\\tool.exe',
        fileCheck: 'exists'
      },
      uninstall: {
        mode: 'manual',
        command: 'C:\\Program Files\\Tool\\uninstall.exe',
        args: '/quiet'
      }
    }));

    expect(script).toContain('function Test-AppPresentForUninstall');
    expect(script).toContain("Test-Path -LiteralPath 'C:\\Program Files\\Tool\\tool.exe'");
    expect(script).toContain("if (-not (Test-AppPresentForUninstall))");
    expect(script).toContain("note = 'detection-rule-absent'");
  });

  it('uses registry detection as an uninstall presence guard without requiring value comparisons', () => {
    const script = svc.generateUninstallScript(base({
      template: 'generic',
      installerType: 'exe',
      detection: {
        type: 'registry',
        registryHive: 'HKLM',
        registryKey: 'Software\\Vendor\\Tool',
        registryValueName: 'Version',
        registryCheck: 'equals',
        registryExpectedValue: '2.0.0'
      },
      uninstall: {
        mode: 'auto-registry',
        registryMatchName: 'Vendor Tool'
      }
    }));

    expect(script).toContain("function Test-AppPresentForUninstall");
    expect(script).toContain("$path = 'HKLM:\\Software\\Vendor\\Tool'");
    expect(script).toContain("return ($null -ne $item.$valueName)");
    expect(script).not.toContain("registryExpectedValue");
  });

  it('builds winget uninstall scripts with the configured package id', () => {
    const script = svc.generateUninstallScript(base({
      template: 'winget',
      wingetId: 'Mozilla.Firefox',
      wingetSource: 'winget'
    }));

    expect(script).toContain('Uninstall-WinGetPackage');
    expect(script).toContain('Mozilla.Firefox');
    expect(script).toContain("$cfg.action, '--id', $cfg.id");
  });
});
