@echo off
REM ============================================
REM  Build the Tailor System .exe installer
REM  Run this on YOUR computer, not the POS.
REM ============================================

echo [1/3] Building the frontend...
cd /d "%~dp0..\frontend"
call npm run build
if errorlevel 1 goto :error

echo [2/3] Installing desktop dependencies...
cd /d "%~dp0"
call npm install
if errorlevel 1 goto :error

echo [3/3] Packaging the installer (.exe)...
set "ELECTRON_BUILDER_CACHE=C:\EBCache"
call npx electron-builder --win

if errorlevel 1 goto :error

echo.
echo ============================================
echo  DONE! Your installer is in:
echo  desktop\dist\Tailor System Setup 1.0.0.exe
echo ============================================
pause
exit /b 0

:error
echo.
echo BUILD FAILED - read the error above.
pause
exit /b 1
