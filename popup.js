/**
 * Network Analyzer - Popup UI 交互逻辑
 *
 * 负责：
 * 1. 初始化：加载域名列表 + API 预检
 * 2. 域名列表渲染
 * 3. Ping/MTR/Timing 结果渲染
 * 4. 导出报告
 *
 * 不使用 ES module，通过 script 标签引入。
 * 所有 chrome.runtime.sendMessage 调用使用 Promise 包装。
 */

// ─── 全局状态 ───────────────────────────────────────────────────

let currentTabId = null;
let apiAvailable = false;

// ─── 工具函数 ───────────────────────────────────────────────────

/**
 * Promise 包装 chrome.runtime.sendMessage
 * @param {object} message
 * @returns {Promise<object>}
 */
function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

/**
 * 获取颜色高亮类名（丢包率）
 * @param {number} lossPercent - 丢包率百分比
 * @returns {string} CSS 类名
 */
function getLossHighlightClass(lossPercent) {
  if (lossPercent >= 50) return 'highlight-red';
  if (lossPercent > 0) return 'highlight-orange';
  return 'highlight-green';
}

/**
 * 获取颜色高亮类名（RTT）
 * @param {number} rttMs - RTT 毫秒值
 * @returns {string} CSS 类名
 */
function getRttHighlightClass(rttMs) {
  if (rttMs > 100) return 'highlight-yellow';
  return '';
}

/**
 * 获取 Timing 阶段颜色高亮类名
 * @param {number} ms - 耗时毫秒
 * @returns {string} CSS 类名
 */
function getTimingHighlightClass(ms) {
  if (ms > 500) return 'highlight-red';
  if (ms > 100) return 'highlight-yellow';
  return '';
}

/**
 * 获取 Timing 阶段行背景高亮类名
 * @param {number} ms - 耗时毫秒
 * @returns {string} CSS 类名
 */
function getTimingBgHighlightClass(ms) {
  if (ms > 500) return 'bg-highlight-red';
  if (ms > 100) return 'bg-highlight-yellow';
  return '';
}


/**
 * 格式化数值，保留指定小数位
 * @param {number|null} value
 * @param {number} decimals
 * @returns {string}
 */
function formatNumber(value, decimals) {
  if (value === null || value === undefined) return '-';
  return Number(value).toFixed(decimals === undefined ? 2 : decimals);
}

/**
 * 安全转义 HTML
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  var div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ─── 初始化 ─────────────────────────────────────────────────────

/**
 * Popup 初始化函数
 * 获取当前标签页 ID，加载域名列表，执行 API 预检，然后自动分析所有域名
 */
async function init() {
  try {
    // 获取当前活动标签页
    var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs && tabs.length > 0) {
      currentTabId = tabs[0].id;
    }

    if (currentTabId === null) {
      showEmptyState();
      return;
    }

    // 并行加载域名数据和 API 状态
    var networkDataPromise = sendMessage({
      type: 'GET_NETWORK_DATA',
      tabId: currentTabId
    });

    var apiStatusPromise = sendMessage({
      type: 'CHECK_API_STATUS'
    });

    var networkResponse = await networkDataPromise;
    var apiStatusResponse;
    try {
      apiStatusResponse = await apiStatusPromise;
    } catch (e) {
      apiStatusResponse = { success: false };
    }

    // 更新 API 状态
    updateApiStatus(apiStatusResponse);

    // 渲染域名列表
    if (networkResponse && networkResponse.success && networkResponse.data) {
      var domainKeys = Object.keys(networkResponse.data);
      if (domainKeys.length > 0) {
        renderDomainList(networkResponse.data);
        // 自动对所有域名执行分析
        autoAnalyzeAll(networkResponse.data);
      } else {
        showEmptyState();
      }
    } else {
      showEmptyState();
    }
  } catch (err) {
    showEmptyState();
    console.error('Popup init error:', err);
  }
}

/**
 * 自动对所有域名执行 Ping、MTR、Timing 分析
 * Timing 立即并行执行（速度快），Ping 和 MTR 逐个串行执行（避免 API 限流）
 * @param {Record<string, DomainInfo>} data - 域名数据
 */
async function autoAnalyzeAll(data) {
  var domains = Object.keys(data).sort();
  var promises = [];

  // 所有域名的 Timing、Ping、MTR 全部并发执行
  domains.forEach(function(domain) {
    var info = data[domain];
    var target = info.ip || domain;

    // Timing 不依赖外部 API，直接并发
    promises.push(autoRunTiming(domain));

    // Ping 和 MTR 也并发（Globalping API 支持并发请求）
    if (apiAvailable) {
      promises.push(autoRunPing(domain, target));
      promises.push(autoRunMtr(domain, target));
    }
  });

  // 等待所有分析完成（各自独立，互不阻塞）
  await Promise.allSettled(promises);
}

/**
 * 自动执行单个域名的 Ping 分析
 */
