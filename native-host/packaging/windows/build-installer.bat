@echo off
REM Build Windows .exe installer using Inno Setup
REM Prerequisites: Install Inno Setup from https://jrsoftware.org/isdl.php
REM Usage: build-installer.bat

setlocal

set SCRIPT_DIR=%~dp0
set ISCC="C:\Program Files (x86)\Inno Setup 6\ISCC.exe"

if not exist %ISCC% (
    echo [ERROR] Inno Setup not found at %ISCC%
    echo Please install from: https://jrsoftware.org/isdl.php
    pause
    exit /b 1
)

echo Building Windows installer...
%ISCC% "%SCRIPT_DIR%installer.iss"

if errorlevel 1 (
    echo [ERROR] Build failed
    pause
    exit /b 1
)

echo.
echo [OK] Installer built successfully
echo Output: dist\Network-Analyzer-Host-Windows-Setup.exe
pause
