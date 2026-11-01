<#
  Vektra updater helper.

  Chrome doesn't let an extension change its own files, so this script does
  it: it installs the latest Vektra release from GitHub over the folder it
  lives in (the parent of this updater folder). Vektra talks to it through
  Chrome's native messaging once install-updater.ps1 has registered it.

  Native messaging (started by Chrome through vektra-updater.bat):
    {"type":"ping"}    -> {"ok":true,"version":"<installed version>"}
    {"type":"update"}  -> {"ok":true,"updated":true|false,"version":"..."}
                          or {"ok":false,"error":"..."}

  By hand, to install a local release zip (for testing):
    powershell -ExecutionPolicy Bypass -File vektra-updater.ps1 -ZipPath vektra-0.2.0.zip [-ShaPath vektra-0.2.0.zip.sha256]

  Nothing but the reply may be written to standard output: Chrome reads it as
  the answer. Progress goes to update.log next to this script.
#>

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Repo = 'Filiposakkq/Vektra'
$ExtDir = Split-Path -Parent $PSScriptRoot
$LogFile = Join-Path $PSScriptRoot 'update.log'
$LeftoversFile = Join-Path $PSScriptRoot 'leftovers.txt'
$LockFile = Join-Path $PSScriptRoot 'update.lock'
# Written here by the installer or this script, not part of a release.
$LocalFiles = @('updater/update.log', 'updater/leftovers.txt', 'updater/update.lock', 'updater/com.vektra.updater.json')

function Write-Log([string]$Text) {
  try { Add-Content -Path $LogFile -Value "$(Get-Date -Format s) $Text" -Encoding UTF8 } catch { }
}

<#
  One update at a time: two browsers running Vektra from this folder may both
  find a new release at once. The second waits for the first, then finds
  Vektra up to date. Windows releases the lock if this script dies.
