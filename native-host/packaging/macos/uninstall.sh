#!/bin/bash
# Network Analyzer Native Host 卸载脚本 (macOS)
# 用法: sudo ./uninstall.sh

set -e

HOST_NAME="com.network.analyzer"
INSTALL_DIR="/usr/local/lib/network-analyzer"

echo "🗑️  卸载 Network Analyzer 本地诊断组件..."

# 获取当前用户
CURRENT_USER="${SUDO_USER:-$USER}"
USER_HOME=$(eval echo "~$CURRENT_USER")

# 删除 Chrome 注册
CHROME_MANIFEST="$USER_HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/$HOST_NAME.json"
if [ -f "$CHROME_MANIFEST" ]; then
  rm -f "$CHROME_MANIFEST"
  echo "  ✅ 已移除 Chrome 注册"
fi

# 删除 Edge 注册
EDGE_MANIFEST="$USER_HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts/$HOST_NAME.json"
if [ -f "$EDGE_MANIFEST" ]; then
  rm -f "$EDGE_MANIFEST"
  echo "  ✅ 已移除 Edge 注册"
fi

# 删除安装目录
if [ -d "$INSTALL_DIR" ]; then
  rm -rf "$INSTALL_DIR"
  echo "  ✅ 已删除程序文件"
fi

# 忘记 pkg 安装记录
pkgutil --forget com.network.analyzer 2>/dev/null || true
echo "  ✅ 已清除安装记录"

echo ""
echo "🎉 卸载完成！请重启浏览器。"
