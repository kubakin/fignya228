@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "RUSTDESK_EXE="

if exist "%ProgramFiles%\RustDesk\rustdesk.exe" set "RUSTDESK_EXE=%ProgramFiles%\RustDesk\rustdesk.exe"
if not defined RUSTDESK_EXE if exist "%ProgramFiles(x86)%\RustDesk\rustdesk.exe" set "RUSTDESK_EXE=%ProgramFiles(x86)%\RustDesk\rustdesk.exe"
if not defined RUSTDESK_EXE if exist "%LocalAppData%\Programs\RustDesk\rustdesk.exe" set "RUSTDESK_EXE=%LocalAppData%\Programs\RustDesk\rustdesk.exe"

if defined RUSTDESK_EXE (
  echo [run-worker-remote] Starting RustDesk: "%RUSTDESK_EXE%"
  start "" "%RUSTDESK_EXE%"
) else (
  echo [run-worker-remote] RustDesk not found. Install RustDesk to enable remote screen view.
)

echo [run-worker-remote] Starting worker with Chrome profile...
call "%SCRIPT_DIR%run-worker.cmd"
set "RC=%ERRORLEVEL%"

exit /b %RC%
