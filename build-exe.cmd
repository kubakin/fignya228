@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"

echo [build-exe] Папка проекта: %CD%
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js не найден в PATH.
  echo Установите LTS с https://nodejs.org/ ^(вместе с npm^) и запустите этот файл снова.
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo npm не найден в PATH.
  exit /b 1
)

echo [build-exe] node:
node -v
echo [build-exe] npm:
npm -v
echo.

if exist "package-lock.json" (
  echo [build-exe] npm ci
  call npm ci
) else (
  echo [build-exe] npm install
  call npm install
)
if errorlevel 1 (
  echo [build-exe] Ошибка установки зависимостей.
  exit /b 1
)

echo.
echo [build-exe] npm run build:exe
call npm run build:exe
if errorlevel 1 (
  echo [build-exe] Ошибка сборки exe.
  exit /b 1
)

echo.
echo [build-exe] Готово: dist\yt-worker.exe
exit /b 0
