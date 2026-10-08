const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const scriptService = require('../services/script-service');
const bundleService = require('../services/bundle-service');
const temp = path.join(__dirname, 'generated-installation-tests');
const psLiteral = value => "'" + String(value).replace(/'/g, "''") + "'";
function run(name, content) {
  fs.mkdirSync(temp, { recursive: true });
  const file = path.join(temp, name + '.ps1');
  fs.writeFileSync(file, '\uFEFF' + content);
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  if (result.error) throw result.error;
  return { ...result, output: result.stdout + result.stderr };
}
const generic = () => scriptService.generateScript({ name: 'Nextcloud Talk', template: 'generic', installerType: 'msi', version: '3.2.0', notifyUser: false });
describe('generated deployment runtime', () => {
  it('distinguishes MSI product identity, exact names, upgrades and installation dispositions', () => {
    const source = path.join(temp, 'generated-generic.ps1'); fs.mkdirSync(temp, { recursive: true }); fs.writeFileSync(source, '\uFEFF' + generic());
    const result = run('installer-identity', String.raw`
$ErrorActionPreference='Stop'
$tokens=$null; $errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile(__SOURCE__',[ref]$tokens,[ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
foreach ($fn in $ast.FindAll({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst]},$true)) { Invoke-Expression $fn.Extent.Text }
function Get-InstalledApplicationEntries { return $script:fixtures }
function Test-AppInstalled { return $false }
function Wait-InstallerExecutionIdle { }
function Start-Sleep { }
function Wait-ManagedInstallerInstalled { return $true }
function Start-Process { return [pscustomobject]@{ ExitCode=0 } }
$script:fixtures=@([pscustomobject]@{ DisplayName='Nextcloud'; NormalizedDisplayName='nextcloud'; ProductCode='{CLIENT}'; PublisherNormalized='nextcloudgmbh'; DisplayVersion='34.0.5'; VersionObject=[version]'34.0.5' })
$meta=[pscustomobject]@{ Extension='.msi'; ProductCode='{TALK}'; RelatedProductCodes=@(); NameCandidates=@('nextcloudtalk','nextcloud'); PublisherNormalized='nextcloudgmbh'; InstallerVersionObject=[version]'3.2.0' }
$state=Resolve-InstallerConflictState $meta '3.2.0'
if ($state.Match -or $state.SkipInstall -or $state.CanAutoUninstall) { throw 'Nextcloud client falsely matched Talk MSI' }
$meta.Extension='.exe'; $meta.ProductCode=''; $meta.NameCandidates=@('nextcloudtalk')
if (Get-InstalledApplicationMatch $meta) { throw 'Name prefix falsely matched another app' }
$meta.Extension='.msi'; $meta.ProductCode='{TALK}'; $meta.RelatedProductCodes=@('{OLD-TALK}')
$script:fixtures=@([pscustomobject]@{ DisplayName='Nextcloud Talk'; NormalizedDisplayName='nextcloudtalk'; ProductCode='{OLD-TALK}'; PublisherNormalized='nextcloudgmbh'; DisplayVersion='3.1.0'; VersionObject=[version]'3.1.0' })
$state=Resolve-InstallerConflictState $meta '3.2.0'
if (-not $state.CanAutoUninstall -or $state.SkipInstall) { throw 'Related MSI upgrade was lost' }
if (Test-ManagedInstallerInstalled $meta '3.2.0') { throw 'Older installed version falsely confirmed upgrade success' }
$script:fixtures[0].VersionObject=[version]'3.3.0'
if (-not (Resolve-InstallerConflictState $meta '3.2.0').SkipInstall) { throw 'Newer related version was not skipped' }
function Get-InstallerDetectionMetadata { return $meta }
$CurrentVersion='3.2.0'; $ManagedInstallerMaxAttempts=1
$script:InstallDisposition='pending'
$null=Invoke-ManagedInstaller -Kind msi -InstallerPath 'fixture.msi'
if ($script:InstallDisposition -ne 'skipped') { throw 'Skip disposition did not propagate out of function scope' }
$script:fixtures=@(); $script:InstallDisposition='pending'
$null=Invoke-ManagedInstaller -Kind msi -InstallerPath 'fixture.msi'
if ($script:InstallDisposition -ne 'installed') { throw 'Install disposition did not propagate' }
'Installer identity/runtime cases passed'
`.replace("__SOURCE__'", psLiteral(source)));
    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain('Installer identity/runtime cases passed');
  });

  it('executes bundle orchestration with failed, deferred and successful child statuses', () => {
    const fixture = path.join(temp, 'bundle'); fs.mkdirSync(fixture, { recursive: true });
    for (const name of ['Fail', 'Pending', 'Good']) { const dir = path.join(fixture, name); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'install.ps1'), '# fixture'); }
    const apps = ['Fail','Pending','Good'].map(name => ({id:name, name}));
    const marker = path.join(fixture, 'logs', 'Tracker_Bundle_FixtureBundle.txt');
    if (fs.existsSync(marker)) fs.unlinkSync(marker);
    const bundle = { name: 'FixtureBundle', version:'1.0', notifyUser:false, apps:apps.map((app,order) => ({appId:app.id,order})) };
    const script = bundleService.generateBundleScript(bundle, apps, {networkSharePath:fixture}).replace('$LogDir = "C:\\ProgramData\\AppDeploy_Logs"', '$LogDir = ' + psLiteral(path.join(fixture, 'logs')));
    const prelude = String.raw`
$ErrorActionPreference='Stop'; $env:PROCESSOR_ARCHITEW6432=''; $env:ADDM_STATUS_CASE='__CASE__'
function Start-Transcript { param($Path,[switch]$Append,[switch]$Force) }
function Stop-Transcript { param($ErrorAction) }
function powershell.exe { param([switch]$NoProfile,$ExecutionPolicy,$WindowStyle,$File)
  if ($env:ADDM_STATUS_CASE -eq 'success') { $global:LASTEXITCODE=0 }
  elseif ($env:ADDM_STATUS_CASE -eq 'pending') { $global:LASTEXITCODE=60001 }
  elseif ($File -like '*Fail*') { $global:LASTEXITCODE=1 }
  elseif ($File -like '*Pending*') { $global:LASTEXITCODE=60001 }
  else { $global:LASTEXITCODE=0 }
}
`;
    const mixed = run('bundle-mixed', prelude.replace('__CASE__','mixed') + script);
    expect(mixed.status, mixed.output).toBe(1);
    expect(mixed.output).toContain('ERROR: Fail'); expect(mixed.output).not.toContain('OK: Fail');
    expect(mixed.output).toContain('PENDING: Pending'); expect(mixed.output).toContain('OK: Good');
    expect(fs.existsSync(marker)).toBe(false);
    const pending = run('bundle-pending', prelude.replace('__CASE__','pending') + script);
    expect(pending.status, pending.output).toBe(60001); expect(fs.existsSync(marker)).toBe(false);
    const success = run('bundle-success', prelude.replace('__CASE__','success') + script);
    expect(success.status, success.output).toBe(0);
    expect(JSON.parse(fs.readFileSync(marker, 'utf8').replace(/^\uFEFF/, '')).result).toBe('success');
  });

  it('propagates generic installation failures after recording the actual generated tracker', () => {
    const generated = generic();
    const footer = generated.slice(generated.indexOf('    $DeploymentExitCode = 0\n    #'));
    expect(footer).toContain('exit $DeploymentExitCode');
    const result = run('generic-failure', String.raw`
function Save-AppDeployTracker { param($Payload); Write-Host "tracker=$($Payload.result)" }
function Send-AppDeployLog { param($Level,$Source,$Message,$Context) }
function Invoke-DeployCacheCleanupWithFallback { param($CacheDir,$MarkerPath) }
function Stop-Transcript { param($ErrorAction) }
try { throw 'Fixture installer failed'
` + footer);
    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain('tracker=failed');
  });
});
