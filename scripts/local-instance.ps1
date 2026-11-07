function Resolve-WorkbenchDataDir {
  param([string]$Root, [string]$DataDir)
  if (-not $DataDir) { $DataDir = $env:APP_DATA_DIR }
  if (-not $DataDir) { $DataDir = Join-Path $Root 'data' }
  if (-not [IO.Path]::IsPathRooted($DataDir)) { $DataDir = Join-Path $Root $DataDir }
  $resolved = [IO.Path]::GetFullPath($DataDir)
  if ($resolved.Length -gt [IO.Path]::GetPathRoot($resolved).Length) {
    $resolved = $resolved.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
  }
  return $resolved
}

function Test-WorkbenchProcess {
  param($Process, [string]$EntryPath)
  if (-not $Process -or $Process.Name -ne 'node.exe') { return $false }
  $commandLine = $Process.CommandLine.Replace('\', '/')
  $absoluteEntry = [regex]::Escape($EntryPath.Replace('\', '/'))
  $relativeEntry = [regex]::Escape('apps/server/dist/index.js')
  $pattern = '(?i)(?:^|[\s"])(?:' + $absoluteEntry + '|' + $relativeEntry + ')(?=$|[\s"])'
  return $commandLine -match $pattern
}

function Get-WorkbenchInstance {
  param([int]$Port, [string]$Root, [string]$DataDir)
  $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
  if (-not $listeners.Count) { return @{ Status = 'not_running' } }
  try {
    $health = Invoke-RestMethod -TimeoutSec 2 -Uri "http://127.0.0.1:$Port/api/system/health"
    if ($health.app -ne 'AI Creative Workbench' -or -not $health.ok) { return @{ Status = 'other_app' } }
    if ([IO.Path]::GetFullPath($health.projectRoot) -ne [IO.Path]::GetFullPath($Root)) { return @{ Status = 'other_app' } }
    if ([IO.Path]::GetFullPath($health.dataDir) -ne [IO.Path]::GetFullPath($DataDir)) { return @{ Status = 'other_app' } }
    if (@($listeners.OwningProcess) -notcontains [int]$health.pid) { return @{ Status = 'other_app' } }
    $ownerProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$health.pid)"
    $entryPath = Join-Path $Root 'apps/server/dist/index.js'
    if (-not (Test-WorkbenchProcess $ownerProcess $entryPath)) { return @{ Status = 'other_app' } }
    return @{ Status = 'running'; Process = $ownerProcess }
  } catch {
    return @{ Status = 'other_app' }
  }
}

function Save-WorkbenchInstance {
  param($Process, [string]$Logs, [int]$Port, [string]$Root, [string]$DataDir)
  Set-Content -LiteralPath (Join-Path $Logs 'server.pid') -Value $Process.ProcessId -Encoding ascii
  @{
    pid = $Process.ProcessId
    port = $Port
    projectRoot = $Root
    dataDir = $DataDir
    createdAt = $Process.CreationDate.ToUniversalTime().ToString('o')
  } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Logs 'server.instance.json') -Encoding utf8
}
