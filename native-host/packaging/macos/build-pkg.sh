#!/bin/bash
# 构建 macOS .pkg 安装包
# 用法: ./build-pkg.sh <版本号> <通用二进制> <输出目录>

set -euo pipefail

VERSION="${1:?缺少版本号}"
BINARY="${2:?缺少通用二进制}"
DIST_DIR="${3:?缺少输出目录}"

cd "$(dirname "$0")"
PKG_ROOT="$(pwd)"

echo "📦 构建 macOS .pkg 安装包..."

if [ ! -f "$BINARY" ]; then
  echo "❌ 未找到二进制文件: $BINARY"
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
trap 'rm -rf "$PAYLOAD_DIR" "$SCRIPTS_DIR"' EXIT
cp "$PKG_ROOT/postinstall" "$SCRIPTS_DIR/postinstall"
chmod +x "$SCRIPTS_DIR/postinstall"

# 构建 .pkg
OUTPUT="$DIST_DIR/Network-Analyzer-Host-macOS-universal.pkg"
mkdir -p "$DIST_DIR"

pkgbuild \
  --root "$PAYLOAD_DIR" \
  --scripts "$SCRIPTS_DIR" \
  --identifier "com.network.analyzer" \
  --version "$VERSION" \
  --install-location "/" \
  "$OUTPUT"

echo ""
echo "✅ 构建完成: $OUTPUT"
echo ""
echo "用户安装方式: 双击 .pkg 文件，按提示完成安装"
echo "卸载方式: sudo /usr/local/lib/network-analyzer/uninstall.sh"
