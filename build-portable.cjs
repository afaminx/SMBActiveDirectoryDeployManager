// Works from a standalone fork checkout or codex/src/mod-rev-X.Y.
const fs = require('fs');
const path = require('path');
const { build, Platform } = require('electron-builder');
const revision = process.env.ADDM_REVISION || 'mod-rev-1.4';
if (!/^mod-rev-\d+\.\d+$/.test(revision)) throw Error('Invalid ADDM_REVISION');
const sourceRevision = path.basename(__dirname);
if (/^mod-rev-\d+\.\d+$/.test(sourceRevision) && sourceRevision !== revision) {
  throw Error('Copy source into the requested new revision before building.');
}
const inRevisionLayout = path.basename(path.dirname(__dirname)) === 'src'
  && path.basename(path.resolve(__dirname, '../..')) === 'codex';
const inGitpubLayout = path.basename(path.dirname(__dirname)) === 'gitpub'
  && path.basename(path.resolve(__dirname, '../..')) === 'codex';
const codexRoot = process.env.ADDM_CODEX_ROOT
  ? path.resolve(process.env.ADDM_CODEX_ROOT)
  : inRevisionLayout || inGitpubLayout ? path.resolve(__dirname, '../..') : path.join(__dirname, 'codex');
const output = path.join(codexRoot, 'bin', revision);
const packageOutput = path.join(codexRoot, 'pkg', revision);
for (const directory of [output, packageOutput]) {
  if (fs.existsSync(directory) && fs.readdirSync(directory).length) {
    throw Error('Build output already exists. Create the next revision; existing builds must be preserved.');
  }
  fs.mkdirSync(directory, { recursive: true });
}
process.env.ELECTRON_BUILDER_CACHE = path.join(codexRoot, 'toolchain', 'builder-cache');
process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
process.env.TEMP = process.env.TMP = path.join(codexRoot, 'toolchain', 'build-tmp');
fs.mkdirSync(process.env.TEMP, { recursive: true });
build({
  projectDir: __dirname,
  targets: Platform.WINDOWS.createTarget([process.argv.includes('--dir') ? 'dir' : 'portable']),
  config: {
    directories: { output },
    electronDist: path.join(__dirname, 'node_modules/electron/dist'),
    electronVersion: require('electron/package.json').version,
    npmRebuild: false,
    win: { signAndEditExecutable: false },
    portable: { artifactName: `../../pkg/${revision}/ADDeployManager-Portable.exe` }
  }
}).then(files => {
  // Builder diagnostics contain local paths and are not distribution files.
  for (const name of ['builder-debug.yml', 'builder-effective-config.yaml']) {
    const file = path.join(output, name);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
  console.log('Artifacts:', files);
}).catch(error => { console.error(error); process.exitCode = 1; });
