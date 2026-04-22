@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "SRC_PROFILE=C:\Users\Administrator\AppData\Local\Google\Chrome\User Data"
set "DST_PROFILE=%SCRIPT_DIR%chrome-profile-cloned"

echo [run-worker-copy] Source profile: "%SRC_PROFILE%"
echo [run-worker-copy] Clone profile:  "%DST_PROFILE%"

if not exist "%SRC_PROFILE%" (
  echo [run-worker-copy] ERROR: source profile folder not found.
  exit /b 1
)

if not exist "%DST_PROFILE%" mkdir "%DST_PROFILE%"

echo [run-worker-copy] Copying Chrome profile...
robocopy "%SRC_PROFILE%" "%DST_PROFILE%" /E /R:1 /W:1 /NFL /NDL /NJH /NJS /NP /XD "Crashpad" "ShaderCache" "GrShaderCache"
set "RC=%ERRORLEVEL%"

rem Robocopy exit codes below 8 are success/warnings.
if %RC% GEQ 8 (
  echo [run-worker-copy] ERROR: robocopy failed with code %RC%
  exit /b %RC%
)

echo [run-worker-copy] Starting worker with cloned profile...
powershell -ExecutionPolicy Bypass -File "%SCRIPT_DIR%run-yt-worker.ps1" -ScriptName worker -UseChromeProfile -ChromeUserDataDir "%DST_PROFILE%"
set "PS_RC=%ERRORLEVEL%"

exit /b %PS_RC%
