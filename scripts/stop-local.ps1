param([int]$Port = 4173)
$ErrorActionPreference = "SilentlyContinue"
$root = Split-Path -Parent $PSScriptRoot

$candidates = @()
$pidFiles = Get-ChildItem -Path $root -Filter "server.pid" -Recurse -ErrorAction SilentlyContinue
foreach ($file in $pidFiles) {
  $value = (Get-Content -LiteralPath $file.FullName -Raw).Trim()
  if ($value -match '^\d+$') { $candidates += [int]$value }
}

$stopped = @()
foreach ($processId in $candidates | Select-Object -Unique) {
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$processId"
  if ($process -and $process.CommandLine -like "*server*index.js*") {
    Stop-Process -Id $processId -Force
    $stopped += $processId
    Get-ChildItem -Path $root -Filter "server.pid" -Recurse -ErrorAction SilentlyContinue |
      Remove-Item -Force -ErrorAction SilentlyContinue
  }
}

if ($stopped.Count -gt 0) {
  Write-Output ("STOPPED " + ($stopped -join ","))
  exit 0
}

$listening = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($listening) {
  $owner = Get-CimInstance Win32_Process -Filter "ProcessId=$($listening[0].OwningProcess)"
  if ($owner -and $owner.CommandLine -like "*server*index.js*") {
    Stop-Process -Id $owner.ProcessId -Force
    Write-Output "STOPPED $($owner.ProcessId)"
    exit 0
  }
  Write-Output "PORT_BUSY_OTHER_APP"
  exit 2
}

Write-Output "NOT_RUNNING"
exit 0
