param(
  [int]$Port = 3000
)

$ErrorActionPreference = "Continue"

$healthUrl = "http://127.0.0.1:$Port/api/health"
$homeUrl = "http://127.0.0.1:$Port"
$settingsUrl = "http://127.0.0.1:$Port/settings"

Write-Host "[local-dev] checking $healthUrl"
try {
  $health = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 5
  Write-Host "[local-dev] health status=$($health.StatusCode) body=$($health.Content)"
} catch {
  Write-Host "[local-dev] health failed: $($_.Exception.Message)"
}

foreach ($url in @($homeUrl, $settingsUrl)) {
  try {
    $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5
    Write-Host "[local-dev] $url status=$($response.StatusCode) length=$($response.Content.Length)"
  } catch {
    Write-Host "[local-dev] $url failed: $($_.Exception.Message)"
  }
}

Write-Host "[local-dev] listeners:"
netstat -ano | findstr ":$Port"
