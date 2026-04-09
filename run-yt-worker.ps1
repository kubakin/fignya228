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

function Ensure-Node {
  $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
  $npmCmd = Get-Command npm -ErrorAction SilentlyContinue
  if ($nodeCmd -and $npmCmd) {
    return
  }

  Write-Step "Node.js/npm не найдены. Пытаюсь установить Node.js LTS через winget..."
  $wingetCmd = Get-Command winget -ErrorAction SilentlyContinue
  if (-not $wingetCmd) {
    throw "winget не найден. Установите Node.js LTS вручную: https://nodejs.org/ и запустите скрипт снова."
  }

  & winget install --id OpenJS.NodeJS.LTS --exact --accept-package-agreements --accept-source-agreements
  Refresh-Path

  $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
  $npmCmd = Get-Command npm -ErrorAction SilentlyContinue
  if (-not $nodeCmd -or -not $npmCmd) {
    throw "Node.js/npm не обнаружены после установки. Перезапустите PowerShell и попробуйте снова."
  }
}

try {
  Set-Location -Path $PSScriptRoot
  Write-Step "Рабочая папка: $PSScriptRoot"

  Ensure-Node

  Write-Step "node: $(node -v)"
  Write-Step "npm: $(npm -v)"

  if (Test-Path "package-lock.json") {
    Write-Step "Устанавливаю зависимости: npm ci"
    npm ci
  } else {
    Write-Step "Устанавливаю зависимости: npm install"
    npm install
  }

  if (-not $SkipBrowserInstall) {
    Write-Step "Устанавливаю Chromium для Playwright"
    npx playwright install chromium
  }

  Write-Step "Запускаю npm run $ScriptName"
  npm run $ScriptName

  Write-Host "[run-yt-worker] Готово." -ForegroundColor Green
} catch {
  Write-Host "[run-yt-worker] Ошибка: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}

