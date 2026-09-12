param([ValidateSet('single','parallel','memory','context')][string]$Mode='single', [ValidateSet('both','300000','1000000')][string]$ContextWindow='both')
$ErrorActionPreference='Stop'
$wbProxySettings=Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
if (-not $wbProxySettings.ProxyEnable -or -not $wbProxySettings.ProxyServer) { throw 'System proxy is disabled or absent; verify connectivity before running.' }
$wbProxyAddress=[string]$wbProxySettings.ProxyServer
if ($wbProxyAddress.Contains('=')) { throw 'Per-protocol proxy format requires explicit configuration.' }
if ($wbProxyAddress -notmatch '^https?://') { $wbProxyAddress='http://'+$wbProxyAddress }
$wbOldHttp=$env:HTTP_PROXY
$wbOldHttps=$env:HTTPS_PROXY
try {
 $env:HTTP_PROXY=$wbProxyAddress
 $env:HTTPS_PROXY=$wbProxyAddress
 if ($Mode -eq 'context') { node "$PSScriptRoot\workbuddy-acp-probe.cjs" $ContextWindow }
 elseif ($Mode -eq 'memory') { node "$PSScriptRoot\workbuddy-memory-probe.cjs" }
 else { node "$PSScriptRoot\workbuddy-cli-probe.cjs" $Mode }
} finally {
 $env:HTTP_PROXY=$wbOldHttp
 $env:HTTPS_PROXY=$wbOldHttps
}