async function autoRunPing(domain, target) {
  var area = getResultArea(domain);
  if (!area) return;

  // 在现有结果后追加 Ping 加载状态
  appendLoading(domain, 'ping-section', '正在 Ping ' + domain + ' (10次)...');

  try {
    var response = await sendMessage({
      type: 'RUN_PING',
      target: target,
      tabId: currentTabId,
      count: 10
    });

    if (response && response.success && response.data) {
      replaceSection(domain, 'ping-section', buildPingHtml(response.data));
    } else if (response && response.error === 'NATIVE_HOST_NOT_INSTALLED') {
      replaceSection(domain, 'ping-section', '<div class="unavailable-text" style="padding:4px 0">Ping 需要安装本地诊断组件</div>');
    } else {
      replaceSection(domain, 'ping-section', buildErrorHtml('Ping', (response && response.error) || '探测失败'));
    }
  } catch (err) {
    replaceSection(domain, 'ping-section', buildErrorHtml('Ping', err.message || '探测失败'));
  }

  // 更新 Ping 按钮状态
  var btn = document.querySelector('.btn-ping[data-domain="' + domain + '"]');
  if (btn) btn.classList.add('btn-done');
}

/**
 * 自动执行单个域名的 MTR 分析
 */
async function autoRunMtr(domain, target) {
  appendLoading(domain, 'mtr-section', '正在 MTR ' + domain + ' ...');

  try {
    var response = await sendMessage({
      type: 'RUN_MTR',
      target: target,
      tabId: currentTabId
    });

    if (response && response.success && response.data) {
      replaceSection(domain, 'mtr-section', buildMtrHtml(response.data));
    } else if (response && response.error === 'NATIVE_HOST_NOT_INSTALLED') {
      replaceSection(domain, 'mtr-section', '<div class="unavailable-text" style="padding:4px 0">MTR 需要安装本地诊断组件</div>');
    } else {
      replaceSection(domain, 'mtr-section', buildErrorHtml('MTR', (response && response.error) || '探测失败'));
    }
  } catch (err) {
    replaceSection(domain, 'mtr-section', buildErrorHtml('MTR', err.message || '探测失败'));
  }

  var btn = document.querySelector('.btn-mtr[data-domain="' + domain + '"]');
  if (btn) btn.classList.add('btn-done');
}

/**
 * 自动执行单个域名的 Timing 分析
 */
async function autoRunTiming(domain) {
  appendLoading(domain, 'timing-section', '正在测量 ' + domain + ' 连接耗时...');

  try {
    var response = await sendMessage({
      type: 'RUN_TIMING',
      tabId: currentTabId,
      domain: domain
    });

    if (response && response.success && response.data) {
      replaceSection(domain, 'timing-section', buildTimingHtml(response.data));
    } else {
      replaceSection(domain, 'timing-section', buildErrorHtml('Timing', (response && response.error) || '获取失败'));
    }
  } catch (err) {
    replaceSection(domain, 'timing-section', buildErrorHtml('Timing', err.message || '获取失败'));
  }

  var btn = document.querySelector('.btn-timing[data-domain="' + domain + '"]');
  if (btn) btn.classList.add('btn-done');
}

/**
 * 在域名结果区域追加一个带 ID 的加载区块
 */
function appendLoading(domain, sectionId, message) {
  var area = getResultArea(domain);
  if (!area) return;
  var section = document.createElement('div');
  section.id = sectionId + '-' + domain.replace(/\./g, '-');
  section.className = 'result-panel';
  section.innerHTML =
    '<div class="loading-indicator">' +
      '<div class="loading-spinner"></div>' +
      '<span>' + escapeHtml(message) + '</span>' +
    '</div>';
  area.appendChild(section);
}

/**
 * 替换域名结果区域中指定 section 的内容
 */
function replaceSection(domain, sectionId, html) {
  var id = sectionId + '-' + domain.replace(/\./g, '-');
  var section = document.getElementById(id);
  if (section) {
    section.innerHTML = html;
  }
}

/**
 * 构建错误 HTML 片段
 */
function buildErrorHtml(label, message) {
  return '<div class="error-message">❌ ' + escapeHtml(label) + ': ' + escapeHtml(message) + '</div>';
}

/**
 * 更新 API 状态指示器
 * @param {object} response - CHECK_API_STATUS 响应
 */
function updateApiStatus(response) {
  var statusEl = document.getElementById('apiStatus');
  var guideEl = document.getElementById('nativeHostGuide');
  var uninstallBtn = document.getElementById('uninstallBtn');
  if (!statusEl) return;

  if (response && response.success && response.data && response.data.nativeHostAvailable) {
    apiAvailable = true;
    statusEl.textContent = '本地诊断可用';
    statusEl.className = 'api-status api-status--ok';
    if (guideEl) guideEl.style.display = 'none';
    if (uninstallBtn) uninstallBtn.style.display = '';
  } else {
    apiAvailable = false;
    statusEl.textContent = '需要安装组件';
    statusEl.className = 'api-status api-status--error';
    if (guideEl) guideEl.style.display = '';
    if (uninstallBtn) uninstallBtn.style.display = 'none';
    disablePingMtrButtons();
  }
}

/**
 * 禁用所有 Ping 和 MTR 按钮
 */
function disablePingMtrButtons() {
  var pingBtns = document.querySelectorAll('.btn-ping');
  var mtrBtns = document.querySelectorAll('.btn-mtr');
  pingBtns.forEach(function(btn) { btn.disabled = true; });
  mtrBtns.forEach(function(btn) { btn.disabled = true; });
}

/**
 * 显示空数据提示
 */
function showEmptyState() {
  var container = document.getElementById('domainListContainer');
  var emptyState = document.getElementById('emptyState');
  if (container) container.style.display = 'none';
  if (emptyState) emptyState.style.display = 'flex';
}


// ─── 域名列表渲染 ───────────────────────────────────────────────

