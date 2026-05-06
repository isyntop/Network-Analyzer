#!/bin/bash
# 打包 Network Analyzer 扩展
#
# 用法:
#   ./scripts/pack-extension.sh          # 生成商店上传用的 .zip
#   ./scripts/pack-extension.sh --crx    # 同时生成企业分发用的 .crx
#
# 输出:
#   dist/network-analyzer-extension.zip   — 上传 Chrome Web Store / Edge Add-ons
#   dist/network-analyzer.crx             — 企业内部分发（需要 --crx 参数）
#   dist/network-analyzer.pem             — .crx 签名私钥（首次生成，请妥善保管）

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DIST_DIR="$PROJECT_DIR/dist"

mkdir -p "$DIST_DIR"

# ─── 需要打包的文件（排除开发文件）───────────────────────────

EXTENSION_FILES=(
  manifest.json
  background.js
  api-client.js
  config.js
  content.js
  timing-utils.js
  popup.html
  popup.js
  popup.css
  setup.html
  setup.js
  icons/icon16.png
  icons/icon48.png
  icons/icon128.png
)

# ─── 1. 生成商店上传用 .zip ──────────────────────────────────

echo "📦 打包扩展 .zip（商店上传用）..."

ZIP_FILE="$DIST_DIR/network-analyzer-extension.zip"
rm -f "$ZIP_FILE"

# 进入项目目录打包（保持相对路径）
cd "$PROJECT_DIR"

# 检查所有文件存在
MISSING=0
for f in "${EXTENSION_FILES[@]}"; do
  if [ ! -f "$f" ]; then
    echo "  ⚠️  缺少文件: $f"
    MISSING=1
  fi
done

if [ "$MISSING" -eq 1 ]; then
  echo ""
  echo "❌ 部分扩展源文件缺失"
  exit 1
fi

# 商店上传的 zip 中 manifest.json 不能包含 "key" 字段
# 创建临时目录，复制文件，移除 key 字段后打包
TMP_PACK=$(mktemp -d)
for f in "${EXTENSION_FILES[@]}"; do
  mkdir -p "$TMP_PACK/$(dirname "$f")"
  cp "$f" "$TMP_PACK/$f"
done

# 移除 manifest.json 中的 "key" 字段
python3 -c "
import json, sys
with open('$TMP_PACK/manifest.json', 'r') as f:
    m = json.load(f)
m.pop('key', None)
with open('$TMP_PACK/manifest.json', 'w') as f:
    json.dump(m, f, indent=2, ensure_ascii=False)
" 2>/dev/null || {
  # 如果没有 python3，用 sed 移除（兼容方案）
  sed -i.bak '/"key":/d' "$TMP_PACK/manifest.json"
  # 清理可能残留的逗号
  sed -i.bak 'N;s/,\n}/\n}/' "$TMP_PACK/manifest.json"
  rm -f "$TMP_PACK/manifest.json.bak"
}

(cd "$TMP_PACK" && zip -r "$ZIP_FILE" . -x "*.DS_Store") >/dev/null
rm -rf "$TMP_PACK"

echo "  ✅ $ZIP_FILE ($(du -h "$ZIP_FILE" | cut -f1))"

# ─── 2. 生成企业分发用 .crx（可选）──────────────────────────

