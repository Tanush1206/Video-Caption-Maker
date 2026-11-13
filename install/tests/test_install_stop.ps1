# install.ps1 stopping on a check that fails (v1.4.1): its own message and
# next step, and nothing after them. PowerShell used to add a red error
# block for the `throw` that ends the script (launch audit U4).
#
# Docker is hidden (an empty PATH), so the installer stops at its first check
# and never reaches a real Docker or a real install.
#
#   powershell -NoProfile -File install/tests/test_install_stop.ps1   (or pwsh)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$exe = (Get-Process -Id $PID).Path
$installer = [IO.Path]::Combine($here, '..', 'install.ps1')
$work = Join-Path ([IO.Path]::GetTempPath()) ("vcm-install-stop-" + [guid]::NewGuid().ToString('N'))
$empty = Join-Path $work 'empty'
New-Item -ItemType Directory -Force -Path $empty | Out-Null
try {
    $setup = "`$env:PATH = '$empty'; `$env:VCM_HOME = '$(Join-Path $work 'home')'; `$env:VCM_NO_OPEN = '1'"
    $script:failures = 0
    function Check([string]$name, [bool]$passed, [string]$out) {
        if ($passed) { Write-Host "PASS $name" } else { Write-Host "FAIL $name"; Write-Host $out; $script:failures++ }
    }
    $ErrorActionPreference = 'Continue'

    # Run as a file, as CI and scripts do.
    $out = & $exe -NoProfile -ExecutionPolicy Bypass -Command "$setup; & '$installer'; exit `$LASTEXITCODE" 2>&1 | Out-String
    $status = $LASTEXITCODE
    Check 'it says what is wrong and what to do' ($out -match 'Docker Desktop is not installed' -and $out -match 'run this installer again') $out
    Check 'nothing follows the message: no PowerShell error block' (-not ($out -match 'Installation stopped|CategoryInfo|FullyQualifiedErrorId|At line|At .*install\.ps1')) $out
    Check 'run as a file, it still ends with a failure status' ($status -ne 0) $out
    Check 'nothing was installed' (-not (Test-Path (Join-Path $work 'home'))) $out

    # Piped into iex, as the README's command does: the same message, and the
    # user's PowerShell window stays open.
    $out = & $exe -NoProfile -ExecutionPolicy Bypass -Command "$setup; Get-Content -Raw '$installer' | Invoke-Expression; Write-Host 'WINDOW STILL OPEN'" 2>&1 | Out-String
    Check 'through iex: the message, no error block' ($out -match 'Docker Desktop is not installed' -and -not ($out -match 'Installation stopped|CategoryInfo|FullyQualifiedErrorId')) $out
    Check 'through iex: the window stays open' ($out -match 'WINDOW STILL OPEN') $out

    if ($script:failures -eq 0) { Write-Host 'ALL PASSED' } else { Write-Host "$($script:failures) FAILED"; exit 1 }
} finally {
    Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}
