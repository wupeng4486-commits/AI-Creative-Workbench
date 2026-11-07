param(
  [int]$Port = 4173,
  [string]$DataDir = ""
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not $DataDir) { $DataDir = Join-Path $root "data" }
$logs = Join-Path $DataDir "logs"
New-Item -ItemType Directory -Force -Path $logs | Out-Null

$pidFile = Join-Path $logs "server.pid"
$listening = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($listening) {
  $owner = Get-CimInstance Win32_Process -Filter "ProcessId=$($listening[0].OwningProcess)"
  if ($owner -and $owner.CommandLine -like "*server*index.js*") {
    Write-Output "RUNNING"
    exit 0
  }
  Write-Output "PORT_BUSY"
  exit 2
}

$env:APP_PORT = "$Port"
$env:APP_HOST = "127.0.0.1"
$env:APP_DATA_DIR = $DataDir
$process = Start-Process -FilePath "node" `
  -ArgumentList "apps/server/dist/index.js" `
  -WorkingDirectory $root `
  -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $logs "server.out.log") `
  -RedirectStandardError (Join-Path $logs "server.err.log") `
  -PassThru
Set-Content -Path $pidFile -Value $process.Id -Encoding ascii

for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Milliseconds 500
  try {
    $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri "http://127.0.0.1:$Port/api/system/health"
    if ($response.StatusCode -eq 200) {
      Write-Output "STARTED $($process.Id)"
      exit 0
    }
  } catch {
    if ($process.HasExited) { break }
  }
}

Write-Output "FAILED"
exit 1
