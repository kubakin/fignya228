@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "RUSTDESK_EXE="

if exist "%ProgramFiles%\RustDesk\rustdesk.exe" set "RUSTDESK_EXE=%ProgramFiles%\RustDesk\rustdesk.exe"
if not defined RUSTDESK_EXE if exist "%ProgramFiles(x86)%\RustDesk\rustdesk.exe" set "RUSTDESK_EXE=%ProgramFiles(x86)%\RustDesk\rustdesk.exe"
if not defined RUSTDESK_EXE if exist "%LocalAppData%\Programs\RustDesk\rustdesk.exe" set "RUSTDESK_EXE=%LocalAppData%\Programs\RustDesk\rustdesk.exe"

if not defined RUSTDESK_EXE (
  echo [install-rustdesk] RustDesk not found. Installing via winget...
  where winget >nul 2>&1
  if errorlevel 1 (
    echo [install-rustdesk] ERROR: winget not found. Install RustDesk manually, then run run-worker-remote.cmd
    exit /b 1
  )

  winget install --id RustDesk.RustDesk --exact --source winget --accept-package-agreements --accept-source-agreements
  if errorlevel 1 (
    echo [install-rustdesk] ERROR: RustDesk installation failed.
    exit /b 1
  )
)

echo [install-rustdesk] Starting remote worker flow...
call "%SCRIPT_DIR%run-worker-remote.cmd"
set "RC=%ERRORLEVEL%"

exit /b %RC%
