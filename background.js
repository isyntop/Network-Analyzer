/**
 * Network Analyzer - Background Service Worker
 *
 * 核心协调层，负责：
 * 1. 网络请求监听与域名/IP 采集
 * 2. 消息路由（Popup ↔ Service Worker ↔ Content Script）
 * 3. API 调用协调（Ping/MTR 通过 Globalping API）
 * 4. 诊断结果存储与导出报告生成
 */

import { getConfig, setConfig } from './config.js';
import { createApiClientWithFallback } from './api-client.js';

const NATIVE_HOST_NAME = 'com.network.analyzer';

// Native Host 连接状态缓存
let nativeHostAvailable = null; // null=未检测, true/false

// ─── 内部状态 ───────────────────────────────────────────────────

/**
 * 每个标签页的网络数据存储
 * Map<number, Record<string, DomainInfo>>
 * DomainInfo: { ip: string|null, requestCount: number, types: Set<string>, firstSeen: number }
 */
const tabNetworkData = new Map();

/**
 * 每个标签页的诊断结果存储（供导出报告使用）
 * Map<number, Record<string, { pingResult?, mtrResult?, timingResult? }>>
 */
const tabDiagnosticResults = new Map();

// ─── 域名/IP 采集逻辑 ──────────────────────────────────────────

/**
 * 处理网络请求响应，提取域名和 IP 信息。
 * 导出为命名函数以便测试。
 *
 * @param {object} details - chrome.webRequest.onResponseStarted 事件详情
 */
export function handleWebRequest(details) {
  // 过滤浏览器内部请求（tabId < 0）
  if (details.tabId < 0) return;

  let domain;
  try {
    const url = new URL(details.url);
    domain = url.hostname;
  } catch {
    return;
  }
  if (!domain) return;

  const ip = details.ip || null;

  if (!tabNetworkData.has(details.tabId)) {
    tabNetworkData.set(details.tabId, {});
  }

  const tabData = tabNetworkData.get(details.tabId);

  if (!tabData[domain]) {
    tabData[domain] = {
      ip: ip,
      requestCount: 0,
      types: new Set(),
      firstSeen: Date.now(),
    };
  }

  tabData[domain].requestCount++;
  // 保留首次发现的 IP 地址
  if (ip && !tabData[domain].ip) {
    tabData[domain].ip = ip;
  }
  tabData[domain].types.add(details.type);
}

/**
 * 处理标签页导航事件，清除旧数据。
 * 仅处理主框架（frameId === 0）的导航。
 *
 * @param {object} details - chrome.webNavigation.onBeforeNavigate 事件详情
 */
export function handleNavigation(details) {
  if (details.frameId === 0) {
    tabNetworkData.delete(details.tabId);
    tabDiagnosticResults.delete(details.tabId);
  }
}

/**
 * 处理标签页关闭事件，释放内存。
 *
 * @param {number} tabId - 被关闭的标签页 ID
 */
export function handleTabRemoved(tabId) {
  tabNetworkData.delete(tabId);
  tabDiagnosticResults.delete(tabId);
}

// 注册事件监听器
chrome.webRequest.onResponseStarted.addListener(
  handleWebRequest,
  { urls: ['<all_urls>'] }
);

chrome.tabs.onRemoved.addListener(handleTabRemoved);

chrome.webNavigation.onBeforeNavigate.addListener(handleNavigation);

// ─── 消息路由与处理 ─────────────────────────────────────────────

/**
 * 获取指定 tabId 的域名网络数据，将 Set 转为 Array 以便序列化。
 *
 * @param {number} tabId
 * @returns {{ success: boolean, data: object }}
 */
export function getNetworkData(tabId) {
  const data = tabNetworkData.get(tabId) || {};
  const serializable = {};
  for (const [domain, info] of Object.entries(data)) {
    serializable[domain] = {
      ...info,
      types: Array.from(info.types || []),
    };
  }
  return { success: true, data: serializable };
}

/**
 * 发送 Native Messaging 消息
 * @param {object} message
 * @returns {Promise<object>}
 */
function sendNativeMessage(message) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * 检测 Native Host 是否可用
 * @returns {Promise<boolean>}
 */
