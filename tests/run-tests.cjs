const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const source = path.resolve(__dirname, '..');
const temp = path.join(__dirname, 'tmp');
fs.mkdirSync(temp, { recursive: true });
const result = spawnSync(process.execPath, [require.resolve('vitest/vitest.mjs'), 'run'], {
  cwd: source,
  env: { ...process.env, TEMP: temp, TMP: temp },
  stdio: 'inherit',
  windowsHide: true
});
if (result.error) throw result.error;
process.exitCode = result.status === null ? 1 : result.status;
