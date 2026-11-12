# vcm - run VideoCaptionMaker (Windows).
#
#   vcm start       start the app and open it in the browser
#   vcm stop        stop it (your videos stay)
#   vcm restart     stop, then start
#   vcm status      what is running, and whether it is healthy
#   vcm logs [svc]  follow the logs (all services, or e.g. `vcm logs worker`)
#   vcm update      download the newest version and restart into it
#   vcm open        open the app in the browser
#   vcm uninstall   remove the app; asks before deleting your videos
param([string]$Command = 'help', [string]$Service = '')

# 'Continue', not 'Stop': on PowerShell 5.1 any stderr line from a native
# command (docker prints progress there) becomes a terminating error under
# 'Stop', even when redirected. Native exit codes are checked explicitly, and
# cmdlets that must stop on failure say so with -ErrorAction Stop.
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
$VcmHome = $PSScriptRoot
$RepoUrl = 'https://github.com/Tanush1206/Video-Caption-Maker'
$BaseUrl = if ($env:VCM_BASE_URL) { $env:VCM_BASE_URL } else { "$RepoUrl/releases/latest/download" }
$Project = 'vcm'
$EnvFile = Join-Path $VcmHome '.env'

function Get-EnvValue([string]$key) {
    if (-not (Test-Path $EnvFile)) { return '' }
    foreach ($line in [IO.File]::ReadAllLines($EnvFile)) {
        if ($line -match "^$key=(.*)$") { return $Matches[1] }
    }
    return ''
}
$Port = Get-EnvValue 'VCM_PORT'; if (-not $Port) { $Port = '3000' }
$Url = "http://localhost:$Port"

# '.tmp': the files an update has staged, not the installed ones.
$ComposeSuffix = ''

function Get-ComposeFiles {
    $files = @('-f', (Join-Path $VcmHome "docker-compose.prod.yml$script:ComposeSuffix"))
    if ((Get-EnvValue 'VCM_VARIANT') -eq 'cuda') { $files += @('-f', (Join-Path $VcmHome "docker-compose.gpu.yml$script:ComposeSuffix")) }
    return $files
}

function Invoke-Compose([string[]]$arguments) {
    $files = Get-ComposeFiles
    $all = @('compose', '-p', $Project, '--env-file', $EnvFile, '--project-directory', $VcmHome) + $files + $arguments
    & docker @all
    if ($LASTEXITCODE -ne 0) { throw "docker compose $($arguments -join ' ') failed" }
}

# Antivirus that scans HTTPS breaks a few of Docker's TLS handshakes to
# GitHub's registry (v1.3.1): with Quick Heal's scanning on, 5 in 120 from
# Docker failed with "tls: error decoding message", none with it off and none
# from Windows itself. A pull keeps the layers it already has, so trying again
# fetches only what failed.
$PullTries = 3
$TlsTrouble = 'tls: |x509|certificate|decoding message|bad record mac'
$Dropped = 'i/o timeout|connection reset|unexpected eof'

function Invoke-Pull {
    $files = Get-ComposeFiles
    $all = @('compose', '-p', $Project, '--env-file', $EnvFile, '--project-directory', $VcmHome) + $files + @('pull')
    $wait = if ($env:VCM_PULL_WAIT) { [int]$env:VCM_PULL_WAIT } else { 5 }
    for ($try = 1; ; $try++) {
        # Shown as it comes, and kept to decide what went wrong.
        $said = (& docker @all 2>&1 | ForEach-Object { $line = "$_"; Write-Host $line; $line }) -join "`n"
        if ($LASTEXITCODE -eq 0) { return }
        if ($try -ge $PullTries -or $said -notmatch "$TlsTrouble|$Dropped") { break }
        Write-Host "The download was interrupted; trying again ($($try + 1) of $PullTries)..." -ForegroundColor Yellow
        Start-Sleep -Seconds $wait
    }
    if ($said -match $TlsTrouble) {
        Write-Host ''
        Write-Host "Couldn't download the images: the secure connection to GitHub's image registry kept failing." -ForegroundColor Red
        Write-Host 'This is usually antivirus software that scans HTTPS traffic (for example Quick Heal).'
        Write-Host 'To fix it, either:'
        Write-Host '  - turn off its HTTPS (web) scanning while this runs, then turn it back on; or'
        Write-Host '  - add an exception for ghcr.io and pkg-containers.githubusercontent.com.'
        Write-Host 'Then try again. Nothing was changed.'
    }
    throw 'docker compose pull failed'
}

