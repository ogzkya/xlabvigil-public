$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$line = Get-Content -LiteralPath '.env' | Where-Object { $_ -match '^VIGIL_DB_PASSWORD=' } | Select-Object -First 1
$databasePassword = $line.Substring('VIGIL_DB_PASSWORD='.Length)
$env:VIGIL_TEST_DATABASE_URL = "postgres://vigil:${databasePassword}@127.0.0.1:55440/vigil?sslmode=disable"
go test ./... -count=1
if ($LASTEXITCODE -ne 0) { throw 'Go testleri başarısız.' }
go vet ./...
if ($LASTEXITCODE -ne 0) { throw 'Go statik kontrolü başarısız.' }
Push-Location web
try {
    npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Arayüz derlemesi başarısız.' }
} finally { Pop-Location }
Write-Output 'Odaklı doğrulamalar tamamlandı.'
