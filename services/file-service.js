const fs = require('fs');
const path = require('path');
const configService = require('./config');
const { resolveNamedSubdirectory } = require('./path-utils');
const shareHealth = require('./share-health');

const fileService = {
  listDeployedApps() {
    try {
      if (!shareHealth.isAvailableSync()) {
        return { success: false, error: 'SHARE_UNAVAILABLE', data: [] };
      }
      const config = configService.getConfig();
      const basePath = config.networkSharePath;
      const myShareId = config.shareId || '';

      if (!fs.existsSync(basePath)) {
        return { success: false, error: `Path does not exist: ${basePath}`, data: [] };
      }

      const entries = fs.readdirSync(basePath, { withFileTypes: true });
      const apps = entries
        .filter(e => e.isDirectory())
        .map(dir => {
          const dirPath = path.join(basePath, dir.name);
          const files = fs.readdirSync(dirPath).map(f => {
            const filePath = path.join(dirPath, f);
            const stats = fs.statSync(filePath);
            return {
              name: f,
              size: stats.size,
              modified: stats.mtime.toISOString(),
              extension: path.extname(f).toLowerCase()
            };
          });

          const hasScript = files.some(f => f.extension === '.ps1');
          const hasInstaller = files.some(f =>
            f.extension === '.msi'
            || f.extension === '.exe'
            || (f.extension === '.ps1' && String(f.name || '').toLowerCase() !== 'install.ps1')
          );

          // Read version manifest if available
          let manifest = null;
          const versionFile = path.join(dirPath, 'version.json');
          try {
            if (fs.existsSync(versionFile)) {
              manifest = JSON.parse(fs.readFileSync(versionFile, 'utf-8'));
            }
          } catch (e) {}

          // If config has a shareId, only include folders that match it
          // (folders without shareId in manifest are always included for backward compat)
          if (myShareId && manifest?.shareId && manifest.shareId !== myShareId) {
            return null;
          }

          const isNoInstallerApp = manifest?.template === 'winget' || manifest?.template === 'odt'
            || (manifest && manifest.hash === '' && hasScript);
          const status = hasScript && (hasInstaller || isNoInstallerApp) ? 'ready'
            : hasScript ? 'missing-installer'
            : 'missing-script';

          return {
            name: dir.name,
            path: dirPath,
            files,
            hasScript,
            hasInstaller,
            version: manifest?.version || null,
            hash: manifest?.hash || null,
            template: manifest?.template || null,
            deployedAt: manifest?.deployedAt || null,
            shareId: manifest?.shareId || null,
            status
          };
        }).filter(app => app && app.hasScript);

      return { success: true, data: apps };
    } catch (err) {
      return { success: false, error: err.message, data: [] };
    }
  },

  getAppContents(name) {
    try {
      if (!shareHealth.isAvailableSync()) return { success: false, error: 'SHARE_UNAVAILABLE', data: [] };
      const config = configService.getConfig();
      const { path: dirPath } = resolveNamedSubdirectory(config.networkSharePath, name, 'App');

      if (!fs.existsSync(dirPath)) {
        return { success: false, error: 'Folder not found', data: [] };
      }

      const files = fs.readdirSync(dirPath).map(f => {
        const filePath = path.join(dirPath, f);
        const stats = fs.statSync(filePath);
        return {
          name: f,
          size: stats.size,
          modified: stats.mtime.toISOString(),
          extension: path.extname(f).toLowerCase()
        };
      });

      return { success: true, data: files };
    } catch (err) {
      return { success: false, error: err.message, data: [] };
    }
  },

  createAppFolder(name) {
    try {
      if (!shareHealth.isAvailableSync()) return { success: false, error: 'SHARE_UNAVAILABLE' };
      const config = configService.getConfig();
      const { path: dirPath } = resolveNamedSubdirectory(config.networkSharePath, name, 'App');

      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }

      return { success: true, path: dirPath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
};

module.exports = fileService;
