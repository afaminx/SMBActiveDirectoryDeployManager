const fs = require('fs');
const path = require('path');
const GENERATOR_REVISION = 'mod-rev-2.1';

function getCurrentAppVersion() {
  try {
    const { app } = require('electron');
    const currentVersion = app?.getVersion?.();
    if (typeof currentVersion === 'string' && currentVersion.trim()) {
      return currentVersion.trim();
    }
  } catch (err) {}

  try {
    const packageJsonPath = path.join(__dirname, '..', 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      if (typeof packageJson.version === 'string' && packageJson.version.trim()) {
        return packageJson.version.trim();
      }
    }
  } catch (err) {}

  return '0.0.0';
}

module.exports = {
  getCurrentAppVersion,
  getCurrentForkVersion: () => GENERATOR_REVISION.replace(/^mod-rev-/, ''),
  getCurrentGeneratorRevision: () => GENERATOR_REVISION
};
