@echo off
REM Network Analyzer 诊断组件 - 卸载 (Windows)
REM 双击运行即可卸载

setlocal

set HOST_NAME=com.network.analyzer
set INSTALL_DIR=%LOCALAPPDATA%\Network-Analyzer

echo ============================================
echo   Network Analyzer 诊断组件卸载程序
echo ============================================
echo.

REM 删除 Chrome 注册
reg delete "HKCU\Software\Google\Chrome\NativeMessagingHosts\%HOST_NAME%" /f >nul 2>&1
echo ✅ 已移除 Chrome 注册

REM 删除 Edge 注册
reg delete "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\%HOST_NAME%" /f >nul 2>&1
echo ✅ 已移除 Edge 注册

REM 删除安装目录（延迟删除自身）
if exist "%INSTALL_DIR%\network_analyzer.exe" del /f "%INSTALL_DIR%\network_analyzer.exe"
if exist "%INSTALL_DIR%\%HOST_NAME%.json" del /f "%INSTALL_DIR%\%HOST_NAME%.json"

echo ✅ 已删除程序文件

echo.
echo ============================================
echo   🎉 卸载完成！请重启浏览器。
echo ============================================
echo.
pause

REM 最后删除自身和目录
del /f "%INSTALL_DIR%\uninstall.bat" >nul 2>&1
rmdir "%INSTALL_DIR%" >nul 2>&1
