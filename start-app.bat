@echo off
chcp 65001 >nul
title HTML to PPTX - DEV
cd /d "%~dp0"

echo ============================================
echo   HTML -^> editable PPTX  (DEV app)
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [!] Node.js 가 설치되어 있지 않습니다.
  echo     https://nodejs.org 에서 설치 후 다시 실행하세요.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo [*] 의존성을 처음 설치합니다. 잠시 기다려 주세요...
  call npm install
  if errorlevel 1 (
    echo [!] npm install 실패.
    pause
    exit /b 1
  )
  echo.
)

echo [*] 앱 창을 엽니다. 창을 닫으면 종료됩니다.
echo.
node src/app.js

if errorlevel 1 (
  echo.
  echo [!] 앱 실행 중 오류가 발생했습니다.
  pause
)
