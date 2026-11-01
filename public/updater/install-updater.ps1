<#
  Registers the Vektra updater helper with Chrome, for the current Windows
  user only (no admin rights needed), so Vektra can install its updates
  itself. Run it once from the updater folder inside your Vektra folder;
  install-updater.bat does that on a double-click.

  install-updater.ps1             register the helper
  install-updater.ps1 -Uninstall  remove it again
#>
param([switch]$Uninstall)

$ErrorActionPreference = 'Stop'

$HostName = 'com.vektra.updater'
$RegistryKey = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName"
$HostManifest = Join-Path $PSScriptRoot "$HostName.json"

if ($Uninstall) {
  if (Test-Path $RegistryKey) { Remove-Item -Path $RegistryKey -Force }
  if (Test-Path $HostManifest) { Remove-Item -Path $HostManifest -Force }
  Write-Host 'The Vektra updater is removed. Vektra will show a download link for new versions instead.'
  exit 0
}

# Chrome derives the extension ID from the key in Vektra's manifest: the first
# 32 hex digits of its SHA-256, written with the letters a-p.
$manifest = Get-Content -Raw -Path (Join-Path (Split-Path -Parent $PSScriptRoot) 'manifest.json') | ConvertFrom-Json
if (-not $manifest.key) { throw 'This Vektra folder has no extension key; download a newer release.' }
$sha = [Security.Cryptography.SHA256]::Create()
$hash = $sha.ComputeHash([Convert]::FromBase64String($manifest.key))
$id = -join ($hash[0..15] | ForEach-Object { [char](97 + ($_ -shr 4)); [char](97 + ($_ -band 15)) })

$hostConfig = [ordered]@{
  name = $HostName
  description = 'Installs Vektra updates from its GitHub releases'
  path = 'vektra-updater.bat'
  type = 'stdio'
  allowed_origins = @("chrome-extension://$id/")
}
Set-Content -Path $HostManifest -Value ($hostConfig | ConvertTo-Json) -Encoding ASCII
New-Item -Path $RegistryKey -Force | Out-Null
Set-ItemProperty -Path $RegistryKey -Name '(Default)' -Value $HostManifest

Write-Host "The Vektra updater is installed for extension $id."
Write-Host 'Vektra can now update itself. Keep this Vektra folder where it is; run this again if you move it.'
