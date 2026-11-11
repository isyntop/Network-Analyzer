#!/bin/bash
# 构建所有正式发布的本地诊断组件，产物只写入指定目录。
# 用法: ./native-host/build.sh <版本号> <输出目录>
set -euo pipefail

VERSION="${1:?缺少版本号}"
OUTPUT_DIR="${2:?缺少输出目录}"
HOST_DIR="$(cd "$(dirname "$0")" && pwd)"

for tool in go zip lipo pkgbuild; do
  command -v "$tool" >/dev/null || { echo "缺少构建工具: $tool" >&2; exit 1; }
done

mkdir -p "$OUTPUT_DIR"
OUTPUT_DIR="$(cd "$OUTPUT_DIR" && pwd)"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

echo "编译本地诊断组件 $VERSION"
cd "$HOST_DIR"
for arch in amd64 arm64; do
  GOOS=darwin GOARCH="$arch" go build \
    -ldflags="-s -w -X main.VERSION=$VERSION" \
    -o "$WORK_DIR/darwin-$arch/network_analyzer" .
done
GOOS=windows GOARCH=amd64 go build \
  -ldflags="-s -w -X main.VERSION=$VERSION" \
  -o "$WORK_DIR/network_analyzer.exe" .

lipo -create "$WORK_DIR/darwin-amd64/network_analyzer" \
  "$WORK_DIR/darwin-arm64/network_analyzer" \
  -output "$WORK_DIR/network_analyzer"

# 在临时目录编译安装器，避免在源码树留下嵌入载荷。
cp -R "$HOST_DIR/installer" "$WORK_DIR/installer"
mkdir -p "$WORK_DIR/installer/payload"
cp "$WORK_DIR/network_analyzer.exe" "$WORK_DIR/installer/payload/network_analyzer.exe"
(cd "$WORK_DIR/installer" && GOOS=windows GOARCH=amd64 go build \
  -ldflags="-s -w" \
  -o "$OUTPUT_DIR/Network-Analyzer-Host-Windows-Setup.exe" .)

mkdir -p "$WORK_DIR/mac-zip" "$WORK_DIR/win-zip"
cp "$WORK_DIR/network_analyzer" "$WORK_DIR/mac-zip/network_analyzer"
cp "$HOST_DIR/install-macos.sh" "$WORK_DIR/mac-zip/"
cp "$HOST_DIR/packaging/macos/uninstall.sh" "$WORK_DIR/mac-zip/uninstall.sh"
chmod +x "$WORK_DIR/mac-zip/"*
(cd "$WORK_DIR/mac-zip" && zip -q "$OUTPUT_DIR/network-analyzer-host-macos.zip" ./*)

cp "$WORK_DIR/network_analyzer.exe" "$WORK_DIR/win-zip/"
cp "$HOST_DIR/packaging/windows/install.bat" "$WORK_DIR/win-zip/"
cp "$HOST_DIR/packaging/windows/uninstall.bat" "$WORK_DIR/win-zip/"
(cd "$WORK_DIR/win-zip" && zip -q "$OUTPUT_DIR/network-analyzer-host-windows.zip" ./*)

bash "$HOST_DIR/packaging/macos/build-pkg.sh" \
  "$VERSION" "$WORK_DIR/network_analyzer" "$OUTPUT_DIR"

echo "本地诊断组件已生成: $OUTPUT_DIR"