#>
function Lock-Update {
  $deadline = (Get-Date).AddMinutes(2)
  while ($true) {
    try {
      return [IO.File]::Open($LockFile, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    } catch [IO.IOException] {
      if ((Get-Date) -gt $deadline) { throw 'Another Vektra update is still running.' }
      Start-Sleep -Milliseconds 250
    }
  }
}

function Get-ManifestVersion([string]$Dir) {
  $manifest = Get-Content -Raw -Path (Join-Path $Dir 'manifest.json') | ConvertFrom-Json
  return [string]$manifest.version
}

function Get-RelativeFiles([string]$Dir) {
  $root = (Resolve-Path $Dir).Path.TrimEnd('\', '/')
  Get-ChildItem -Path $root -Recurse -File | ForEach-Object {
    $_.FullName.Substring($root.Length + 1).Replace('\', '/')
  }
}

<# Files of the version before the last update; Vektra has reloaded since, so nothing uses them. #>
function Remove-Leftovers {
  if (-not (Test-Path $LeftoversFile)) { return }
  $root = (Resolve-Path $ExtDir).Path.TrimEnd('\', '/')
  foreach ($line in Get-Content $LeftoversFile) {
    if (-not $line -or $line.Contains('..')) { continue }
    $path = Join-Path $root $line
    if (Test-Path -LiteralPath $path -PathType Leaf) { Remove-Item -LiteralPath $path -Force }
  }
  Remove-Item -LiteralPath $LeftoversFile -Force
  # Folders the removed files leave empty.
  Get-ChildItem -Path $root -Recurse -Directory | Sort-Object { $_.FullName.Length } -Descending |
    Where-Object { -not (Get-ChildItem -LiteralPath $_.FullName -Force) } |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }
}

<#
  Copy the unpacked release over the extension folder. Nothing is deleted:
  pages still running the old version keep loading its files until Vektra
  reloads. Files only the old version had are removed on the next update.
  Unchanged files aren't rewritten (vektra-updater.bat is running right now).
#>
function Copy-Release([string]$Staging) {
  $old = @(Get-RelativeFiles $ExtDir | Where-Object { $LocalFiles -notcontains $_ })
  $new = @(Get-RelativeFiles $Staging)
  foreach ($file in $new) {
    $source = Join-Path $Staging $file
    $target = Join-Path $ExtDir $file
    if ((Test-Path -LiteralPath $target) -and
        (Get-FileHash -LiteralPath $source).Hash -eq (Get-FileHash -LiteralPath $target).Hash) { continue }
    $dir = Split-Path -Parent $target
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    Copy-Item -LiteralPath $source -Destination $target -Force
  }
  $leftovers = @($old | Where-Object { $new -notcontains $_ })
  if ($leftovers.Count) { Set-Content -Path $LeftoversFile -Value $leftovers -Encoding UTF8 }
}

<# Install from $Zip after checking it against $Sha (when given); returns the version installed. #>
function Install-Zip([string]$Zip, [string]$Sha, [string]$ExpectedVersion) {
  if ($Sha) {
    $expected = ((Get-Content -Raw -Path $Sha).Trim() -split '\s+')[0]
    $actual = (Get-FileHash -LiteralPath $Zip -Algorithm SHA256).Hash
    if ($actual -ne $expected) { throw "The download is damaged (checksum mismatch)." }
  }
  $staging = Join-Path ([IO.Path]::GetTempPath()) ("vektra-update-" + [Guid]::NewGuid().ToString('N'))
  try {
    Expand-Archive -LiteralPath $Zip -DestinationPath $staging -Force
    $manifest = Get-Content -Raw -Path (Join-Path $staging 'manifest.json') | ConvertFrom-Json
    if ($manifest.name -ne 'Vektra') { throw "The download is not a Vektra release." }
    if ($ExpectedVersion -and $manifest.version -ne $ExpectedVersion) {
      throw "The download is version $($manifest.version), not $ExpectedVersion."
    }
    Copy-Release $staging
    return [string]$manifest.version
  } finally {
    Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Install-Latest {
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  $installed = Get-ManifestVersion $ExtDir
  $release = Invoke-RestMethod -UseBasicParsing -Uri "https://api.github.com/repos/$Repo/releases/latest" `
    -Headers @{ Accept = 'application/vnd.github+json' }
  $version = ([string]$release.tag_name).TrimStart('v')
  if ([version]$version -le [version]$installed) {
    return @{ ok = $true; updated = $false; version = $installed }
  }
  $zipAsset = $release.assets | Where-Object { $_.name -eq "vektra-$version.zip" } | Select-Object -First 1
  $shaAsset = $release.assets | Where-Object { $_.name -eq "vektra-$version.zip.sha256" } | Select-Object -First 1
  if (-not $zipAsset -or -not $shaAsset) { throw "Release $version has no vektra-$version.zip and checksum." }
  $temp = Join-Path ([IO.Path]::GetTempPath()) ("vektra-download-" + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $temp | Out-Null
  try {
    $zip = Join-Path $temp $zipAsset.name
    $sha = Join-Path $temp $shaAsset.name
    Invoke-WebRequest -UseBasicParsing -Uri $zipAsset.browser_download_url -OutFile $zip
    Invoke-WebRequest -UseBasicParsing -Uri $shaAsset.browser_download_url -OutFile $sha
    Remove-Leftovers
    $done = Install-Zip $zip $sha $version
    Write-Log "Updated $installed -> $done"
    return @{ ok = $true; updated = $true; version = $done }
  } finally {
    Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
  }
}

# Native messaging: a 32-bit length, then that many bytes of UTF-8 JSON.
function Read-Message {
  $stdin = [Console]::OpenStandardInput()
  $header = New-Object byte[] 4
  $read = 0
  while ($read -lt 4) {
    $n = $stdin.Read($header, $read, 4 - $read)
    if ($n -le 0) { return $null }
    $read += $n
  }
  $length = [BitConverter]::ToInt32($header, 0)
  $body = New-Object byte[] $length
  $read = 0
  while ($read -lt $length) {
    $n = $stdin.Read($body, $read, $length - $read)
    if ($n -le 0) { return $null }
    $read += $n
  }
  return [Text.Encoding]::UTF8.GetString($body) | ConvertFrom-Json
}

function Write-Message($Reply) {
  $bytes = [Text.Encoding]::UTF8.GetBytes(($Reply | ConvertTo-Json -Compress))
  $stdout = [Console]::OpenStandardOutput()
  $stdout.Write([BitConverter]::GetBytes([int]$bytes.Length), 0, 4)
  $stdout.Write($bytes, 0, $bytes.Length)
  $stdout.Flush()
}

$zipIndex = [Array]::IndexOf($args, '-ZipPath')
if ($zipIndex -ge 0) {
  $shaIndex = [Array]::IndexOf($args, '-ShaPath')
  $zip = (Resolve-Path $args[$zipIndex + 1]).Path
  $sha = if ($shaIndex -ge 0) { (Resolve-Path $args[$shaIndex + 1]).Path } else { '' }
  $lock = Lock-Update
  try {
    Remove-Leftovers
    $version = Install-Zip $zip $sha ''
  } finally {
    $lock.Dispose()
  }
  Write-Log "Installed $version from $zip"
  Write-Output "Installed Vektra $version into $ExtDir"
  exit 0
}

# Started by Chrome: one request, one reply.
$script:Reply = $null
try {
  $message = Read-Message
  if ($null -eq $message) { exit 0 }
  switch ([string]$message.type) {
    'ping' { $script:Reply = @{ ok = $true; version = (Get-ManifestVersion $ExtDir) } }
    'update' {
      $lock = Lock-Update
      try {
        # Anything a command leaves in the pipeline would corrupt the reply.
        $script:Reply = (Install-Latest | Select-Object -Last 1)
      } finally {
        $lock.Dispose()
      }
    }
    default { $script:Reply = @{ ok = $false; error = "Unknown request: $($message.type)" } }
  }
} catch {
  Write-Log "Failed: $($_.Exception.Message)"
  $script:Reply = @{ ok = $false; error = $_.Exception.Message }
}
Write-Message $script:Reply
