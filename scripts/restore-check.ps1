param([Parameter(Mandatory=$true)][string]$BackupPath)
$ErrorActionPreference = 'Stop'
$backup = [IO.Path]::GetFullPath($BackupPath)
$meta = Get-Content -LiteralPath "$backup.json" -Raw | ConvertFrom-Json
if ($meta.format -ne 'andthen-pg-custom-v1' -or $meta.file -ne [IO.Path]::GetFileName($backup)) { throw 'Unrecognized backup manifest' }
if ((Get-FileHash -LiteralPath $backup -Algorithm SHA256).Hash -ne $meta.sha256) { throw 'Backup checksum mismatch' }
$id = [Guid]::NewGuid().ToString('N')
$restoreDb = "andthen_restore_$id"
if ($restoreDb -notmatch '^andthen_restore_[a-f0-9]{32}$') { throw 'Unsafe restore database name' }
$remote = "/tmp/andthen-restore-$id.dump"
$created = $false
Push-Location (Join-Path $PSScriptRoot '..')
try {
  & docker compose cp $backup "db:$remote"
  if ($LASTEXITCODE -ne 0) { throw 'Backup upload failed' }
  & docker compose exec -T db createdb -U andthen $restoreDb
  if ($LASTEXITCODE -ne 0) { throw 'Cannot create isolated restore database' }
  $created = $true
  & docker compose exec -T db pg_restore -U andthen --dbname=$restoreDb --no-owner --no-acl --exit-on-error $remote
  if ($LASTEXITCODE -ne 0) { throw 'Restore failed' }
  $countsSql = "select json_build_object('sources',(select count(*) from sources),'snapshots',(select count(*) from source_snapshots),'interests',(select count(*) from interests),'interviews',(select count(*) from interview_sessions),'messages',(select count(*) from interview_messages),'drafts',(select count(*) from followup_versions));"
  $counts = & docker compose exec -T db psql -U andthen -d $restoreDb -At -v ON_ERROR_STOP=1 -c $countsSql
  if ($LASTEXITCODE -ne 0) { throw 'Restored schema verification failed' }
  [pscustomobject]@{ restored = $true; isolated_database = $restoreDb; counts = ($counts | ConvertFrom-Json); source_backup = $backup; sha256 = $meta.sha256 }
} finally {
  if ($created) {
    & docker compose exec -T db dropdb -U andthen $restoreDb
    if ($LASTEXITCODE -ne 0) { Write-Warning "Could not remove isolated restore database $restoreDb" }
  }
  & docker compose exec -T db rm -f -- $remote 2>$null
  Pop-Location
}
