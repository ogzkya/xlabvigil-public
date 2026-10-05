# Shared local backup protection for Windows PowerShell 5.1 and newer.
# Passphrases are never supplied as command arguments, environment or output.
function ConvertTo-VigilBackupArgument([string]$Value) {
    if ($Value.IndexOfAny(@([char]0, [char]10, [char]13)) -ge 0) { throw 'Yedek aracına verilen dosya yolu geçersiz.' }
    '"' + (($Value -replace '(\\*)"', '$1$1\"') -replace '(\\+)$', '$1$1') + '"'
}

function Get-VigilBackupPassphraseBytes([Security.SecureString]$Passphrase) {
    if ($null -eq $Passphrase) { throw 'Yedekleme parolası gereklidir.' }
    $pointer = [IntPtr]::Zero
    $characters = $null
    $encoded = $null
    try {
        $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Passphrase)
        $characters = New-Object char[] $Passphrase.Length
        for ($index = 0; $index -lt $characters.Length; $index++) {
            $characters[$index] = [char]([Runtime.InteropServices.Marshal]::ReadInt16($pointer, $index * 2) -band 0xffff)
            if ($characters[$index] -eq [char]10 -or $characters[$index] -eq [char]13 -or $characters[$index] -eq [char]0) { throw 'Yedekleme parolası satır sonu veya sıfır karakteri içeremez.' }
        }
        $encoding = New-Object Text.UTF8Encoding($false, $true)
        try { $encoded = $encoding.GetBytes($characters) } catch { throw 'Yedekleme parolası geçerli UTF-8 metni olmalıdır.' }
        if ($encoded.Length -lt 12 -or $encoded.Length -gt 1024) { throw 'Yedekleme parolası UTF-8 ile 12–1024 bayt olmalıdır.' }
        $result = $encoded
        $encoded = $null
        return ,$result
    } finally {
        if ($null -ne $encoded) { [Array]::Clear($encoded, 0, $encoded.Length) }
        if ($null -ne $characters) { [Array]::Clear($characters, 0, $characters.Length) }
        if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    }
}

function Test-VigilBackupPassphraseEqual([Security.SecureString]$First, [Security.SecureString]$Second) {
    $firstBytes = $null
    $secondBytes = $null
    try {
        $firstBytes = Get-VigilBackupPassphraseBytes $First
        $secondBytes = Get-VigilBackupPassphraseBytes $Second
        $difference = $firstBytes.Length -bxor $secondBytes.Length
        $length = [Math]::Min($firstBytes.Length, $secondBytes.Length)
        for ($index = 0; $index -lt $length; $index++) { $difference = $difference -bor ($firstBytes[$index] -bxor $secondBytes[$index]) }
        return $difference -eq 0
    } finally {
        if ($null -ne $firstBytes) { [Array]::Clear($firstBytes, 0, $firstBytes.Length) }
        if ($null -ne $secondBytes) { [Array]::Clear($secondBytes, 0, $secondBytes.Length) }
    }
}

function Get-VigilBackupPassphrase([Security.SecureString]$Passphrase, [switch]$Confirm) {
    $owned = $null
    $confirmation = $null
    $bytes = $null
    try {
        if ($null -ne $Passphrase) {
            # The caller still owns its SecureString; dispose only our copy.
            $owned = $Passphrase.Copy()
        } else {
            $owned = Read-Host 'Yedekleme parolası (12–1024 UTF-8 bayt)' -AsSecureString
            if ($Confirm) {
                $confirmation = Read-Host 'Yedekleme parolasını yeniden girin' -AsSecureString
                if (-not (Test-VigilBackupPassphraseEqual $owned $confirmation)) { throw 'Yedekleme parolaları eşleşmiyor; yedek oluşturulmadı.' }
            }
        }
        $bytes = Get-VigilBackupPassphraseBytes $owned
        $owned.MakeReadOnly()
        $result = $owned
        $owned = $null
        return $result
    } finally {
        if ($null -ne $bytes) { [Array]::Clear($bytes, 0, $bytes.Length) }
        if ($null -ne $confirmation) { $confirmation.Dispose() }
        if ($null -ne $owned) { $owned.Dispose() }
    }
}

