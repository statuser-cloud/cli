# Installs the statuser CLI on Windows from a GitHub release of
# statuser-cloud/cli:
#
#   irm https://raw.githubusercontent.com/statuser-cloud/cli/main/install.ps1 | iex
#
# $env:STATUSER_VERSION picks a version (default: the latest release),
# $env:STATUSER_INSTALL_DIR a directory (default:
# %LOCALAPPDATA%\Programs\statuser, added to the user PATH). The archive is
# checked against SHA256SUMS of the same release before anything is installed.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$repo = 'statuser-cloud/cli'
# Only an x64 build exists; Windows on ARM runs it under emulation.
$asset = 'statuser-windows-x64.zip'
if ($env:STATUSER_VERSION) {
  $base = "https://github.com/$repo/releases/download/v$($env:STATUSER_VERSION.TrimStart('v'))"
} else {
  $base = "https://github.com/$repo/releases/latest/download"
}

$tmp = Join-Path ([IO.Path]::GetTempPath()) ([Guid]::NewGuid())
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  Invoke-WebRequest "$base/$asset" -OutFile (Join-Path $tmp $asset) -UseBasicParsing
  Invoke-WebRequest "$base/SHA256SUMS" -OutFile (Join-Path $tmp 'SHA256SUMS') -UseBasicParsing

  $line = Get-Content (Join-Path $tmp 'SHA256SUMS') | Where-Object { ($_ -split '\s+')[1] -eq $asset }
  if (-not $line) { throw "$asset is not listed in SHA256SUMS" }
  $expected = ($line -split '\s+')[0]
  $actual = (Get-FileHash (Join-Path $tmp $asset) -Algorithm SHA256).Hash
  if ($actual -ne $expected) { throw "checksum mismatch for $asset" }

  Expand-Archive (Join-Path $tmp $asset) -DestinationPath $tmp -Force

  $dir = $env:STATUSER_INSTALL_DIR
  if (-not $dir) { $dir = Join-Path $env:LOCALAPPDATA 'Programs\statuser' }
  New-Item -ItemType Directory -Path $dir -Force | Out-Null
  Copy-Item (Join-Path $tmp 'statuser.exe') (Join-Path $dir 'statuser.exe') -Force

  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not (($userPath -split ';') -contains $dir)) {
    [Environment]::SetEnvironmentVariable('Path', "$userPath;$dir".TrimStart(';'), 'User')
    Write-Host "Added $dir to the user PATH; open a new terminal to use statuser."
  }
  $version = & (Join-Path $dir 'statuser.exe') --version
  Write-Host "statuser $version installed to $dir\statuser.exe"
} finally {
  Remove-Item $tmp -Recurse -Force
}
