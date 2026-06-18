@echo off
title HTML to PPTX
cd /d "%~dp0"

echo ============================================
echo    HTML to editable PPTX
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed.
  echo Please install it from https://nodejs.org and run again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Installing dependencies for the first time. Please wait...
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
  echo.
)

echo Opening the app window. Close the window to quit.
echo.
call node src/app.js

if errorlevel 1 (
  echo.
  echo The app exited with an error.
  pause
)
