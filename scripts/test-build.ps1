# Installs the newest green main build's installer over the local FastStudy, without publishing it.
# Data, keys and settings live outside the install dir, so they carry over untouched.
$ErrorActionPreference = 'Stop'
$repo = 'ShalomPrinz/fast-study'

$run = gh run list --repo $repo --workflow build.yml --branch main --status success --limit 1 `
  --json databaseId,headSha,displayTitle | ConvertFrom-Json
if (-not $run) { throw 'No successful build.yml run on main.' }
Write-Host "Build: $($run.headSha.Substring(0, 8)) $($run.displayTitle)"

$dir = Join-Path $env:TEMP 'faststudy-test-build'
Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
gh run download $run.databaseId --repo $repo --name installer --dir $dir
if ($LASTEXITCODE) { throw 'Artifact download failed (expired? re-run build.yml by dispatch).' }
$version = (Select-String -Path "$dir\latest.yml" -Pattern '^version:\s*(.+)$').Matches[0].Groups[1].Value

# Closing the window quits the app, which stops its services; a hard kill would orphan them.
$app = Get-Process FastStudy -ErrorAction SilentlyContinue
if ($app) {
  $app | ForEach-Object { $_.CloseMainWindow() | Out-Null }
  $app | Wait-Process -Timeout 60 -ErrorAction SilentlyContinue
  Get-Process FastStudy -ErrorAction SilentlyContinue | Stop-Process -Force
}

$p = Start-Process "$dir\FastStudy-Setup.exe" -ArgumentList '/S' -Wait -PassThru
if ($p.ExitCode) { throw "Installer exited with code $($p.ExitCode)." }
Write-Host "Installed FastStudy $version - start it again. Run scripts\revert-build.ps1 to go back to the published release."