# `vcm update` (v1.4.0) hands the update over to the version it has just
# downloaded and checked, so what an update says and does is the new
# version's own. The new one first answers `__handover` with this token,
# then runs `__finish-update`; if it can't start, or exits 3 (stopped before
# changing anything), the running version finishes the update itself.
$Handover = 'vcm-handover-1'
$UpdateFiles = @('docker-compose.prod.yml', 'docker-compose.gpu.yml', 'vcm.ps1', 'vcm.cmd')

# An ARM install made before v1.4.0 runs the Intel/AMD images, emulated;
# its first update to native images downloads them in full.
function Test-SwitchingToArm {
    $arch = (docker version --format '{{.Server.Arch}}') 2>$null
    if ($arch -notin @('arm64', 'aarch64')) { return $false }
    $image = (docker inspect --format '{{.Image}}' "$Project-backend-1") 2>$null
    if (-not $image) { return $false }
    return ((docker image inspect --format '{{.Architecture}}' $image) 2>$null) -eq 'amd64'
}

# The files staged as *.tmp (checked against SHA256SUMS) put to use: pulled
# with first and moved into place only after, so a download that fails
# leaves the install exactly as it was.
function Complete-Update {
    if (Test-SwitchingToArm) {
        Write-Host 'This update moves the app to native ARM images, so it downloads them in full'
        Write-Host 'once (about 1 GB). Updates after this one are small again.'
    }
    $script:ComposeSuffix = '.tmp'
    try {
        Invoke-Pull
    } catch {
        ($UpdateFiles + @('SHA256SUMS')) | ForEach-Object { Remove-Item -ErrorAction SilentlyContinue (Join-Path $VcmHome "$_.tmp") }
        throw 'The update stopped before changing anything: the app is still on the version you had.'
    } finally {
        $script:ComposeSuffix = ''
    }
    foreach ($file in $UpdateFiles) {
        Move-Item -ErrorAction Stop -Force (Join-Path $VcmHome "$file.tmp") (Join-Path $VcmHome $file)
    }
    Remove-Item -ErrorAction SilentlyContinue (Join-Path $VcmHome 'SHA256SUMS.tmp')
    Invoke-Compose @('up', '-d', '--remove-orphans')
    Wait-Ready | Out-Null
    # Only this app's old images (the ones the update just replaced, now
    # untagged), never anything else on the machine.
    docker image prune -f --filter 'label=org.opencontainers.image.source=https://github.com/Tanush1206/Video-Caption-Maker' *> $null
    Write-Host 'Updated.'
}

function Assert-Docker {
    docker info *> $null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Docker isn't running. Start Docker Desktop and try again." -ForegroundColor Red
        exit 1
    }
}

function Wait-Ready {
    Write-Host -NoNewline 'Waiting for the app'
    for ($i = 0; $i -lt 120; $i++) {
        try {
            Invoke-WebRequest -ErrorAction Stop -UseBasicParsing -Uri "$Url/api/health" -TimeoutSec 5 | Out-Null
            Write-Host " - ready at $Url"
            return $true
        } catch { Write-Host -NoNewline '.'; Start-Sleep -Seconds 3 }
    }
    Write-Host ''
    Write-Host 'Not answering yet. Check: vcm status / vcm logs' -ForegroundColor Yellow
    return $false
}

