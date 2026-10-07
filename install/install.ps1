# VideoCaptionMaker installer for Windows (PowerShell 5.1+).
#
#   irm https://github.com/Tanush1206/Video-Caption-Maker/releases/latest/download/install.ps1 | iex
#
# Checks Docker Desktop, disk space and the GPU, generates this install's
# secrets, pulls the images, starts everything, waits until it is healthy, and
# opens http://localhost:3000. Safe to run again: data and secrets are kept.
#
# Optional environment overrides: VCM_HOME, VCM_PORT, VCM_GPU (1/0),
# VCM_VERSION, VCM_REGISTRY, VCM_BASE_URL, VCM_NO_OPEN (1).

& {
    # 'Continue', not 'Stop': on PowerShell 5.1 any stderr line from a native
# command (docker prints progress there) becomes a terminating error under
# 'Stop', even when redirected. Native exit codes are checked explicitly, and
# cmdlets that must stop on failure say so with -ErrorAction Stop.
$ErrorActionPreference = 'Continue'
    $ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest is 10x slower with it
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

    $RepoUrl = 'https://github.com/Tanush1206/Video-Caption-Maker'
    $BaseUrl = if ($env:VCM_BASE_URL) { $env:VCM_BASE_URL } else { "$RepoUrl/releases/latest/download" }
    $VcmHome = if ($env:VCM_HOME) { $env:VCM_HOME } else { Join-Path $env:LOCALAPPDATA 'VideoCaptionMaker' }
    $Project = 'vcm'

    function Ok($m)   { Write-Host "  [ok] $m" -ForegroundColor Green }
    function Warn($m) { Write-Host "  [!]  $m" -ForegroundColor Yellow }
    function Info($m) { Write-Host "       $m" }
    function Fail($m, [string[]]$help) {
        Write-Host ""
        Write-Host "  [x] $m" -ForegroundColor Red
        foreach ($line in $help) { Write-Host "      $line" }
        Write-Host ""
        throw "Installation stopped: $m"
    }

    Write-Host "VideoCaptionMaker installer" -ForegroundColor White
    Write-Host ""

    # -- 1. Docker ------------------------------------------------------------
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        Fail 'Docker Desktop is not installed.' @(
            'Install it from https://docs.docker.com/desktop/setup/install/windows-install/',
            'Start it once so it finishes setting up, then run this installer again.')
    }
    docker info *> $null
    if ($LASTEXITCODE -ne 0) {
        Fail 'Docker Desktop is installed but not running.' @(
            'Start Docker Desktop from the Start menu, wait until it says "Engine running",',
            'then run this installer again.')
    }
    docker compose version *> $null
    if ($LASTEXITCODE -ne 0) { Fail 'Docker Compose v2 is missing.' @('Update Docker Desktop to a current version.') }
    $dockerVersion = (docker version --format '{{.Server.Version}}') 2>$null
    Ok "Docker $dockerVersion is running"

    # -- 2. GPU ---------------------------------------------------------------
    $variant = 'cpu'
    if ($env:VCM_GPU -eq '1') {
        $variant = 'cuda'
    } elseif ($env:VCM_GPU -ne '0' -and (Get-Command nvidia-smi -ErrorAction SilentlyContinue)) {
        # Docker Desktop (WSL2) passes NVIDIA GPUs through on its own; check it
        # actually does before choosing the CUDA image.
        docker run --rm --gpus all busybox:1.37 true *> $null
        if ($LASTEXITCODE -eq 0) {
            $variant = 'cuda'
        } else {
            Warn 'Found an NVIDIA GPU, but Docker Desktop cannot use it.'
            Info 'Update the NVIDIA driver and Docker Desktop (WSL 2 backend), then run this again.'
            Info 'Continuing with the CPU for now.'
        }
    }
    if ($variant -eq 'cuda') {
        $gpu = (nvidia-smi --query-gpu=name --format=csv,noheader 2>$null | Select-Object -First 1)
        Ok "NVIDIA GPU: $gpu"
    } else {
        Ok 'No usable NVIDIA GPU - using the CPU (works everywhere, just slower)'
    }

    # -- 3. Disk space --------------------------------------------------------
    # Docker Desktop keeps its disk image under %LOCALAPPDATA%\Docker by default.
    $need = if ($variant -eq 'cuda') { 12 } else { 8 }
    $drive = (Get-Item $env:LOCALAPPDATA).PSDrive
    $freeGb = [math]::Floor($drive.Free / 1GB)
    if ($freeGb -lt $need) {
        Fail "Not enough disk space on ${drive}: - $freeGb GB free, about $need GB needed." @(
            'Free some space (or run: docker system prune) and try again.')
    }
    Ok "$freeGb GB free on ${drive}: (about $need GB needed, more for your videos)"

    # -- 4. Files -------------------------------------------------------------
    New-Item -ItemType Directory -Force -Path (Join-Path $VcmHome 'certs') | Out-Null
    foreach ($file in @('docker-compose.prod.yml', 'docker-compose.gpu.yml', 'vcm.ps1', 'vcm.cmd')) {
        $target = Join-Path $VcmHome $file
        try {
            Invoke-WebRequest -ErrorAction Stop -UseBasicParsing -Uri "$BaseUrl/$file" -OutFile "$target.tmp"
            Move-Item -ErrorAction Stop -Force "$target.tmp" $target
        } catch {
            Remove-Item -ErrorAction SilentlyContinue "$target.tmp"
            Fail "Couldn't download $file from $BaseUrl" @('Check your internet connection and try again.')
        }
    }
    Ok "Installed to $VcmHome"

    # -- 5. Secrets and settings (.env) ---------------------------------------
    $envFile = Join-Path $VcmHome '.env'
    function New-Secret {
        $bytes = New-Object byte[] 32
        [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
        -join ($bytes | ForEach-Object { $_.ToString('x2') })
    }
    $values = [ordered]@{}
    if (Test-Path $envFile) {
        foreach ($line in [IO.File]::ReadAllLines($envFile)) {
            if ($line -match '^([A-Z_]+)=(.*)$') { $values[$Matches[1]] = $Matches[2] }
        }
        Ok "Kept existing settings and secrets"
    } else {
        $values['POSTGRES_PASSWORD'] = New-Secret
        $values['JWT_SECRET_KEY'] = New-Secret
        Ok "Generated this install's secrets"
    }

    function Test-PortFree([int]$port) {
        $client = New-Object Net.Sockets.TcpClient
        try { $client.Connect('127.0.0.1', $port); $client.Close(); return $false } catch { return $true }
    }
    $port = if ($env:VCM_PORT) { $env:VCM_PORT } elseif ($values['VCM_PORT']) { $values['VCM_PORT'] } else { '' }
    if (-not $port) {
        $port = '3000'
        $ours = (docker compose -p $Project ps --status running 2>$null | Select-String 'frontend')
        if (-not (Test-PortFree 3000) -and -not $ours) {
            foreach ($candidate in 3001, 3002, 3003, 3004, 3005, 3080, 8080) {
                if (Test-PortFree $candidate) { $port = "$candidate"; break }
            }
            Warn "Port 3000 is taken; using $port instead"
        }
    }
    $values['VCM_PORT'] = $port
    $values['VCM_VARIANT'] = $variant
    $values['VCM_VERSION'] = if ($env:VCM_VERSION) { $env:VCM_VERSION } elseif ($values['VCM_VERSION']) { $values['VCM_VERSION'] } else { 'latest' }
    if ($env:VCM_REGISTRY) { $values['VCM_REGISTRY'] = $env:VCM_REGISTRY }

    $body = "# Generated by the installer. Keep this file private; it is never uploaded.`n"
    foreach ($key in $values.Keys) { $body += "$key=$($values[$key])`n" }
    # No BOM and LF endings: docker compose reads a BOM as part of the first key.
    [IO.File]::WriteAllText($envFile, $body, (New-Object Text.UTF8Encoding $false))

    # -- 6. vcm command on PATH -----------------------------------------------
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    if (($userPath -split ';') -notcontains $VcmHome) {
        [Environment]::SetEnvironmentVariable('Path', "$userPath;$VcmHome".Trim(';'), 'User')
        Ok "Added the 'vcm' command (open a new terminal to use it)"
    } else {
        Ok "The 'vcm' command is ready"
    }
    $vcm = Join-Path $VcmHome 'vcm.ps1'

    # -- 7. Pull, start, wait -------------------------------------------------
    Write-Host ""
    Write-Host "Downloading the app (first time: a few GB, this can take a while)..." -ForegroundColor White
    & powershell -NoProfile -ExecutionPolicy Bypass -File $vcm pull
    if ($LASTEXITCODE -ne 0) { Fail "Couldn't download the images." @('Check your internet connection and run the installer again - it resumes.') }
    Write-Host "Starting..." -ForegroundColor White
    & powershell -NoProfile -ExecutionPolicy Bypass -File $vcm up
    if ($LASTEXITCODE -ne 0) { Fail 'The app failed to start.' @('See what happened with:  vcm logs') }

    $url = "http://localhost:$port"
    Write-Host -NoNewline "  Waiting for it to be ready"
    $ready = $false
    for ($i = 0; $i -lt 120; $i++) {
        try {
            Invoke-WebRequest -ErrorAction Stop -UseBasicParsing -Uri "$url/api/health" -TimeoutSec 5 | Out-Null
            $ready = $true; break
        } catch { Write-Host -NoNewline '.'; Start-Sleep -Seconds 3 }
    }
    Write-Host ""
    if (-not $ready) { Fail "It started but isn't answering yet." @("Give it a minute and open $url, or check:  vcm status  /  vcm logs") }
    Ok "Running at $url"

    if ($env:VCM_NO_OPEN -ne '1') { Start-Process $url }

    Write-Host ""
    Write-Host "Done. Open $url" -ForegroundColor White
    Info 'The first video also downloads the speech model (0.5-3 GB, once).'
    Info 'vcm start | stop | update | status | logs | uninstall'
    Write-Host ""
}
