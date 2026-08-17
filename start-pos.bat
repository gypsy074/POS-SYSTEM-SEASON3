@echo off
rem Starts the Season 3 POS backend in this window (fallback to the NSSM
rem service — the service is the recommended way to run the café server).
cd /d "%~dp0backend"
node server.js
