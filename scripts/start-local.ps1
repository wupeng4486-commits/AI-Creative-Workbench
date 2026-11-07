param(
  [int]$Port = 4173,
  [string]$DataDir = ""
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
. (Join-Path $PSScriptRoot 'local-instance.ps1')

$DataDir = Resolve-WorkbenchDataDir $root $DataDir
$logs = Join-Path $DataDir "logs"
New-Item -ItemType Directory -Force -Path $logs | Out-Null

$existing = Get-WorkbenchInstance $Port $root $DataDir
if ($existing.Status -eq 'running') {
  Save-WorkbenchInstance $existing.Process $logs $Port $root $DataDir
  Write-Output "RUNNING $($existing.Process.ProcessId)"
  exit 0
}
if ($existing.Status -eq 'other_app') {
  Write-Output "PORT_BUSY"
  exit 2
}

$entryPath = Join-Path $root 'apps/server/dist/index.js'
if (-not (Test-Path -LiteralPath $entryPath) -or -not (Test-Path -LiteralPath (Join-Path $root 'apps/web/dist/index.html'))) {
  Write-Output 'MISSING_BUILD: npm run build'
  exit 3
}
$node = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $node) { Write-Output 'NODE_NOT_FOUND'; exit 3 }
$env:APP_PORT = "$Port"
$env:APP_HOST = "127.0.0.1"
$env:APP_DATA_DIR = $DataDir
$process = Start-Process -FilePath $node.Source `
  -ArgumentList "`"$entryPath`"" `
  -WorkingDirectory $root `
  -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $logs "server.out.log") `
  -RedirectStandardError (Join-Path $logs "server.err.log") `
  -PassThru

for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Milliseconds 500
  $instance = Get-WorkbenchInstance $Port $root $DataDir
  if ($instance.Status -eq 'running' -and $instance.Process.ProcessId -eq $process.Id) {
    Save-WorkbenchInstance $instance.Process $logs $Port $root $DataDir
    Write-Output "STARTED $($process.Id)"
    exit 0
  }
  $process.Refresh()
  if ($process.HasExited) { break }
}

$process.Refresh()
if (-not $process.HasExited) { $process.Kill(); $process.WaitForExit() }
Write-Output "FAILED"
exit 1