if [ "$1" = "--crx" ]; then
  echo ""
  echo "📦 打包扩展 .crx（企业分发用）..."

  # 检查是否有 Chrome/Chromium
  CHROME=""
  for candidate in \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    "/Applications/Chromium.app/Contents/MacOS/Chromium" \
    "google-chrome" \
    "chromium-browser" \
    "chromium"; do
    if command -v "$candidate" &>/dev/null || [ -x "$candidate" ]; then
      CHROME="$candidate"
      break
    fi
  done

  if [ -z "$CHROME" ]; then
    echo "  ⚠️  未找到 Chrome/Chromium，使用 openssl 手动打包 .crx..."

    PEM_FILE="$DIST_DIR/network-analyzer.pem"
    CRX_FILE="$DIST_DIR/network-analyzer.crx"

    # 生成私钥（如果不存在）
    if [ ! -f "$PEM_FILE" ]; then
      openssl genrsa -out "$PEM_FILE" 2048 2>/dev/null
      echo "  🔑 已生成签名私钥: $PEM_FILE（请妥善保管！）"
    fi

    # 创建临时目录放扩展文件
    TMP_DIR=$(mktemp -d)
    for f in "${EXTENSION_FILES[@]}"; do
      mkdir -p "$TMP_DIR/$(dirname "$f")"
      cp "$f" "$TMP_DIR/$f"
    done

    # 打包为 zip
    TMP_ZIP=$(mktemp).zip
    (cd "$TMP_DIR" && zip -r "$TMP_ZIP" . -x "*.DS_Store") >/dev/null

    # 签名
    openssl sha256 -sign "$PEM_FILE" -out "$TMP_DIR/sig" "$TMP_ZIP" 2>/dev/null

    # 导出公钥 DER
    openssl rsa -pubout -outform DER -in "$PEM_FILE" -out "$TMP_DIR/pub" 2>/dev/null

    # 构建 CRX3 格式
    # CRX3 header: magic(4) + version(4) + header_length(4) + header_proto
    # 简化版：使用 CRX2 格式（更简单，Chrome 仍然支持）
    PUB_LEN=$(wc -c < "$TMP_DIR/pub" | tr -d ' ')
    SIG_LEN=$(wc -c < "$TMP_DIR/sig" | tr -d ' ')
    ZIP_CONTENT=$(cat "$TMP_ZIP")

    {
      # CRX2 magic number
      printf 'Cr24'
      # Version 2
      printf '\x02\x00\x00\x00'
      # Public key length (little-endian uint32)
      printf "$(printf '%08x' "$PUB_LEN" | sed 's/\(..\)\(..\)\(..\)\(..\)/\\x\4\\x\3\\x\2\\x\1/')"
      # Signature length (little-endian uint32)
      printf "$(printf '%08x' "$SIG_LEN" | sed 's/\(..\)\(..\)\(..\)\(..\)/\\x\4\\x\3\\x\2\\x\1/')"
      # Public key
      cat "$TMP_DIR/pub"
      # Signature
      cat "$TMP_DIR/sig"
      # ZIP content
      cat "$TMP_ZIP"
    } > "$CRX_FILE"

    rm -rf "$TMP_DIR" "$TMP_ZIP"

    echo "  ✅ $CRX_FILE ($(du -h "$CRX_FILE" | cut -f1))"
    echo "  🔑 私钥: $PEM_FILE"
  else
    # 使用 Chrome 打包
    CRX_FILE="$DIST_DIR/network-analyzer.crx"
    PEM_FILE="$DIST_DIR/network-analyzer.pem"

    # 创建临时扩展目录
    TMP_EXT=$(mktemp -d)
    for f in "${EXTENSION_FILES[@]}"; do
      mkdir -p "$TMP_EXT/$(dirname "$f")"
      cp "$f" "$TMP_EXT/$f"
    done

    if [ -f "$PEM_FILE" ]; then
      "$CHROME" --pack-extension="$TMP_EXT" --pack-extension-key="$PEM_FILE" --no-message-box 2>/dev/null || true
    else
      "$CHROME" --pack-extension="$TMP_EXT" --no-message-box 2>/dev/null || true
    fi

    # Chrome 输出 .crx 和 .pem 在临时目录旁边
    CHROME_CRX="${TMP_EXT}.crx"
    CHROME_PEM="${TMP_EXT}.pem"

    if [ -f "$CHROME_CRX" ]; then
      mv "$CHROME_CRX" "$CRX_FILE"
      echo "  ✅ $CRX_FILE ($(du -h "$CRX_FILE" | cut -f1))"
    fi
    if [ -f "$CHROME_PEM" ] && [ ! -f "$PEM_FILE" ]; then
      mv "$CHROME_PEM" "$PEM_FILE"
      echo "  🔑 已生成签名私钥: $PEM_FILE（请妥善保管！）"
    fi

    rm -rf "$TMP_EXT"
  fi
fi

# ─── 汇总 ───────────────────────────────────────────────────

echo ""
echo "============================================"
echo "  打包完成"
echo "============================================"
echo ""
ls -lh "$DIST_DIR"/network-analyzer-extension.zip "$DIST_DIR"/network-analyzer.crx 2>/dev/null || true
echo ""
echo "📤 Chrome Web Store 上传: dist/network-analyzer-extension.zip"
echo "   → https://chrome.google.com/webstore/devconsole"
echo ""
echo "📤 Edge Add-ons 上传: dist/network-analyzer-extension.zip（同一个文件）"
echo "   → https://partner.microsoft.com/dashboard/microsoftedge"
echo ""
if [ -f "$DIST_DIR/network-analyzer.crx" ]; then
  echo "🏢 企业分发: dist/network-analyzer.crx"
  echo "   → 通过企业策略或内部网站分发给用户"
  echo ""
fi
echo "⚠️  注意：用户安装插件后，还需要安装 Native Host 诊断组件"
echo "   插件会自动引导用户下载安装"
