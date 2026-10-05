. (Join-Path $PSScriptRoot 'common.ps1')
function Invoke-VigilTestDocker([string[]]$Arguments) {
    $dockerConfig = Join-Path (Get-VigilProjectRoot) 'runtime/docker-config'
    New-Item -ItemType Directory -Path $dockerConfig -Force | Out-Null
    $output = & docker --config $dockerConfig @Arguments
    if ($LASTEXITCODE -ne 0) { throw 'Yalıtılmış test veritabanı Docker işlemi başarısız.' }
    $output
}
function Start-VigilTestDatabase {
    Assert-VigilCommand 'docker'
    $instance = [Guid]::NewGuid().ToString('N')
    $name = 'vigil-acceptance-' + $instance
    $network = $name + '-network'
    $label = 'com.xlabvigil.acceptance=' + $instance
    $image = 'postgres:18-alpine@sha256:6c538e7206ea40ff740ef27883529390a690b6ead6ba96b44c67a9f7c638e8fd'
    $previousPassword = $env:POSTGRES_PASSWORD
    $secret = New-VigilRandomSecret
    $resource = [pscustomobject]@{ Name = $name; Network = $network; Instance = $instance; DatabaseUrl = $null; Port = 0 }
    try {
        Invoke-VigilTestDocker @('network', 'create', '--label', $label, $network) | Out-Null
        $env:POSTGRES_PASSWORD = $secret
        Invoke-VigilTestDocker @('run', '-d', '--rm', '--name', $name, '--label', $label, '--network', $network, '-p', '127.0.0.1::5432', '--mount', 'type=tmpfs,destination=/var/lib/postgresql', '-e', 'POSTGRES_PASSWORD', '-e', 'POSTGRES_USER=vigil', '-e', 'POSTGRES_DB=vigil_acceptance', $image) | Out-Null
        $deadline = [DateTime]::UtcNow.AddSeconds(45)
        do {
            & docker --config (Join-Path (Get-VigilProjectRoot) 'runtime/docker-config') exec $name pg_isready -U vigil -d vigil_acceptance 2>$null | Out-Null
            if ($LASTEXITCODE -eq 0) { break }
            Start-Sleep -Milliseconds 300
        } while ([DateTime]::UtcNow -lt $deadline)
        if ($LASTEXITCODE -ne 0) { throw 'Yalıtılmış PostgreSQL hazır olmadı.' }
        $mapping = [string](Invoke-VigilTestDocker @('port', $name, '5432/tcp'))
        if ($mapping -notmatch '^127\.0\.0\.1:(\d+)$') { throw 'Test veritabanı loopback portuna bağlanmadı.' }
        $resource.Port = [int]$Matches[1]
        $resource.DatabaseUrl = "postgres://vigil:${secret}@127.0.0.1:$($resource.Port)/vigil_acceptance?sslmode=disable"
        $resource
    } catch { Stop-VigilTestDatabase $resource; throw } finally { $env:POSTGRES_PASSWORD = $previousPassword }
}
function Stop-VigilTestDatabase($Resource) {
    if (-not $Resource -or $Resource.Name -notmatch '^vigil-acceptance-[a-f0-9]{32}$' -or $Resource.Network -ne ($Resource.Name + '-network') -or $Resource.Instance -ne $Resource.Name.Substring('vigil-acceptance-'.Length)) { throw 'Test kaynağı kimliği geçersiz; temizleme yapılmadı.' }
    $dockerConfig = Join-Path (Get-VigilProjectRoot) 'runtime/docker-config'
    $labelKey = 'com.xlabvigil.acceptance'
    $containers = @(& docker --config $dockerConfig ps -a --filter "name=^/$($Resource.Name)$" --format '{{.Names}}')
    if ($LASTEXITCODE -ne 0) { throw 'Test kapsayıcısı kimliği kontrol edilemedi.' }
    if ($containers -contains $Resource.Name) {
        $labels = ((Invoke-VigilTestDocker @('inspect', '--format', '{{json .Config.Labels}}', $Resource.Name)) -join '') | ConvertFrom-Json
        $label = [string]$labels.$labelKey
        if ($label -ne $Resource.Instance) { throw 'Test kapsayıcısı etiketi eşleşmedi; silinmedi.' }
        Invoke-VigilTestDocker @('rm', '-f', '-v', $Resource.Name) | Out-Null
    }
    $networks = @(& docker --config $dockerConfig network ls --filter "name=^$($Resource.Network)$" --format '{{.Name}}')
    if ($LASTEXITCODE -ne 0) { throw 'Test ağı kimliği kontrol edilemedi.' }
    if ($networks -contains $Resource.Network) {
        $labels = ((Invoke-VigilTestDocker @('network', 'inspect', '--format', '{{json .Labels}}', $Resource.Network)) -join '') | ConvertFrom-Json
        $label = [string]$labels.$labelKey
        if ($label -ne $Resource.Instance) { throw 'Test ağı etiketi eşleşmedi; silinmedi.' }
        Invoke-VigilTestDocker @('network', 'rm', $Resource.Network) | Out-Null
    }
}
