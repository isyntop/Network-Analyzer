@echo off
REM Windows 安装脚本：注册 Native Messaging Host
REM 用法: 以管理员身份运行 install-windows.bat

set HOST_NAME=com.network.analyzer
set SCRIPT_DIR=%~dp0
set BINARY_PATH=%SCRIPT_DIR%dist\windows-amd64\network_analyzer.exe

if not exist "%BINARY_PATH%" (
    echo ❌ 未找到可执行文件: %BINARY_PATH%
    echo    请先运行 build.sh 构建
    pause
    exit /b 1
)

REM 创建 manifest JSON 文件
set MANIFEST_PATH=%SCRIPT_DIR%com.network.analyzer.json

(
echo {
echo   "name": "%HOST_NAME%",
echo   "description": "Network Analyzer - 本地网络诊断工具",
echo   "path": "%BINARY_PATH:\=\\%",
echo   "type": "stdio",
echo   "allowed_origins": [
echo     "chrome-extension://EXTENSION_ID_PLACEHOLDER/"
echo   ]
echo }
) > "%MANIFEST_PATH%"

REM 注册到 Chrome（注册表）
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\%HOST_NAME%" /ve /t REG_SZ /d "%MANIFEST_PATH%" /f >nul 2>&1
echo ✅ 已注册到 Chrome

REM 注册到 Edge（注册表）
reg add "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\%HOST_NAME%" /ve /t REG_SZ /d "%MANIFEST_PATH%" /f >nul 2>&1
echo ✅ 已注册到 Edge

echo.
echo ⚠️  注意：请将 %MANIFEST_PATH% 中的 EXTENSION_ID_PLACEHOLDER 替换为实际的扩展 ID
echo.
echo 🎉 安装完成！重启浏览器后生效。
pause