/**
 * 渲染域名列表
 * @param {Record<string, DomainInfo>} data - 域名数据
 */
function renderDomainList(data) {
  var container = document.getElementById('domainListContainer');
  if (!container) return;

  container.innerHTML = '';

  var domains = Object.keys(data).sort();

  domains.forEach(function(domain) {
    var info = data[domain];
    var item = document.createElement('div');
    item.className = 'domain-item';
    item.id = 'domain-' + domain.replace(/\./g, '-');

    // 资源类型标签 HTML
    var typesHtml = '';
    var types = info.types || [];
    types.slice(0, 4).forEach(function(t) {
      typesHtml += '<span class="type-tag">' + escapeHtml(t) + '</span>';
    });
    if (types.length > 4) {
      typesHtml += '<span class="type-tag">+' + (types.length - 4) + '</span>';
    }

    item.innerHTML =
      '<div class="domain-item-header">' +
        '<div class="domain-info">' +
          '<div class="domain-name">' + escapeHtml(domain) + '</div>' +
          '<div class="domain-meta">' +
            '<span class="domain-ip">' + escapeHtml(info.ip || '未知 IP') + '</span>' +
            '<span class="domain-count">' + info.requestCount + ' 次请求</span>' +
            typesHtml +
          '</div>' +
        '</div>' +
        '<div class="domain-actions">' +
          '<button class="btn btn-ping" data-domain="' + escapeHtml(domain) + '" data-ip="' + escapeHtml(info.ip || domain) + '"' +
            (!apiAvailable ? ' disabled' : '') + '>Ping</button>' +
          '<button class="btn btn-mtr" data-domain="' + escapeHtml(domain) + '" data-ip="' + escapeHtml(info.ip || domain) + '"' +
            (!apiAvailable ? ' disabled' : '') + '>MTR</button>' +
          '<button class="btn btn-timing" data-domain="' + escapeHtml(domain) + '">Timing</button>' +
        '</div>' +
      '</div>' +
      '<div class="result-area" id="result-' + domain.replace(/\./g, '-') + '"></div>';

    container.appendChild(item);
  });

  // 绑定按钮事件
  bindButtonEvents();
}

/**
 * 绑定 Ping/MTR/Timing 按钮点击事件
 */
function bindButtonEvents() {
  // Ping 按钮
  document.querySelectorAll('.btn-ping').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var domain = this.getAttribute('data-domain');
      var target = this.getAttribute('data-ip') || domain;
      handlePingClick(domain, target, this);
    });
  });

  // MTR 按钮
  document.querySelectorAll('.btn-mtr').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var domain = this.getAttribute('data-domain');
      var target = this.getAttribute('data-ip') || domain;
      handleMtrClick(domain, target, this);
    });
  });

  // Timing 按钮
  document.querySelectorAll('.btn-timing').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var domain = this.getAttribute('data-domain');
      handleTimingClick(domain, this);
    });
  });
}

/**
 * 获取域名对应的结果区域元素
 * @param {string} domain
 * @returns {HTMLElement|null}
 */
function getResultArea(domain) {
  return document.getElementById('result-' + domain.replace(/\./g, '-'));
}

/**
 * 在结果区域显示加载指示器
 * @param {string} domain
 * @param {string} message
 */
function showLoading(domain, message) {
  var area = getResultArea(domain);
  if (!area) return;
  area.innerHTML =
    '<div class="result-panel">' +
      '<div class="loading-indicator">' +
        '<div class="loading-spinner"></div>' +
        '<span>' + escapeHtml(message) + '</span>' +
      '</div>' +
    '</div>';
}


// ─── Ping 结果渲染（任务 8.3）─────────────────────────────────

/**
 * Ping 按钮点击处理
 * @param {string} domain - 域名
 * @param {string} target - 目标（IP 或域名）
 * @param {HTMLElement} btn - 按钮元素
 */
async function handlePingClick(domain, target, btn) {
  btn.disabled = true;
  showLoading(domain, '正在 Ping 探测 (10次)...');

  try {
    var response = await sendMessage({
      type: 'RUN_PING',
      target: target,
      tabId: currentTabId,
      count: 10
    });

    if (response && response.success && response.data) {
      renderPingResult(domain, response.data);
    } else {
      renderError(domain, (response && response.error) || '探测失败');
    }
  } catch (err) {
    renderError(domain, err.message || '探测失败');
  } finally {
    btn.disabled = false;
  }
}

/**
 * 渲染 Ping 结果
 * @param {string} domain
 * @param {object} result - PingResult
 */
