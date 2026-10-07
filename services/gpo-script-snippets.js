// Operates only on the application's recorded Startup entry. Other INI entries
// and CSE registrations are preserved. LDAP failures propagate to the caller.
const gpoScriptHelpers = String.raw`
$scriptExt = '[{42B5FAAE-6536-11D2-AE5A-0000F87571E3}{40B6664F-4972-11D1-A7CA-0000F87571E3}]'
function Get-IniEntries([string[]]$lines, [string]$section) {
  $active = $false
  foreach ($line in $lines) {
    if ($line -match '^\s*\[([^\]]+)\]\s*$') { $active = $matches[1] -eq $section; continue }
    if ($active -and $line -match '^(\d+)(CmdLine|Parameters)=(.*)$') {
      [pscustomobject]@{ Index = [int]$matches[1]; Key = $matches[2]; Value = $matches[3] }
    }
  }
}
function Update-StartupLines([string[]]$lines, [int]$index, [string]$parameters, [bool]$remove) {
  $out = [System.Collections.Generic.List[string]]::new()
  $active = $false; $found = $false; $inserted = $false
  foreach ($line in $lines) {
    if ($line -match '^\s*\[([^\]]+)\]\s*$') {
      if ($active -and -not $remove -and -not $inserted) {
        $out.Add("$($index)CmdLine=powershell.exe"); $out.Add("$($index)Parameters=$parameters"); $inserted = $true
      }
      $active = $matches[1] -eq 'Startup'
      if ($active) { $found = $true }
    }
    if ($active -and $line -match ('^' + $index + '(CmdLine|Parameters)=')) { continue }
    $out.Add($line)
  }
  if (-not $remove -and -not $inserted) {
    if (-not $found) { $out.Add('[Startup]') }
    $out.Add("$($index)CmdLine=powershell.exe"); $out.Add("$($index)Parameters=$parameters")
  }
  if ($remove) {
    # Scripts must have contiguous indices after removing our entry.
    $indices = @(Get-IniEntries $out.ToArray() 'Startup' | ForEach-Object { $_.Index } | Sort-Object -Unique)
    $mapping = @{}; $next = 0
    foreach ($old in $indices) { $mapping[[int]$old] = $next; $next++ }
    $active = $false
    for ($i = 0; $i -lt $out.Count; $i++) {
      if ($out[$i] -match '^\s*\[([^\]]+)\]\s*$') { $active = $matches[1] -eq 'Startup'; continue }
      if ($active -and $out[$i] -match '^(\d+)(CmdLine|Parameters)=(.*)$') {
        $out[$i] = [string]$mapping[[int]$matches[1]] + $matches[2] + '=' + $matches[3]
      }
    }
  }
  return $out.ToArray()
}
function Convert-GpoVersion($value) {
  # LDAP Integer is signed; the policy version is an unsigned 32-bit bitfield.
  if ([long]$value -lt 0) { return [BitConverter]::ToUInt32([BitConverter]::GetBytes([int]$value), 0) }
  return [uint32]$value
}
function Get-NextMachineVersion([uint32]$current) {
  $user = ([uint64]$current -shr 16) -band 65535
  $machine = (([uint64]$current -band 65535) + 1) -band 65535
  return [uint32](($user -shl 16) -bor $machine)
}
function Get-GptUpdate([string]$gptIni, $entry) {
  if (-not (Test-Path -LiteralPath $gptIni)) { throw 'SYSVOL_FAILED: gpt.ini is missing' }
  $lines = @(Get-Content -LiteralPath $gptIni)
  $versions = @($lines | Where-Object { $_ -match '^Version=\d+\s*$' })
  if ($versions.Count -ne 1) { throw 'GPO_VERSION_FAILED: gpt.ini must have one valid Version' }
  $current = [uint32](($versions[0] -split '=')[1].Trim())
  $adVersion = Convert-GpoVersion (Get-LdapValue $entry 'versionNumber')
  if ($current -ne $adVersion) { throw 'GPO_VERSION_FAILED: LDAP and SYSVOL versions differ; reconcile before retrying' }
  $next = Get-NextMachineVersion $current
  [pscustomobject]@{
    Version = $next
    SignedVersion = [BitConverter]::ToInt32([BitConverter]::GetBytes([uint32]$next), 0)
    Lines = @($lines | ForEach-Object { if ($_ -match '^Version=') { "Version=$next" } else { $_ } })
  }
}
function Merge-ScriptExtension([string]$ext) {
  # Add the exact computer tool GUID, even if another Scripts tool is present.
  $cse = '{42B5FAAE-6536-11D2-AE5A-0000F87571E3}'
  $tool = '{40B6664F-4972-11D1-A7CA-0000F87571E3}'
  $groups = @([regex]::Matches($ext, '\[[^\]]+\]') | ForEach-Object { $_.Value })
  if (($groups -join '') -ne $ext) { throw 'GPO_CSE_FAILED: Malformed extension list' }
  $found = $false
  $updated = foreach ($group in $groups) {
    if ($group.StartsWith('[' + $cse, [StringComparison]::OrdinalIgnoreCase)) {
      $found = $true
      if ($group.IndexOf($tool, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
        $tools = @([regex]::Matches($group.Substring(1 + $cse.Length), '\{[^}]+\}') | ForEach-Object { $_.Value }) + $tool
        '[' + $cse + (@($tools | Sort-Object) -join '') + ']'
      }
      else { $group }
    } else { $group }
  }
  if (-not $found) { $updated = @($updated) + $scriptExt }
  # The extension groups are ordered by CSE GUID as required by Group Policy.
  return (@($updated | Sort-Object) -join '')
}
function Remove-OwnedScriptExtension([string]$ext, [string]$originalExt) {
  $cse = '{42B5FAAE-6536-11D2-AE5A-0000F87571E3}'
  $tool = '{40B6664F-4972-11D1-A7CA-0000F87571E3}'
  $originalGroups = @([regex]::Matches($originalExt, '\[[^\]]+\]') | ForEach-Object { $_.Value })
  $original = @($originalGroups | Where-Object { $_.StartsWith('[' + $cse, [StringComparison]::OrdinalIgnoreCase) })
  if ($original.Count -gt 0 -and $original[0].IndexOf($tool, [StringComparison]::OrdinalIgnoreCase) -ge 0) { return $ext }
  $updated = foreach ($match in [regex]::Matches($ext, '\[[^\]]+\]')) {
    $group = $match.Value
    if ($group.StartsWith('[' + $cse, [StringComparison]::OrdinalIgnoreCase)) {
      $group = [regex]::Replace($group, [regex]::Escape($tool), '', [Text.RegularExpressions.RegexOptions]::IgnoreCase)
      if ($group -eq ('[' + $cse + ']')) { continue }
    }
    $group
  }
  return (@($updated) -join '')
}
function Assert-OwnedStartup($owner, [string[]]$lines, [string]$guid) {
  if ($owner.Schema -ne 1 -or $owner.GpoGuid -ne $guid -or $owner.Index -notmatch '^\d+$') { throw 'GPO_OWNERSHIP_FAILED: Invalid ownership record' }
  $entries = @(Get-IniEntries $lines 'Startup' | Where-Object { $_.Index -eq [int]$owner.Index })
  $cmd = @($entries | Where-Object { $_.Key -eq 'CmdLine' })
  $args = @($entries | Where-Object { $_.Key -eq 'Parameters' })
  if ($entries.Count -ne 2 -or $cmd.Count -ne 1 -or $args.Count -ne 1 -or $cmd[0].Value -ne 'powershell.exe' -or $args[0].Value -cne $owner.Parameters) {
    throw 'GPO_OWNERSHIP_FAILED: Startup entry changed externally; inspect before retrying'
  }
}
function Set-DeploymentStartup([string]$guid, [string]$scriptPath, [bool]$remove) {
  $entry = New-LdapEntry "CN=$guid,CN=Policies,CN=System,$domainDN"
  try {
    $policyPath = "\\$adServer\sysvol\$domain\Policies\$guid"
    if (-not (Test-Path -LiteralPath $policyPath)) { throw "SYSVOL_FAILED: $policyPath" }
    $scriptsPath = Join-Path $policyPath 'Machine\Scripts'
    $scriptsIni = Join-Path $scriptsPath 'scripts.ini'
    $ownerPath = Join-Path $scriptsPath 'addeploymanager-startup.json'
    $lines = if (Test-Path -LiteralPath $scriptsIni) { @(Get-Content -LiteralPath $scriptsIni) } else { @() }
    $ext = [string](Get-LdapValue $entry 'gPCMachineExtensionNames')
    $owner = $null
    if (Test-Path -LiteralPath $ownerPath) {
      $owner = Get-Content -LiteralPath $ownerPath -Raw | ConvertFrom-Json
      Assert-OwnedStartup $owner $lines $guid
    }
    if ($remove -and $null -eq $owner) { throw 'GPO_OWNERSHIP_FAILED: No ownership record; legacy scripts require manual review' }
    $gptIni = Join-Path $policyPath 'gpt.ini'
    $update = Get-GptUpdate $gptIni $entry
    if ($null -ne $owner) { $index = [int]$owner.Index }
    else {
      $indices = @(Get-IniEntries $lines 'Startup' | ForEach-Object { $_.Index })
      $index = if ($indices.Count) { [int]($indices | Measure-Object -Maximum).Maximum + 1 } else { 0 }
    }
    $parameters = '-ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $scriptPath + '"'
    $newLines = @(Update-StartupLines $lines $index $parameters $remove)
    if ($remove) {
      $otherScripts = @(Get-IniEntries $newLines 'Startup') + @(Get-IniEntries $newLines 'Shutdown')
      $psIni = Join-Path $scriptsPath 'psscripts.ini'
      if ($otherScripts.Count -eq 0 -and -not (Test-Path -LiteralPath $psIni)) {
        $newExt = Remove-OwnedScriptExtension $ext ([string]$owner.OriginalExtension)
      } else { $newExt = $ext }
    } else {
      $newExt = Merge-ScriptExtension $ext
      if ($null -eq $owner) {
        $owner = [pscustomobject]@{ Schema = 1; GpoGuid = $guid; Index = $index; Parameters = $parameters; OriginalExtension = $ext }
      } else { $owner.Parameters = $parameters }
    }
    # Snapshot only files touched by this operation; restore if LDAP/file write fails.
    $snapshots = @{}
    foreach ($file in @($scriptsIni, $gptIni, $ownerPath)) {
      $snapshots[$file] = if (Test-Path -LiteralPath $file) { ,[IO.File]::ReadAllBytes($file) } else { $null }
    }
    $oldVersion = Get-LdapValue $entry 'versionNumber'
    $commitAttempted = $false
    try {
      [void][IO.Directory]::CreateDirectory($scriptsPath)
      Set-Content -LiteralPath $scriptsIni -Value $newLines -Encoding Unicode -Force
      Set-Content -LiteralPath $gptIni -Value $update.Lines -Encoding ASCII -Force
      if ($remove) { Remove-Item -LiteralPath $ownerPath -Force }
      else { $owner | ConvertTo-Json -Compress | Set-Content -LiteralPath $ownerPath -Encoding UTF8 -Force }
      Set-LdapValue $entry 'gPCMachineExtensionNames' $newExt
      Set-LdapValue $entry 'versionNumber' $update.SignedVersion
      $commitAttempted = $true
      $entry.CommitChanges()
    } catch {
      $failure = $_
      $rollbackErrors = [System.Collections.Generic.List[string]]::new()
      foreach ($file in $snapshots.Keys) {
        try {
          if ($null -eq $snapshots[$file]) { if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force } }
          else { [IO.File]::WriteAllBytes($file, [byte[]]$snapshots[$file]) }
        } catch { $rollbackErrors.Add($_.Exception.Message) }
      }
      if ($commitAttempted) {
        try {
          $entry.RefreshCache()
          Set-LdapValue $entry 'gPCMachineExtensionNames' $ext
          Set-LdapValue $entry 'versionNumber' $oldVersion
          $entry.CommitChanges()
        } catch { $rollbackErrors.Add($_.Exception.Message) }
      }
      if ($rollbackErrors.Count) { throw "GPO_WRITE_FAILED: $($failure.Exception.Message); rollback incomplete: $($rollbackErrors -join '; ')" }
      throw $failure
    }
  } finally { $entry.Dispose() }
}
`;

module.exports = { gpoScriptHelpers };
