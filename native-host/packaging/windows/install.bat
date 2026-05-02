@echo off
REM Network Analyzer 诊断组件 - 一键安装 (Windows)
REM 双击运行即可安装，无需管理员权限

setlocal enabledelayedexpansion

set HOST_NAME=com.network.analyzer
set EXTENSION_ID=kpfbbomehbepffmhnbjmooahcfedpndg
set INSTALL_DIR=%LOCALAPPDATA%\Network-Analyzer
set SCRIPT_DIR=%~dp0

echo ============================================
echo   Network Analyzer 诊断组件安装程序
echo ============================================
echo.

if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"

copy /Y "%SCRIPT_DIR%network_analyzer.exe" "%INSTALL_DIR%\network_analyzer.exe" >nul
if errorlevel 1 (
    echo ❌ 复制文件失败
    pause
    exit /b 1
)
echo ✅ 已安装诊断程序到 %INSTALL_DIR%

set MANIFEST_PATH=%INSTALL_DIR%\%HOST_NAME%.json
set EXE_PATH=%INSTALL_DIR%\network_analyzer.exe
set "EXE_PATH_ESCAPED=!EXE_PATH:\=\\!"

(
echo {
echo   "name": "%HOST_NAME%",
echo   "description": "Network Analyzer - 本地网络诊断工具",
echo   "path": "!EXE_PATH_ESCAPED!",
echo   "type": "stdio",
echo   "allowed_origins": [
echo     "chrome-extension://%EXTENSION_ID%/"
echo   ]
echo }
) > "%MANIFEST_PATH%"

reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\%HOST_NAME%" /ve /t REG_SZ /d "%MANIFEST_PATH%" /f >nul 2>&1
echo ✅ 已注册到 Chrome

reg add "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\%HOST_NAME%" /ve /t REG_SZ /d "%MANIFEST_PATH%" /f >nul 2>&1
echo ✅ 已注册到 Edge

copy /Y "%SCRIPT_DIR%uninstall.bat" "%INSTALL_DIR%\uninstall.bat" >nul 2>&1

echo.
echo ============================================
echo   🎉 安装完成！请重启浏览器后使用。
echo   卸载：运行 %INSTALL_DIR%\uninstall.bat
echo ============================================
echo.
pause
