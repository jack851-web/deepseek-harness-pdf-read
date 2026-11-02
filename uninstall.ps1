#Requires -Version 5.1
<#
.SYNOPSIS
  Remove dsh-pdf-native from the DSH desktop profile.
#>
[CmdletBinding()]
param(
    [string]$ProfileDir = (Join-Path $env:USERPROFILE '.dsh\profiles\desktop')
)

$ErrorActionPreference = 'Stop'
$profileJson = Join-Path $ProfileDir 'package.json'
if (-not (Test-Path -LiteralPath $profileJson)) {
    throw "profile package.json not found: $profileJson"
}

$raw = Get-Content -LiteralPath $profileJson -Raw -Encoding utf8
try { $pkg = $raw | ConvertFrom-Json } catch { throw "profile package.json is not valid JSON: $($_.Exception.Message)" }

if ($pkg.dependencies) {
    $deps = @{}
    foreach ($p in $pkg.dependencies.PSObject.Properties) {
        if ($p.Name -ne 'dsh-pdf-native') { $deps[$p.Name] = $p.Value }
    }
    $pkg.dependencies = [pscustomobject]$deps
}
if ($pkg.dsh -and $pkg.dsh.profile -and $pkg.dsh.profile.bundles) {
    $pkg.dsh.profile.bundles = @($pkg.dsh.profile.bundles) | Where-Object { $_ -ne 'dsh-pdf-native' }
}

$json = $pkg | ConvertTo-Json -Depth 30
[System.IO.File]::WriteAllText($profileJson, $json, (New-Object System.Text.UTF8Encoding($false)))

$target = Join-Path $ProfileDir 'node_modules\dsh-pdf-native'
if (Test-Path -LiteralPath $target) {
    Remove-Item -LiteralPath $target -Recurse -Force
}

Write-Host 'Removed dsh-pdf-native. Restart DSH to return to the builtin pdf.js renderer.'
