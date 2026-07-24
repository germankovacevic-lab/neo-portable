@echo off
REM ===========================================================================
REM NEO Portable - Windows daemon launcher
REM Started automatically by a "at logon" Scheduled Task (NeoPortableDaemon).
REM Runs in the user's INTERACTIVE session so GUI tasks (e.g. explorer.exe)
REM remain visible on the desktop - a real Windows Service (Session 0) would not.
REM
REM Secrets (RELAY_URL, AGENT_TOKEN, GEMINI_API_KEY) are read from persisted
REM USER environment variables (set once via setx). They are never hardcoded here.
REM Auto-restarts the daemon if it exits. Close this window to stop.
REM ===========================================================================
title NEO Portable daemon
cd /d "%~dp0..\.."
:loop
echo [neo-daemon] starting at %DATE% %TIME%
call "node_modules\.bin\tsx.cmd" src\cli.ts --daemon config\example.remote.gemini.yaml
echo [neo-daemon] exited with code %ERRORLEVEL% - restarting in 5s (close window to stop)
ping -n 6 127.0.0.1 >nul
goto loop
