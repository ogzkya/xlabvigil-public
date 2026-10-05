$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
. (Join-Path $PSScriptRoot 'test-database.ps1')
foreach ($command in @('go', 'node', 'npm.cmd')) { Assert-VigilCommand $command }
$previousDatabaseUrl = $env:VIGIL_TEST_DATABASE_URL
$previousGoCache = $env:GOCACHE
$database = $null
$reportPath = Join-Path $projectRoot 'runtime/qa/go-tests.jsonl'
New-Item -ItemType Directory -Path (Split-Path -Parent $reportPath) -Force | Out-Null
# Keep generated/cached Go sources under runtime out of the product's ./... scan.
$runtimeModule = Join-Path $projectRoot 'runtime/go.mod'
if (-not (Test-Path -LiteralPath $runtimeModule)) { [IO.File]::WriteAllText($runtimeModule, "module xlabvigil/runtime-artifacts`n", (New-Object Text.UTF8Encoding($false))) }
try {
    if (-not $env:VIGIL_TEST_DATABASE_URL) {
        $database = Start-VigilTestDatabase
        $env:VIGIL_TEST_DATABASE_URL = $database.DatabaseUrl
        Write-Output 'Ana veritabanından bağımsız, geçici PostgreSQL kabul ortamı hazır.'
    } else { Write-Output 'Açıkça verilen test veritabanında rastgele geçici şemalar kullanılacak.' }
    $env:GOCACHE = Join-Path $projectRoot 'runtime/go-cache'
    $testOutput = @(go test ./... -count=1 -json)
    $testExitCode = $LASTEXITCODE
    $testOutput | Set-Content -LiteralPath $reportPath -Encoding UTF8
    $events = @($testOutput | ForEach-Object { $_ | ConvertFrom-Json })
    $skipped = @($events | Where-Object { $_.Action -eq 'skip' -and $_.Test })
    $failed = @($events | Where-Object { $_.Action -eq 'fail' })
    $passed = @($events | Where-Object { $_.Action -eq 'pass' -and $_.Test -and $_.Test -notmatch '/' })
    if ($testExitCode -ne 0 -or $failed.Count -gt 0) { throw 'Go testleri başarısız. runtime/qa/go-tests.jsonl ayrıntıları içerir.' }
    if ($skipped.Count -gt 0 -or $passed.Count -eq 0) { throw 'Atlanan veya çalışmayan veritabanı testi var; kabul tamamlanmış sayılmadı.' }
    Write-Output "$($passed.Count) üst düzey Go testi geçti; atlanan test yok."
    go vet ./...
    if ($LASTEXITCODE -ne 0) { throw 'Go statik kontrolü başarısız.' }
    Push-Location web
    try {
        npm.cmd run build -- --outDir ../runtime/qa/web-dist
        if ($LASTEXITCODE -ne 0) { throw 'Arayüz derlemesi başarısız.' }
    } finally { Pop-Location }
    Write-Output 'Yerel ürün kontrolleri tamamlandı.'
} finally {
    $env:VIGIL_TEST_DATABASE_URL = $previousDatabaseUrl
    $env:GOCACHE = $previousGoCache
    if ($database) { Stop-VigilTestDatabase $database }
}
