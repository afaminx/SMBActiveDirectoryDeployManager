// WinGet execution context is explicit. Never invoke its CLI as LocalSystem.
const crypto = require('crypto');
function normalize(cfg) {
  const id = String(cfg.wingetId || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9.+_-]*$/.test(id)) throw Error('A valid WinGet package ID is required');
  const source = cfg.wingetSource || 'winget';
  if (!['winget', 'msstore'].includes(source)) throw Error('Unsupported WinGet source');
  const scope = cfg.wingetScope || (source === 'msstore' || id === 'Spotify.Spotify' ? 'user' : 'machine');
  if (!['user', 'machine'].includes(scope)) throw Error('Select a WinGet installation scope');
  if (source === 'msstore' && scope !== 'user') throw Error('Microsoft Store packages require user scope in this deployment workflow');
  return { id, source, scope, repair: cfg.wingetRepair === true, name: cfg.name || id, version: cfg.version || '1.0.0', action: 'install' };
}
function generate(cfg, action = 'install', loggingRuntime = '') {
  const data = { ...normalize(cfg), action };
  data.key = crypto.createHash('sha256').update(`${data.id}|${data.source}|${data.scope}`).digest('hex').slice(0, 20);
  const encoded = Buffer.from(JSON.stringify(data)).toString('base64');
  return String.raw`# Package ID: ${data.id}
# WinGet deployment: explicit scope, mod-rev-2.1
$ErrorActionPreference = 'Stop'
$cfg = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')) | ConvertFrom-Json
${loggingRuntime}
$IsSystem = ([Security.Principal.WindowsIdentity]::GetCurrent().User.Value -eq 'S-1-5-18')
$LogDir = if ($IsSystem) { Join-Path $env:ProgramData 'AppDeploy_Logs' } else { Join-Path $env:LOCALAPPDATA 'ADDeployManager' }
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
$TrackerFile = Join-Path $LogDir ('Tracker_' + $cfg.key + '.json')
Start-Transcript -Path (Join-Path $LogDir ('WinGet_' + $cfg.key + '.log')) -Append -ErrorAction SilentlyContinue | Out-Null
function Save-WinGetResult($Result, $Message) {
    @{ generatorRevision='mod-rev-2.1'; version=$cfg.version; result=$Result; error=$Message; wingetId=$cfg.id; scope=$cfg.scope; action=$cfg.action; user=$env:USERNAME; computer=$env:COMPUTERNAME; timestamp=(Get-Date).ToString('o') } |
        ConvertTo-Json | Set-Content -LiteralPath $TrackerFile -Encoding UTF8 -Force
    try {
        if (Get-Command Send-AppDeployLog -ErrorAction SilentlyContinue) {
            $level = if ($Result -eq 'failed') { 'error' } else { 'info' }
            $event = if ($Result -eq 'scheduled') { 'install_pending' } elseif ($Result -eq 'failed') { $cfg.action + '_failed' } else { $cfg.action + '_success' }
            Send-AppDeployLog -Level $level -Source $cfg.action -Message $event -Context @{ appName=$cfg.name; version=$cfg.version; result=$Result; scope=$cfg.scope; user=$env:USERNAME; error=$Message }
        }
    } catch { }
}
$CurrentTracker = $null
if (Test-Path -LiteralPath $TrackerFile) { try { $CurrentTracker = Get-Content -LiteralPath $TrackerFile -Raw | ConvertFrom-Json } catch {} }
$AlreadyProcessed = $CurrentTracker -and $CurrentTracker.generatorRevision -eq 'mod-rev-2.1' -and $CurrentTracker.version -eq $cfg.version -and $CurrentTracker.action -eq $cfg.action -and $CurrentTracker.result -in @('success','removed')
try {
    if ($cfg.scope -eq 'user' -and $IsSystem) {
        # Keep this task for subsequent users. Their trackers and package checks are independent.
        $taskName = 'ADDM_WinGet_' + $cfg.key
        $taskRoot = Join-Path $env:ProgramData ('ADDeployManager\Tasks\' + $cfg.key)
        New-Item -ItemType Directory -Path $taskRoot -Force | Out-Null
        $acl = New-Object Security.AccessControl.DirectorySecurity
        $acl.SetAccessRuleProtection($true, $false)
        foreach ($sid in @('S-1-5-18', 'S-1-5-32-544', 'S-1-5-32-545')) {
            $rights = if ($sid -eq 'S-1-5-32-545') { 'ReadAndExecute' } else { 'FullControl' }
            $identity = New-Object Security.Principal.SecurityIdentifier($sid)
            $rule = New-Object Security.AccessControl.FileSystemAccessRule($identity, $rights, 'ContainerInherit,ObjectInherit', 'None', 'Allow')
            $acl.AddAccessRule($rule)
        }
        Set-Acl -LiteralPath $taskRoot -AclObject $acl
        if ($ADDMLoggingConfigPath -and (Test-Path -LiteralPath $ADDMLoggingConfigPath)) {
            $loggingRoot = Join-Path $taskRoot 'ADDeploy'
            New-Item -ItemType Directory -Path $loggingRoot -Force | Out-Null
            Copy-Item -LiteralPath $ADDMLoggingConfigPath -Destination (Join-Path $loggingRoot 'logging-config.json') -Force
        }
        $localScript = Join-Path $taskRoot 'deploy.ps1'
        Copy-Item -LiteralPath $PSCommandPath -Destination $localScript -Force
        $action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $localScript + '"')
        $trigger = New-ScheduledTaskTrigger -AtLogOn
        $principal = New-ScheduledTaskPrincipal -GroupId "S-1-5-4" -RunLevel Limited
        $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -MultipleInstances Parallel -StartWhenAvailable
        Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'WinGet deployment for each signed-in user' -Force -ErrorAction Stop | Out-Null
        Save-WinGetResult 'scheduled' 'Waiting for user sign-in'
        Write-Host 'PENDING: Waiting for user sign-in'
        Stop-Transcript -ErrorAction SilentlyContinue | Out-Null
        exit 60001
    }
    if ($cfg.scope -eq 'machine') {
        if (-not $IsSystem -and -not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Computer-wide installation requires administrator permissions' }
        # Microsoft.WinGet.Client requires PowerShell 7 in SYSTEM context; use MTA.
        if ($PSVersionTable.PSVersion.Major -lt 7 -or [Threading.Thread]::CurrentThread.GetApartmentState() -ne 'MTA') {
            $pwsh = Join-Path $env:ProgramFiles 'PowerShell\7\pwsh.exe'
            if (-not (Test-Path -LiteralPath $pwsh)) { throw 'PowerShell 7 is required for computer-wide WinGet deployment. Install it on the client first.' }
            & $pwsh -NoProfile -NonInteractive -MTA -ExecutionPolicy Bypass -File $PSCommandPath
            $childCode = $LASTEXITCODE
            Stop-Transcript -ErrorAction SilentlyContinue | Out-Null
            exit $childCode
        }
        if (-not (Get-Module -ListAvailable Microsoft.WinGet.Client)) {
            if (-not $cfg.repair) { throw 'Microsoft.WinGet.Client is missing. Install it for all users or enable WinGet prerequisite repair.' }
            Install-Module Microsoft.WinGet.Client -Repository PSGallery -Scope AllUsers -Force -ErrorAction Stop
        }
        Import-Module Microsoft.WinGet.Client -ErrorAction Stop
        try { Get-WinGetVersion -ErrorAction Stop | Out-Null } catch {
            if (-not $cfg.repair) { throw 'WinGet is unavailable. Enable prerequisite repair or repair the client manually.' }
            Repair-WinGetPackageManager -Latest -Force -ErrorAction Stop | Out-Null
        }
        $installed = @(Get-WinGetPackage -Id $cfg.id -Source $cfg.source -MatchOption EqualsCaseInsensitive -ErrorAction Stop | Where-Object { $_.Id -eq $cfg.id })
        if ($cfg.action -eq 'uninstall') {
            if ($installed.Count) {
                $result = Uninstall-WinGetPackage -Id $cfg.id -Source $cfg.source -MatchOption EqualsCaseInsensitive -Mode Silent -ErrorAction Stop
                if ($result.Status -ne 'Ok') { throw ('WinGet uninstall failed: ' + $result.Status + '; ' + $result.InstallerErrorCode) }
            }
        } elseif (-not $installed.Count) {
            $result = Install-WinGetPackage -Id $cfg.id -Source $cfg.source -MatchOption EqualsCaseInsensitive -Scope System -Mode Silent -ErrorAction Stop
            if ($result.Status -ne 'Ok') { throw ('WinGet installation failed: ' + $result.Status + '; ' + $result.InstallerErrorCode) }
        } elseif (-not $AlreadyProcessed -and ($installed | Where-Object IsUpdateAvailable)) {
            $result = Update-WinGetPackage -Id $cfg.id -Source $cfg.source -MatchOption EqualsCaseInsensitive -Scope System -Mode Silent -ErrorAction Stop
            if ($result.Status -ne 'Ok') { throw ('WinGet update failed: ' + $result.Status + '; ' + $result.InstallerErrorCode) }
        }
        $verified = @(Get-WinGetPackage -Id $cfg.id -Source $cfg.source -MatchOption EqualsCaseInsensitive -ErrorAction Stop | Where-Object { $_.Id -eq $cfg.id }).Count -gt 0
    } else {
        $winget = (Get-Command winget.exe -ErrorAction SilentlyContinue).Source
        if (-not $winget -and $cfg.repair) {
            if (-not (Get-Module -ListAvailable Microsoft.WinGet.Client)) { Install-Module Microsoft.WinGet.Client -Repository PSGallery -Scope CurrentUser -Force -ErrorAction Stop }
            Import-Module Microsoft.WinGet.Client -ErrorAction Stop
            Repair-WinGetPackageManager -Latest -ErrorAction Stop | Out-Null
            $winget = (Get-Command winget.exe -ErrorAction SilentlyContinue).Source
        }
        if (-not $winget) { throw 'WinGet is missing for this user. Install/register App Installer or enable prerequisite repair.' }
        function Test-UserPackage {
            $output = & $winget list --id $cfg.id --source $cfg.source --exact --scope user --accept-source-agreements --disable-interactivity 2>&1 | Out-String
            return ($LASTEXITCODE -eq 0 -and $output -match [regex]::Escape($cfg.id))
        }
        $present = Test-UserPackage
        if (($cfg.action -eq 'install' -and (-not $present -or -not $AlreadyProcessed)) -or ($cfg.action -eq 'uninstall' -and $present)) {
            $args = @($cfg.action, '--id', $cfg.id, '--source', $cfg.source, '--exact', '--scope', 'user', '--silent', '--accept-source-agreements', '--disable-interactivity')
            if ($cfg.action -eq 'install') { $args += '--accept-package-agreements' }
            & $winget @args
            $ec = $LASTEXITCODE
            if ($ec -notin @(0,3010,1641,-1978335212,-1978335189,-1978335140)) { throw "WinGet failed with exit code $ec" }
        }
        $verified = Test-UserPackage
    }
    if (($cfg.action -eq 'install' -and -not $verified) -or ($cfg.action -eq 'uninstall' -and $verified)) { throw 'WinGet operation completed but the requested package state could not be verified' }
    $state = if ($cfg.action -eq 'install') { 'success' } else { 'removed' }
    Save-WinGetResult $state ''
    Write-Host ('OK: ' + $cfg.name + ' (' + $cfg.scope + ', ' + $cfg.action + ')')
    Stop-Transcript -ErrorAction SilentlyContinue | Out-Null
    exit 0
} catch {
    Save-WinGetResult 'failed' $_.ToString()
    Write-Host ('ERROR: ' + $_.ToString())
    Stop-Transcript -ErrorAction SilentlyContinue | Out-Null
    exit 1
}
`;
}
module.exports = { generate, normalize };