function renderPingResult(domain, result) {
  var area = getResultArea(domain);
  if (!area) return;

  if (!result.success) {
    renderError(domain, result.error || '探测失败');
    return;
  }

  var stats = result.stats || {};
  var probe = result.probe || {};
  var lossClass = getLossHighlightClass(stats.packetLoss);

  var html =
    '<div class="result-panel">' +
      '<div class="result-panel-title">📡 Ping 结果</div>' +
      '<div class="probe-info">' +
        '探测节点：' + escapeHtml(probe.location || 'unknown') +
        ' | 网络：' + escapeHtml(probe.network || 'unknown') +
      '</div>' +
      '<div class="ping-stats">' +
        '<div class="ping-stat-item">' +
          '<div class="ping-stat-label">Min</div>' +
          '<div class="ping-stat-value">' + formatNumber(stats.min) + '<span class="ping-stat-unit"> ms</span></div>' +
        '</div>' +
        '<div class="ping-stat-item">' +
          '<div class="ping-stat-label">Avg</div>' +
          '<div class="ping-stat-value">' + formatNumber(stats.avg) + '<span class="ping-stat-unit"> ms</span></div>' +
        '</div>' +
        '<div class="ping-stat-item">' +
          '<div class="ping-stat-label">Max</div>' +
          '<div class="ping-stat-value">' + formatNumber(stats.max) + '<span class="ping-stat-unit"> ms</span></div>' +
        '</div>' +
      '</div>' +
      '<div class="ping-loss-row">' +
        '<span>丢包率</span>' +
        '<span class="' + lossClass + '">' + formatNumber(stats.packetLoss) + '%</span>' +
      '</div>' +
      '<div class="ping-loss-row" style="margin-top:4px">' +
        '<span>发送 / 接收</span>' +
        '<span>' + (stats.sent || 0) + ' / ' + (stats.received || 0) + '</span>' +
      '</div>' +
    '</div>';

  area.innerHTML = html;
}


// ─── MTR 结果渲染（任务 8.4）─────────────────────────────────

/**
 * MTR 按钮点击处理
 * @param {string} domain - 域名
 * @param {string} target - 目标（IP 或域名）
 * @param {HTMLElement} btn - 按钮元素
 */
async function handleMtrClick(domain, target, btn) {
  btn.disabled = true;
  showLoading(domain, '正在通过远程节点执行 MTR 路由追踪...');

  try {
    var response = await sendMessage({
      type: 'RUN_MTR',
      target: target,
      tabId: currentTabId
    });

    if (response && response.success && response.data) {
      renderMtrResult(domain, response.data);
    } else {
      renderError(domain, (response && response.error) || '探测失败');
    }
  } catch (err) {
    renderError(domain, err.message || '探测失败');
  } finally {
    btn.disabled = false;
  }
}

/**
 * 渲染 MTR 结果
 * @param {string} domain
 * @param {object} result - MtrResult
 */
function renderMtrResult(domain, result) {
  var area = getResultArea(domain);
  if (!area) return;

  if (!result.success) {
    renderError(domain, result.error || '探测失败');
    return;
  }

  var probe = result.probe || {};
  var hops = result.hops || [];

  var rowsHtml = '';
  hops.forEach(function(hop) {
    var lossClass = getLossHighlightClass(hop.loss);
    var rttClass = getRttHighlightClass(hop.rttAvg);
    var rowBgClass = '';
    if (hop.loss > 0) {
      rowBgClass = hop.loss >= 50 ? 'bg-highlight-red' : 'bg-highlight-orange';
    } else if (hop.rttAvg > 100) {
      rowBgClass = 'bg-highlight-yellow';
    }

    if (hop.isTimeout) {
      rowsHtml +=
        '<tr class="' + rowBgClass + '">' +
          '<td>' + hop.hop + '</td>' +
          '<td class="hop-timeout">* * *</td>' +
          '<td class="hop-timeout">-</td>' +
          '<td class="hop-timeout">-</td>' +
          '<td class="hop-timeout">-</td>' +
          '<td class="hop-timeout">-</td>' +
        '</tr>';
    } else {
      rowsHtml +=
        '<tr class="' + rowBgClass + '">' +
          '<td>' + hop.hop + '</td>' +
          '<td>' + escapeHtml(hop.host) + '</td>' +
          '<td class="' + rttClass + '">' + formatNumber(hop.rttMin) + '</td>' +
          '<td class="' + rttClass + '">' + formatNumber(hop.rttAvg) + '</td>' +
          '<td class="' + rttClass + '">' + formatNumber(hop.rttMax) + '</td>' +
          '<td class="' + lossClass + '">' + formatNumber(hop.loss) + '%</td>' +
        '</tr>';
    }
  });

  var html =
    '<div class="result-panel">' +
      '<div class="result-panel-title">🔀 MTR 路由追踪</div>' +
      '<div class="probe-info">' +
        '探测节点：' + escapeHtml(probe.location || 'unknown') +
        ' | 网络：' + escapeHtml(probe.network || 'unknown') +
      '</div>' +
      '<table class="mtr-table">' +
        '<thead><tr>' +
          '<th>#</th>' +
          '<th>主机</th>' +
          '<th>Min</th>' +
          '<th>Avg</th>' +
          '<th>Max</th>' +
          '<th>丢包</th>' +
        '</tr></thead>' +
        '<tbody>' + rowsHtml + '</tbody>' +
      '</table>' +
    '</div>';

  area.innerHTML = html;
}


// ─── Timing 结果渲染（任务 8.5）─────────────────────────────

/**
 * Timing 按钮点击处理
 * @param {string} domain - 域名
 * @param {HTMLElement} btn - 按钮元素
 */
async function handleTimingClick(domain, btn) {
  btn.disabled = true;
  showLoading(domain, '正在采集 Timing 数据...');

  try {
    var response = await sendMessage({
      type: 'RUN_TIMING',
      tabId: currentTabId,
      domain: domain
    });

    if (response && response.success && response.data) {
      renderTimingResult(domain, response.data);
    } else {
      renderError(domain, (response && response.error) || '获取 Timing 数据失败');
    }
  } catch (err) {
    renderError(domain, err.message || '获取 Timing 数据失败');
  } finally {
    btn.disabled = false;
  }
}