async function checkNativeHost() {
  try {
    const response = await sendNativeMessage({ command: 'ping_check' });
    nativeHostAvailable = !!(response && response.success);
    return nativeHostAvailable;
  } catch {
    nativeHostAvailable = false;
    return false;
  }
}

/**
 * 通过 Native Host 执行本地 Ping
 * @param {string} target
 * @param {number} count
 * @returns {Promise<object>} PingResult 格式
 */
async function nativePing(target, count) {
  const response = await sendNativeMessage({
    command: 'ping',
    target: target,
    count: count || 10,
  });

  if (!response || !response.success) {
    throw new Error(response?.error || 'Native ping failed');
  }

  const data = response.data;
  return {
    success: true,
    probe: { location: '本地', network: '本机网络' },
    stats: {
      min: data.stats?.min || 0,
      avg: data.stats?.avg || 0,
      max: data.stats?.max || 0,
      packetLoss: data.stats?.packetLoss || 0,
      sent: data.stats?.sent || 0,
      received: data.stats?.received || 0,
    },
    rawOutput: data.rawOutput || data.raw,
    source: 'local',
  };
}

/**
 * 通过 Native Host 执行本地 MTR/Traceroute
 * @param {string} target
 * @param {number} maxHops
 * @returns {Promise<object>} MtrResult 格式
 */
async function nativeMtr(target, maxHops) {
  const response = await sendNativeMessage({
    command: 'mtr',
    target: target,
    maxHops: maxHops || 30,
  });

  if (!response || !response.success) {
    throw new Error(response?.error || 'Native mtr failed');
  }

  const data = response.data;
  return {
    success: true,
    probe: { location: '本地', network: '本机网络' },
    hops: (data.hops || []).map((hop) => ({
      hop: hop.hop,
      host: hop.host || '* * *',
      loss: hop.loss || 0,
      sent: hop.sent || 0,
      received: hop.received || 0,
      rttMin: hop.rttMin || 0,
      rttAvg: hop.rttAvg || 0,
      rttMax: hop.rttMax || 0,
      stDev: hop.stDev || 0,
      isTimeout: hop.isTimeout || false,
    })),
    rawOutput: data.rawOutput || data.raw,
    source: 'local',
  };
}

/**
 * 执行 Ping 诊断（仅通过本地 Native Host）。
 *
 * @param {string} target - 目标域名或 IP
 * @param {number} [count] - 发送包数
 * @returns {Promise<object>} Ping 结果
 */
export async function handlePing(target, count) {
  if (nativeHostAvailable === false) {
    return { success: false, error: 'NATIVE_HOST_NOT_INSTALLED' };
  }
  try {
    const result = await nativePing(target, count || 10);
    return { success: true, data: result };
  } catch (err) {
    nativeHostAvailable = false;
    return { success: false, error: 'NATIVE_HOST_NOT_INSTALLED' };
  }
}

/**
 * 执行 MTR 路由追踪诊断（仅通过本地 Native Host）。
 *
 * @param {string} target - 目标域名或 IP
 * @param {string} [protocol] - 协议类型（未使用，保留接口兼容）
 * @returns {Promise<object>} MTR 结果
 */
export async function handleMtr(target, protocol) {
  if (nativeHostAvailable === false) {
    return { success: false, error: 'NATIVE_HOST_NOT_INSTALLED' };
  }
  try {
    const result = await nativeMtr(target);
    return { success: true, data: result };
  } catch (err) {
    nativeHostAvailable = false;
    return { success: false, error: 'NATIVE_HOST_NOT_INSTALLED' };
  }
}

/**
 * 执行 Timing 分析。
 * 直接在 Service Worker 中发起 fetch 请求测量各阶段耗时，
 * 避免跨域 Resource Timing 限制。
 *
 * @param {number} tabId - 标签页 ID
 * @param {string} domain - 目标域名
 * @returns {Promise<object>} Timing 结果
 */
