# `vcm pull` on Windows against a fake docker (v1.3.1); the twin of
# test_vcm_pull.sh. Antivirus that scans HTTPS (Quick Heal, measured) breaks a
# few of Docker's TLS handshakes to GitHub's registry: the pull is tried
# again, and if it keeps failing the message says what to change.
#
#   powershell -NoProfile -File install/tests/test_vcm_pull.ps1   (or pwsh)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$work = Join-Path ([IO.Path]::GetTempPath()) ("vcm-pull-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
try {
    # Combine, not a backslash path: CI runs this under pwsh on Linux.
    Copy-Item ([IO.Path]::Combine($here, '..', 'vcm.ps1')) (Join-Path $work 'vcm.ps1')
    Set-Content -Path (Join-Path $work 'docker-compose.prod.yml') -Value '' -Encoding ascii
    Set-Content -Path (Join-Path $work '.env') -Value 'VCM_VARIANT=cpu' -Encoding ascii
    $fails = Join-Path $work 'fails'
    $calls = Join-Path $work 'calls'
    $tls = 'failed to copy: httpReadSeeker: failed open: failed to do request: Get "https://pkg-containers.githubusercontent.com/ghcrblobs15/blobs/sha256:435c": remote error: tls: error decoding message'
    $script:failures = 0

    function Invoke-Vcm([int]$failCount, [string]$says) {
        Set-Content -Path $fails -Value $failCount -Encoding ascii
        Set-Content -Path $calls -Value '' -Encoding ascii
        # The fake docker is a function in the child PowerShell, which shadows
        # docker.exe: `info` works; `compose ... pull` fails while the counter
        # is above 0, saying $says on its error stream (what `2>&1` takes from
        # docker.exe's stderr); anything else works.
        $fake = @"
function global:docker {
    if (`$args[0] -eq 'info') { `$global:LASTEXITCODE = 0; return }
    if (`$args[-1] -eq 'pull') {
        Add-Content -Path '$calls' -Value 'pull'
        `$left = [int](Get-Content '$fails')
        if (`$left -gt 0) {
            Set-Content -Path '$fails' -Value (`$left - 1)
            Write-Error '$($says -replace "'", "''")'
            `$global:LASTEXITCODE = 1; return
        }
    }
    `$global:LASTEXITCODE = 0
}
`$env:VCM_PULL_WAIT = '0'
& '$(Join-Path $work 'vcm.ps1')' pull
exit `$LASTEXITCODE
"@
        # 'Continue': on 5.1 a child's stderr line is a terminating error under 'Stop'.
        $ErrorActionPreference = 'Continue'
        $exe = if ($PSVersionTable.PSEdition -eq 'Core') { 'pwsh' } else { 'powershell' }
        $out = & $exe -NoProfile -ExecutionPolicy Bypass -Command $fake 2>&1 | Out-String
        return @{ Status = $LASTEXITCODE; Out = $out; Calls = @(Get-Content $calls | Where-Object { $_ }).Count }
    }

    function Check([string]$name, [bool]$passed, $run) {
        if ($passed) { Write-Host "PASS $name" } else { Write-Host "FAIL $name"; Write-Host $run.Out; $script:failures++ }
    }

    $r = Invoke-Vcm 1 $tls
    Check 'a TLS failure is tried again and the pull succeeds' ($r.Status -eq 0 -and $r.Calls -eq 2) $r
    Check 'it says it is trying again' ($r.Out -match 'trying again') $r

    $r = Invoke-Vcm 9 $tls
    Check 'it gives up after three tries' ($r.Status -ne 0 -and $r.Calls -eq 3) $r
    Check 'it names HTTPS scanning by antivirus' ($r.Out -match 'antivirus' -and $r.Out -match 'HTTPS') $r
    Check 'it names both hosts to allow' ($r.Out -match 'ghcr\.io' -and $r.Out -match 'pkg-containers\.githubusercontent\.com') $r

    $r = Invoke-Vcm 9 'no matching manifest for linux/arm64/v8 in the manifest list entries'
    Check 'a non-network failure is not tried again' ($r.Status -ne 0 -and $r.Calls -eq 1) $r
    Check 'and says nothing about antivirus' (-not ($r.Out -match 'antivirus')) $r

    # v1.4.1: a registry answering once in plain HTTP (seen on a clean install,
    # gone seconds later) is a passing fault like a dropped connection.
    $r = Invoke-Vcm 1 'failed to do request: Head "https://registry-1.docker.io/v2/chromadb/chroma/manifests/1.0.0": http: server gave HTTP response to HTTPS client'
    Check 'a plain-HTTP answer from the registry is tried again' ($r.Status -eq 0 -and $r.Calls -eq 2) $r

    if ($script:failures -eq 0) { Write-Host 'ALL PASSED' } else { Write-Host "$($script:failures) FAILED"; exit 1 }
} finally {
    Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}
