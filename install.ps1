#Requires -Version 5.1
<#
.SYNOPSIS
  Install dsh-pdf-native into the current DSH desktop profile.
.DESCRIPTION
  Copies the plugin into the profile's node_modules and adds it to the profile
  package.json (dependencies + dsh.profile.bundles). Backs up package.json
  first. The DSH app must be restarted afterwards to load the plugin.
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

$target = Join-Path $ProfileDir 'node_modules\dsh-pdf-native'
if (Test-Path -LiteralPath $target) {
    Remove-Item -LiteralPath $target -Recurse -Force
}
New-Item -ItemType Directory -Path $target -Force | Out-Null
Copy-Item -Path (Join-Path $source '*') -Destination $target -Recurse -Force
Write-Host "copied to: $target"

$raw = Get-Content -LiteralPath $profileJson -Raw -Encoding utf8
$pkg = $raw | ConvertFrom-Json
if ($null -eq $pkg.dependencies) {
    $pkg | Add-Member -NotePropertyName dependencies -NotePropertyValue ([pscustomobject]@{})
}
$deps = @{}
foreach ($p in $pkg.dependencies.PSObject.Properties) { $deps[$p.Name] = $p.Value }
$deps['dsh-pdf-native'] = "file:$($source -replace '\\', '/')"
$pkg.dependencies = [pscustomobject]$deps

$bundles = @()
if ($pkg.dsh -and $pkg.dsh.profile -and $pkg.dsh.profile.bundles) {
    $bundles = @($pkg.dsh.profile.bundles)
}
if ($bundles -notcontains 'dsh-pdf-native') { $bundles += 'dsh-pdf-native' }
$pkg.dsh.profile.bundles = $bundles

$json = $pkg | ConvertTo-Json -Depth 30
[System.IO.File]::WriteAllText($profileJson, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "registered in: $profileJson"
Write-Host ''
Write-Host 'Done. Fully quit and restart DSH, then open a PDF in the right sidebar.'
Write-Host "Rollback: powershell -File '$source\uninstall.ps1'"
