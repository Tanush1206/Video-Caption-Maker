# `vcm update` on Windows against a fake docker and a local "release"
# (v1.4.0); the twin of test_vcm_update.sh. It hands over to the version it
# downloaded; if that one can't start or stops before doing anything, the
# running version finishes; a bad checksum or a download that fails
# mid-update leaves the install exactly as it was; an ARM install still on
# Intel/AMD images is told it downloads them in full once.
#
# The fake docker is a real program first on PATH (fake_docker.py), not a
# function: the hand-over starts another PowerShell, which a function would
# not reach, and which would then call the real docker.
#
#   powershell -NoProfile -File install/tests/test_vcm_update.ps1   (or pwsh)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$onWindows = [IO.Path]::DirectorySeparatorChar -eq '\'
$python = if ($onWindows) { 'python' } else { 'python3' }
$exe = if ($PSVersionTable.PSEdition -eq 'Core') { 'pwsh' } else { 'powershell' }
$work = Join-Path ([IO.Path]::GetTempPath()) ("vcm-update-" + [guid]::NewGuid().ToString('N'))
$release = Join-Path $work 'release'
$bin = Join-Path $work 'bin'
$home_ = Join-Path $work 'home'
New-Item -ItemType Directory -Force -Path (Join-Path $release 'api'), $bin | Out-Null
Set-Content -Path (Join-Path $release 'api/health') -Value 'ok' -Encoding ascii
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0); $listener.Start()
$port = $listener.LocalEndpoint.Port; $listener.Stop()
# -WindowStyle exists only on Windows; pwsh on Linux refuses it.
$hidden = if ($onWindows) { @{ WindowStyle = 'Hidden' } } else { @{} }
$server = Start-Process -PassThru @hidden -FilePath $python -ArgumentList @('-m', 'http.server', $port, '--bind', '127.0.0.1', '--directory', $release) -ErrorAction Stop 2>$null
try {
    Copy-Item (Join-Path $here 'fake_docker.py') $bin
    if ($onWindows) {
        Set-Content -Path (Join-Path $bin 'docker.cmd') -Value "@python `"%~dp0fake_docker.py`" %*" -Encoding ascii
    } else {
        Set-Content -Path (Join-Path $bin 'docker') -Value "#!/bin/sh`nexec python3 `"`$(dirname `"`$0`")/fake_docker.py`" `"`$@`"" -Encoding ascii
        chmod +x (Join-Path $bin 'docker')
    }
    for ($i = 0; $i -lt 50; $i++) {
        try { Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$port/api/health" -TimeoutSec 2 | Out-Null; break } catch { Start-Sleep -Milliseconds 200 }
    }
    $vcm = [IO.Path]::Combine($here, '..', 'vcm.ps1')
    $calls = Join-Path $work 'calls'
    $script:failures = 0

    function New-Release([string]$kind, [switch]$BadSums) {
        $new = Join-Path $release 'vcm.ps1'
        switch ($kind) {
            # The vcm under test, with a line that says it ran.
            'good'   { (Get-Content -Raw $vcm) -replace '(?m)^function Complete-Update \{', "function Complete-Update {`n    Write-Host 'finished by the new vcm'" | Set-Content -NoNewline -Path $new -Encoding utf8 }
            'broken' { Set-Content -Path $new -Value 'if (' -Encoding ascii }
            'early'  { Set-Content -Path $new -Value "param([string]`$Command = 'help')`nif (`$Command -eq '__handover') { 'vcm-handover-1' } else { exit 3 }" -Encoding ascii }
        }
        Set-Content -Path (Join-Path $release 'vcm.cmd') -Value 'new-cmd' -Encoding ascii
        Set-Content -Path (Join-Path $release 'docker-compose.prod.yml') -Value 'new-prod' -Encoding ascii
        Set-Content -Path (Join-Path $release 'docker-compose.gpu.yml') -Value 'new-gpu' -Encoding ascii
        $lines = foreach ($f in 'docker-compose.prod.yml', 'docker-compose.gpu.yml', 'vcm.ps1', 'vcm.cmd') {
            $hash = (Get-FileHash -Algorithm SHA256 (Join-Path $release $f)).Hash.ToLower()
            if ($BadSums -and $f -eq 'docker-compose.prod.yml') { $hash = ('0' * 64) }
            "$hash  $f"
        }
        Set-Content -Path (Join-Path $release 'SHA256SUMS') -Value $lines -Encoding ascii
    }

    function Invoke-Update([hashtable]$fake = @{}) {
        if (Test-Path $home_) { Remove-Item -Recurse -Force $home_ }
        New-Item -ItemType Directory -Path $home_ | Out-Null
        Copy-Item $vcm (Join-Path $home_ 'vcm.ps1')
        Set-Content -Path (Join-Path $home_ 'vcm.cmd') -Value 'old-cmd' -Encoding ascii
        Set-Content -Path (Join-Path $home_ 'docker-compose.prod.yml') -Value 'old-prod' -Encoding ascii
        Set-Content -Path (Join-Path $home_ 'docker-compose.gpu.yml') -Value 'old-gpu' -Encoding ascii
        Set-Content -Path (Join-Path $home_ '.env') -Value @('VCM_VARIANT=cpu', "VCM_PORT=$port") -Encoding ascii
        Set-Content -Path $calls -Value '' -Encoding ascii
        $sep = [IO.Path]::PathSeparator
        $set = ($fake.GetEnumerator() | ForEach-Object { "`$env:$($_.Key) = '$($_.Value)'" }) -join "`n"
        $child = @"
`$env:PATH = '$bin' + '$sep' + `$env:PATH
`$env:FAKE_CALLS = '$calls'
`$env:VCM_BASE_URL = 'http://127.0.0.1:$port'
`$env:VCM_PULL_WAIT = '0'
$set
if (-not (Get-Command docker).Source.StartsWith('$bin')) { Write-Host 'REAL DOCKER ON PATH: refusing'; exit 99 }
& '$(Join-Path $home_ 'vcm.ps1')' update
exit `$LASTEXITCODE
"@
        $ErrorActionPreference = 'Continue'
        $out = & $exe -NoProfile -ExecutionPolicy Bypass -Command $child 2>&1 | Out-String
        $status = $LASTEXITCODE
        $made = Get-Content -Raw $calls
        $tmps = @(Get-ChildItem -Path $home_ -Filter '*.tmp').Count + @(Get-ChildItem -Path $home_ -Filter 'vcm-next.ps1').Count
        $prod = (Get-Content -Raw (Join-Path $home_ 'docker-compose.prod.yml')).Trim()
        $same = (Get-FileHash (Join-Path $home_ 'vcm.ps1')).Hash -eq (Get-FileHash $vcm).Hash
        $fromRelease = (Get-FileHash (Join-Path $home_ 'vcm.ps1')).Hash -eq (Get-FileHash (Join-Path $release 'vcm.ps1')).Hash
        return @{
            Status = $status; Out = $out; Calls = $made
            Unchanged = ($prod -eq 'old-prod' -and $same -and $tmps -eq 0 -and $made -notmatch ' up ')
            Updated = ($prod -eq 'new-prod' -and $fromRelease -and $tmps -eq 0 -and $made -match ' up ')
        }
    }

    function Check([string]$name, [bool]$passed, $run) {
        if ($passed) { Write-Host "PASS $name" } else { Write-Host "FAIL $name"; Write-Host $run.Out; $script:failures++ }
    }

    New-Release 'good'; $r = Invoke-Update
    Check 'the new version finishes the update' ($r.Status -eq 0 -and $r.Out -match 'finished by the new vcm') $r
    Check 'it pulls with the staged files, then puts them in place' ($r.Calls -match 'docker-compose\.prod\.yml\.tmp.* pull' -and $r.Updated) $r

    New-Release 'good' -BadSums; $r = Invoke-Update
    Check 'a bad checksum changes nothing' ($r.Status -ne 0 -and $r.Out -match "didn't match" -and $r.Unchanged -and $r.Calls -notmatch 'pull') $r

    New-Release 'broken'; $r = Invoke-Update
    Check "a new version that can't start: this one finishes" ($r.Status -eq 0 -and $r.Out -match 'Updated\.' -and $r.Updated) $r

    New-Release 'early'; $r = Invoke-Update
    Check 'a new version that stops before doing anything: this one finishes' ($r.Status -eq 0 -and $r.Out -match 'this one will' -and $r.Updated) $r

    New-Release 'good'; $r = Invoke-Update @{ FAKE_PULL_FAIL = '1' }
    Check 'no network mid-update leaves the install exactly as it was' ($r.Status -ne 0 -and $r.Out -match 'before changing anything' -and $r.Unchanged) $r

    $r = Invoke-Update @{ FAKE_ARCH = 'arm64'; FAKE_IMAGE_ARCH = 'amd64' }
    Check 'an ARM install on Intel/AMD images is told it downloads them in full once' ($r.Out -match 'native ARM images') $r
    $r = Invoke-Update @{ FAKE_ARCH = 'arm64'; FAKE_IMAGE_ARCH = 'arm64' }
    Check 'already native: nothing said' (-not ($r.Out -match 'native ARM images')) $r

    if ($script:failures -eq 0) { Write-Host 'ALL PASSED' } else { Write-Host "$($script:failures) FAILED"; exit 1 }
} finally {
    if ($server) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
    Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}
