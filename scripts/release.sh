#!/bin/bash
# Network Analyzer 发布脚本
#
# 用法:
#   ./scripts/release.sh v1.0.0          # 构建 + 打 tag + 推送 + 创建 GitHub Release
#   ./scripts/release.sh v1.0.0 --dry    # 仅构建，不推送
#
# 前置条件:
#   - 安装 GitHub CLI: brew install gh
#   - 登录: gh auth login

set -e

VERSION="${1:?用法: ./scripts/release.sh v1.0.0}"
DRY_RUN="${2}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_DIR"

# 从 tag 中提取纯版本号（去掉 v 前缀）
SEMVER="${VERSION#v}"

echo "🚀 发布 Network Analyzer $VERSION"
echo ""

# ─── 0. 同步版本号到 manifest.json 和 package.json ──────────

echo "📦 步骤 0: 同步版本号 → $SEMVER"

# 更新 manifest.json 中的 version 字段
python3 -c "
import json
with open('manifest.json', 'r') as f:
    m = json.load(f)
m['version'] = '$SEMVER'
with open('manifest.json', 'w') as f:
    json.dump(m, f, indent=2, ensure_ascii=False)
    f.write('\n')
"

# 更新 package.json 中的 version 字段
python3 -c "
import json
with open('package.json', 'r') as f:
    m = json.load(f)
m['version'] = '$SEMVER'
with open('package.json', 'w') as f:
    json.dump(m, f, indent=2, ensure_ascii=False)
    f.write('\n')
"

echo "  ✅ manifest.json → $SEMVER"
echo "  ✅ package.json  → $SEMVER"
echo ""

# ─── 1. 构建 Native Host ────────────────────────────────────

echo "📦 步骤 1/5: 构建 Native Host..."
cd native-host
./build.sh --pkg
cd "$PROJECT_DIR"

# ─── 2. 复制安装包到 packages/ ──────────────────────────────

echo ""
echo "📦 步骤 2/5: 更新 packages/..."
cp native-host/dist/Network-Analyzer-Host-macOS-*.pkg packages/Network-Analyzer-Host-macOS.pkg 2>/dev/null || true
cp native-host/dist/network-analyzer-host-macos.zip packages/ 2>/dev/null || true
cp native-host/dist/network-analyzer-host-windows.zip packages/ 2>/dev/null || true
cp native-host/dist/Network-Analyzer-Host-Windows-Setup.exe packages/ 2>/dev/null || true

# ─── 3. 打包扩展 ────────────────────────────────────────────

echo ""
echo "📦 步骤 3/5: 打包扩展..."
./scripts/pack-extension.sh

# ─── 4. 汇总 Release 文件 ───────────────────────────────────

echo ""
echo "📦 步骤 4/5: 汇总 Release 文件..."

RELEASE_DIR="$PROJECT_DIR/dist"
echo ""
echo "Release 文件:"
ls -lh "$RELEASE_DIR"/network-analyzer-extension.zip
ls -lh "$RELEASE_DIR"/network-analyzer-host-*.zip 2>/dev/null || true
ls -lh "$RELEASE_DIR"/Network-Analyzer-Host-macOS-*.pkg 2>/dev/null || true

if [ "$DRY_RUN" = "--dry" ]; then
  echo ""
  echo "⏸️  Dry run 模式，跳过 git 操作"
  echo "   手动发布: gh release create $VERSION dist/* --title '$VERSION' --notes-file -"
  exit 0
fi

# ─── 5. Git tag + push + GitHub Release ─────────────────────

echo ""
echo "📦 步骤 5/5: 创建 Git tag 并推送..."

# 提交版本号变更
git add manifest.json package.json
if ! git diff --cached --quiet; then
  git commit -m "chore: bump version to $SEMVER"
  echo "  ✅ 已提交版本号变更"
fi

# 检查 tag 是否已存在
if git rev-parse "$VERSION" >/dev/null 2>&1; then
  echo "⚠️  Tag $VERSION 已存在，跳过创建"
else
  git tag -a "$VERSION" -m "Release $VERSION"
  echo "  ✅ 已创建 tag: $VERSION"
fi

git push origin main --tags
echo "  ✅ 已推送到 origin"

# 创建 GitHub Release
if command -v gh &>/dev/null; then
  echo ""
  echo "📤 创建 GitHub Release..."

  RELEASE_NOTES="## Network Analyzer $VERSION

### 安装方式

**浏览器扩展：**
- Chrome Web Store 安装（推荐）
- 或下载 \`network-analyzer-extension.zip\` 解压后开发者模式加载

**本地诊断组件（Ping/MTR 功能需要）：**
- macOS: 下载 \`.pkg\` 双击安装
- Windows: 下载 \`.exe\` 双击安装

### 文件说明

| 文件 | 说明 |
|------|------|
| \`network-analyzer-extension.zip\` | 浏览器扩展（上传商店或开发者模式加载） |
| \`Network-Analyzer-Host-macOS-*.pkg\` | macOS Native Host 安装包 |
| \`Network-Analyzer-Host-Windows-Setup.exe\` | Windows Native Host 安装包 |
| \`network-analyzer-host-macos.zip\` | macOS（zip 格式备选） |
| \`network-analyzer-host-windows.zip\` | Windows（zip 格式备选） |
"

  # 收集要上传的文件（只上传扩展 zip，Native Host 已打包在扩展内）
  ASSETS=("$RELEASE_DIR/network-analyzer-extension.zip")

  echo "$RELEASE_NOTES" | gh release create "$VERSION" \
    "${ASSETS[@]}" \
    --title "Network Analyzer $VERSION" \
    --notes-file -

  echo ""
  echo "✅ GitHub Release 已创建！"
  echo "   https://github.com/isyntop/Network-Analyzer/releases/tag/$VERSION"
else
  echo ""
  echo "⚠️  未安装 GitHub CLI (gh)，请手动创建 Release："
  echo "   1. 打开 https://github.com/isyntop/Network-Analyzer/releases/new"
  echo "   2. Tag: $VERSION"
  echo "   3. 上传以下文件："
  ls "$RELEASE_DIR"/network-analyzer-extension.zip
  ls "$RELEASE_DIR"/Network-Analyzer-Host-macOS-*.pkg 2>/dev/null || true
  ls "$RELEASE_DIR"/network-analyzer-host-macos.zip 2>/dev/null || true
  ls "$RELEASE_DIR"/network-analyzer-host-windows.zip 2>/dev/null || true
fi

echo ""
echo "🎉 发布完成！"