/**
 * Timing 阶段定义
 */
var TIMING_PHASES = [
  { key: 'dnsLookup', label: 'DNS', barClass: 'bar-dns', color: '#4CAF50' },
  { key: 'tcpConnection', label: 'TCP', barClass: 'bar-tcp', color: '#2196F3' },
  { key: 'tlsHandshake', label: 'TLS', barClass: 'bar-tls', color: '#9C27B0' },
  { key: 'ttfb', label: 'TTFB', barClass: 'bar-ttfb', color: '#FF9800' },
  { key: 'contentDownload', label: 'Download', barClass: 'bar-download', color: '#00BCD4' }
];

/**
 * 渲染 Timing 结果（瀑布图 + 汇总表格）
 * @param {string} domain
 * @param {object} result - TimingResult
 */
function renderTimingResult(domain, result) {
  var area = getResultArea(domain);
  if (!area) return;

  if (!result.success && result.error) {
    renderError(domain, result.error);
    return;
  }

  var summary = result.summary || {};

  // 计算瀑布图最大值（用于比例计算）
  var maxVal = 1;
  TIMING_PHASES.forEach(function(phase) {
    var s = summary[phase.key];
    if (s && s.available && s.avg !== null && s.avg > maxVal) {
      maxVal = s.avg;
    }
  });

  // 构建瀑布图 HTML
  var waterfallHtml = '';
  TIMING_PHASES.forEach(function(phase) {
    var s = summary[phase.key];
    var available = s && s.available;
    var avgVal = (s && s.avg !== null) ? s.avg : null;

    if (!available) {
      waterfallHtml +=
        '<div class="waterfall-row">' +
          '<div class="waterfall-label">' + phase.label + '</div>' +
          '<div class="waterfall-bar-container">' +
            '<div class="waterfall-bar" style="width:100%;background:#e0e0e0">' +
              '<span class="waterfall-bar-text" style="color:#999">不可用（跨域限制）</span>' +
            '</div>' +
          '</div>' +
          '<div class="waterfall-value unavailable-text">N/A</div>' +
        '</div>';
    } else {
      var pct = avgVal !== null ? Math.max((avgVal / maxVal) * 100, 3) : 0;
      var highlightClass = avgVal !== null ? getTimingHighlightClass(avgVal) : '';
      var displayVal = avgVal !== null ? formatNumber(avgVal) + ' ms' : '-';

      waterfallHtml +=
        '<div class="waterfall-row">' +
          '<div class="waterfall-label">' + phase.label + '</div>' +
          '<div class="waterfall-bar-container">' +
            '<div class="waterfall-bar ' + phase.barClass + '" style="width:' + pct + '%">' +
              '<span class="waterfall-bar-text">' + (avgVal !== null ? formatNumber(avgVal, 1) : '') + '</span>' +
            '</div>' +
          '</div>' +
          '<div class="waterfall-value ' + highlightClass + '">' + displayVal + '</div>' +
        '</div>';
    }
  });

  // 构建汇总表格 HTML
  var summaryRowsHtml = '';
  TIMING_PHASES.forEach(function(phase) {
    var s = summary[phase.key];
    var available = s && s.available;

    if (!available) {
      summaryRowsHtml +=
        '<tr>' +
          '<td>' + phase.label + '</td>' +
          '<td class="unavailable-text" colspan="3">不可用（跨域限制）</td>' +
        '</tr>';
    } else {
      var avgClass = s.avg !== null ? getTimingHighlightClass(s.avg) : '';
      var minClass = s.min !== null ? getTimingHighlightClass(s.min) : '';
      var maxClass = s.max !== null ? getTimingHighlightClass(s.max) : '';
      var bgClass = s.avg !== null ? getTimingBgHighlightClass(s.avg) : '';

      summaryRowsHtml +=
        '<tr class="' + bgClass + '">' +
          '<td>' + phase.label + '</td>' +
          '<td class="' + avgClass + '">' + (s.avg !== null ? formatNumber(s.avg) + ' ms' : '-') + '</td>' +
          '<td class="' + minClass + '">' + (s.min !== null ? formatNumber(s.min) + ' ms' : '-') + '</td>' +
          '<td class="' + maxClass + '">' + (s.max !== null ? formatNumber(s.max) + ' ms' : '-') + '</td>' +
        '</tr>';
    }
  });

  // 总耗时行
  var totalSummary = summary.totalTime;
  if (totalSummary) {
    var totalAvgClass = totalSummary.avg !== null ? getTimingHighlightClass(totalSummary.avg) : '';
    summaryRowsHtml +=
      '<tr style="font-weight:600">' +
        '<td>总耗时</td>' +
        '<td class="' + totalAvgClass + '">' + (totalSummary.avg !== null ? formatNumber(totalSummary.avg) + ' ms' : '-') + '</td>' +
        '<td>' + (totalSummary.min !== null ? formatNumber(totalSummary.min) + ' ms' : '-') + '</td>' +
        '<td>' + (totalSummary.max !== null ? formatNumber(totalSummary.max) + ' ms' : '-') + '</td>' +
      '</tr>';
  }

  var html =
    '<div class="result-panel">' +
      '<div class="result-panel-title">⏱️ Timing 时间分解</div>' +
      '<div class="waterfall-chart">' + waterfallHtml + '</div>' +
      '<table class="timing-summary-table">' +
        '<thead><tr>' +
          '<th>阶段</th>' +
          '<th>Avg</th>' +
          '<th>Min</th>' +
          '<th>Max</th>' +
        '</tr></thead>' +
        '<tbody>' + summaryRowsHtml + '</tbody>' +
      '</table>' +
    '</div>';

  area.innerHTML = html;
}


