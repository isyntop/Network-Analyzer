#!/usr/bin/env python3
"""通过原生消息协议验证已安装的诊断组件版本。"""

import json
from pathlib import Path
import struct
import subprocess
import sys


def main():
    binary = Path(sys.argv[1])
    version = sys.argv[2]
    request = json.dumps({"command": "ping_check"}).encode()
    response = subprocess.run([str(binary)], input=struct.pack("<I", len(request)) + request,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              timeout=15, check=True).stdout
    if len(response) < 4:
        raise ValueError("诊断组件未返回消息")
    size = struct.unpack("<I", response[:4])[0]
    if len(response) != size + 4:
        raise ValueError("诊断组件消息长度错误")
    data = json.loads(response[4:])
    if not data.get("success") or data.get("version") != version:
        raise ValueError(f"诊断组件响应错误: {data}")
    print(f"诊断组件协议验证通过: {version}")


if __name__ == "__main__":
    main()
