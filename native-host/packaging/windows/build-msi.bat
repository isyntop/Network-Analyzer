@echo off
REM 构建 Windows .msi 安装包
REM 前置条件: 安装 WiX Toolset v3 (https://wixtoolset.org/)
REM 前置条件: 先运行 build.sh 编译 Go 二进制

echo 📦 构建 Windows .msi 安装包...

set SCRIPT_DIR=%~dp0
set DIST_DIR=%SCRIPT_DIR%..\..\dist
set BINARY=%DIST_DIR%\windows-amd64\network_analyzer.exe

if not exist "%BINARY%" (
    echo ❌ 未找到二进制文件: %BINARY%
    echo    请先编译 Go 程序
    pause
    exit /b 1
)

REM 生成 Native Messaging Host manifest 文件（使用 [INSTALLFOLDER] 占位符）
echo 生成 manifest 文件...

(
echo {
echo   "name": "com.network.analyzer",
echo   "description": "Network Analyzer - 本地网络诊断工具",
echo   "path": "network_analyzer.exe",
echo   "type": "stdio",
echo   "allowed_origins": [
echo     "chrome-extension://*/"
echo   ]
echo }
) > "%SCRIPT_DIR%chrome_manifest.json"

copy "%SCRIPT_DIR%chrome_manifest.json" "%SCRIPT_DIR%edge_manifest.json" >nul

REM 编译 WiX
echo 编译 WiX...
candle.exe "%SCRIPT_DIR%product.wxs" -o "%SCRIPT_DIR%product.wixobj"
if errorlevel 1 (
    echo ❌ candle.exe 编译失败
    pause
    exit /b 1
)

REM 链接生成 MSI
echo 链接生成 MSI...
light.exe -ext WixUtilExtension "%SCRIPT_DIR%product.wixobj" -o "%DIST_DIR%\Network-Analyzer-Host-Windows.msi"
if errorlevel 1 (
    echo ❌ light.exe 链接失败
    pause
    exit /b 1
)

REM 清理临时文件
del "%SCRIPT_DIR%product.wixobj" 2>nul
del "%SCRIPT_DIR%chrome_manifest.json" 2>nul
del "%SCRIPT_DIR%edge_manifest.json" 2>nul

echo.
echo ✅ 构建完成: %DIST_DIR%\Network-Analyzer-Host-Windows.msi
echo.
echo 用户安装方式: 双击 .msi 文件，按提示完成安装
echo 卸载方式: 控制面板 → 程序和功能 → Network Analyzer 诊断组件 → 卸载
pause