// ─── 导出报告（任务 8.6）────────────────────────────────────

/**
 * 导出报告按钮点击处理
 */
async function handleExportClick() {
  var exportBtn = document.getElementById('exportBtn');
  if (exportBtn) exportBtn.disabled = true;

  try {
    var response = await sendMessage({
      type: 'EXPORT_REPORT',
      tabId: currentTabId
    });

    if (response && response.success && response.data) {
      // 格式化 JSON 并触发下载
      var jsonStr = JSON.stringify(response.data, null, 2);
      var blob = new Blob([jsonStr], { type: 'application/json' });
      var url = URL.createObjectURL(blob);

      var a = document.createElement('a');
      a.href = url;
      a.download = 'network-report-' + new Date().toISOString().slice(0, 19).replace(/:/g, '-') + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } else {
      alert('导出失败：' + ((response && response.error) || '未知错误'));
    }
  } catch (err) {
    alert('导出失败：' + (err.message || '未知错误'));
  } finally {
    if (exportBtn) exportBtn.disabled = false;
  }
}

// ─── 错误渲染 ───────────────────────────────────────────────────

/**
 * 在结果区域显示错误信息
 * @param {string} domain
 * @param {string} message
 */
function renderError(domain, message) {
  var area = getResultArea(domain);
  if (!area) return;
  area.innerHTML =
    '<div class="result-panel">' +
      '<div class="error-message">❌ ' + escapeHtml(message) + '</div>' +
    '</div>';
}

// ─── 事件绑定与启动 ─────────────────────────────────────────────

// ─── 自动分析结果 HTML 构建器 ───────────────────────────────────

/**
 * 构建 Ping 结果 HTML 片段（用于自动分析和手动点击）
 */
function buildPingHtml(result) {
  if (!result.success) {
    return buildErrorHtml('Ping', result.error || '探测失败');
  }

  var stats = result.stats || {};
  var probe = result.probe || {};
  var lossClass = getLossHighlightClass(stats.packetLoss);

  return '<div class="result-panel-title">📡 Ping <span class="local-badge">本地实测</span></div>' +
    '<div class="probe-info">' +
      '节点：' + escapeHtml(probe.location || '-') +
      ' | ' + escapeHtml(probe.network || '-') +
    '</div>' +
    '<div class="ping-stats">' +
      '<div class="ping-stat-item">' +
        '<div class="ping-stat-label">Min</div>' +
        '<div class="ping-stat-value">' + formatNumber(stats.min) + '<span class="ping-stat-unit"> ms</span></div>' +
      '</div>' +
      '<div class="ping-stat-item">' +
        '<div class="ping-stat-label">Avg</div>' +
        '<div class="ping-stat-value">' + formatNumber(stats.avg) + '<span class="ping-stat-unit"> ms</span></div>' +
      '</div>' +
      '<div class="ping-stat-item">' +
        '<div class="ping-stat-label">Max</div>' +
        '<div class="ping-stat-value">' + formatNumber(stats.max) + '<span class="ping-stat-unit"> ms</span></div>' +
      '</div>' +
    '</div>' +
    '<div class="ping-loss-row">' +
      '<span>丢包率</span>' +
      '<span class="' + lossClass + '">' + formatNumber(stats.packetLoss) + '%</span>' +
    '</div>';
}

/**
 * 构建 MTR 结果 HTML 片段
 */
function buildMtrHtml(result) {
  if (!result.success) {
    return buildErrorHtml('MTR', result.error || '探测失败');
  }

  var probe = result.probe || {};
  var hops = result.hops || [];

  // 将连续超时跳分组折叠
  var rowsHtml = '';
  var i = 0;
  while (i < hops.length) {
    var hop = hops[i];

    if (hop.isTimeout) {
      // 找连续超时跳的范围
      var start = i;
      while (i < hops.length && hops[i].isTimeout) {
        i++;
      }
      var count = i - start;

      if (count >= 2) {
        // 折叠显示
        var firstHop = hops[start].hop;
        var lastHop = hops[i - 1].hop;
        rowsHtml +=
          '<tr class="hop-collapsed">' +
            '<td>' + firstHop + '-' + lastHop + '</td>' +
            '<td class="hop-timeout">* * * （' + count + ' 跳不可达）</td>' +
            '<td class="hop-timeout">-</td>' +
            '<td class="hop-timeout">-</td>' +
            '<td class="hop-timeout">-</td>' +
            '<td class="hop-timeout">-</td>' +
          '</tr>';
      } else {
        // 单个超时跳正常显示
        rowsHtml +=
          '<tr>' +
            '<td>' + hop.hop + '</td>' +
            '<td class="hop-timeout">* * *</td>' +
            '<td class="hop-timeout">-</td>' +
            '<td class="hop-timeout">-</td>' +
            '<td class="hop-timeout">-</td>' +
            '<td class="hop-timeout">-</td>' +
          '</tr>';
      }
    } else {
      var lossClass = getLossHighlightClass(hop.loss);
      var rttClass = getRttHighlightClass(hop.rttAvg);
      var rowBgClass = '';
      if (hop.loss > 0) {
        rowBgClass = hop.loss >= 50 ? 'bg-highlight-red' : 'bg-highlight-orange';
      } else if (hop.rttAvg > 100) {
        rowBgClass = 'bg-highlight-yellow';
      }

      rowsHtml +=
        '<tr class="' + rowBgClass + '">' +
          '<td>' + hop.hop + '</td>' +
          '<td>' + escapeHtml(hop.host) + '</td>' +
          '<td class="' + rttClass + '">' + formatNumber(hop.rttMin) + '</td>' +
          '<td class="' + rttClass + '">' + formatNumber(hop.rttAvg) + '</td>' +
          '<td class="' + rttClass + '">' + formatNumber(hop.rttMax) + '</td>' +
          '<td class="' + lossClass + '">' + formatNumber(hop.loss) + '%</td>' +
        '</tr>';
      i++;
    }
  }

  return '<div class="result-panel-title">🔀 MTR 路由追踪 <span class="local-badge">本地实测</span></div>' +
    '<div class="probe-info">' +
      '节点：' + escapeHtml(probe.location || '-') +
      ' | ' + escapeHtml(probe.network || '-') +
    '</div>' +
    '<table class="mtr-table">' +
      '<thead><tr>' +
        '<th>#</th><th>主机</th><th>Min</th><th>Avg</th><th>Max</th><th>丢包</th>' +
      '</tr></thead>' +
      '<tbody>' + rowsHtml + '</tbody>' +
    '</table>';
}

