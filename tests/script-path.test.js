const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ad = require('../services/ad-service');
const config = require('../services/config');
const validate = ad.__test__.validateScriptPath;
const root = '\\\\192.0.2.50\\ClientDeployment$\\Software';
const settings = { networkSharePath: root, preferredDC: 'dc.example.test' };
const originalConfig = config.getConfig;
afterEach(() => { config.getConfig = originalConfig; ad.__test__.setPowerShellRunner(null); });

describe('trusted startup script paths', () => {
  it.each(['Notepad++', "L'été & Tools; {x} `$literal", 'Unicode ä'])('accepts hidden shares and literal Windows file names: %s', name => {
    const file = `${root}\\${name}\\install.ps1`;
    expect(validate(file, settings)).toBe(file);
  });

  it('matches UNC roots without regard to case and normalizes traversal within the root', () => {
    const file = `${root.toUpperCase()}\\app\\..\\install.ps1`;
    expect(validate(file, settings)).toBe(path.win32.normalize(file));
  });

  it.each([
    `${root}evil\\install.ps1`, `${root}\\..\\install.ps1`,
    '\\\\other.example.test\\ClientDeployment$\\Software\\install.ps1',
    'C:\\untrusted\\install.ps1', 'relative\\install.ps1',
    '\\rooted\\install.ps1', 'C:install.ps1',
    '\\\\?\\C:\\trusted\\install.ps1', '\\\\.\\C:\\trusted\\install.ps1',
    `${root}\\bad"name.ps1`, `${root}\\bad|name.ps1`, `${root}\\wild*.ps1`,
    `${root}\\wild?.ps1`, `${root}\\file:stream.ps1`, `${root}\\line\nbreak.ps1`,
    `${root}\\control\x01.ps1`, `${root}\\script.txt`
  ])('rejects untrusted, ambiguous or invalid Windows paths: %s', file => {
    expect(() => validate(file, settings)).toThrow();
  });

  it('reports English errors for missing paths and missing trusted configuration', () => {
    expect(() => validate('', settings)).toThrow('Script path is required');
    expect(() => validate(`${root}\\install.ps1`, {})).toThrow('No trusted paths are configured');
  });

  it('preserves the hidden share and literal metacharacters through the actual createGPO PowerShell generation', async () => {
    const file = `${root}\\L'été & Tools; {x} $literal\\install.ps1`;
    let command;
    config.getConfig = () => settings;
    ad.__test__.setPowerShellRunner(ps => {
      command = ps;
      return '{"ok":true,"gpoId":"test","linkResults":[]}';
    });
    expect((await ad.createGPO('Deploy_Test', file, [])).success).toBe(true);
    const directory = path.join(__dirname, 'generated-powershell');
    fs.mkdirSync(directory, { recursive: true });
    const generated = path.join(directory, 'literal-hidden-share.ps1');
    fs.writeFileSync(generated, '\uFEFF' + command);
    // Inspect the generated assignment as a PowerShell AST. No directory calls
    // run, and a literal path cannot become an injected statement/expression.
    const inspect = "$ErrorActionPreference='Stop';[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;$tokens=$null;$errors=$null;$ast=[System.Management.Automation.Language.Parser]::ParseFile($args[0],[ref]$tokens,[ref]$errors);if($errors.Count){throw $errors[0]};$a=@($ast.FindAll({param($n) $n -is [System.Management.Automation.Language.AssignmentStatementAst] -and $n.Left.VariablePath.UserPath -eq 'scriptLocalPath'},$true));if($a.Count -ne 1){throw 'Expected one path assignment'};$expr=$a[0].Right.Expression;if($expr -isnot [System.Management.Automation.Language.StringConstantExpressionAst]){throw 'Expected a string literal'};$expr.Value";
    const inspector = path.join(directory, 'inspect-literal-path.ps1');
    fs.writeFileSync(inspector, '\uFEFF' + inspect);
    const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', inspector, generated], { encoding: 'utf8', windowsHide: true });
    expect(output.trim()).toBe(file);
  });

  it('rejects invalid input before running PowerShell', async () => {
    config.getConfig = () => settings;
    let called = false;
    ad.__test__.setPowerShellRunner(() => { called = true; });
    expect(await ad.createGPO('Deploy_Test', `${root}evil\\install.ps1`, [])).toMatchObject({ success: false, code: 'INVALID_SCRIPT_PATH', error: 'Script path is outside the configured trusted paths' });
    expect(called).toBe(false);
  });
});