function Assert-VigilPrivateBackupDirectory([string]$Path) {
    $directory = Get-Item -LiteralPath $Path -Force
    if (-not $directory.PSIsContainer -or ($directory.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Geçici yedek dizini düzenli bir yerel dizin olmalıdır.' }
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $access = Get-Acl -LiteralPath $directory.FullName
    if (-not $access.AreAccessRulesProtected -or $access.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'Yedek dizini sahibinin özel izinleri doğrulanamadı.' }
    $rules = @($access.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
    $requiredInheritance = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit
    $ownerRules = @($rules | Where-Object { $_.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and $_.IdentityReference.Value -eq $sid.Value -and ($_.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -eq [Security.AccessControl.FileSystemRights]::FullControl -and ($_.InheritanceFlags -band $requiredInheritance) -eq $requiredInheritance })
    $otherRules = @($rules | Where-Object { $_.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and $_.IdentityReference.Value -ne $sid.Value })
    if ($ownerRules.Count -ne 1 -or $otherRules.Count -ne 0) { throw 'Yedek dizini yalnızca mevcut kullanıcıya açık olmalıdır.' }
}

function New-VigilPrivateBackupDirectory([string]$Path) {
    $fullPath = [IO.Path]::GetFullPath($Path)
    if ($fullPath.StartsWith('\\') -or (Test-Path -LiteralPath $fullPath)) { throw 'Yeni özel yedek dizini yerel olmalı ve önceden bulunmamalıdır.' }
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $access = New-Object Security.AccessControl.DirectorySecurity
    $access.SetOwner($sid)
    $access.SetAccessRuleProtection($true, $false)
    $inheritance = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit
    $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, [Security.AccessControl.FileSystemRights]::FullControl, $inheritance, [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow)
    $access.AddAccessRule($rule)
    $directory = New-Object IO.DirectoryInfo($fullPath)
    $createWithAcl = $directory.GetType().GetMethod('Create', [type[]]@([Security.AccessControl.DirectorySecurity]))
    if ($null -ne $createWithAcl) {
        # .NET Framework creates the directory with its protected ACL atomically.
        $directory.Create($access)
    } else {
        # The equivalent API in PowerShell on modern .NET.
        [IO.FileSystemAclExtensions]::Create($directory, $access)
    }
    Assert-VigilPrivateBackupDirectory $fullPath
    return $fullPath
}

function Remove-VigilPrivateBackupDirectory([string]$Path, [string]$ParentDirectory) {
    if ([string]::IsNullOrWhiteSpace($Path)) { return }
    $fullPath = [IO.Path]::GetFullPath($Path)
    $parent = [IO.Path]::GetFullPath($ParentDirectory).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
    $expectedParent = [IO.Path]::GetDirectoryName($fullPath)
    $name = [IO.Path]::GetFileName($fullPath)
    if (-not [string]::Equals($parent, $expectedParent, [StringComparison]::OrdinalIgnoreCase) -or $name -cnotmatch '\Avigil-(backup|restore)-plaintext-[0-9a-f]{32}\z') { throw 'Geçici temizleme hedefi bu çalışmanın ayrılmış dizini değil.' }
    if (-not (Test-Path -LiteralPath $fullPath)) { return }
    Assert-VigilPrivateBackupDirectory $fullPath
    # No recursive removal: only the fixed files created by this invocation.
    foreach ($name in @('database.dump.partial', 'database.dump', 'metadata.json')) {
        $file = Join-Path $fullPath $name
        if (Test-Path -LiteralPath $file) {
            $item = Get-Item -LiteralPath $file -Force
            if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Geçici temizleme hedefi beklenen düzenli dosya değil; hedef silinmedi.' }
            Remove-Item -LiteralPath $file -Force
        }
    }
    if (@(Get-ChildItem -LiteralPath $fullPath -Force).Count -ne 0) { throw 'Özel geçici dizinde bu çalışmanın bilmediği dosyalar var; dizin silinmedi.' }
    Remove-Item -LiteralPath $fullPath -Force
}

function Invoke-VigilBackupCrypto([string]$Executable, [string[]]$Arguments, [Security.SecureString]$Passphrase) {
    if (-not (Test-Path -LiteralPath $Executable -PathType Leaf) -or ((Get-Item -LiteralPath $Executable -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Şifreli yedek aracı bulunamadı. Kaynak depoda setup.ps1, teslim paketinde install.ps1 kullanın.' }
    $secretBytes = $null
    $process = New-Object Diagnostics.Process
    $started = $false
    try {
        $secretBytes = Get-VigilBackupPassphraseBytes $Passphrase
        $start = New-Object Diagnostics.ProcessStartInfo
        $start.FileName = [IO.Path]::GetFullPath($Executable)
        $start.Arguments = (($Arguments | ForEach-Object { ConvertTo-VigilBackupArgument $_ }) -join ' ')
        $start.UseShellExecute = $false
        $start.CreateNoWindow = $true
        $start.RedirectStandardInput = $true
        $start.RedirectStandardOutput = $true
        $start.RedirectStandardError = $true
        $start.StandardOutputEncoding = New-Object Text.UTF8Encoding($false)
        $start.StandardErrorEncoding = New-Object Text.UTF8Encoding($false)
        $process.StartInfo = $start
        $stdinEncoding = New-Object Text.UTF8Encoding($false, $true)
        if ($null -ne $start.GetType().GetProperty('StandardInputEncoding')) {
            $start.StandardInputEncoding = $stdinEncoding
            $started = $process.Start()
        } else {
            # .NET Framework creates its redirected input writer during Start
            # using Console.InputEncoding. Prevent a UTF-8 BOM/preamble even
            # when the caller's console encoding normally includes one.
            $previousInputEncoding = [Console]::InputEncoding
            try {
                [Console]::InputEncoding = $stdinEncoding
                $started = $process.Start()
            } finally { [Console]::InputEncoding = $previousInputEncoding }
        }
        if (-not $started) { throw 'Şifreli yedek aracı başlatılamadı.' }
        $standardOutput = $process.StandardOutput.ReadToEndAsync()
        $standardError = $process.StandardError.ReadToEndAsync()
        # Write raw UTF-8 bytes to bypass PS 5.1's console/StreamWriter encoding.
        $process.StandardInput.BaseStream.Write($secretBytes, 0, $secretBytes.Length)
        $process.StandardInput.BaseStream.WriteByte(10)
        $process.StandardInput.BaseStream.Flush()
        $process.StandardInput.Close()
        [Array]::Clear($secretBytes, 0, $secretBytes.Length)
        $secretBytes = $null
        $process.WaitForExit()
        # Both redirected streams are drained but never included in diagnostics.
        $null = $standardOutput.GetAwaiter().GetResult()
        $null = $standardError.GetAwaiter().GetResult()
        if ($process.ExitCode -ne 0) { throw "Şifreli yedek işlemi tamamlanamadı (çıkış kodu $($process.ExitCode)). Parolayı ve arşiv bütünlüğünü denetleyin; mevcut yedek değiştirilmedi." }
    } finally {
        if ($null -ne $secretBytes) { [Array]::Clear($secretBytes, 0, $secretBytes.Length) }
        if ($started) {
            try { $process.StandardInput.Dispose() } catch { }
            try { if (-not $process.HasExited) { $process.Kill(); $process.WaitForExit() } } catch { }
        }
        $process.Dispose()
    }
}
