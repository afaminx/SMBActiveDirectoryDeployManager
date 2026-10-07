const fs = require('fs');
const path = require('path');
const vm = require('vm');
const code = fs.readFileSync(path.join(__dirname, '..', 'build-portable.cjs'), 'utf8');

function simulate(directory, existing = false, environment = {}) {
  let options;
  vm.runInNewContext(code, {
    __dirname: directory,
    process: { env: { ...environment }, argv: [] },
    console: { log() {}, error() {} },
    require(name) {
      if (name === 'path') return path;
      if (name === 'fs') return {
        existsSync: () => existing,
        readdirSync: () => existing ? ['existing.exe'] : [],
        mkdirSync() {}, unlinkSync() {}
      };
      if (name === 'electron/package.json') return { version: '33.4.11' };
      if (name === 'electron-builder') return {
        Platform: { WINDOWS: { createTarget: value => value } },
        build(value) { options = value; return Promise.resolve([]); }
      };
      throw Error('Unexpected dependency');
    }
  });
  return options;
}

describe('clean fork build layout', () => {
  it('keeps binaries outside the existing GitHub checkout', () => {
    const workspace = path.resolve('fixture-workspace');
    const opts = simulate(path.join(workspace, 'codex', 'gitpub', 'SMBActiveDirectoryDeployManager'));
    expect(opts.config.directories.output).toBe(path.join(workspace, 'codex', 'bin', 'mod-rev-1.4'));
  });
  it('uses the shared codex root for a revision source directory', () => {
    const workspace = path.resolve('fixture-workspace');
    const opts = simulate(path.join(workspace, 'codex', 'src', 'mod-rev-1.4'));
    expect(opts.config.directories.output).toBe(path.join(workspace, 'codex', 'bin', 'mod-rev-1.4'));
  });
  it('creates local codex output in a standalone fork clone', () => {
    const root = path.resolve('standalone-fork');
    expect(simulate(root).config.directories.output).toBe(path.join(root, 'codex', 'bin', 'mod-rev-1.4'));
  });
  it('refuses to overwrite an existing build before invoking the builder', () => {
    expect(() => simulate(path.resolve('standalone-fork'), true)).toThrow('Build output already exists');
  });
});
