# Network Analyzer

一款 Chrome / Edge 浏览器扩展，用于诊断页面加载过程中的网络性能问题。自动采集当前页面所有域名和 IP，对每个目标执行 **Ping**、**Traceroute（MTR）** 和 **Timing** 分析，帮助快速定位网络瓶颈。

## 功能

| 功能 | 说明 | 数据来源 |
|------|------|----------|
| **域名/IP 采集** | 自动监听当前页面所有网络请求，提取域名和 IP 映射 | 浏览器 webRequest API |
| **Ping** | ICMP Ping 检测，间隔 1 秒发送 10 次，统计 min/avg/max RTT 和丢包率 | 本地系统 ping 命令 |
| **MTR 路由追踪** | Traceroute 逐跳分析，显示每跳 IP/主机名、延迟和丢包，连续超时跳自动折叠 | 本地系统 traceroute/tracert |
| **Timing** | HTTP 连接耗时分解（连接时间、TTFB、下载时间） | 浏览器 fetch API |
| **自动分析** | 打开插件时自动对所有域名并发执行全部诊断 | - |
| **导出报告** | 将诊断结果导出为 JSON 文件 | - |
| **导入分析** | 导入 JSON 报告文件进行可视化查看 | - |

## 架构

```
┌─────────────────────────────────────────────┐
│              Chrome / Edge 浏览器            │
│                                             │
│  ┌──────────┐  消息  ┌──────────────────┐   │
│  │ Popup UI │◄─────►│ Background SW     │   │
│  │ (popup)  │       │ (background.js)   │   │
│  └──────────┘       └────────┬──────────┘   │
│                              │              │
│  ┌──────────┐  消息  ┌───────┴────────┐     │
│  │ Content  │◄─────►│ webRequest API  │     │
│  │ Script   │       │ (域名/IP采集)    │     │
│  └──────────┘       └────────────────┘     │
└──────────────────────┬──────────────────────┘
                       │ Native Messaging
              ┌────────┴────────┐
              │  Native Host    │
              │  (Go 单文件)    │
              │  ping / tracert │
              └─────────────────┘
```

## 安装

### 方式一：Chrome Web Store（推荐）

在 Chrome Web Store 搜索 "Network Analyzer" 安装。

### 方式二：开发者模式加载

1. 下载或克隆本仓库
2. 打开 `chrome://extensions`，开启"开发者模式"
3. 点击"加载已解压的扩展程序"，选择项目根目录

### 安装 Native Host 诊断组件

Ping 和 MTR 功能需要安装本地诊断组件（Go 编译的单文件程序，约 2MB，无依赖）。

**首次使用时插件会自动引导安装。** 也可以手动安装：

#### macOS

```bash
# 方式一：双击 .pkg 安装（推荐）
open packages/Network-Analyzer-Host-macOS.pkg

# 方式二：命令行安装
cd native-host
./install-macos.sh
```

#### Windows

解压 `packages/network-analyzer-host-windows.zip`，双击 `install.bat`。

> 安装后需要重启浏览器。

#### 卸载 Native Host

- **macOS**: `sudo /usr/local/lib/network-analyzer/uninstall.sh`
- **Windows**: 运行安装目录下的 `uninstall.bat`
- 也可以在插件界面点击 🗑️ 卸载组件 按钮

## 项目结构

```
Network-Analyzer/
├── manifest.json          # 扩展清单（Manifest V3）
├── background.js          # Service Worker：域名采集、消息路由、API 协调
├── api-client.js          # Globalping API 客户端（备用，当前未启用）
├── config.js              # 配置管理
├── content.js             # Content Script：Resource Timing 采集
├── timing-utils.js        # Timing 计算纯函数
├── popup.html/js/css      # 弹出页面 UI
├── setup.html/js          # Native Host 安装引导页
├── icons/                 # 扩展图标
├── packages/              # 预编译的 Native Host 安装包
│   ├── Network-Analyzer-Host-macOS.pkg
│   ├── network-analyzer-host-macos.zip
│   └── network-analyzer-host-windows.zip
├── native-host/           # Native Host 源码（Go）
│   ├── main.go            # 主程序：ping、traceroute、卸载
│   ├── go.mod
│   ├── build.sh           # 构建脚本（编译 + 打包）
│   ├── install-macos.sh   # macOS 安装脚本
│   ├── install-windows.bat
│   └── packaging/         # .pkg / .msi 打包配置
├── scripts/
│   ├── pack-extension.sh  # 扩展打包脚本（生成商店 .zip）
│   └── generate-icons.js  # 图标生成脚本
├── tests/                 # 测试文件
│   ├── chrome-mock.js     # Chrome API Mock
│   ├── setup.test.js      # 框架验证测试
│   ├── config.test.js     # 配置模块测试
│   ├── api-client.test.js # API 客户端测试
│   └── timing-utils.test.js # Timing 工具测试
├── package.json
└── vitest.config.js
```

## 开发

### 环境要求

- Node.js 18+
- Go 1.21+（编译 Native Host）

### 安装依赖

```bash
npm install
```

### 运行测试

```bash
npm test
```

### 编译 Native Host

```bash
cd native-host
./build.sh          # 编译 macOS + Windows
./build.sh --pkg    # 同时生成 macOS .pkg 安装包
```

### 打包扩展

```bash
./scripts/pack-extension.sh          # 生成商店上传用 .zip
./scripts/pack-extension.sh --crx    # 同时生成企业分发用 .crx
```

输出文件在 `dist/` 目录：

| 文件 | 用途 |
|------|------|
| `network-analyzer-extension.zip` | 上传 Chrome Web Store / Edge Add-ons |
| `network-analyzer.crx` | 企业内部分发 |
| `network-analyzer.pem` | .crx 签名私钥（妥善保管） |

## 浏览器兼容性

- Chrome 88+
- Microsoft Edge 88+
- 其他 Chromium 内核浏览器

## Native Host 系统兼容性

| 系统 | Ping | Traceroute | 安装方式 |
|------|------|------------|----------|
| macOS (Intel/Apple Silicon) | ✅ 系统 ping | ✅ 系统 traceroute | .pkg 双击安装 |
| Windows 10/11 | ✅ 系统 ping | ✅ 系统 tracert | .bat 双击安装 |
| Linux | ✅ 系统 ping | ✅ 系统 traceroute | 手动安装 |

## 隐私说明

- 所有诊断数据仅存储在本地浏览器内存中，关闭标签页后自动清除
- 不向任何第三方服务器发送用户数据
- Ping 和 Traceroute 通过本地 Native Host 执行，数据不经过远程服务器
- 不使用任何分析、广告或追踪服务

## License

MIT