/**
 * 构建 Timing 结果 HTML 片段（适配新的 fetch 探测数据格式）
 */
function buildTimingHtml(result) {
  if (!result.success && result.error) {
    return buildErrorHtml('Timing', result.error);
  }

  var summary = result.summary || {};

  // 新的 Timing 阶段（来自 background.js fetch 探测）
  var phases = [
    { key: 'connectionTime', label: '连接', barClass: 'bar-tcp', color: '#2196F3' },
    { key: 'ttfb', label: 'TTFB', barClass: 'bar-ttfb', color: '#FF9800' },
    { key: 'contentDownload', label: '下载', barClass: 'bar-download', color: '#00BCD4' },
  ];

  var maxVal = 1;
  phases.forEach(function(phase) {
    var s = summary[phase.key];
    if (s && s.available && s.avg !== null && s.avg > maxVal) {
      maxVal = s.avg;
    }
  });

  var waterfallHtml = '';
  phases.forEach(function(phase) {
    var s = summary[phase.key];
    var available = s && s.available;
    var avgVal = (s && s.avg !== null) ? s.avg : null;

    if (!available) {
      waterfallHtml +=
        '<div class="waterfall-row">' +
          '<div class="waterfall-label">' + phase.label + '</div>' +
          '<div class="waterfall-bar-container"><div class="waterfall-bar" style="width:100%;background:#e0e0e0"><span class="waterfall-bar-text" style="color:#999">N/A</span></div></div>' +
          '<div class="waterfall-value unavailable-text">N/A</div>' +
        '</div>';
    } else {
      var pct = avgVal !== null ? Math.max((avgVal / maxVal) * 100, 3) : 0;
      var highlightClass = avgVal !== null ? getTimingHighlightClass(avgVal) : '';

      waterfallHtml +=
        '<div class="waterfall-row">' +
          '<div class="waterfall-label">' + phase.label + '</div>' +
          '<div class="waterfall-bar-container">' +
            '<div class="waterfall-bar ' + phase.barClass + '" style="width:' + pct + '%">' +
              '<span class="waterfall-bar-text">' + (avgVal !== null ? formatNumber(avgVal, 1) : '') + '</span>' +
            '</div>' +
          '</div>' +
          '<div class="waterfall-value ' + highlightClass + '">' + (avgVal !== null ? formatNumber(avgVal) + ' ms' : '-') + '</div>' +
        '</div>';
    }
  });

  // 总耗时
  var totalS = summary.totalTime;
  var totalHtml = '';
  if (totalS && totalS.available) {
    totalHtml = '<div style="margin-top:6px;font-size:12px;font-weight:600;color:var(--color-primary)">' +
      '总耗时：' + formatNumber(totalS.avg) + ' ms' +
      ' (min ' + formatNumber(totalS.min) + ' / max ' + formatNumber(totalS.max) + ')' +
    '</div>';
  }

  return '<div class="result-panel-title">⏱️ Timing <span class="local-badge">本地实测</span></div>' +
    '<div class="waterfall-chart">' + waterfallHtml + '</div>' +
    totalHtml;
}

