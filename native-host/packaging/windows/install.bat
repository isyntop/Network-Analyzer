@echo off
chcp 65001 >nul 2>&1
REM Network Analyzer - One-click Install (Windows)
REM Double-click to install, no admin required

setlocal enabledelayedexpansion

set HOST_NAME=com.network.analyzer
set EXTENSION_ID=kpfbbomehbepffmhnbjmooahcfedpndg
set STORE_EXTENSION_ID=daenfnkblgiedkbkjnheiebnfhhmbbdo
set INSTALL_DIR=%LOCALAPPDATA%\Network-Analyzer
set SCRIPT_DIR=%~dp0

echo ============================================
echo   Network Analyzer Install
echo ============================================
echo.

if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"

copy /Y "%SCRIPT_DIR%network_analyzer.exe" "%INSTALL_DIR%\network_analyzer.exe" >nul
if errorlevel 1 (
    echo [ERROR] Failed to copy files
    pause
    exit /b 1
)
echo [OK] Installed to %INSTALL_DIR%

set MANIFEST_PATH=%INSTALL_DIR%\%HOST_NAME%.json
set EXE_PATH=%INSTALL_DIR%\network_analyzer.exe
set "EXE_PATH_ESCAPED=!EXE_PATH:\=\\!"

(
echo {
echo   "name": "%HOST_NAME%",
echo   "description": "Network Analyzer Native Host",
echo   "path": "!EXE_PATH_ESCAPED!",
echo   "type": "stdio",
echo   "allowed_origins": [
echo     "chrome-extension://%EXTENSION_ID%/",
echo     "chrome-extension://%STORE_EXTENSION_ID%/"
echo   ]
echo }
) > "%MANIFEST_PATH%"

reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\%HOST_NAME%" /ve /t REG_SZ /d "%MANIFEST_PATH%" /f >nul 2>&1
echo [OK] Registered to Chrome

reg add "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\%HOST_NAME%" /ve /t REG_SZ /d "%MANIFEST_PATH%" /f >nul 2>&1
echo [OK] Registered to Edge

copy /Y "%SCRIPT_DIR%uninstall.bat" "%INSTALL_DIR%\uninstall.bat" >nul 2>&1

echo.
echo ============================================
echo   Install complete! Please restart browser.
echo   Uninstall: %INSTALL_DIR%\uninstall.bat
echo ============================================
echo.
pause
