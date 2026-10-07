# Local fixture only. LDAP methods are mocked; no AD or network writes occur.
class MockGpoEntry {
  [hashtable]$Attributes
  [bool]$FailNextCommit = $false
  MockGpoEntry() { $this.Attributes = @{} }
  [void] CommitChanges() {
    if ($this.FailNextCommit) { $this.FailNextCommit = $false; throw 'Injected LDAP commit failure' }
  }
  [void] RefreshCache() {}
  [void] Dispose() {}
}
function New-LdapEntry([string]$dn) { return $script:mockEntry }
function Get-LdapValue($entry, [string]$name) { return $entry.Attributes[$name] }
function Set-LdapValue($entry, [string]$name, $value) { $entry.Attributes[$name] = $value }
function Assert-Test([bool]$condition, [string]$message) { if (-not $condition) { throw $message } }
$script:fixtureRoot = Join-Path $env:TEMP ('gpo-fixture-' + [guid]::NewGuid().ToString())
[void][IO.Directory]::CreateDirectory((Join-Path $script:fixtureRoot 'Machine\Scripts\Startup'))
$script:mockEntry = [MockGpoEntry]::new()
$scriptsIni = Join-Path $script:fixtureRoot 'Machine\Scripts\scripts.ini'
$gptIni = Join-Path $script:fixtureRoot 'gpt.ini'
$ownerPath = Join-Path $script:fixtureRoot 'Machine\Scripts\addeploymanager-startup.json'
$unrelatedFile = Join-Path $script:fixtureRoot 'Machine\Scripts\Startup\unrelated.cmd'
$originalLines = @('[Startup]','0CmdLine=unrelated.cmd','0Parameters=/keep','[Shutdown]','0CmdLine=shutdown.cmd','0Parameters=/retain')
$unrelatedExt = '[{00000000-0000-0000-0000-000000000001}{00000000-0000-0000-0000-000000000002}]'
try {
  Set-Content -LiteralPath $scriptsIni -Value $originalLines -Encoding Unicode
  Set-Content -LiteralPath $gptIni -Value @('[General]','Version=131077') -Encoding ASCII
  Set-Content -LiteralPath $unrelatedFile -Value 'rem preserved' -Encoding ASCII
  $script:mockEntry.Attributes = @{ versionNumber = 131077; gPCMachineExtensionNames = $unrelatedExt }
  Set-DeploymentStartup '{TEST}' 'C:\trusted\deploy.ps1' $false
  Assert-Test ($script:mockEntry.Attributes.versionNumber -eq 131078) 'LDAP version did not increment'
  Assert-Test ((Get-Content -LiteralPath $gptIni) -contains 'Version=131078') 'GPT version mismatch'
  Assert-Test ((Get-Content -LiteralPath $scriptsIni) -contains '0CmdLine=unrelated.cmd') 'Unrelated startup removed'
  Assert-Test (Test-Path -LiteralPath $ownerPath) 'Ownership record missing'
  $snapshots = @{}
  foreach ($file in @($scriptsIni,$gptIni,$ownerPath,$unrelatedFile)) { $snapshots[$file] = [Convert]::ToBase64String([IO.File]::ReadAllBytes($file)) }
  $script:mockEntry.FailNextCommit = $true
  $failed = $false
  try { Set-DeploymentStartup '{TEST}' 'C:\trusted\updated.ps1' $false } catch { $failed = $true }
  Assert-Test $failed 'LDAP commit failure was swallowed'
  foreach ($file in $snapshots.Keys) { Assert-Test ([Convert]::ToBase64String([IO.File]::ReadAllBytes($file)) -ceq $snapshots[$file]) "Rollback changed $file" }
  Assert-Test ($script:mockEntry.Attributes.versionNumber -eq 131078) 'LDAP rollback failed'
  $script:mockEntry.Attributes.versionNumber = 999
  $failed = $false
  try { Set-DeploymentStartup '{TEST}' 'C:\trusted\updated.ps1' $false } catch { $failed = $true }
  Assert-Test $failed 'Version mismatch was ignored'
  Assert-Test ([Convert]::ToBase64String([IO.File]::ReadAllBytes($scriptsIni)) -ceq $snapshots[$scriptsIni]) 'Version mismatch wrote scripts.ini'
  $script:mockEntry.Attributes.versionNumber = 131078
  Set-DeploymentStartup '{TEST}' '' $true
  Assert-Test ((@(Get-Content -LiteralPath $scriptsIni) -join '|') -ceq ($originalLines -join '|')) 'Removal lost unrelated entries'
  Assert-Test (Test-Path -LiteralPath $unrelatedFile) 'Unrelated Startup file deleted'
  Assert-Test (-not (Test-Path -LiteralPath $ownerPath)) 'Ownership record not removed'
  Assert-Test ($script:mockEntry.Attributes.versionNumber -eq 131079) 'Removal version mismatch'
  $failed = $false
  try { Set-DeploymentStartup '{TEST}' '' $true } catch { $failed = $true }
  Assert-Test $failed 'Unknown ownership was not refused'
  Write-Output 'File and rollback cases passed'
} finally {
  # Verify fixture path is inside the explicitly configured local test temp root.
  $resolved = [IO.Path]::GetFullPath($script:fixtureRoot)
  $testRoot = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'
  if (-not $resolved.StartsWith($testRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe fixture cleanup path' }
  Remove-Item -LiteralPath $resolved -Recurse -Force
}
