@echo off
rem One-click launcher for the Hello Retail API Tester.
rem Starts the local server (serving the built UI) and opens it in the browser.
rem Close the "hr-api-tester server" window to stop it.

cd /d "%~dp0"

rem Build the UI only if it hasn't been built yet.
if not exist "dist\index.html" (
  echo Building the UI for the first time...
  call npm run build
)

rem Start the server in its own window so closing it stops the tool.
start "hr-api-tester server" cmd /k "node server/index.js"

rem Give the server a moment to come up, then open the browser.
timeout /t 2 /nobreak >nul
start "" "http://localhost:8787"
