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

function Invoke-Compose([string[]]$arguments) {
    $files = @('-f', (Join-Path $VcmHome 'docker-compose.prod.yml'))
    if ((Get-EnvValue 'VCM_VARIANT') -eq 'cuda') { $files += @('-f', (Join-Path $VcmHome 'docker-compose.gpu.yml')) }
    $all = @('compose', '-p', $Project, '--env-file', $EnvFile, '--project-directory', $VcmHome) + $files + $arguments
    & docker @all
    if ($LASTEXITCODE -ne 0) { throw "docker compose $($arguments -join ' ') failed" }
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
        'pull'    { Assert-Docker; Invoke-Compose @('pull') }
        'stop'    { Assert-Docker; Invoke-Compose @('stop'); Write-Host "Stopped. Your videos are kept; 'vcm start' brings it back." }
        'restart' { Assert-Docker; Invoke-Compose @('stop'); Invoke-Compose @('up', '-d'); Wait-Ready | Out-Null }
        'status'  { Assert-Docker; Invoke-Compose @('ps') }
        'logs'    { Assert-Docker; $a = @('logs', '-f', '--tail', '200'); if ($Service) { $a += $Service }; Invoke-Compose $a }
        'open'    { Start-Process $Url }
        'update'  {
            Assert-Docker
            Write-Host 'Fetching the latest version...'
            foreach ($file in @('docker-compose.prod.yml', 'docker-compose.gpu.yml', 'vcm.ps1', 'vcm.cmd')) {
                $target = Join-Path $VcmHome $file
                Invoke-WebRequest -ErrorAction Stop -UseBasicParsing -Uri "$BaseUrl/$file" -OutFile "$target.tmp"
                Move-Item -ErrorAction Stop -Force "$target.tmp" $target
            }
            Invoke-Compose @('pull')
            Invoke-Compose @('up', '-d', '--remove-orphans')
            Wait-Ready | Out-Null
            docker image prune -f *> $null
            Write-Host 'Updated.'
        }
        'uninstall' {
            Assert-Docker
            Write-Host 'This removes VideoCaptionMaker from this computer.'
            Invoke-Compose @('down', '--remove-orphans')
            $answer = Read-Host 'Also delete ALL your videos, captions and downloaded models? This cannot be undone. Type DELETE to confirm, or press Enter to keep them'
            $deleted = $false
            if ($answer -ceq 'DELETE') {
                Invoke-Compose @('down', '-v')
                $deleted = $true
                Write-Host 'Deleted your data.'
            } else {
                Write-Host "Kept your data (Docker volumes named ${Project}_*). Reinstalling picks it up again."
            }
            try { Invoke-Compose @('down', '--rmi', 'all') } catch { }
            $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
            $kept = ($userPath -split ';' | Where-Object { $_ -and $_ -ne $VcmHome }) -join ';'
            [Environment]::SetEnvironmentVariable('Path', $kept, 'User')
            if ($deleted) {
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
