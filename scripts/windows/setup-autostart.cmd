@echo off
setlocal
REM ===========================================================================
REM NEO Portable - one-time Windows auto-start setup (NO admin required).
REM   1) Persists secrets (RELAY_URL/AGENT_TOKEN/GEMINI_API_KEY) from the CURRENT
REM      session to the USER environment via setx (values never printed).
REM   2) Installs a stub in the user's Startup folder that launches the daemon
REM      at logon, in the interactive session (GUI stays visible).
REM Run this once from the daemon's session (so the secrets are in env). Idempotent.
REM ===========================================================================
pushd "%~dp0..\.."
set "LAUNCHER=%CD%\scripts\windows\neo-daemon-launch.cmd"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "STUB=%STARTUP%\neo-portable-daemon.cmd"

echo == Persisting secrets to USER environment (values not shown) ==
if defined RELAY_URL (setx RELAY_URL "%RELAY_URL%" >nul && echo RELAY_URL: saved) else (echo RELAY_URL: MISSING in session)
if defined AGENT_TOKEN (setx AGENT_TOKEN "%AGENT_TOKEN%" >nul && echo AGENT_TOKEN: saved) else (echo AGENT_TOKEN: MISSING in session)
if defined GEMINI_API_KEY (setx GEMINI_API_KEY "%GEMINI_API_KEY%" >nul && echo GEMINI_API_KEY: saved) else (echo GEMINI_API_KEY: MISSING in session)

echo == Installing startup stub (no admin; runs at user logon, interactive) ==
> "%STUB%" echo @echo off
>> "%STUB%" echo call "%LAUNCHER%"

echo == Verify ==
reg query "HKCU\Environment" /v RELAY_URL >nul 2>&1 && echo RELAY_URL=PERSISTED || echo RELAY_URL=NOT_PERSISTED
reg query "HKCU\Environment" /v AGENT_TOKEN >nul 2>&1 && echo AGENT_TOKEN=PERSISTED || echo AGENT_TOKEN=NOT_PERSISTED
reg query "HKCU\Environment" /v GEMINI_API_KEY >nul 2>&1 && echo GEMINI_API_KEY=PERSISTED || echo GEMINI_API_KEY=NOT_PERSISTED
if exist "%STUB%" (echo STARTUP_STUB=INSTALLED) else (echo STARTUP_STUB=MISSING)
echo --- stub contents ---
type "%STUB%"
popd
echo SETUP_DONE
