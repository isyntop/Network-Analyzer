@echo off
chcp 65001 >nul 2>&1
REM Network Analyzer - Uninstall (Windows)
REM Double-click to uninstall

setlocal

set HOST_NAME=com.network.analyzer
set INSTALL_DIR=%LOCALAPPDATA%\Network-Analyzer

echo ============================================
echo   Network Analyzer Uninstall
echo ============================================
echo.

reg delete "HKCU\Software\Google\Chrome\NativeMessagingHosts\%HOST_NAME%" /f >nul 2>&1
echo [OK] Removed Chrome registration

reg delete "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\%HOST_NAME%" /f >nul 2>&1
echo [OK] Removed Edge registration

if exist "%INSTALL_DIR%\network_analyzer.exe" del /f "%INSTALL_DIR%\network_analyzer.exe"
if exist "%INSTALL_DIR%\%HOST_NAME%.json" del /f "%INSTALL_DIR%\%HOST_NAME%.json"

echo [OK] Deleted program files

echo.
echo ============================================
echo   Uninstall complete! Please restart browser.
echo ============================================
echo.
pause

del /f "%INSTALL_DIR%\uninstall.bat" >nul 2>&1
rmdir "%INSTALL_DIR%" >nul 2>&1
