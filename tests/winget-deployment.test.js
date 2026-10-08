const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const deployment = require('../services/winget-deployment');
const tmp = path.join(__dirname, 'generated-winget-tests');
const literal = s => "'" + s.replace(/'/g, "''") + "'";
function execute(label, cfg, prelude, system = false) {
  fs.mkdirSync(tmp, { recursive: true });
  const script = path.join(tmp, label + '.ps1');
  let body = deployment.generate({ name: "Fixture O'Brien", version: '1.0', ...cfg });
  body = body.replace("([Security.Principal.WindowsIdentity]::GetCurrent().User.Value -eq 'S-1-5-18')", system ? '$true' : '$false');
  // Only the host requirement is stubbed; the actual installation branch runs against mocks.
  body = body.replace("$PSVersionTable.PSVersion.Major -lt 7 -or [Threading.Thread]::CurrentThread.GetApartmentState() -ne 'MTA'", '$false');
  const fixture = path.join(tmp, label); fs.mkdirSync(fixture, { recursive: true });
  fs.writeFileSync(script, '\uFEFF' + `$env:ProgramData=${literal(fixture)}; $env:LOCALAPPDATA=${literal(fixture)}\n` + String.raw`
function Start-Transcript { param($Path,[switch]$Append,$ErrorAction) }
function Stop-Transcript { param($ErrorAction) }
function Set-Acl { param($LiteralPath,$AclObject) }
` + prelude + '\n' + body);
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  if (r.error) throw r.error;
  return { ...r, output: r.stdout + r.stderr };
}
describe('WinGet deployment contexts', () => {
  it('defers SYSTEM user packages without invoking WinGet and retains a limited group task', () => {
    const r = execute('scheduled', { wingetId: 'Spotify.Spotify', wingetScope: 'user' }, String.raw`
function New-ScheduledTaskAction { param($Execute,$Argument); if ($Argument -notlike '*deploy.ps1*') { throw 'Wrong worker' }; @{} }
function New-ScheduledTaskTrigger { param([switch]$AtLogOn); @{} }
function New-ScheduledTaskPrincipal { param($GroupId,$RunLevel); if ($GroupId -ne 'S-1-5-4' -or $RunLevel -ne 'Limited') { throw 'Wrong principal' }; @{} }
function New-ScheduledTaskSettingsSet { param($ExecutionTimeLimit,$MultipleInstances,[switch]$StartWhenAvailable); if ($MultipleInstances -ne 'Parallel') { throw 'Users blocked' }; @{} }
function Register-ScheduledTask { param($TaskName,$Action,$Trigger,$Principal,$Settings,$Description,[switch]$Force,$ErrorAction); Write-Host 'TASK VERIFIED' }
function winget.exe { throw 'CLI invoked as SYSTEM' }
`, true);
    expect(r.status, r.output).toBe(60001); expect(r.output).toContain('TASK VERIFIED');
    expect(r.output).toContain('Waiting for user sign-in');
  });
  it('uses user-scoped detection and records failure instead of success when installation fails', () => {
    for (const failed of [false, true]) {
      const r = execute('user-' + failed, { wingetId: 'Spotify.Spotify', wingetScope: 'user' }, String.raw`
$script:installed=$false
function Get-Command { param($Name,$ErrorAction); @{Source='Fixture-WinGet'} }
function Fixture-WinGet {
  if ($args -notcontains 'user') { throw 'Incorrect detection scope' }
  if ($args[0] -eq 'list') { $global:LASTEXITCODE=0; if ($script:installed) { 'Spotify.Spotify' }; return }
  if (__FAILED__) { $global:LASTEXITCODE=1618; return }
  $script:installed=$true; $global:LASTEXITCODE=0
}
`.replace('__FAILED__', failed ? '$true' : '$false'));
      expect(r.status, r.output).toBe(failed ? 1 : 0);
      expect(r.output).toContain(failed ? 'ERROR:' : 'OK:');
    }
  });
  it('uses module System scope, verifies installation, and never converts machine failure to a user task', () => {
    for (const failed of [false, true]) {
      const r = execute('machine-' + failed, { wingetId: 'Mozilla.Firefox', wingetScope: 'machine' }, String.raw`
$script:installed=$false
function Get-Module { param([switch]$ListAvailable,$Name); @{} }
function Import-Module { param($Name,$ErrorAction) }
function Get-WinGetVersion { param($ErrorAction); '1.0' }
function Get-WinGetPackage { param($Id,$Source,$MatchOption,$ErrorAction); if ($script:installed) { @{Id='Mozilla.Firefox'} } }
function Install-WinGetPackage { param($Id,$Source,$MatchOption,$Scope,$Mode,$ErrorAction); if ($Scope -ne 'System' -or $MatchOption -ne 'EqualsCaseInsensitive') { throw 'Wrong scope/match' }; if (__FAILED__) { @{Status='InstallError';InstallerErrorCode=1603} } else { $script:installed=$true; @{Status='Ok'} } }
function Register-ScheduledTask { throw 'Scope changed' }
function winget.exe { throw 'CLI invoked as SYSTEM' }
`.replace('__FAILED__', failed ? '$true' : '$false'), true);
      expect(r.status, r.output).toBe(failed ? 1 : 0);
    }
  });
  it('requires valid IDs, explicit scope, and defaults prerequisite repair to off', () => {
    expect(deployment.normalize({ wingetId: 'Mozilla.Firefox' }).repair).toBe(false);
    expect(() => deployment.normalize({ wingetId: 'bad;command' })).toThrow();
    expect(() => deployment.normalize({ wingetId: '9ABC', wingetSource: 'msstore', wingetScope: 'machine' })).toThrow();
    expect(deployment.generate({ wingetId: 'Spotify.Spotify' })).not.toContain('Unregister-ScheduledTask');
  });
});
