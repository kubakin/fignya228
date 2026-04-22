@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
powershell -ExecutionPolicy Bypass -File "%SCRIPT_DIR%run-yt-worker.ps1" -ScriptName worker -UseChromeProfile

endlocal