export async function handleTiming(tabId, domain) {
  try {
    const probeUrl = `https://${domain}/?_net_timing_probe=${Date.now()}`;
    const timings = [];

    // 发送 3 次探测请求取平均值
    for (let i = 0; i < 3; i++) {
      const url = `${probeUrl}&_i=${i}`;
      const timing = await measureFetchTiming(url);
      if (timing) timings.push(timing);
    }

    if (timings.length === 0) {
      return { success: false, error: '无法连接到目标域名' };
    }

    // 计算统计聚合
    const summary = computeFetchTimingSummary(timings);

    return {
      success: true,
      data: {
        success: true,
        domain,
        entries: timings,
        summary,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err.message || '获取 Timing 数据失败',
    };
  }
}

/**
 * 通过 fetch 测量单次请求的各阶段耗时。
 * 在 Service Worker 中发起请求，不受跨域 Timing 限制。
 *
 * @param {string} url - 探测 URL
 * @returns {Promise<object|null>} 各阶段耗时数据
 */
async function measureFetchTiming(url) {
  try {
    const dnsStart = performance.now();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const connectStart = performance.now();
    const response = await fetch(url, {
      method: 'HEAD',
      cache: 'no-store',
      signal: controller.signal,
    });
    const ttfbEnd = performance.now();

    // 读取完响应体（HEAD 请求通常没有 body）
    try { await response.text(); } catch {}
    const responseEnd = performance.now();

    clearTimeout(timeoutId);

    const totalTime = responseEnd - dnsStart;
    const ttfb = ttfbEnd - connectStart;
    const contentDownload = responseEnd - ttfbEnd;

    return {
      url,
      domain: new URL(url).hostname,
      totalTime: Math.round(totalTime * 100) / 100,
      ttfb: Math.round(ttfb * 100) / 100,
      contentDownload: Math.round(contentDownload * 100) / 100,
      // Service Worker 无法精确分离 DNS/TCP/TLS，用总连接时间代替
      connectionTime: Math.round(ttfb * 100) / 100,
      statusCode: response.status,
      isCrossOriginRestricted: false,
    };
  } catch (err) {
    if (err.name === 'AbortError') return null;
    return null;
  }
}

/**
 * 计算 fetch Timing 统计聚合
 * @param {Array} timings - measureFetchTiming 返回的数组
 * @returns {object} 统计聚合结果
 */
function computeFetchTimingSummary(timings) {
  function summarize(values) {
    const valid = values.filter(v => v !== null && v !== undefined);
    if (valid.length === 0) return { avg: null, min: null, max: null, available: false };
    const sum = valid.reduce((a, b) => a + b, 0);
    return {
      avg: Math.round((sum / valid.length) * 100) / 100,
      min: Math.round(Math.min(...valid) * 100) / 100,
      max: Math.round(Math.max(...valid) * 100) / 100,
      available: true,
    };
  }

  return {
    ttfb: summarize(timings.map(t => t.ttfb)),
    contentDownload: summarize(timings.map(t => t.contentDownload)),
    connectionTime: summarize(timings.map(t => t.connectionTime)),
    totalTime: summarize(timings.map(t => t.totalTime)),
  };
}

/**
 * 执行 API 可达性预检。
 * 创建带降级策略的 API 客户端，调用 checkAvailability。
 *
 * @returns {Promise<object>} API 状态检查结果
 */
export async function handleCheckApiStatus() {
  try {
    const nativeAvailable = await checkNativeHost();
    return {
      success: true,
      data: {
        nativeHostAvailable: nativeAvailable,
        anyAvailable: nativeAvailable,
      },
    };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
}

/**
 * 生成导出报告。
 * 汇总指定 tabId 的域名数据和所有诊断结果。
 *
 * @param {number} tabId - 标签页 ID
 * @returns {Promise<object>} 导出报告
 */
export async function handleExportReport(tabId) {
  try {
    // 获取当前标签页 URL
    let pageUrl = '';
    try {
      const tab = await chrome.tabs.get(tabId);
      pageUrl = tab.url || '';
    } catch {
      // 获取 tab 信息失败时使用空字符串
    }

    // 获取域名网络数据
    const networkData = tabNetworkData.get(tabId) || {};
    const diagnosticData = tabDiagnosticResults.get(tabId) || {};

    // 构建导出报告
    const domains = {};
    for (const [domain, info] of Object.entries(networkData)) {
      domains[domain] = {
        info: {
          ...info,
          types: Array.from(info.types || []),
        },
        ...(diagnosticData[domain] || {}),
      };
    }

    const report = {
      exportTime: new Date().toISOString(),
      pageUrl,
      domains,
    };

    return { success: true, data: report };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
}

/**
 * 存储诊断结果到 tabDiagnosticResults，供导出报告使用。
 *
 * @param {number} tabId - 标签页 ID
 * @param {string} domain - 域名
 * @param {string} resultType - 结果类型：'pingResult' | 'mtrResult' | 'timingResult'
 * @param {object} result - 诊断结果数据
 */
export function storeDiagnosticResult(tabId, domain, resultType, result) {
  if (!tabDiagnosticResults.has(tabId)) {
    tabDiagnosticResults.set(tabId, {});
  }
  const tabDiag = tabDiagnosticResults.get(tabId);
  if (!tabDiag[domain]) {
    tabDiag[domain] = {};
  }
  tabDiag[domain][resultType] = result;
}

/**
 * 消息路由处理器。
 * 根据消息类型分发到对应的处理函数。
 *
 * @param {object} message - 消息对象
 * @param {object} sender - 发送者信息
 * @param {Function} sendResponse - 响应回调
 * @returns {boolean} 是否异步响应（true 表示 sendResponse 将异步调用）
 */
export function messageHandler(message, sender, sendResponse) {
  if (!message || !message.type) return false;

  switch (message.type) {
    case 'GET_NETWORK_DATA': {
      sendResponse(getNetworkData(message.tabId));
      return false;
    }

    case 'RUN_PING': {
      handlePing(message.target, message.count).then((result) => {
        // 存储诊断结果
        if (result.data && message.target) {
          // 尝试从 tabId 存储（如果消息中包含 tabId）
          if (message.tabId) {
            storeDiagnosticResult(message.tabId, message.target, 'pingResult', result.data);
          }
        }
        sendResponse(result);
      });
      return true; // 异步响应
    }

    case 'RUN_MTR': {
      handleMtr(message.target, message.protocol).then((result) => {
        if (result.data && message.target && message.tabId) {
          storeDiagnosticResult(message.tabId, message.target, 'mtrResult', result.data);
        }
        sendResponse(result);
      });
      return true;
    }

    case 'RUN_TIMING': {
      handleTiming(message.tabId, message.domain).then((result) => {
        if (result.data && message.domain && message.tabId) {
          storeDiagnosticResult(message.tabId, message.domain, 'timingResult', result.data);
        }
        sendResponse(result);
      });
      return true;
    }

    case 'CHECK_API_STATUS': {
      handleCheckApiStatus().then(sendResponse);
      return true;
    }

    case 'EXPORT_REPORT': {
      handleExportReport(message.tabId).then(sendResponse);
      return true;
    }

    case 'GET_CONFIG': {
      getConfig().then((config) => {
        sendResponse({ success: true, data: config });
      });
      return true;
    }

    case 'SET_CONFIG': {
      setConfig(message.config).then((mergedConfig) => {
        sendResponse({ success: true, data: mergedConfig });
      });
      return true;
    }

    case 'UNINSTALL_NATIVE': {
      sendNativeMessage({ command: 'uninstall' }).then((result) => {
        // 卸载后重置状态
        nativeHostAvailable = false;
        sendResponse({ success: true, data: result });
      }).catch((err) => {
        sendResponse({ success: false, error: err.message || '卸载失败' });
      });
      return true;
    }

    default:
      return false;
  }
}

// 注册消息处理器
chrome.runtime.onMessage.addListener(messageHandler);

// ─── 导出内部状态访问器（仅供测试使用）────────────────────────

/**
 * 获取 tabNetworkData（仅供测试使用）
 * @returns {Map}
 */
export function _getTabNetworkData() {
  return tabNetworkData;
}

/**
 * 获取 tabDiagnosticResults（仅供测试使用）
 * @returns {Map}
 */
export function _getTabDiagnosticResults() {
  return tabDiagnosticResults;
}

/**
 * 清除所有内部状态（仅供测试使用）
 */
export function _clearAllData() {
  tabNetworkData.clear();
  tabDiagnosticResults.clear();
}
