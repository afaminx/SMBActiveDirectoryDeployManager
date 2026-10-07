// Preserve display names as PowerShell literals. Legacy lookup repairs pre-1.8 naming.
const gpoNameHelpers = String.raw`
function Resolve-DeploymentGpo([string]$Name, $AllGpos = $null) {
  $all = $AllGpos
  if ($null -eq $all) { $all = @(Get-GPO -All -Domain $domain -Server $adServer -ErrorAction Stop) }
  $match = @($all | Where-Object { $_.DisplayName -ieq $Name })
  if ($match.Count -gt 1) { throw "AMBIGUOUS_GPO_NAME: $Name" }
  if ($match.Count -eq 1) { return $match[0] }
  $legacy = ([regex]::Replace($Name, '[^a-zA-Z0-9\s\-_.,=@]', '')).Trim()
  if ($legacy -and $legacy -ine $Name) {
    $owners = @(@($configuredGpoNames) + @($Name) | Where-Object {
      (([regex]::Replace($_, '[^a-zA-Z0-9\s\-_.,=@]', '')).Trim()) -ieq $legacy
    } | ForEach-Object { $_.ToLower() } | Sort-Object -Unique)
    if ($owners.Count -gt 1) { throw "AMBIGUOUS_GPO_NAME: Multiple configured names reduce to $legacy" }
    $match = @($all | Where-Object { $_.DisplayName -ieq $legacy })
    if ($match.Count -gt 1) { throw "AMBIGUOUS_GPO_NAME: $Name" }
    if ($match.Count -eq 1) { return $match[0] }
  }
  return $null
}
function Get-DeploymentGpoName([string]$Name) {
  $gpo = Resolve-DeploymentGpo $Name
  if (-not $gpo) { throw "NOT_FOUND: GPO $Name" }
  return $gpo.DisplayName
}
`;
function quoteGpoName(name) {
  if (typeof name !== 'string' || !name.trim() || /[\x00-\x1f\x7f]/.test(name)) throw Error('INVALID_GPO_NAME: A nonempty display name without control characters is required');
  return name.trim().replace(/'/g, "''");
}
module.exports = { gpoNameHelpers, quoteGpoName };
