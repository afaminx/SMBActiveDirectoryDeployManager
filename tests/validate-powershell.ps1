param([Parameter(Mandatory=$true)][string]$Directory)
$ErrorActionPreference = 'Stop'
$files = @(Get-ChildItem -LiteralPath $Directory -Filter 'operation-*.ps1')
foreach ($file in $files) {
  $tokens = $null; $errors = $null
  [void][Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$tokens, [ref]$errors)
  if ($errors.Count) { throw "$($file.Name): $($errors -join '; ')" }
}
Write-Output "$($files.Count) scripts parsed"
