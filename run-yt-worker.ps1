param(
  [string]$ScriptName = "fill",
  [switch]$SkipBrowserInstall,
  [switch]$SkipDependenciesInstall,
  [switch]$UseChromeProfile,
  [int]$ChromeDebugPort = 9222,
  [string]$ChromeUserDataDir = "",
  [switch]$KeepChromeOpen
)

$ErrorActionPreference = "Stop"

function Write-Step([string]$msg) {
  Write-Host "[run-yt-worker] $msg" -ForegroundColor Cyan
}

function Refresh-Path {
  $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $user = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machine;$user"
}

function Ensure-NodePathHint {
  $defaultNodeDir = "C:\Program Files\nodejs"
  if ((Test-Path $defaultNodeDir) -and -not ($env:Path -like "*$defaultNodeDir*")) {
    $env:Path = "$defaultNodeDir;$env:Path"
  }
}

function Invoke-AndEnsureSuccess([scriptblock]$Command, [string]$ErrorMessage) {
  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw "$ErrorMessage (exit code: $LASTEXITCODE)"
  }
}

function Test-CdpEndpoint([int]$port) {
  try {
    $null = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$port/json/version" -TimeoutSec 2
    return $true
  } catch {
    return $false
  }
}

function Get-ChromePath {
  $candidates = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "$env:ProgramFiles(x86)\Google\Chrome\Application\chrome.exe",
    "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
  )
  foreach ($p in $candidates) {
    if (Test-Path $p) { return $p }
  }
  return $null
}

function Start-ChromeForProfile {
  param(
    [int]$Port,
    [string]$UserDataDir
  )

  if (Test-CdpEndpoint -port $Port) {
    Write-Step "Chrome CDP endpoint already available at :$Port"
    return $null
  }

  $chromePath = Get-ChromePath
  if (-not $chromePath) {
    throw "Google Chrome not found. Install Chrome or start it manually with --remote-debugging-port=$Port."
  }

  if ([string]::IsNullOrWhiteSpace($UserDataDir)) {
    $UserDataDir = Join-Path $PSScriptRoot "chrome-profile"
  }
  New-Item -ItemType Directory -Path $UserDataDir -Force | Out-Null

  Write-Step "Starting Chrome with persistent profile: $UserDataDir"
  $args = @(
    "--remote-debugging-port=$Port",
    "--user-data-dir=$UserDataDir",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-default-apps",
    "--disable-notifications",
    "--disable-features=ChromeWhatsNewUI,DesktopPWAsDefaultOff,DesktopPWAsTabStrip",
    "--disable-component-update",
    "--disable-sync",
    "--disable-background-networking",
    "--new-window",
    "https://www.youtube.com"
  )
  $proc = Start-Process -FilePath $chromePath -ArgumentList $args -PassThru

  $ok = $false
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-CdpEndpoint -port $Port) { $ok = $true; break }
  }
  if (-not $ok) {
    throw "Chrome started but CDP endpoint not reachable at http://127.0.0.1:$Port"
  }
  return $proc
}

function Ensure-Node {
  $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
  $npmCmd = Get-Command npm -ErrorAction SilentlyContinue
  if ($nodeCmd -and $npmCmd) {
    return
  }

  Write-Step "Node.js/npm not found. Installing Node.js LTS via winget..."
  $wingetCmd = Get-Command winget -ErrorAction SilentlyContinue
  if (-not $wingetCmd) {
    throw "winget not found. Install Node.js LTS manually from https://nodejs.org/ and run again."
  }

  & winget install --id OpenJS.NodeJS.LTS --exact --source winget --accept-package-agreements --accept-source-agreements
  Refresh-Path
  Ensure-NodePathHint

  $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
  $npmCmd = Get-Command npm -ErrorAction SilentlyContinue
  if (-not $nodeCmd -or -not $npmCmd) {
    throw "Node.js/npm not found after install. Restart PowerShell and try again. If needed, add 'C:\Program Files\nodejs' to PATH."
  }
}

try {
  Set-Location -Path $PSScriptRoot
  Write-Step "Working directory: $PSScriptRoot"
  Ensure-NodePathHint

  Ensure-Node

  Write-Step "node: $(node -v)"
  Write-Step "npm: $(npm -v)"

  if (-not $SkipDependenciesInstall) {
    if (Test-Path "package-lock.json") {
      Write-Step "Installing dependencies: npm ci"
      Invoke-AndEnsureSuccess { npm ci } "Dependency install failed (npm ci)"
    } else {
      Write-Step "Installing dependencies: npm install"
      Invoke-AndEnsureSuccess { npm install } "Dependency install failed (npm install)"
    }
  } else {
    Write-Step "Skipping dependencies install"
    $tsxBin = Join-Path $PSScriptRoot "node_modules\.bin\tsx.cmd"
    if (-not (Test-Path $tsxBin)) {
      throw "tsx not found (node_modules is missing or incomplete). Run without -SkipDependenciesInstall once."
    }
  }

  if (-not $SkipBrowserInstall) {
    Write-Step "Installing Playwright Chromium"
    Invoke-AndEnsureSuccess { npx playwright install chromium } "Playwright browser install failed"
  }

  $chromeProc = $null
  if ($UseChromeProfile) {
    $chromeProc = Start-ChromeForProfile -Port $ChromeDebugPort -UserDataDir $ChromeUserDataDir
    $env:PLAYWRIGHT_CDP_URL = "http://127.0.0.1:$ChromeDebugPort"
    $env:HEADLESS = "false"
    Write-Step "Using existing Chrome profile via CDP: $($env:PLAYWRIGHT_CDP_URL)"
  }

  Write-Step "Running npm run $ScriptName"
  Invoke-AndEnsureSuccess { npm run $ScriptName } "Script failed: npm run $ScriptName"

  if ($chromeProc -and -not $KeepChromeOpen) {
    try { Stop-Process -Id $chromeProc.Id -Force -ErrorAction SilentlyContinue } catch {}
  }

  Write-Host "[run-yt-worker] Done." -ForegroundColor Green
} catch {
  Write-Host "[run-yt-worker] Error: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}

