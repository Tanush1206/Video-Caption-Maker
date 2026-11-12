# `vcm doctor` on Windows against a fake docker and a fake app (v1.4.0); the
# twin of test_vcm_doctor.sh: the report has what a bug report needs and none
# of the secrets the install holds.
#
#   powershell -NoProfile -File install/tests/test_vcm_doctor.ps1   (or pwsh)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$onWindows = [IO.Path]::DirectorySeparatorChar -eq '\'
$python = if ($onWindows) { 'python' } else { 'python3' }
$exe = if ($PSVersionTable.PSEdition -eq 'Core') { 'pwsh' } else { 'powershell' }
$work = Join-Path ([IO.Path]::GetTempPath()) ("vcm-doctor-" + [guid]::NewGuid().ToString('N'))
$app = Join-Path $work 'app'
$bin = Join-Path $work 'bin'
$vcmHome = Join-Path $work 'home'
$cwd = Join-Path $work 'cwd'
$fakeHome = Join-Path $work 'fakehome'
New-Item -ItemType Directory -Force -Path (Join-Path $app 'api'), $bin, $vcmHome, $cwd, $fakeHome | Out-Null
Set-Content -Path (Join-Path $app 'api/health') -Value '{"status":"ok"}' -Encoding ascii
Set-Content -Path (Join-Path $app 'api/system') -Value '{"version":"1.4.0","gemini_configured":true,"vocabulary": ["Ketan Sharma","Akrapovic"],"vocabulary_max":100}' -Encoding ascii
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0); $listener.Start()
$port = $listener.LocalEndpoint.Port; $listener.Stop()
$hidden = if ($onWindows) { @{ WindowStyle = 'Hidden' } } else { @{} }
$server = Start-Process -PassThru @hidden -FilePath $python -ArgumentList @('-m', 'http.server', $port, '--bind', '127.0.0.1', '--directory', $app) -ErrorAction Stop 2>$null
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
    Copy-Item ([IO.Path]::Combine($here, '..', 'vcm.ps1')) (Join-Path $vcmHome 'vcm.ps1')
    Set-Content -Path (Join-Path $vcmHome 'docker-compose.prod.yml') -Value '' -Encoding ascii
    Set-Content -Path (Join-Path $vcmHome '.env') -Encoding ascii -Value @(
        'POSTGRES_PASSWORD=pg-supersecret-123', 'JWT_SECRET_KEY=jwt-supersecret-456',
        'GEMINI_API_KEY=AIzaSyDUMMYDUMMYDUMMYDUMMYDUMMY1234567',
        'VCM_VERSION=1.4.0', 'VCM_VARIANT=cpu', "VCM_PORT=$port")
    $sep = [IO.Path]::PathSeparator
    $child = @"
`$env:PATH = '$bin' + '$sep' + `$env:PATH
`$env:USERPROFILE = '$fakeHome'
`$env:FAKE_HOME_PATH = '$fakeHome'
`$env:FAKE_CALLS = '$(Join-Path $work 'calls')'
if (-not (Get-Command docker).Source.StartsWith('$bin')) { Write-Host 'REAL DOCKER ON PATH: refusing'; exit 99 }
Set-Location '$cwd'
& '$(Join-Path $vcmHome 'vcm.ps1')' doctor
exit `$LASTEXITCODE
"@
    $ErrorActionPreference = 'Continue'
    $out = & $exe -NoProfile -ExecutionPolicy Bypass -Command $child 2>&1 | Out-String
    $status = $LASTEXITCODE
    $report = Get-ChildItem -Path $cwd -Filter 'vcm-doctor-*.txt' | Select-Object -First 1
    $text = if ($report) { Get-Content -Raw $report.FullName } else { '' }
    $script:failures = 0
    function Check([string]$name, [bool]$passed) {
        if ($passed) { Write-Host "PASS $name" } else { Write-Host "FAIL $name"; $script:failures++ }
    }
    function Has([string]$s) { return $text.Contains($s) }

    Check 'it writes a report in the current folder' ($status -eq 0 -and $null -ne $report)
    Check 'it says to review it before attaching' ($out -match 'Review it before attaching')
    Check 'the version, variant and port' ((Has 'VCM_VERSION=1.4.0') -and (Has 'VCM_VARIANT=cpu'))
    Check 'docker, compose, containers, health, system, logs' ((Has 'Docker Compose version v5.6.1') -and (Has 'vcm-backend-1  running') -and (Has '"status":"ok"') -and (Has '"gemini_configured":true') -and (Has 'worker-1'))
    Check 'no database password or JWT secret from .env' (-not (Has 'pg-supersecret') -and -not (Has 'jwt-supersecret'))
    Check 'no Gemini key' (-not (Has 'AIzaSyDUMMY'))
    Check 'no download token or bearer' (-not (Has 'eyJhbGci') -and -not (Has 'abc.def.ghi'))
    Check 'no password in a URL' (-not (Has 'hunter2'))
    Check 'no email address' (-not (Has 'someone@example.com'))
    Check 'no video file names' (-not (Has 'My Holiday') -and -not (Has 'TRIP.MOV'))
    Check 'no vocabulary words' (-not (Has 'Ketan Sharma') -and -not (Has 'Akrapovic'))
    Check 'no home folder' (-not (Has $fakeHome))
    Check 'sentence end kept' (Has 'burned <video>, then <video>.')

    if ($script:failures -eq 0) { Write-Host 'ALL PASSED' } else { Write-Host "$($script:failures) FAILED"; Write-Host $out; Write-Host $text; exit 1 }
} finally {
    if ($server) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
    Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}
