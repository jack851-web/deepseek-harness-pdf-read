#Requires -Version 5.1
<#
.SYNOPSIS
  Remove dsh-file-toolkit from the DSH desktop profile.
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
    $deps = [ordered]@{}
    foreach ($p in $pkg.dependencies.PSObject.Properties) {
        if ($p.Name -ne 'dsh-file-toolkit') { $deps[$p.Name] = $p.Value }
    }
    $pkg.dependencies = [pscustomobject]$deps
}
if ($pkg.dsh -and $pkg.dsh.profile -and $pkg.dsh.profile.bundles) {
    $pkg.dsh.profile.bundles = @($pkg.dsh.profile.bundles) | Where-Object { $_ -ne 'dsh-file-toolkit' }
}

$json = $pkg | ConvertTo-Json -Depth 30
[System.IO.File]::WriteAllText($profileJson, $json, (New-Object System.Text.UTF8Encoding($false)))

$target = Join-Path $ProfileDir 'node_modules\dsh-file-toolkit'
if (Test-Path -LiteralPath $target) {
    Remove-Item -LiteralPath $target -Recurse -Force
}

Write-Host 'Removed dsh-file-toolkit. Restart DSH to unload it.'
