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
| **导出报告** | 将诊断结果导出为 JSON 文件，探测完成前按钮禁用并动态提示 | - |
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

Ping 和 MTR 功能需要安装本地诊断组件（Go 编译的单文件程序，约 3-5MB，无依赖）。

**首次使用时插件会自动引导安装。** 也可以手动安装：

#### macOS

下载 [最新 Release](https://github.com/isyntop/Network-Analyzer/releases/latest) 中的 `.pkg` 文件，双击安装。

#### Windows

下载 [最新 Release](https://github.com/isyntop/Network-Analyzer/releases/latest) 中的 `.exe` 文件，双击运行即可完成安装。无需解压，无需管理员权限，自动注册到 Chrome 和 Edge。

> 插件首次打开会自动引导跳转到下载页面，用户无需手动查找。
> 安装后需要重启浏览器。

#### 卸载 Native Host

- **macOS**: `sudo /usr/local/lib/network-analyzer/uninstall.sh`
- **Windows**: 运行 `%LOCALAPPDATA%\Network-Analyzer\uninstall.exe --uninstall`
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
├── dist/v版本号/          # 每个版本的独立发布产物（gitignore）
├── native-host/           # Native Host 源码（Go）
│   ├── main.go            # 主程序：ping、traceroute、卸载
│   ├── go.mod
│   ├── build.sh           # 构建 macOS/Windows 本地组件
│   ├── install-macos.sh   # macOS 手动安装脚本
│   └── packaging/         # .pkg / .bat 打包配置
├── scripts/
│   ├── pack-extension.sh  # 扩展打包脚本（生成商店 .zip）
│   ├── release.sh         # 发布入口（调用 release.py）
│   ├── release.py         # 版本、产物校验和发布步骤
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
- Go 1.25+（编译 Native Host）
- macOS 构建机需有 `lipo`、`pkgbuild`、`zip`
- Git 和 GitHub Actions（推送标签后自动发布 Release）

### 安装依赖

```bash
npm install
```

### 运行测试

```bash
npm test
```

### 发布流程

版本号以 `package.json` 为准。发布脚本把它同步到扩展清单和锁文件，并在编译时注入本地诊断程序及 macOS pkg。每次发布使用独立目录，避免旧安装包混入新版本。

```bash
npm ci

# 可选：在临时副本完整预演，不修改当前工作区
./scripts/release.sh preview v1.0.10

# 准备版本文件、运行测试并构建全部产物；产物留在 dist/v1.0.10/
./scripts/release.sh prepare v1.0.10

# 检查产物未被替换，且版本、架构和安装包内容正确
./scripts/release.sh verify v1.0.10

# 审阅版本文件变更后，在 main 上提交版本、推送单个标签
./scripts/release.sh publish v1.0.10
```

推送标签后，[GitHub Actions](.github/workflows/release.yml) 会重新构建，执行 macOS 原生消息验证和 Windows 安装/卸载验证，再创建 GitHub Release 并核对上传资产。`main` 分支提交也会运行同样的构建验证，但不会发布。发布失败时查看该标签对应的 Actions 运行记录；不要复用已经发布的标签。

`dist/v版本号/` 包含以下文件：

| 文件 | 用途 |
|------|------|
| `network-analyzer-extension.zip` | 上传 Chrome Web Store / Edge Add-ons；仅包含扩展文件 |
| `Network-Analyzer-Host-macOS-universal.pkg` | macOS Intel / Apple Silicon 安装包 |
| `Network-Analyzer-Host-Windows-Setup.exe` | Windows 安装包 |
| `network-analyzer-host-macos.zip` | macOS 手动安装备选 |
| `network-analyzer-host-windows.zip` | Windows 手动安装备选 |
| `SHA256SUMS` | 上述五个产物的 SHA-256 校验和 |

GitHub Release 完成后，从该目录上传扩展 zip 到 [Chrome Web Store 开发者后台](https://chrome.google.com/webstore/devconsole) 和 Edge Add-ons。商店上传由开发者手动完成；扩展内的安装引导从最新 GitHub Release 下载 pkg/exe。macOS pkg 当前未签名，正式分发前需另行配置签名与公证。

首次上架新的扩展商店时，应先读取商店分配的扩展 ID，并将其加入 macOS、Windows 本地诊断组件生成的 `allowed_origins`，随后重新构建安装包并验证商店安装版可以连接本地组件。当前 Edge 加载项 ID 为 `gohljecmghmeeikijodpgnlffecnpdhi`。

## 浏览器兼容性

- Chrome 88+
- Microsoft Edge 88+
- 其他 Chromium 内核浏览器

## Native Host 系统兼容性

| 系统 | Ping | Traceroute | 安装方式 |
|------|------|------------|----------|
| macOS (Intel/Apple Silicon) | ✅ 系统 ping | ✅ 系统 traceroute | .pkg 双击安装 |
| Windows 10/11 | ✅ 系统 ping | ✅ 系统 tracert | .exe 双击安装 |
| Linux | ✅ 系统 ping | ✅ 系统 traceroute | 手动安装 |

## 隐私说明

- 所有诊断数据仅存储在本地浏览器内存中，关闭标签页后自动清除
- 不向任何第三方服务器发送用户数据
- Ping 和 Traceroute 通过本地 Native Host 执行，数据不经过远程服务器
- 不使用任何分析、广告或追踪服务

## 更新日志

### v1.0.7

- **改进**：导出报告按钮在所有探测（Ping/MTR/Timing）执行完成前自动禁用，显示"⏳ 探测进行中..."动态提示，防止导出不完整的报告数据

### v1.0.6

- 修复 Windows ping 中文版丢包率 100% 解析问题
- 修复 MTR 长主机名被遮挡的显示问题

## License

MIT
