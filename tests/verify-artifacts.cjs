// Usage: node tests/verify-artifacts.cjs <unpacked-directory> <portable-exe>
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createRequire } = require('module');
const source = path.resolve(__dirname, '..');
if (!process.argv[2] || !process.argv[3]) throw Error('Provide unpacked directory and portable executable paths.');
const archive = path.join(path.resolve(process.argv[2]), 'resources', 'app.asar');
const portable = path.resolve(process.argv[3]);
const builderRequire = createRequire(require.resolve('electron-builder'));
const libRequire = createRequire(builderRequire.resolve('app-builder-lib'));
const asar = libRequire('@electron/asar');
const forbidden = /\b(?:Get|Set|New|Remove)-AD\w+|Import-Module\s+ActiveDirectory|ActiveDirectory\.Management/i;
let compared = 0;
for (const member of asar.listPackage(archive)) {
  const name = member.replace(/^[/\\]+/, '').replace(/\\/g, '/');
  if (!/\.(js|html|css)$/.test(name)) continue;
  const bytes = asar.extractFile(archive, name.split('/').join(path.sep));
  if (!bytes.equals(fs.readFileSync(path.join(source, name)))) throw Error('Packaged content mismatch: ' + name);
  if (name.endsWith('.js') && forbidden.test(bytes.toString('utf8'))) throw Error('Packaged ADWS reference: ' + name);
  compared++;
}
for (const name of ['services/ldap-snippets.js','services/gpo-script-snippets.js','services/ad-service.js','main.js','preload.js']) {
  if (!asar.extractFile(archive, name.split('/').join(path.sep)).length) throw Error('Missing packaged code: ' + name);
}
const bytes = fs.readFileSync(portable);
if (bytes.toString('ascii', 0, 2) !== 'MZ') throw Error('Invalid executable');
console.log(path.basename(portable), bytes.length, 'bytes SHA256', crypto.createHash('sha256').update(bytes).digest('hex'));
console.log('Packaged source verified:', compared, 'files; no runtime ADWS calls');
