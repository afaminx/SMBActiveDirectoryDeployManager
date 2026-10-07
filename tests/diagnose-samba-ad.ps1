param([Parameter(Mandatory=$true)][string]$Server, [string]$BaseOU = "", [string]$GpoGuid = "")
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.DirectoryServices
function New-LdapEntry([string]$dn) {
  $entry = [System.DirectoryServices.DirectoryEntry]::new("LDAP://$adServer/$dn")
  $entry.AuthenticationType = [System.DirectoryServices.AuthenticationTypes]::Secure
  try { $entry.RefreshCache(); return ,$entry }
  catch { $entry.Dispose(); throw "LDAP_BIND_FAILED: $dn - $($_.Exception.Message)" }
}
function Get-LdapValue($entry, [string]$name) {
  if ($entry.Properties[$name].Count -gt 0) { return $entry.Properties[$name][0] }
  return $null
}
function Set-LdapValue($entry, [string]$name, $value) {
  if ($null -eq $value -or [string]$value -eq '') { $entry.Properties[$name].Clear() }
  else { $entry.Properties[$name].Value = $value }
}
function Get-LdapOUs([string]$base = $domainDN) {
  $entry = New-LdapEntry $base
  $searcher = [System.DirectoryServices.DirectorySearcher]::new($entry)
  $results = $null
  try {
    $searcher.Filter = '(objectClass=organizationalUnit)'
    $searcher.SearchScope = [System.DirectoryServices.SearchScope]::Subtree
    $searcher.PageSize = 1000
    $searcher.ReferralChasing = [System.DirectoryServices.ReferralChasingOption]::None
    foreach ($name in @('name','distinguishedName','description','gPLink')) { [void]$searcher.PropertiesToLoad.Add($name) }
    $results = $searcher.FindAll()
    foreach ($result in $results) {
      [pscustomobject]@{
        Name = [string]$result.Properties['name'][0]
        DistinguishedName = [string]$result.Properties['distinguishedname'][0]
        Description = [string]$result.Properties['description'][0]
        gPLink = [string]$result.Properties['gplink'][0]
      }
    }
  } finally {
    if ($null -ne $results) { $results.Dispose() }
    $searcher.Dispose(); $entry.Dispose()
  }
}
function Get-LdapOU([string]$dn) {
  $entry = New-LdapEntry $dn
  try {
    if (@($entry.Properties['objectClass']) -notcontains 'organizationalUnit') { throw "Not an OU: $dn" }
    [pscustomobject]@{
      Name = [string](Get-LdapValue $entry 'name')
      DistinguishedName = [string](Get-LdapValue $entry 'distinguishedName')
      Description = [string](Get-LdapValue $entry 'description')
      gPLink = [string](Get-LdapValue $entry 'gPLink')
    }
  } finally { $entry.Dispose() }
}

$adServer = $Server

  if (-not $adServer) { throw 'DC_DISCOVERY_FAILED: No Domain Controller returned' }
  try { [void][System.Net.Dns]::GetHostAddresses($adServer) }
  catch { throw "DC_DNS_FAILED: $adServer - $($_.Exception.Message)" }
  $rootDse = New-LdapEntry 'RootDSE'
  try { $domainDN = [string](Get-LdapValue $rootDse 'defaultNamingContext') }
  finally { $rootDse.Dispose() }
  if ($domainDN -notmatch '^(?i:DC=[^,]+)(,DC=[^,]+)*$') { throw 'ROOTDSE_FAILED: Invalid defaultNamingContext' }
  $domain = (($domainDN -split ',') | ForEach-Object { $_.Substring(3) }) -join '.'

Write-Output "LDAP server: $adServer"
Write-Output "Naming context: $domainDN"
Write-Output "DNS domain: $domain"
if ($BaseOU) { $ous = @(Get-LdapOUs $BaseOU) } else { $ous = @(Get-LdapOUs) }
Write-Output "OU count: $($ous.Count)"
$ous | Select-Object Name,DistinguishedName,Description,gPLink | Format-List
if (-not (Get-Module -ListAvailable -Name GroupPolicy)) { throw 'GROUPPOLICY_UNAVAILABLE: Install RSAT Group Policy Management' }
Import-Module GroupPolicy -ErrorAction Stop
$gpos = @(Get-GPO -All -Domain $domain -Server $adServer -ErrorAction Stop)
Write-Output "GPO count: $($gpos.Count)"
$gpos | Select-Object DisplayName,Id | Format-Table -AutoSize
$sysvol = "\\$adServer\SYSVOL\$domain\Policies"
if (-not (Test-Path -LiteralPath $sysvol)) { throw "SYSVOL_FAILED: $sysvol" }
Write-Output "SYSVOL accessible: $sysvol"
if ($GpoGuid) {
  $guid = '{' + ([guid]$GpoGuid).ToString() + '}'
  $entry = New-LdapEntry "CN=$guid,CN=Policies,CN=System,$domainDN"
  try {
    foreach ($name in @('displayName','gPCMachineExtensionNames','versionNumber','gPCFileSysPath')) {
      Write-Output ("{0}: {1}" -f $name, (Get-LdapValue $entry $name))
    }
  } finally { $entry.Dispose() }
  foreach ($relative in @('gpt.ini','Machine\Scripts\scripts.ini','Machine\Scripts\addeploymanager-startup.json')) {
    $file = Join-Path (Join-Path $sysvol $guid) $relative
    if (Test-Path -LiteralPath $file) { Write-Output $file; Get-Content -LiteralPath $file }
  }
}
Write-Output 'Read-only diagnostics passed'