try {
    switch ($Command) {
        'start'   { Assert-Docker; Invoke-Compose @('up', '-d'); if (Wait-Ready) { Start-Process $Url } }
        'up'      { Assert-Docker; Invoke-Compose @('up', '-d') }
        'pull'    { Assert-Docker; Invoke-Pull }
        'stop'    { Assert-Docker; Invoke-Compose @('stop'); Write-Host "Stopped. Your videos are kept; 'vcm start' brings it back." }
        'restart' { Assert-Docker; Invoke-Compose @('stop'); Invoke-Compose @('up', '-d'); Wait-Ready | Out-Null }
        'status'  { Assert-Docker; Invoke-Compose @('ps', '-a') }
        'logs'    { Assert-Docker; $a = @('logs', '-f', '--tail', '200'); if ($Service) { $a += $Service }; Invoke-Compose $a }
        'open'    { Start-Process $Url }
        'update'  {
            Assert-Docker
            Write-Host 'Fetching the latest version...'
            # All downloaded and checked against SHA256SUMS before any is replaced.
            $files = $UpdateFiles
            $temps = ($files + @('SHA256SUMS')) | ForEach-Object { Join-Path $VcmHome "$_.tmp" }
            try {
                foreach ($file in $files + @('SHA256SUMS')) {
                    Invoke-WebRequest -ErrorAction Stop -UseBasicParsing -Uri "$BaseUrl/$file" -OutFile (Join-Path $VcmHome "$file.tmp")
                }
                $sums = @{}
                foreach ($line in [IO.File]::ReadAllLines((Join-Path $VcmHome 'SHA256SUMS.tmp'))) {
                    if ($line -match '^([0-9a-fA-F]{64})\s+\*?(.+)$') { $sums[$Matches[2]] = $Matches[1].ToLower() }
                }
                foreach ($file in $files) {
                    $actual = (Get-FileHash -Algorithm SHA256 (Join-Path $VcmHome "$file.tmp")).Hash.ToLower()
                    if (-not $sums.ContainsKey($file) -or $sums[$file] -ne $actual) {
                        throw "$file didn't match the release's SHA256SUMS; nothing was changed."
                    }
                }
            } catch {
                $temps | ForEach-Object { Remove-Item -ErrorAction SilentlyContinue $_ }
                throw
            }
            # Run as a .ps1 (-File needs the extension), from this folder.
            $next = Join-Path $VcmHome 'vcm-next.ps1'
            Copy-Item -Force (Join-Path $VcmHome 'vcm.ps1.tmp') $next
            $exe = if ($PSVersionTable.PSEdition -eq 'Core') { 'pwsh' } else { 'powershell' }
            try {
                $token = (& $exe -NoProfile -ExecutionPolicy Bypass -File $next __handover) 2>$null
                if ("$token".Trim() -eq $Handover) {
                    & $exe -NoProfile -ExecutionPolicy Bypass -File $next __finish-update
                    if ($LASTEXITCODE -ne 3) { exit $LASTEXITCODE }
                    Write-Host "The new version couldn't finish the update; this one will." -ForegroundColor Yellow
                }
            } finally {
                Remove-Item -ErrorAction SilentlyContinue $next
            }
            Complete-Update
        }
        '__handover' { Write-Output $Handover }
        '__finish-update' {
            # Run by the previous version, the new files staged as *.tmp. Exit 3:
            # nothing done yet, so the previous version can finish instead.
            docker info *> $null
            if ($LASTEXITCODE -ne 0) { exit 3 }
            foreach ($file in $UpdateFiles + @('SHA256SUMS')) {
                if (-not (Test-Path (Join-Path $VcmHome "$file.tmp"))) { exit 3 }
            }
            Complete-Update
        }
        'uninstall' {
            Assert-Docker
            Write-Host 'This removes VideoCaptionMaker from this computer.'
            # Asked before anything stops: `down -v` only removes the anonymous
            # volumes (redis /data) of containers it is removing in the same call.
            $answer = Read-Host 'Also delete ALL your videos, captions and downloaded models? This cannot be undone. Type DELETE to confirm, or press Enter to keep them'
            $deleted = $false
            if ($answer -ceq 'DELETE') {
                Invoke-Compose @('down', '--remove-orphans', '-v')
                $deleted = $true
                Write-Host 'Deleted your data.'
            } else {
                Invoke-Compose @('down', '--remove-orphans')
                Write-Host "Kept your data (Docker volumes named ${Project}_*). Reinstalling picks it up again."
            }
            # Only this app's own images. postgres, redis and chroma are shared
            # base images that other projects on this machine may be using.
            try {
                Invoke-Compose @('config', '--images') | Where-Object { $_ -match '/video-caption-maker-' } |
                    Sort-Object -Unique | ForEach-Object { docker image rm $_ *> $null }
            } catch { }
            $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
            $kept = ($userPath -split ';' | Where-Object { $_ -and $_ -ne $VcmHome }) -join ';'
            [Environment]::SetEnvironmentVariable('Path', $kept, 'User')
            # Never a directory this script did not install into.
            if ($deleted -and (Test-Path (Join-Path $VcmHome 'docker-compose.prod.yml')) -and
                ($VcmHome -ne $env:USERPROFILE)) {
                Set-Location $env:USERPROFILE
                Remove-Item -Recurse -Force $VcmHome
            } else {
                # .env holds the database password the kept data is locked with.
                Write-Host "Kept $VcmHome too: it holds the password for your kept data."
            }
            Write-Host 'Uninstalled.'
        }
        default {
            Get-Content $PSCommandPath -TotalCount 10 | Select-Object -Skip 1 | ForEach-Object { $_ -replace '^# ?', '' }
        }
    }
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
