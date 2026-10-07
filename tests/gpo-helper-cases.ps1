function Assert-Equal($actual, $expected, [string]$case) {
  if ($actual -cne $expected) { throw "${case}: expected '$expected', got '$actual'" }
}
Assert-Equal (Get-NextMachineVersion 131077) 131078 'Machine increment'
Assert-Equal (Get-NextMachineVersion 196607) 131072 'Machine wrap preserves user word'
Assert-Equal (Get-NextMachineVersion ([uint32]::MaxValue)) 4294901760 'Unsigned maximum'
Assert-Equal (Convert-GpoVersion -1) 4294967295 'Signed LDAP version'
$unrelated = '[{00000000-0000-0000-0000-000000000001}{00000000-0000-0000-0000-000000000002}]'
Assert-Equal (Merge-ScriptExtension $unrelated) ($unrelated + $scriptExt) 'Preserve unrelated CSE'
Assert-Equal (Merge-ScriptExtension ($unrelated + $scriptExt)) ($unrelated + $scriptExt) 'Idempotent CSE'
$otherTool = '[{42B5FAAE-6536-11D2-AE5A-0000F87571E3}{40B66650-4972-11D1-A7CA-0000F87571E3}]'
$merged = Merge-ScriptExtension $otherTool
if ($merged -notlike '*40B66650*' -or $merged -notlike '*40B6664F*') { throw 'Other Scripts tool lost' }
Assert-Equal (Remove-OwnedScriptExtension ($unrelated + $scriptExt) $unrelated) $unrelated 'Remove only owned CSE'
Assert-Equal (Remove-OwnedScriptExtension ($unrelated + $scriptExt) ($unrelated + $scriptExt)) ($unrelated + $scriptExt) 'Pre-existing CSE retained'
Assert-Equal (Remove-OwnedScriptExtension $merged $otherTool) $otherTool 'Other Scripts tool retained'
$lines = @('[Startup]','0CmdLine=existing.cmd','0Parameters=/original','[Shutdown]','0CmdLine=shutdown.cmd','0Parameters=/keep')
$added = @(Update-StartupLines $lines 1 '-File "C:\trusted\deploy.ps1"' $false)
Assert-Equal ($added -join '|') '[Startup]|0CmdLine=existing.cmd|0Parameters=/original|1CmdLine=powershell.exe|1Parameters=-File "C:\trusted\deploy.ps1"|[Shutdown]|0CmdLine=shutdown.cmd|0Parameters=/keep' 'Append without destroying settings'
$removed = @(Update-StartupLines $added 1 '' $true)
Assert-Equal ($removed -join '|') ($lines -join '|') 'Remove only deployment'
$shifted = @(Update-StartupLines $added 0 '' $true)
Assert-Equal (@(Get-IniEntries $shifted 'Startup' | Where-Object { $_.Key -eq 'CmdLine' })[0].Index) 0 'Contiguous indices'
$owner = [pscustomobject]@{ Schema=1; GpoGuid='{TEST}'; Index=1; Parameters='-File "C:\trusted\deploy.ps1"' }
Assert-OwnedStartup $owner $added '{TEST}'
$threw = $false
try { Assert-OwnedStartup $owner ($added -replace 'deploy.ps1','changed.ps1') '{TEST}' } catch { $threw=$true }
if (-not $threw) { throw 'Ownership changes must fail' }
$threw = $false
try { Merge-ScriptExtension 'malformed' } catch { $threw=$true }
if (-not $threw) { throw 'Malformed extension list must fail' }
Write-Output 'Helper cases passed'
