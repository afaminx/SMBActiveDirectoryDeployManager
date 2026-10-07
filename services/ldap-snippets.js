// Shared PowerShell LDAP implementation; uses Windows credentials, never ADWS.
const ldapHelpers = String.raw`
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
`;

function dcSnippet(preferredDC) {
  const server = typeof preferredDC === 'string' ? preferredDC.trim() : '';
  if (server && !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(server)) {
    throw new Error('INVALID_DC: Domain Controller must be a hostname');
  }
  const discovery = server ? `$adServer = '${server}'` : String.raw`
  $discoveryDomain = $null; $controller = $null
  try {
    $discoveryDomain = [System.DirectoryServices.ActiveDirectory.Domain]::GetComputerDomain()
    $controller = $discoveryDomain.PdcRoleOwner
    $adServer = $controller.Name
  } catch { throw "DC_DISCOVERY_FAILED: Configure a Domain Controller explicitly. $($_.Exception.Message)" }
  finally {
    if ($null -ne $controller) { $controller.Dispose() }
    if ($null -ne $discoveryDomain) { $discoveryDomain.Dispose() }
  }`;
  return `${ldapHelpers}\n${discovery}\n` + String.raw`
  if (-not $adServer) { throw 'DC_DISCOVERY_FAILED: No Domain Controller returned' }
  try { [void][System.Net.Dns]::GetHostAddresses($adServer) }
  catch { throw "DC_DNS_FAILED: $adServer - $($_.Exception.Message)" }
  $rootDse = New-LdapEntry 'RootDSE'
  try { $domainDN = [string](Get-LdapValue $rootDse 'defaultNamingContext') }
  finally { $rootDse.Dispose() }
  if ($domainDN -notmatch '^(?i:DC=[^,]+)(,DC=[^,]+)*$') { throw 'ROOTDSE_FAILED: Invalid defaultNamingContext' }
  $domain = (($domainDN -split ',') | ForEach-Object { $_.Substring(3) }) -join '.'
`;
}

module.exports = { dcSnippet, ldapHelpers };
