# Reinstalls the latest published FastStudy release over a test build; data, keys and settings stay as they are.
$ErrorActionPreference = 'Stop'
$repo = 'ShalomPrinz/fast-study'

$dir = Join-Path $env:TEMP 'faststudy-release'
Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
gh release download --repo $repo --pattern 'FastStudy-Setup.exe' --dir $dir
if ($LASTEXITCODE) { throw 'Release download failed.' }
$tag = gh release view --repo $repo --json tagName --jq .tagName

# Closing the window quits the app, which stops its services; a hard kill would orphan them.
$app = Get-Process FastStudy -ErrorAction SilentlyContinue
if ($app) {
  $app | ForEach-Object { $_.CloseMainWindow() | Out-Null }
  $app | Wait-Process -Timeout 60 -ErrorAction SilentlyContinue
  Get-Process FastStudy -ErrorAction SilentlyContinue | Stop-Process -Force
}

$p = Start-Process "$dir\FastStudy-Setup.exe" -ArgumentList '/S' -Wait -PassThru
if ($p.ExitCode) { throw "Installer exited with code $($p.ExitCode)." }
Write-Host "Reverted to FastStudy $tag - start it again."
