const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ad = require('../services/ad-service');
const config = require('../services/config');
const { ldapHelpers } = require('../services/ldap-snippets');
const { gpoScriptHelpers } = require('../services/gpo-script-snippets');
const generatedDir = path.join(__dirname, 'generated-powershell');
const originalConfig = config.getConfig;
let commands;

beforeEach(() => {
  commands = [];
  config.getConfig = () => ({ preferredDC: 'dc.example.test', networkSharePath: 'C:\\trusted', baseOUs: [] });
  ad.__test__.setPowerShellRunner(command => {
    commands.push(command);
    return JSON.stringify({ ok: true, gpoId: 'test', createdNew: true, exists: true, linkResults: [] });
  });
});
afterEach(() => { config.getConfig = originalConfig; ad.__test__.setPowerShellRunner(null); });

describe('LDAP service contracts', () => {
  it('bypasses discovery for a configured DC and rejects invalid hostnames', () => {
    const script = ad.__test__.dcSnippet('dc.example.test');
    expect(script).toContain("$adServer = 'dc.example.test'");
    expect(script).not.toContain('GetComputerDomain');
    expect(ad.__test__.dcSnippet('')).toContain('GetComputerDomain');
    expect(() => ad.__test__.dcSnippet("dc';throw 'bad")).toThrow('INVALID_DC');
  });

  it('preserves DN escapes, Unicode and literal PowerShell metacharacters', () => {
    expect(ad.__test__.sanitizeDN("OU=L'été \\, $;{}ä,DC=x")).toBe("OU=L''été \\, $;{}ä,DC=x");
    const tree = ad.__test__.buildOUTree([
      { Name: 'Parent', DistinguishedName: 'OU=Parent,DC=x' },
      { Name: 'Acme, Inc', DistinguishedName: 'OU=Acme\\, Inc,OU=Parent,DC=x' }
    ]);
    expect(tree[0].children[0].name).toBe('Acme, Inc');
  });

  it('keeps zero/single/multiple OU responses in the expected tree shape', async () => {
    for (const response of ['null', '{"Name":"One","DistinguishedName":"OU=One,DC=x"}', '[{"Name":"One","DistinguishedName":"OU=One,DC=x"},{"Name":"Two","DistinguishedName":"OU=Two,DC=x"}]']) {
      ad.__test__.setPowerShellRunner(() => response);
      const result = await ad.getOUs();
      expect(result.success).toBe(true);
      expect(result.data.length).toBe(response === 'null' ? 0 : response.startsWith('[') ? 2 : 1);
    }
  });

  it('returns LDAP health without requiring a GroupPolicy module', async () => {
    ad.__test__.setPowerShellRunner(command => command.includes('Get-Module') ? 'MISSING_GPMC' : '{"ok":true,"server":"dc.example.test","domain":"example.test","namingContext":"DC=example,DC=test"}');
    const result = await ad.checkRSAT();
    expect(result).toMatchObject({ available: true, ldapAvailable: true, missingGPMC: true });
  });

  it('retains useful LDAP error categories', async () => {
    ad.__test__.setPowerShellRunner(() => '{"ok":false,"code":"ROOTDSE_FAILED","error":"ROOTDSE_FAILED: missing naming context"}');
    expect(await ad.testADConnection()).toMatchObject({ success: false, code: 'ROOTDSE_FAILED' });
  });

  it('parses every generated operation with Windows PowerShell and audits all cmdlets', async () => {
    fs.mkdirSync(generatedDir, { recursive: true });
    await ad.testADConnection();
    await ad.getOUs();
    config.getConfig = () => ({ preferredDC: 'dc.example.test', networkSharePath: 'C:\\trusted', baseOUs: ["OU=L'été\\, Inc,DC=example,DC=test", 'OU=Other,DC=example,DC=test'] });
    await ad.getOUs();
    await ad.getGPOs();
    await ad.linkGPOtoOU('Deploy_Test', "OU=L'été\\, Inc,DC=example,DC=test");
    await ad.bulkLinkGPO('Deploy_Test', ['OU=Test,DC=example,DC=test']);
    await ad.createGPO('Deploy_Test', "C:\\trusted\\l'été.ps1", ['OU=Test,DC=example,DC=test']);
    await ad.deleteGPO('Deploy_Test');
    await ad.checkGPOExists('Deploy_Test');
    await ad.unlinkGPOfromOU('Deploy_Test', 'OU=Test,DC=example,DC=test');
    await ad.removeGPOStartupScript('Deploy_Test');
    await ad.getGPOLinkCounts();
    await ad.getManagedGPOLinks(['Deploy_Test']);
    await ad.getManagedGPOLinks(['Deploy_Test'], ['OU=Test,DC=example,DC=test']);
    await ad.checkGPOConflicts('OU=Test,DC=example,DC=test');
    expect(commands.length).toBe(15);
    commands.push(ad.__test__.dcSnippet(''));
    for (let i = 0; i < commands.length; i++) {
      expect(commands[i]).not.toMatch(/\b(?:Get|Set|New|Remove)-AD\w+|Import-Module ActiveDirectory/);
      fs.writeFileSync(path.join(generatedDir, `operation-${i}.ps1`), '\uFEFF' + commands[i]);
    }
    const validator = path.join(__dirname, 'validate-powershell.ps1');
    const output = execFileSync('powershell.exe', ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',validator,'-Directory',generatedDir], { encoding: 'utf8', windowsHide: true });
    expect(output).toContain('16 scripts parsed');
  }, 30000);

  it('executes INI, CSE, version and ownership regression cases in PowerShell', () => {
    fs.mkdirSync(generatedDir, { recursive: true });
    const testFile = path.join(generatedDir, 'pure-helper-tests.ps1');
    fs.writeFileSync(testFile, '\uFEFF$ErrorActionPreference="Stop"\n' + ldapHelpers + '\n' + gpoScriptHelpers + '\n' + fs.readFileSync(path.join(__dirname, 'gpo-helper-cases.ps1'), 'utf8'));
    const output = execFileSync('powershell.exe', ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',testFile], { encoding: 'utf8', windowsHide: true });
    expect(output).toContain('Helper cases passed');
  }, 30000);

  it('writes and rolls back real fixture files with mocked LDAP commits', () => {
    fs.mkdirSync(generatedDir, { recursive: true });
    const testFile = path.join(generatedDir, 'gpo-file-tests.ps1');
    // Only the fixture's SYSVOL root is substituted; production helper code is used.
    const helper = gpoScriptHelpers.replace('$policyPath = "\\\\$adServer\\sysvol\\$domain\\Policies\\$guid"', '$policyPath = $script:fixtureRoot');
    expect(helper).not.toBe(gpoScriptHelpers);
    fs.writeFileSync(testFile, '\uFEFF$ErrorActionPreference="Stop"\n' + ldapHelpers + '\n' + helper + '\n' + fs.readFileSync(path.join(__dirname, 'gpo-file-cases.ps1'), 'utf8'));
    const output = execFileSync('powershell.exe', ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',testFile], { encoding: 'utf8', windowsHide: true });
    expect(output).toContain('File and rollback cases passed');
  }, 30000);
});
