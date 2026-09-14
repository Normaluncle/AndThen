# Run the existing preview stack with the developer integration configuration.
# Only integration variables are loaded. Never print their values.
param([switch]$LocalDiscovery)
$ErrorActionPreference = 'Stop'
$previewRoot = Split-Path $PSScriptRoot -Parent
$previousIntegrationValues = @{}
try {
  foreach ($line in Get-Content -LiteralPath (Join-Path $previewRoot '.env.local')) {
    if ($line -match '^((?:ZHIHU|LLM|EMBEDDING|MEMORY)_[A-Z_]+)=(.*)$') {
      $key = $Matches[1]
      $previousIntegrationValues[$key] = [Environment]::GetEnvironmentVariable($key,'Process')
      $value = $Matches[2].Trim().Trim('"').Trim("'")
      [Environment]::SetEnvironmentVariable($key,$value,'Process')
    }
  }
  Push-Location $previewRoot
  try {
    $previewArgs=@('compose','-p','andthen-v12-demo','-f','docker-compose.yml','-f','docker-compose.demo.yml')
    if($LocalDiscovery){$previewArgs+=@('-f','docker-compose.discovery-local.yml')}
    docker @previewArgs up -d --no-deps api worker demo
    if ($LASTEXITCODE -ne 0) { throw 'Preview startup failed' }
  }
  finally { Pop-Location }
} finally {
  foreach ($key in $previousIntegrationValues.Keys) { [Environment]::SetEnvironmentVariable($key,$previousIntegrationValues[$key],'Process') }
}
