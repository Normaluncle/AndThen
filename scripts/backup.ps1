param(
  [string]$Database = 'andthen',
  [string]$BackupDirectory = (Join-Path $PSScriptRoot '../data/backups'),
  [ValidateRange(1,30)][int]$RetentionDays = 30
)
$ErrorActionPreference = 'Stop'
if ($Database -notmatch '^[a-z][a-z0-9_]{0,62}$') { throw 'Invalid database identifier' }
$root = [IO.Path]::GetFullPath($BackupDirectory)
New-Item -ItemType Directory -Path $root -Force | Out-Null
$stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$id = [Guid]::NewGuid().ToString('N')
$name = "andthen-$stamp-$id.dump"
$target = Join-Path $root $name
$remote = "/tmp/$name"
Push-Location (Join-Path $PSScriptRoot '..')
try {
  & docker compose exec -T db pg_dump -U andthen -d $Database --format=custom --no-owner --no-acl --file=$remote
  if ($LASTEXITCODE -ne 0) { throw 'pg_dump failed' }
  & docker compose cp "db:$remote" $target
  if ($LASTEXITCODE -ne 0 -or !(Test-Path -LiteralPath $target)) { throw 'Backup copy failed' }
  $manifest = [ordered]@{ format = 'andthen-pg-custom-v1'; database = $Database; created_utc = [DateTime]::UtcNow.ToString('o'); file = $name; sha256 = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash; retention_days = $RetentionDays }
  $manifest | ConvertTo-Json | Set-Content -LiteralPath "$target.json" -Encoding utf8
  # Rotate only dumps with our validated manifest and naming convention in this exact directory.
  foreach ($entry in Get-ChildItem -LiteralPath $root -Filter 'andthen-*.dump.json' -File) {
    if ($entry.Name -notmatch '^andthen-\d{8}T\d{6}Z-[a-f0-9]{32}\.dump\.json$') { continue }
    $meta = Get-Content -LiteralPath $entry.FullName -Raw | ConvertFrom-Json
    if ($meta.format -ne 'andthen-pg-custom-v1' -or $meta.file -ne $entry.Name.Substring(0, $entry.Name.Length - 5)) { continue }
    $created = [DateTimeOffset]::Parse($meta.created_utc)
    if ($created -ge [DateTimeOffset]::UtcNow.AddDays(-$RetentionDays)) { continue }
    $expired = [IO.Path]::GetFullPath((Join-Path $root $meta.file))
    if ([IO.Path]::GetDirectoryName($expired) -ne $root) { throw 'Backup rotation path escaped its directory' }
    if (Test-Path -LiteralPath $expired) { Remove-Item -LiteralPath $expired -Force }
    Remove-Item -LiteralPath $entry.FullName -Force
  }
  [pscustomobject]@{ backup = $target; manifest = "$target.json"; sha256 = $manifest.sha256 }
} finally {
  & docker compose exec -T db rm -f -- $remote 2>$null
  Pop-Location
}
