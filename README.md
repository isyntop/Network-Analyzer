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

Ping 和 MTR 功能需要安装本地诊断组件（Go 编译的单文件程序，约 3-5MB，无依赖）。

**首次使用时插件会自动引导安装。** 也可以手动安装：

#### macOS

下载 [最新 Release](https://github.com/isyntop/Network-Analyzer/releases/latest) 中的 `.pkg` 文件，双击安装。

#### Windows

下载 [最新 Release](https://github.com/isyntop/Network-Analyzer/releases/latest) 中的 `.zip` 文件，解压后双击 `install.bat` 即可完成安装。无需管理员权限，自动注册到 Chrome 和 Edge。

> 插件首次打开会自动引导跳转到下载页面，用户无需手动查找。
> 安装后需要重启浏览器。

#### 卸载 Native Host

- **macOS**: `sudo /usr/local/lib/network-analyzer/uninstall.sh`
- **Windows**: 运行 `%LOCALAPPDATA%\Network-Analyzer\uninstall.bat`
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
├── packages/              # 预编译的 Native Host 安装包（gitignore，仅本地构建用）
│   ├── Network-Analyzer-Host-macOS.pkg
│   ├── network-analyzer-host-macos.zip
│   └── network-analyzer-host-windows.zip
├── native-host/           # Native Host 源码（Go）
│   ├── main.go            # 主程序：ping、traceroute、卸载
│   ├── go.mod
│   ├── build.sh           # 构建脚本（编译 + 打包）
│   ├── install-macos.sh   # macOS 手动安装脚本
│   └── packaging/         # .pkg / .bat 打包配置
├── scripts/
│   ├── pack-extension.sh  # 扩展打包脚本（生成商店 .zip）
│   ├── release.sh         # 发布脚本（构建 + tag + GitHub Release）
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
- GitHub CLI (`gh`)（发布 Release 用）

### 安装依赖

```bash
npm install
```

### 运行测试

```bash
npm test
```

### 从零构建完整发布包

以下是从干净仓库到生成所有可发布产物的完整步骤：

```bash
# 1. 编译 Native Host（macOS/Windows 二进制 + 所有安装包）
cd native-host
./build.sh --pkg
cd ..

# 2. 打包浏览器扩展（生成商店上传用 .zip）
./scripts/pack-extension.sh
```

执行完毕后，所有产物在项目根 `dist/` 目录：

| 文件 | 用途 |
|------|------|
| `network-analyzer-extension.zip` | **上传 Chrome Web Store / Edge Add-ons** |
| `Network-Analyzer-Host-macOS-arm64.pkg` | macOS Native Host 安装包 |
| `network-analyzer-host-macos.zip` | macOS zip 备选 |
| `network-analyzer-host-windows.zip` | Windows Native Host 安装包 |

> `build.sh` 会自动将产物同步到 `dist/` 和 `packages/`，`pack-extension.sh` 会将 `packages/` 中的安装包打入扩展 zip，用户安装扩展后可直接从插件内下载对应平台的安装包。

### 一键发布（推荐）

```bash
./scripts/release.sh v1.0.3
```

此命令会自动完成以下所有步骤：

1. 将版本号 `1.0.3` 写入 `manifest.json` 和 `package.json`
2. 编译 Native Host + 生成 macOS .pkg + Windows zip 安装包
3. 将安装包同步到 `packages/` 目录
4. 打包扩展 .zip（内含安装包）
5. 提交版本号变更、创建 git tag、推送到 GitHub
6. 创建 GitHub Release 并上传所有产物

发布后去 [Chrome Web Store 开发者后台](https://chrome.google.com/webstore/devconsole) 上传 `dist/network-analyzer-extension.zip` 即可。

如果只想构建不推送：

```bash
./scripts/release.sh v1.0.3 --dry
```

### 手动分步操作

如果不想用一键发布脚本，也可以分步执行：

```bash
# 编译 Native Host（不含 .pkg）
cd native-host
./build.sh
cd ..

# 编译 Native Host（含 macOS .pkg）
cd native-host
./build.sh --pkg
cd ..

# 仅打包扩展（前提：packages/ 中已有安装包）
./scripts/pack-extension.sh

# 打包扩展 + 生成企业分发用 .crx
./scripts/pack-extension.sh --crx
```

### 上传商店注意事项

- 商店要求每次上传的 `manifest.json` 中 version 必须高于已发布版本
- `release.sh` 会自动处理版本号递增，手动操作时需自行修改 `manifest.json` 中的 `version` 字段
- 上传文件为 `dist/network-analyzer-extension.zip`（约 36KB，仅包含扩展代码）
- 同一个 zip 可同时用于 Chrome Web Store 和 Edge Add-ons
- Native Host 安装包不打包进扩展，插件会引导用户从 GitHub Releases 下载

## 浏览器兼容性

- Chrome 88+
- Microsoft Edge 88+
- 其他 Chromium 内核浏览器

## Native Host 系统兼容性

| 系统 | Ping | Traceroute | 安装方式 |
|------|------|------------|----------|
| macOS (Intel/Apple Silicon) | ✅ 系统 ping | ✅ 系统 traceroute | .pkg 双击安装 |
| Windows 10/11 | ✅ 系统 ping | ✅ 系统 tracert | .zip 解压运行 install.bat |
| Linux | ✅ 系统 ping | ✅ 系统 traceroute | 手动安装 |

## 隐私说明

- 所有诊断数据仅存储在本地浏览器内存中，关闭标签页后自动清除
- 不向任何第三方服务器发送用户数据
- Ping 和 Traceroute 通过本地 Native Host 执行，数据不经过远程服务器
- 不使用任何分析、广告或追踪服务

## License

MIT
