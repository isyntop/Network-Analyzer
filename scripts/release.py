#!/usr/bin/env python3
"""统一版本、构建验证和发布入口。"""

import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import zipfile


ROOT = Path(__file__).resolve().parent.parent
ASSETS = (
    "network-analyzer-extension.zip",
    "Network-Analyzer-Host-macOS-universal.pkg",
    "Network-Analyzer-Host-Windows-Setup.exe",
    "network-analyzer-host-macos.zip",
    "network-analyzer-host-windows.zip",
)
VERSION_RE = re.compile(r"v?((?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*))\Z")


def run(*args, cwd=ROOT, capture=False):
    result = subprocess.run(args, cwd=cwd, check=True, text=True,
                            stdout=subprocess.PIPE if capture else None)
    return result.stdout.strip() if capture else None


def version_number(value):
    match = VERSION_RE.fullmatch(value)
    if not match:
        raise ValueError("版本号须为 v主.次.修订，例如 v1.0.10")
    if any(int(part) > 65535 for part in match.group(1).split(".")):
        raise ValueError("扩展版本号的每一段不能大于 65535")
    return match.group(1)


def json_file(path):
    return json.loads((ROOT / path).read_text(encoding="utf-8"))


def write_json(path, data):
    (ROOT / path).write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n",
                                   encoding="utf-8")


def check_version(version):
    package = json_file("package.json")
    manifest = json_file("manifest.json")
    lock = json_file("package-lock.json")
    values = (package["version"], manifest["version"], lock["version"],
              lock["packages"][""]["version"])
    if any(value != version for value in values):
        raise ValueError(f"版本不一致，期望 {version}，实际 {values}")


def set_version(version):
    for name in ("package.json", "manifest.json"):
        data = json_file(name)
        data["version"] = version
        write_json(name, data)
    lock = json_file("package-lock.json")
    lock["version"] = version
    lock["packages"][""]["version"] = version
    write_json("package-lock.json", lock)
    check_version(version)


def native_reply(binary):
    request = json.dumps({"command": "ping_check"}).encode()
    result = subprocess.run([str(binary)], input=struct.pack("<I", len(request)) + request,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            timeout=15, check=True)
    if len(result.stdout) < 4:
        raise ValueError("本地程序未返回完整消息")
    size = struct.unpack("<I", result.stdout[:4])[0]
    return json.loads(result.stdout[4:4 + size])


def check_zip(path):
    with zipfile.ZipFile(path) as archive:
        if archive.testzip() is not None:
            raise ValueError(f"压缩包损坏: {path.name}")
        return archive.namelist()


def verify(version, directory, write_checksums=False):
    check_version(version)
    missing = [name for name in ASSETS if not (directory / name).is_file()]
    if missing:
        raise ValueError(f"缺少必需产物: {', '.join(missing)}")
    for name in ASSETS:
        if (directory / name).stat().st_size == 0:
            raise ValueError(f"空产物: {name}")

    for name in ASSETS:
        if name.endswith(".zip"):
            check_zip(directory / name)
    with zipfile.ZipFile(directory / ASSETS[0]) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        if manifest["version"] != version or "key" in manifest:
            raise ValueError("扩展压缩包版本错误或包含 key")

    with zipfile.ZipFile(directory / "network-analyzer-host-macos.zip") as archive:
        with tempfile.TemporaryDirectory() as temporary:
            binary = Path(temporary) / "network_analyzer"
            binary.write_bytes(archive.read("network_analyzer"))
            binary.chmod(0o755)
            archs = set(run("lipo", "-archs", str(binary), capture=True).split())
            if archs != {"x86_64", "arm64"}:
                raise ValueError(f"macOS 二进制架构错误: {archs}")
            if sys.platform == "darwin" and native_reply(binary).get("version") != version:
                raise ValueError("本地程序返回的版本不一致")

    with zipfile.ZipFile(directory / "network-analyzer-host-windows.zip") as archive:
        binary = archive.read("network_analyzer.exe")
        if binary[:2] != b"MZ":
            raise ValueError("Windows 诊断程序不是 PE 文件")
    if (directory / "Network-Analyzer-Host-Windows-Setup.exe").read_bytes()[:2] != b"MZ":
        raise ValueError("Windows 安装器不是 PE 文件")

    with tempfile.TemporaryDirectory() as temporary:
        expanded = Path(temporary) / "expanded"
        run("pkgutil", "--expand", str(directory / ASSETS[1]), str(expanded))
        package_info = (expanded / "PackageInfo").read_text()
        if f'version="{version}"' not in package_info:
            raise ValueError("macOS pkg 版本不一致")

    checksum_path = directory / "SHA256SUMS"
    checksums = "".join(
        f"{hashlib.sha256((directory / name).read_bytes()).hexdigest()}  {name}\n"
        for name in ASSETS
    )
    if write_checksums:
        checksum_path.write_text(checksums)
    elif not checksum_path.is_file() or checksum_path.read_text() != checksums:
        raise ValueError("校验和缺失或产物在准备后发生变化")
    print(f"验证通过: {directory}")


