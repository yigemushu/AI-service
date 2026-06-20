param(
  [int]$Port = 3000,
  [switch]$StopExisting
)

$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$logPath = Join-Path $projectRoot "dev-server-stable.log"
$errorLogPath = Join-Path $projectRoot "dev-server-stable.err.log"
$supervisorPidPath = Join-Path $projectRoot ".local-server-supervisor.pid"

function Write-Step($message) {
  Write-Host "[local-dev] $message"
}

function Get-PortListeners([int]$TargetPort) {
  Get-NetTCPConnection -LocalPort $TargetPort -State Listen -ErrorAction SilentlyContinue
}

$listeners = @(Get-PortListeners $Port)
if ($listeners.Count -gt 0) {
  foreach ($listener in $listeners) {
    $process = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
    $name = if ($process) { $process.ProcessName } else { "unknown" }
    Write-Step "port $Port is already used by pid=$($listener.OwningProcess), process=$name"

    if ($StopExisting -and $name -in @("node", "npm", "powershell", "pwsh")) {
      Stop-Process -Id $listener.OwningProcess -Force
      Write-Step "stopped pid=$($listener.OwningProcess)"
    }
  }

  if (-not $StopExisting) {
    Write-Step "existing service detected. Re-run with -- --StopExisting to replace it, or open http://127.0.0.1:$Port"
    exit 0
  }
}

if ($StopExisting -and (Test-Path $supervisorPidPath)) {
  $supervisorPid = Get-Content -LiteralPath $supervisorPidPath -ErrorAction SilentlyContinue
  if ($supervisorPid -match '^\d+$') {
    $supervisor = Get-Process -Id ([int]$supervisorPid) -ErrorAction SilentlyContinue
    if ($supervisor) {
      Stop-Process -Id $supervisor.Id -Force
      Write-Step "stopped local supervisor pid=$($supervisor.Id)"
    }
  }
  Remove-Item -LiteralPath $supervisorPidPath -Force -ErrorAction SilentlyContinue
}

if (Test-Path $logPath) {
  Remove-Item -LiteralPath $logPath -Force
}
if (Test-Path $errorLogPath) {
  Remove-Item -LiteralPath $errorLogPath -Force
}

Write-Step "starting stable Next.js server on port $Port"
$supervisorScript = Join-Path $projectRoot "scripts\local-server-supervisor.cjs"
$env:LOCAL_SERVER_PORT = "$Port"
$env:LOCAL_SERVER_MODE = "start"
Start-Process -FilePath (Get-Command node).Source -ArgumentList "`"$supervisorScript`"" -WorkingDirectory $projectRoot -WindowStyle Hidden

$healthUrl = "http://127.0.0.1:$Port/api/health"
for ($attempt = 1; $attempt -le 30; $attempt += 1) {
  Start-Sleep -Seconds 1
  try {
    $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 2
    if ($response.StatusCode -eq 200) {
      Write-Step "ready: http://127.0.0.1:$Port"
      Write-Step "health: $healthUrl"
      Write-Step "log: $logPath"
      exit 0
    }
  } catch {
    if ($attempt -eq 30) {
      Write-Step "health check failed after $attempt attempts"
    }
  }
}

if (Test-Path $logPath) {
  Write-Step "last log lines:"
  Get-Content -LiteralPath $logPath -Tail 80
}
if (Test-Path $errorLogPath) {
  Write-Step "last error log lines:"
  Get-Content -LiteralPath $errorLogPath -Tail 80
}

exit 1
