#!/bin/bash
# macOS 安装脚本：注册 Native Messaging Host
# 用法: ./install-macos.sh

set -e

HOST_NAME="com.network.analyzer"
EXTENSION_ID="kpfbbomehbepffmhnbjmooahcfedpndg"
STORE_EXTENSION_ID="daenfnkblgiedkbkjnheiebnfhhmbbdo"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# 查找二进制文件
BINARY_PATH=""
for candidate in \
  "$SCRIPT_DIR/network_analyzer" \
  "$SCRIPT_DIR/dist/darwin-arm64/network_analyzer" \
  "$SCRIPT_DIR/dist/darwin-amd64/network_analyzer"; do
  if [ -f "$candidate" ]; then
    BINARY_PATH="$candidate"
    break
  fi
done

if [ -z "$BINARY_PATH" ]; then
  echo "❌ 未找到可执行文件 network_analyzer"
  exit 1
fi

chmod +x "$BINARY_PATH"

# 注册目录
CHROME_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
EDGE_DIR="$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts"

generate_manifest() {
  cat << EOF
{
  "name": "$HOST_NAME",
  "description": "Network Analyzer - 本地网络诊断工具",
  "path": "$BINARY_PATH",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$EXTENSION_ID/",
    "chrome-extension://$STORE_EXTENSION_ID/"
  ]
}
EOF
}

mkdir -p "$CHROME_DIR"
generate_manifest > "$CHROME_DIR/$HOST_NAME.json"
echo "✅ 已注册到 Chrome"

mkdir -p "$EDGE_DIR"
generate_manifest > "$EDGE_DIR/$HOST_NAME.json"
echo "✅ 已注册到 Edge"

echo ""
echo "🎉 安装完成！请重启浏览器后使用。"