def build(version):
    check_version(version)
    destination = ROOT / "dist" / f"v{version}"
    if destination.exists():
        raise ValueError(f"产物目录已存在，请先检查或移走: {destination}")
    run("npm", "test")
    run("go", "test", "./...", cwd=ROOT / "native-host")
    with tempfile.TemporaryDirectory() as temporary:
        stage = Path(temporary)
        run("bash", str(ROOT / "native-host/build.sh"), version, str(stage))
        run("bash", str(ROOT / "scripts/pack-extension.sh"), str(stage))
        verify(version, stage, write_checksums=True)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(stage), destination)
    print(f"准备完成: {destination}")


def preview(version):
    with tempfile.TemporaryDirectory() as temporary:
        copy = Path(temporary) / "source"
        shutil.copytree(ROOT, copy, ignore=shutil.ignore_patterns(
            ".git", "dist", "node_modules", "packages", ".DS_Store", "__pycache__"))
        run("npm", "ci", cwd=copy)
        run(sys.executable, "scripts/release.py", "prepare", f"v{version}", cwd=copy)
    print("预演完成，工作区未修改")


def publish(version):
    check_version(version)
    directory = ROOT / "dist" / f"v{version}"
    verify(version, directory)
    if run("git", "branch", "--show-current", capture=True) != "main":
        raise ValueError("发布只允许在 main 分支执行")
    status = run("git", "status", "--porcelain", capture=True).splitlines()
    allowed = {"manifest.json", "package.json", "package-lock.json"}
    if any(line[3:] not in allowed for line in status):
        raise ValueError("存在版本文件以外的工作区改动，请先处理")
    tag = f"v{version}"
    if run("git", "tag", "-l", tag, capture=True):
        raise ValueError(f"标签已存在: {tag}")
    run("git", "fetch", "origin", "main", "--tags")
    if run("git", "rev-parse", "HEAD", capture=True) != run("git", "rev-parse", "origin/main", capture=True):
        raise ValueError("本地 main 与 origin/main 不一致")
    if run("git", "tag", "-l", tag, capture=True):
        raise ValueError(f"远端标签已存在: {tag}")
    run("git", "add", "manifest.json", "package.json", "package-lock.json")
    if run("git", "diff", "--cached", "--name-only", capture=True):
        run("git", "commit", "-m", f"发布准备：升级版本至 {version}")
    run("git", "tag", "-a", tag, "-m", f"发布 {tag}")
    run("git", "push", "origin", "main")
    run("git", "push", "origin", tag)
    print(f"已推送 {tag}；GitHub Actions 将构建、验证并创建 Release")


def main():
    parser = argparse.ArgumentParser(description="Network Analyzer 发布工具")
    parser.add_argument("action", choices=("prepare", "build", "verify", "preview", "publish"))
    parser.add_argument("version")
    args = parser.parse_args()
    version = version_number(args.version)
    if args.action == "preview":
        preview(version)
    elif args.action == "prepare":
        set_version(version)
        build(version)
    elif args.action == "build":
        build(version)
    elif args.action == "verify":
        verify(version, ROOT / "dist" / f"v{version}")
    else:
        publish(version)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, subprocess.CalledProcessError, OSError, KeyError, zipfile.BadZipFile) as error:
        print(f"发布流程失败: {error}", file=sys.stderr)
        sys.exit(1)
