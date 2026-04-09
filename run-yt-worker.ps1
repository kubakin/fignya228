param(
  [string]$ScriptName = "fill",
  [switch]$SkipBrowserInstall
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

  if (Test-Path "package-lock.json") {
    Write-Step "Installing dependencies: npm ci"
    npm ci
  } else {
    Write-Step "Installing dependencies: npm install"
    npm install
  }

  if (-not $SkipBrowserInstall) {
    Write-Step "Installing Playwright Chromium"
    npx playwright install chromium
  }

  Write-Step "Running npm run $ScriptName"
  npm run $ScriptName

  Write-Host "[run-yt-worker] Done." -ForegroundColor Green
} catch {
  Write-Host "[run-yt-worker] Error: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}

