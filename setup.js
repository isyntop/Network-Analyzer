/**
 * Network Analyzer - 安装引导页逻辑
 * 独立 JS 文件，符合 Chrome 扩展 CSP 要求（禁止内联脚本）
 */

// ─── GitHub Release 下载地址 ───────────────────────────────
// 使用 /latest/ 始终指向最新发布版本，发布新版无需修改扩展
var GITHUB_RELEASE_BASE = 'https://github.com/isyntop/Network-Analyzer/releases/latest/download/';
var DOWNLOAD_MAC = GITHUB_RELEASE_BASE + 'Network-Analyzer-Host-macOS-arm64.pkg';
var DOWNLOAD_WIN = GITHUB_RELEASE_BASE + 'Network-Analyzer-Host-Windows-Setup.exe';

// ─── Tab 切换 ───────────────────────────────────────────────

function switchTab(os) {
  document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });
  document.querySelectorAll('.panel').forEach(function(p) { p.classList.remove('active'); });
  if (os === 'mac') {
    document.querySelectorAll('.tab')[0].classList.add('active');
    document.getElementById('panel-mac').classList.add('active');
  } else {
    document.querySelectorAll('.tab')[1].classList.add('active');
    document.getElementById('panel-win').classList.add('active');
  }
}

// ─── 下载安装包（从 GitHub Release）─────────────────────────

function downloadPackage(os) {
  var url = (os === 'mac') ? DOWNLOAD_MAC : DOWNLOAD_WIN;
  // 在新标签页打开下载链接，浏览器会自动触发下载
  chrome.tabs.create({ url: url });
}

// ─── 状态检测 ───────────────────────────────────────────────

function checkStatus() {
  var icon = document.getElementById('statusIcon');
  var text = document.getElementById('statusText');
  var hint = document.getElementById('statusHint');
  icon.textContent = '🔍';
  text.className = 'status-wait';
  text.textContent = '正在检测...';
  hint.textContent = '正在检查本地诊断组件是否已安装';

  chrome.runtime.sendMessage({ type: 'CHECK_API_STATUS' }, function(resp) {
    if (resp && resp.success && resp.data && resp.data.nativeHostAvailable) {
      icon.textContent = '✅';
      text.className = 'status-ok';
      text.textContent = '诊断组件已安装';
      hint.textContent = '本地 Ping 和 MTR 功能可正常使用，请关闭此页面返回插件';
    } else {
      icon.textContent = '❌';
      text.className = 'status-err';
      text.textContent = '诊断组件未安装';
      hint.textContent = '请按照下方步骤安装后，点击"重新检测"';
    }
  });
}

// ─── 初始化 ─────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function() {
  // Tab 切换
  var tabs = document.querySelectorAll('.tab');
  tabs[0].addEventListener('click', function() { switchTab('mac'); });
  tabs[1].addEventListener('click', function() { switchTab('win'); });

  // 下载按钮
  document.getElementById('dlMac').addEventListener('click', function() { downloadPackage('mac'); });
  document.getElementById('dlWin').addEventListener('click', function() { downloadPackage('win'); });

  // 重新检测按钮
  document.getElementById('checkBtn').addEventListener('click', checkStatus);

  // 自动检测系统并切换 tab
  if (navigator.platform.indexOf('Win') !== -1) {
    switchTab('win');
  }

  // 页面加载时自动检测
  checkStatus();
});