// ─── 事件绑定与启动 ─────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function() {
  init();

  // 导出按钮
  var exportBtn = document.getElementById('exportBtn');
  if (exportBtn) {
    exportBtn.addEventListener('click', handleExportClick);
  }

  // 导入按钮
  var importBtn = document.getElementById('importBtn');
  var importFile = document.getElementById('importFile');
  if (importBtn && importFile) {
    importBtn.addEventListener('click', function() {
      importFile.click();
    });
    importFile.addEventListener('change', handleImportFile);
  }

  // 重新检测 Native Host 按钮
  var retryNativeBtn = document.getElementById('retryNativeBtn');
  if (retryNativeBtn) {
    retryNativeBtn.addEventListener('click', async function() {
      retryNativeBtn.disabled = true;
      retryNativeBtn.textContent = '检测中...';
      try {
        var resp = await sendMessage({ type: 'CHECK_API_STATUS' });
        updateApiStatus(resp);
        if (resp && resp.success && resp.data && resp.data.nativeHostAvailable) {
          // 重新触发自动分析
          var networkResponse = await sendMessage({ type: 'GET_NETWORK_DATA', tabId: currentTabId });
          if (networkResponse && networkResponse.success && networkResponse.data) {
            var domainKeys = Object.keys(networkResponse.data);
            if (domainKeys.length > 0) {
              renderDomainList(networkResponse.data);
              autoAnalyzeAll(networkResponse.data);
            }
          }
        }
      } catch (e) {}
      retryNativeBtn.disabled = false;
      retryNativeBtn.textContent = '🔄 重新检测';
    });
  }

  // 安装诊断组件按钮 — 打开安装引导页
  var installNativeBtn = document.getElementById('installNativeBtn');
  if (installNativeBtn) {
    installNativeBtn.addEventListener('click', function() {
      chrome.tabs.create({ url: chrome.runtime.getURL('setup.html') });
    });
  }

  // 卸载诊断组件按钮
  var uninstallBtn = document.getElementById('uninstallBtn');
  if (uninstallBtn) {
    uninstallBtn.addEventListener('click', async function() {
      if (!confirm('确定要卸载本地诊断组件吗？卸载后 Ping 和 MTR 功能将不可用。')) return;
      uninstallBtn.disabled = true;
      uninstallBtn.textContent = '卸载中...';
      try {
        var resp = await sendMessage({ type: 'UNINSTALL_NATIVE' });
        if (resp && resp.success) {
          alert('卸载成功！请重启浏览器完成清理。\n\n' + (resp.data && resp.data.data ? resp.data.data : ''));
          // 刷新状态
          var statusResp = await sendMessage({ type: 'CHECK_API_STATUS' });
          updateApiStatus(statusResp);
        } else {
          alert('卸载失败：' + ((resp && resp.error) || '未知错误'));
        }
      } catch (e) {
        alert('卸载失败：' + e.message);
      }
      uninstallBtn.disabled = false;
      uninstallBtn.textContent = '🗑️ 卸载组件';
    });
  }
});

// ─── 导入分析功能 ───────────────────────────────────────────────

/**
 * 处理导入的 JSON 报告文件
 */
function handleImportFile(event) {
  var file = event.target.files[0];
  if (!file) return;

  var reader = new FileReader();
  reader.onload = function(e) {
    try {
      var report = JSON.parse(e.target.result);
      renderImportedReport(report);
    } catch (err) {
      alert('文件解析失败：' + err.message);
    }
  };
  reader.readAsText(file);

  // 重置 input 以便再次选择同一文件
  event.target.value = '';
}

/**
 * 渲染导入的报告数据
 * @param {object} report - 导出的报告 JSON 对象
 */
function renderImportedReport(report) {
  if (!report || !report.domains) {
    alert('无效的报告文件格式');
    return;
  }

  var container = document.getElementById('domainListContainer');
  var emptyState = document.getElementById('emptyState');
  if (emptyState) emptyState.style.display = 'none';
  if (container) container.style.display = '';
  container.innerHTML = '';

  // 显示报告元信息
  var metaHtml = '<div class="import-meta">' +
    '<div class="import-meta-title">📂 导入的报告</div>' +
    '<div class="import-meta-info">' +
      '导出时间：' + escapeHtml(report.exportTime || '-') +
      ' | 页面：' + escapeHtml(report.pageUrl || '-') +
    '</div>' +
  '</div>';
  container.innerHTML = metaHtml;

  var domains = Object.keys(report.domains).sort();

  domains.forEach(function(domain) {
    var domainData = report.domains[domain];
    var info = domainData.info || {};

    var item = document.createElement('div');
    item.className = 'domain-item';

    // 资源类型标签
    var typesHtml = '';
    var types = info.types || [];
    types.slice(0, 4).forEach(function(t) {
      typesHtml += '<span class="type-tag">' + escapeHtml(t) + '</span>';
    });

    var headerHtml =
      '<div class="domain-item-header">' +
        '<div class="domain-info">' +
          '<div class="domain-name">' + escapeHtml(domain) + '</div>' +
          '<div class="domain-meta">' +
            '<span class="domain-ip">' + escapeHtml(info.ip || '未知 IP') + '</span>' +
            '<span class="domain-count">' + (info.requestCount || 0) + ' 次请求</span>' +
            typesHtml +
          '</div>' +
        '</div>' +
      '</div>';

    var resultsHtml = '';

    // 渲染 Timing 结果
    if (domainData.timingResult) {
      resultsHtml += '<div class="result-panel">' + buildTimingHtml(domainData.timingResult) + '</div>';
    }

    // 渲染 Ping 结果
    if (domainData.pingResult) {
      resultsHtml += '<div class="result-panel">' + buildPingHtml(domainData.pingResult) + '</div>';
    }

    // 渲染 MTR 结果
    if (domainData.mtrResult) {
      resultsHtml += '<div class="result-panel">' + buildMtrHtml(domainData.mtrResult) + '</div>';
    }

    if (!resultsHtml) {
      resultsHtml = '<div class="result-panel"><div class="unavailable-text" style="padding:8px">无诊断数据</div></div>';
    }

    item.innerHTML = headerHtml + '<div class="result-area">' + resultsHtml + '</div>';
    container.appendChild(item);
  });
}
