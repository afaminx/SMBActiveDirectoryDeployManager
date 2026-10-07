const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');
const names = require('../renderer/utils/gpo-names');
const { quoteGpoName, gpoNameHelpers } = require('../services/gpo-name-snippets');
const ad = require('../services/ad-service');
const config = require('../services/config');
const oldConfig = config.getConfig;
afterEach(() => { config.getConfig = oldConfig; ad.__test__.setPowerShellRunner(null); });
const legacy = { DisplayName: 'Deploy_Notepad', Id: '123' };
const exact = { DisplayName: 'Deploy_Notepad++', Id: '456' };
describe('GPO display-name identity', () => {
  it('preserves punctuation, Unicode and safely doubles single quotes', () => {
    expect(quoteGpoName("Deploy_L'été++ $;{}ä")).toBe("Deploy_L''été++ $;{}ä");
    expect(() => quoteGpoName('bad\nname')).toThrow('INVALID_GPO_NAME');
    expect(() => quoteGpoName('')).toThrow('INVALID_GPO_NAME');
  });
  it('recognizes the old Notepad++ name and prefers exact matches', () => {
    expect(names.resolve('Deploy_Notepad++', [legacy])).toBe(legacy);
    expect(names.resolve('deploy_notepad++', [legacy, exact])).toBe(exact);
    expect(names.resolve('Deploy_Missing', [legacy])).toBe(null);
  });
  it('does not guess when different managed names collide', () => {
    expect(names.resolve('Deploy_Notepad++', [legacy], ['Deploy_Notepad++', 'Deploy_Notepad!'])).toBe(null);
    expect(names.resolve('Deploy_Notepad++', [legacy, legacy])).toBe(null);
  });
  it('renders an existing legacy GPO in the real management table', () => {
    const nodes = new Map();
    const get = id => { if (!nodes.has(id)) nodes.set(id, { style: {}, querySelectorAll: () => [], addEventListener() {} }); return nodes.get(id); };
    const ctx = { GpoNames: names, Set, document: { getElementById: get, querySelectorAll: () => [] }, t: key => key, App: { _esc: String, formatDate: String } };
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../renderer/pages/gpos.js'), 'utf8') + '\nthis.page = GposPage;', ctx);
    ctx.page.gposCache = [legacy, { DisplayName: 'Default Domain Policy', Id: '789' }];
    ctx.page.localLinkCounts = { 'deploy_notepad++': 1 };
    expect(ctx.page.getVisibleGPOs()).toEqual([legacy]);
    ctx.page.renderTable();
    expect(get('gpos-tbody').innerHTML).toContain('Deploy_Notepad');
    expect(get('gpos-tbody').innerHTML).not.toContain('gpos.emptyFiltered');
  });
  it('does not mark a legacy GPO missing in the real OU loader', async () => {
    const ctx = { GpoNames: names, console, Set, Map, document: { getElementById: () => ({ innerHTML: '' }) }, t: key => key, App: { toast() {}, _esc: String }, window: { api: { ad: { getOUs: async () => ({ success: true, data: [] }), getGPOs: async () => ({ success: true, data: [legacy] }) }, apps: { reconcileManagedAssignments: async () => ({ success: true, data: [{ id: 'app', gpoName: 'Deploy_Notepad++' }], links: {} }) } } } };
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../renderer/pages/ou-tree.js'), 'utf8') + '\nthis.page = OUsPage;', ctx);
    Object.assign(ctx.page, { renderMain() {}, renderStatsBar() {}, renderPendingBar() {}, computeAssignmentCounts: () => ({}) });
    await ctx.page.loadData();
    expect(ctx.page.state.orphanGPOAppIds.size).toBe(0);
    ctx.window.api.ad.getGPOs = async () => ({ success: true, data: [] });
    await ctx.page.loadData();
    expect(ctx.page.state.orphanGPOAppIds.has('app')).toBe(true);
  });
  it('reports malformed GPO enumeration output as an error', async () => {
    config.getConfig = () => ({ preferredDC: 'dc.example.test' });
    ad.__test__.setPowerShellRunner(() => 'not JSON');
    expect(await ad.getGPOs()).toMatchObject({ success: false, data: [] });
    ad.__test__.setPowerShellRunner(() => JSON.stringify(legacy));
    expect(await ad.getGPOs()).toMatchObject({ success: true, data: [legacy] });
  });
  it('generates literal names for every AD mutation and managed reconciliation', async () => {
    config.getConfig = () => ({ preferredDC: 'dc.example.test', networkSharePath: 'C:\\trusted' });
    const commands = [];
    ad.__test__.setPowerShellRunner(c => { commands.push(c); return '{"ok":true,"exists":true,"linkResults":[]}'; });
    const name = "Deploy_L'été++ $;{}ä";
    await ad.createGPO(name, 'C:\\trusted\\install.ps1', []);
    await ad.linkGPOtoOU(name, 'OU=Test,DC=example,DC=test');
    await ad.bulkLinkGPO(name, ['OU=Test,DC=example,DC=test']);
    await ad.unlinkGPOfromOU(name, 'OU=Test,DC=example,DC=test');
    await ad.deleteGPO(name);
    await ad.checkGPOExists(name);
    await ad.removeGPOStartupScript(name);
    await ad.getManagedGPOLinks([name]);
    expect(commands.length).toBe(8);
    commands.forEach(c => expect(c).toContain("Deploy_L''été++ $;{}ä"));
    expect(commands[7]).toContain('$gpoLookup[$id] = $name');
    expect(commands[7]).toContain('AMBIGUOUS_GPO_NAME');
  });
  it('executes exact, legacy, not-found and error resolution using PowerShell mocks', () => {
    const temp = path.join(__dirname, 'generated-powershell'); fs.mkdirSync(temp, { recursive: true });
    const file = path.join(temp, 'gpo-name-cases.ps1');
    fs.writeFileSync(file, '\uFEFF' + '$ErrorActionPreference="Stop"\n' + gpoNameHelpers + String.raw`
$domain = 'example.test'; $adServer = 'dc.example.test'
$script:fixtures = @([pscustomobject]@{ DisplayName='Deploy_Notepad'; Id='123' })
function Get-GPO { param([switch]$All,$Domain,$Server,$ErrorAction); if ($script:fail) { throw 'enumeration failed' }; return $script:fixtures }
if ((Get-DeploymentGpoName 'Deploy_Notepad++') -cne 'Deploy_Notepad') { throw 'Legacy mismatch' }
$configuredGpoNames = @('Deploy_Notepad++','Deploy_Notepad!')
try { Resolve-DeploymentGpo 'Deploy_Notepad++'; throw 'Collision missed' } catch { if ($_.Exception.Message -notmatch '^AMBIGUOUS_GPO_NAME:') { throw } }
$configuredGpoNames = @()
$script:fixtures += [pscustomobject]@{ DisplayName='Deploy_Notepad++'; Id='456' }
if ((Get-DeploymentGpoName 'deploy_notepad++') -cne 'Deploy_Notepad++') { throw 'Exact mismatch' }
$literal = 'Deploy_L''été++ $;{}ä'
$script:fixtures += [pscustomobject]@{ DisplayName=$literal; Id='789' }
if ((Get-DeploymentGpoName $literal) -cne $literal) { throw 'Literal mismatch' }
if ($null -ne (Resolve-DeploymentGpo 'missing')) { throw 'Missing mismatch' }
$script:fail = $true
try { Resolve-DeploymentGpo 'missing'; throw 'Error swallowed' } catch { if ($_.Exception.Message -ne 'enumeration failed') { throw } }
'GPO name cases passed'
`);
    expect(execFileSync('powershell.exe', ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',file], { encoding: 'utf8', windowsHide: true })).toContain('GPO name cases passed');
  });
  it('returns real legacy links under the requested app name without clearing assignments', async () => {
    config.getConfig = () => ({ preferredDC: 'dc.example.test' });
    let script;
    ad.__test__.setPowerShellRunner(c => { script = c; return '{}'; });
    await ad.getManagedGPOLinks(['Deploy_Notepad++'], ['OU=Test,DC=example,DC=test']);
    const file = path.join(__dirname, 'generated-powershell', 'managed-name-cases.ps1');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '\uFEFF$ErrorActionPreference="Stop"\n' + gpoNameHelpers + String.raw`
$domain='example.test'; $adServer='dc.example.test'
function Get-GPO { param([switch]$All,$Domain,$Server,$ErrorAction); [pscustomobject]@{ DisplayName='Deploy_Notepad'; Id='00000000-0000-0000-0000-000000000001' } }
function Get-LdapOU { param($DN); [pscustomobject]@{ DistinguishedName=$DN; gPLink='[LDAP://CN={00000000-0000-0000-0000-000000000001},CN=Policies,CN=System,DC=example,DC=test;0]' } }
` + script.slice(script.indexOf('$targetNames = ')));
    const output = execFileSync('powershell.exe', ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',file], { encoding: 'utf8', windowsHide: true });
    expect(JSON.parse(output)).toEqual({ 'OU=Test,DC=example,DC=test': ['Deploy_Notepad++'] });
  });
});
