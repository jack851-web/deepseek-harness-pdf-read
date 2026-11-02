#Requires -Version 5.1
<#
.SYNOPSIS
  Install dsh-file-toolkit into the current DSH desktop profile.
.DESCRIPTION
  Copies the plugin into the profile's node_modules, adds it to the profile
  package.json (dependencies + dsh.profile.bundles) and removes the two
  predecessor plugins (dsh-pdf-native, dsh-copy-path) when they are present.
#>
[CmdletBinding()]
param(
    [string]$ProfileDir = (Join-Path $env:USERPROFILE '.dsh\profiles\desktop')
)

$ErrorActionPreference = 'Stop'
$source = $PSScriptRoot
$profileJson = Join-Path $ProfileDir 'package.json'

if (-not (Test-Path -LiteralPath $profileJson)) {
    throw "profile package.json not found: $profileJson"
}
if (-not (Test-Path -LiteralPath (Join-Path $source 'lib\client.js'))) {
    throw "plugin files missing next to this script: $source"
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = "$profileJson.bak-$stamp"
Copy-Item -LiteralPath $profileJson -Destination $backup -Force
Write-Host "backup: $backup"

$target = Join-Path $ProfileDir 'node_modules\dsh-file-toolkit'
if (Test-Path -LiteralPath $target) {
    Remove-Item -LiteralPath $target -Recurse -Force
}
New-Item -ItemType Directory -Path $target -Force | Out-Null
Copy-Item -Path (Join-Path $source '*') -Destination $target -Recurse -Force
Write-Host "copied to: $target"

$raw = Get-Content -LiteralPath $profileJson -Raw -Encoding utf8
$pkg = $raw | ConvertFrom-Json

$deps = [ordered]@{}
foreach ($p in $pkg.dependencies.PSObject.Properties) {
    if ($p.Name -ne 'dsh-pdf-native' -and $p.Name -ne 'dsh-copy-path') { $deps[$p.Name] = $p.Value }
}
$deps['dsh-file-toolkit'] = "file:$($source -replace '\\', '/')"
$pkg.dependencies = [pscustomobject]$deps

$bundles = @()
if ($pkg.dsh -and $pkg.dsh.profile -and $pkg.dsh.profile.bundles) {
    $bundles = @($pkg.dsh.profile.bundles) | Where-Object { $_ -ne 'dsh-pdf-native' -and $_ -ne 'dsh-copy-path' }
}
if ($bundles -notcontains 'dsh-file-toolkit') { $bundles += 'dsh-file-toolkit' }
$pkg.dsh.profile.bundles = $bundles

$json = $pkg | ConvertTo-Json -Depth 30
[System.IO.File]::WriteAllText($profileJson, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "registered in: $profileJson"

foreach ($old in @('dsh-pdf-native', 'dsh-copy-path')) {
    $oldDir = Join-Path $ProfileDir "node_modules\$old"
    if (Test-Path -LiteralPath $oldDir) {
        Remove-Item -LiteralPath $oldDir -Recurse -Force
        Write-Host "removed predecessor: $old"
    }
}

Write-Host ''
Write-Host 'Done. Fully quit and restart DSH.'
Write-Host "Rollback: powershell -File '$source\uninstall.ps1'"
