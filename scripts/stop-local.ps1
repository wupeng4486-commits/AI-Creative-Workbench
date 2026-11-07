param([int]$Port = 4173, [string]$DataDir = '')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'local-instance.ps1')
$DataDir = Resolve-WorkbenchDataDir $root $DataDir
$logs = Join-Path $DataDir 'logs'
$instance = Get-WorkbenchInstance $Port $root $DataDir

if ($instance.Status -eq 'other_app') {
  Write-Output 'PORT_BUSY_OTHER_APP'
  exit 2
}
if ($instance.Status -eq 'running') {
  $ownerProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($instance.Process.ProcessId)"
  if (-not $ownerProcess -or $ownerProcess.CreationDate -ne $instance.Process.CreationDate) {
    Write-Output 'PROCESS_CHANGED'
    exit 2
  }
  Stop-Process -Id $ownerProcess.ProcessId -Force
  Wait-Process -Id $ownerProcess.ProcessId -Timeout 5 -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $logs 'server.pid') -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $logs 'server.instance.json') -Force -ErrorAction SilentlyContinue
  Write-Output "STOPPED $($ownerProcess.ProcessId)"
  exit 0
}

Remove-Item -LiteralPath (Join-Path $logs 'server.pid') -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath (Join-Path $logs 'server.instance.json') -Force -ErrorAction SilentlyContinue
Write-Output "NOT_RUNNING"
exit 0
