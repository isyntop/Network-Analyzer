#!/bin/bash
# Network Analyzer Native Host - 完整构建脚本
# 用法: ./build.sh [--pkg]
#   --pkg  同时构建 macOS .pkg 安装包

set -e

cd "$(dirname "$0")"
NATIVE_HOST_DIR="$(pwd)"
DIST_DIR="$NATIVE_HOST_DIR/dist"

echo "🔨 构建 Network Analyzer Native Host..."
echo ""

# ─── 编译 Go 二进制 ─────────────────────────────────────────

echo "📦 编译 Go 二进制..."

echo "  → macOS amd64..."
GOOS=darwin GOARCH=amd64 go build -ldflags="-s -w" -o dist/darwin-amd64/network_analyzer .

echo "  → macOS arm64..."
GOOS=darwin GOARCH=arm64 go build -ldflags="-s -w" -o dist/darwin-arm64/network_analyzer .

echo "  → Windows amd64..."
GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o dist/windows-amd64/network_analyzer.exe .

echo "  ✅ 编译完成"
echo ""

# ─── 打包 Windows 安装包（zip）──────────────────────────────

echo "📦 打包 Windows 安装包..."

WIN_PKG_DIR=$(mktemp -d)
cp dist/windows-amd64/network_analyzer.exe "$WIN_PKG_DIR/"
cp packaging/windows/install.bat "$WIN_PKG_DIR/"
cp packaging/windows/uninstall.bat "$WIN_PKG_DIR/"

# 创建 zip
(cd "$WIN_PKG_DIR" && zip -q ../network-analyzer-host-windows.zip *)
mv "$(dirname "$WIN_PKG_DIR")/network-analyzer-host-windows.zip" dist/
rm -rf "$WIN_PKG_DIR"

echo "  ✅ dist/network-analyzer-host-windows.zip"
echo ""

# ─── 构建 Windows .exe 安装包 ───────────────────────────────

echo "📦 构建 Windows .exe 安装包..."

# 将 native host 二进制嵌入 installer
INSTALLER_DIR="$NATIVE_HOST_DIR/installer"
PAYLOAD_DIR="$INSTALLER_DIR/payload"
mkdir -p "$PAYLOAD_DIR"
cp dist/windows-amd64/network_analyzer.exe "$PAYLOAD_DIR/"

# 编译 installer（交叉编译为 Windows exe）
(cd "$INSTALLER_DIR" && GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o "$DIST_DIR/Network-Analyzer-Host-Windows-Setup.exe" .)

# 清理 payload
rm -rf "$PAYLOAD_DIR"

echo "  ✅ dist/Network-Analyzer-Host-Windows-Setup.exe"
echo ""

# ─── 构建 macOS .pkg（如果指定 --pkg）──────────────────────

if [ "$1" = "--pkg" ]; then
  echo "📦 构建 macOS .pkg 安装包..."
  chmod +x packaging/macos/build-pkg.sh
  chmod +x packaging/macos/postinstall
  chmod +x packaging/macos/uninstall.sh
  bash packaging/macos/build-pkg.sh
  echo ""
fi

# ─── 打包 macOS 安装包（zip，给没有 pkgbuild 的环境用）─────

echo "📦 打包 macOS 安装包..."

ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ]; then
  MAC_BINARY="dist/darwin-arm64/network_analyzer"
  MAC_ARCH="arm64"
else
  MAC_BINARY="dist/darwin-amd64/network_analyzer"
  MAC_ARCH="amd64"
fi

MAC_PKG_DIR=$(mktemp -d)
cp "$MAC_BINARY" "$MAC_PKG_DIR/network_analyzer"
cp install-macos.sh "$MAC_PKG_DIR/"
cp packaging/macos/uninstall.sh "$MAC_PKG_DIR/"
chmod +x "$MAC_PKG_DIR/network_analyzer"
chmod +x "$MAC_PKG_DIR/install-macos.sh"
chmod +x "$MAC_PKG_DIR/uninstall.sh"

(cd "$MAC_PKG_DIR" && zip -q ../network-analyzer-host-macos.zip *)
mv "$(dirname "$MAC_PKG_DIR")/network-analyzer-host-macos.zip" dist/
rm -rf "$MAC_PKG_DIR"

echo "  ✅ dist/network-analyzer-host-macos.zip"
echo ""

# ─── 汇总 ───────────────────────────────────────────────────

echo "============================================"
echo "  构建产物汇总"
echo "============================================"
echo ""
ls -lh dist/*.zip dist/*.pkg dist/*.exe 2>/dev/null || true
echo ""

# ─── 同步到项目根 dist/ 和 packages/ ────────────────────────

PROJECT_ROOT="$(cd "$NATIVE_HOST_DIR/.." && pwd)"
PROJECT_DIST="$PROJECT_ROOT/dist"
PACKAGES_DIR="$PROJECT_ROOT/packages"

mkdir -p "$PROJECT_DIST" "$PACKAGES_DIR"

cp dist/Network-Analyzer-Host-macOS-*.pkg "$PROJECT_DIST/" 2>/dev/null || true
cp dist/network-analyzer-host-macos.zip "$PROJECT_DIST/" 2>/dev/null || true
cp dist/network-analyzer-host-windows.zip "$PROJECT_DIST/" 2>/dev/null || true
cp dist/Network-Analyzer-Host-Windows-Setup.exe "$PROJECT_DIST/" 2>/dev/null || true

cp dist/Network-Analyzer-Host-macOS-*.pkg "$PACKAGES_DIR/Network-Analyzer-Host-macOS.pkg" 2>/dev/null || true
cp dist/network-analyzer-host-macos.zip "$PACKAGES_DIR/" 2>/dev/null || true
cp dist/network-analyzer-host-windows.zip "$PACKAGES_DIR/" 2>/dev/null || true
cp dist/Network-Analyzer-Host-Windows-Setup.exe "$PACKAGES_DIR/" 2>/dev/null || true

echo "✅ 已同步到项目根 dist/ 和 packages/"
echo ""
echo "macOS 用户: 双击 .pkg 安装（推荐）或解压 .zip 运行 install-macos.sh"
echo "Windows 用户: 双击 .exe 安装（推荐）或解压 .zip 运行 install.bat"
echo "卸载: macOS 运行 /usr/local/lib/network-analyzer/uninstall.sh"
echo "      Windows 运行 %LOCALAPPDATA%\\Network-Analyzer\\uninstall.exe --uninstall"
