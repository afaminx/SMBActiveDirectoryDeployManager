function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

describe('script-update-service', () => {
  it('refreshes scripts from an older fork revision even when the application version is unchanged', () => {
    const service = require('../services/script-update-service');
    const manifest = { scripts: { install: { path: 'install.ps1', generatedByAppVersion: '1.2.11', generatedByRevision: 'mod-rev-1.8' } } };
    expect(service.inspectManifestVersions(manifest, {}, '1.2.11').needsUpdate).toBe(true);
    manifest.scripts.install.generatedByRevision = 'mod-rev-2.1';
    expect(service.inspectManifestVersions(manifest, {}, '1.2.11').needsUpdate).toBe(false);
  });
  beforeEach(() => {
    vi.resetModules();
  });

  it('marks published scripts without generator metadata as outdated', () => {
    const service = require('../services/script-update-service');

    const report = service.inspectManifestVersions(
      null,
      {
        id: 'app-1',
        name: 'Legacy App',
        deployedPath: '\\\\server\\share\\Legacy App\\install.ps1',
        uninstallDeployedPath: '\\\\server\\share\\Legacy App\\uninstall.ps1'
      },
      '1.2.7'
    );

    expect(report.needsUpdate).toBe(true);
    expect(report.reasons).toContain('install-script-outdated');
    expect(report.reasons).toContain('uninstall-script-outdated');
  });

  it('regenerates only outdated scripts and persists updater metadata', async () => {
    const service = require('../services/script-update-service');
    const apps = [
      {
        id: 'app-1',
        name: 'Legacy App',
        deployedPath: '\\\\server\\share\\Legacy App\\install.ps1',
        uninstallDeployedPath: '\\\\server\\share\\Legacy App\\uninstall.ps1'
      },
      {
        id: 'app-2',
        name: 'Current App',
        deployedPath: '\\\\server\\share\\Current App\\install.ps1',
        uninstallDeployedPath: ''
      }
    ];
    const manifests = new Map([
      ['app-1', {
        installScriptPath: apps[0].deployedPath,
        uninstall: { scriptPath: apps[0].uninstallDeployedPath },
        scripts: {
          install: { path: apps[0].deployedPath, generatedAt: '2026-04-20T08:00:00.000Z', generatedByAppVersion: '1.0.0' },
          uninstall: { path: apps[0].uninstallDeployedPath, generatedAt: '2026-04-20T08:00:00.000Z', generatedByAppVersion: '1.0.0' },
          updater: {}
        }
      }],
      ['app-2', {
        installScriptPath: apps[1].deployedPath,
        uninstall: {},
        scripts: {
          install: { path: apps[1].deployedPath, generatedAt: '2026-04-24T08:00:00.000Z', generatedByAppVersion: '1.2.7', generatedByRevision: 'mod-rev-2.1' },
          updater: {}
        }
      }]
    ]);
    const regenerated = [];
    const activityEntries = [];

    const result = await service.runUpdateCycle('1.2.7', {
      appService: {
        getCachedAll: () => apps
      },
      scriptService: {
        regenerateScripts: async (appRecord) => {
          regenerated.push(appRecord.id);
          const manifest = manifests.get(appRecord.id);
          manifests.set(appRecord.id, {
            ...manifest,
            scripts: {
              ...manifest.scripts,
              install: {
                path: appRecord.deployedPath,
                generatedAt: '2026-04-24T10:30:00.000Z',
                generatedByAppVersion: '1.2.7', generatedByRevision: 'mod-rev-2.1'
              },
              uninstall: {
                path: appRecord.uninstallDeployedPath,
                generatedAt: '2026-04-24T10:30:00.000Z',
                generatedByAppVersion: '1.2.7', generatedByRevision: 'mod-rev-2.1'
              },
              updater: manifest.scripts?.updater || {}
            }
          });
          return { success: true };
        }
      },
      shareHealth: {
        isAvailableSync: () => true
      },
      readManifest: async (appRecord) => clone(manifests.get(appRecord.id)),
      writeManifest: async (appRecord, manifest) => {
        manifests.set(appRecord.id, clone(manifest));
        return true;
      },
      activityLog: {
        add: (action, details) => activityEntries.push({ action, details })
      }
    });

    expect(regenerated).toEqual(['app-1']);
    expect(result.status).toBe('completed');
    expect(result.progress.total).toBe(1);
    expect(result.progress.updated).toBe(1);
    expect(result.progress.failed).toBe(0);
    expect(result.updatedApps).toEqual([{ appId: 'app-1', appName: 'Legacy App' }]);
    expect(activityEntries.map(entry => entry.action)).toEqual([
      'script_update_background_started',
      'script_update_background_completed'
    ]);

    const updatedManifest = manifests.get('app-1');
    expect(updatedManifest.scripts.install.generatedByAppVersion).toBe('1.2.7');
    expect(updatedManifest.scripts.uninstall.generatedByAppVersion).toBe('1.2.7');
    expect(updatedManifest.scripts.updater.status).toBe('current');
    expect(updatedManifest.scripts.updater.needsUpdate).toBe(false);
    expect(updatedManifest.scripts.updater.lastError).toBe('');

    const currentManifest = manifests.get('app-2');
    expect(currentManifest.scripts.updater.status).toBe('current');
    expect(currentManifest.scripts.updater.needsUpdate).toBe(false);
  });

  it('keeps the app marked for update when regeneration fails', async () => {
    const service = require('../services/script-update-service');
    const appRecord = {
      id: 'app-1',
      name: 'Broken App',
      deployedPath: '\\\\server\\share\\Broken App\\install.ps1',
      uninstallDeployedPath: ''
    };
    const manifests = new Map([
      ['app-1', {
        installScriptPath: appRecord.deployedPath,
        uninstall: {},
        scripts: {
          install: { path: appRecord.deployedPath, generatedAt: '2026-04-22T08:00:00.000Z', generatedByAppVersion: '1.0.0' },
          updater: {}
        }
      }]
    ]);

    const result = await service.runUpdateCycle('1.2.7', {
      appService: {
        getCachedAll: () => [appRecord]
      },
      scriptService: {
        regenerateScripts: async () => ({ success: false, error: 'share write failed' })
      },
      shareHealth: {
        isAvailableSync: () => true
      },
      readManifest: async (app) => clone(manifests.get(app.id)),
      writeManifest: async (app, manifest) => {
        manifests.set(app.id, clone(manifest));
        return true;
      },
      activityLog: {
        add: () => {}
      }
    });

    expect(result.status).toBe('completed_with_errors');
    expect(result.progress.total).toBe(1);
    expect(result.progress.updated).toBe(0);
    expect(result.progress.failed).toBe(1);
    expect(result.failedApps).toEqual([
      { appId: 'app-1', appName: 'Broken App', error: 'share write failed' }
    ]);

    const failedManifest = manifests.get('app-1');
    expect(failedManifest.scripts.updater.status).toBe('error');
    expect(failedManifest.scripts.updater.needsUpdate).toBe(true);
    expect(failedManifest.scripts.updater.lastError).toBe('share write failed');
  });
});
