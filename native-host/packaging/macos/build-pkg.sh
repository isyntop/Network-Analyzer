#!/bin/bash
# 构建 macOS .pkg 安装包
# 用法: ./build-pkg.sh
# 前置条件: 先运行 ../../build.sh 编译 Go 二进制

set -e

cd "$(dirname "$0")"
NATIVE_HOST_DIR="$(cd ../.. && pwd)"
PKG_ROOT="$NATIVE_HOST_DIR/packaging/macos"
DIST_DIR="$NATIVE_HOST_DIR/dist"

echo "📦 构建 macOS .pkg 安装包..."

# 检测当前架构，选择对应二进制
ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ]; then
  BINARY="$DIST_DIR/darwin-arm64/network_analyzer"
  PKG_ARCH="arm64"
else
  BINARY="$DIST_DIR/darwin-amd64/network_analyzer"
  PKG_ARCH="amd64"
fi

if [ ! -f "$BINARY" ]; then
  echo "❌ 未找到二进制文件: $BINARY"
  echo "   请先运行: cd $NATIVE_HOST_DIR && ./build.sh"
  exit 1
fi

# 创建临时 payload 目录
PAYLOAD_DIR=$(mktemp -d)
INSTALL_DIR="$PAYLOAD_DIR/usr/local/lib/network-analyzer"
mkdir -p "$INSTALL_DIR"

# 复制二进制和卸载脚本
cp "$BINARY" "$INSTALL_DIR/network_analyzer"
cp "$PKG_ROOT/uninstall.sh" "$INSTALL_DIR/uninstall.sh"
chmod +x "$INSTALL_DIR/network_analyzer"
chmod +x "$INSTALL_DIR/uninstall.sh"

# 创建 scripts 目录（postinstall）
SCRIPTS_DIR=$(mktemp -d)
cp "$PKG_ROOT/postinstall" "$SCRIPTS_DIR/postinstall"
chmod +x "$SCRIPTS_DIR/postinstall"

# 构建 .pkg
OUTPUT="$DIST_DIR/Network-Analyzer-Host-macOS-${PKG_ARCH}.pkg"
mkdir -p "$DIST_DIR"

pkgbuild \
  --root "$PAYLOAD_DIR" \
  --scripts "$SCRIPTS_DIR" \
  --identifier "com.network.analyzer" \
  --version "1.0.0" \
  --install-location "/" \
  "$OUTPUT"

# 清理临时目录
rm -rf "$PAYLOAD_DIR" "$SCRIPTS_DIR"

echo ""
echo "✅ 构建完成: $OUTPUT"
echo ""
echo "用户安装方式: 双击 .pkg 文件，按提示完成安装"
echo "卸载方式: sudo /usr/local/lib/network-analyzer/uninstall.sh"
