/**
 * Network Analyzer - Content Script
 *
 * 注入到页面中，负责通过 Resource Timing API 采集性能数据。
 * 因为 content_scripts 不支持 ES module import，所以 timing-utils.js 的逻辑在此内联。
 *
 * 功能：
 * 1. collectTimingData(domain) — 采集指定域名的 Resource Timing 数据
 * 2. probeAndCollect(domain) — 发起 fetch HEAD 请求并用 PerformanceObserver 捕获 Timing
 * 3. chrome.runtime.onMessage 监听器 — 处理 COLLECT_TIMING 消息
 */

// ─── 内联 timing-utils.js 逻辑 ─────────────────────────────────

/**
 * 解析单个 PerformanceResourceTiming 条目，返回 TimingData 对象。
 *
 * 跨域检测逻辑：当 domainLookupStart === 0 && domainLookupEnd === 0
 * && connectStart === 0 && connectEnd === 0 且 startTime > 0 时，
 * 标记 isCrossOriginRestricted = true，DNS/TCP/TLS/TTFB 设为 null。
 *
 * @param {PerformanceResourceTiming} entry - 浏览器 Resource Timing 条目
 * @returns {TimingData} 解析后的 Timing 数据对象
 */
function parseTimingEntry(entry) {
  let domain = '';
  try {
    domain = new URL(entry.name).hostname;
  } catch {
    domain = '';
  }

  const totalTime = entry.responseEnd - entry.startTime;

  // 跨域限制检测：所有连接阶段时间戳均为 0，但 startTime > 0
  const isCrossOriginRestricted =
    entry.domainLookupStart === 0 &&
    entry.domainLookupEnd === 0 &&
    entry.connectStart === 0 &&
    entry.connectEnd === 0 &&
    entry.startTime > 0;

  if (isCrossOriginRestricted) {
    return {
      url: entry.name,
      domain,
      dnsLookup: null,
      tcpConnection: null,
      tlsHandshake: null,
      ttfb: null,
      contentDownload: null,
      totalTime,
      isCrossOriginRestricted: true,
    };
  }

  const dnsLookup = entry.domainLookupEnd - entry.domainLookupStart;
  const tcpConnection = entry.connectEnd - entry.connectStart;

  // TLS 握手仅在 HTTPS 请求中有效（secureConnectionStart > 0）
  const tlsHandshake =
    entry.secureConnectionStart > 0
      ? entry.connectEnd - entry.secureConnectionStart
      : null;

  const ttfb = entry.responseStart - entry.requestStart;
  const contentDownload = entry.responseEnd - entry.responseStart;

  return {
    url: entry.name,
    domain,
    dnsLookup,
    tcpConnection,
    tlsHandshake,
    ttfb,
    contentDownload,
    totalTime,
    isCrossOriginRestricted: false,
  };
}

/**
 * 计算单个阶段的统计聚合（avg/min/max）。
 * 仅对非 null 值进行统计。
 *
 * @param {Array<number|null>} values - 该阶段的所有值
 * @returns {{ avg: number|null, min: number|null, max: number|null, available: boolean }}
 */
function computePhaseSummary(values) {
  const validValues = values.filter((v) => v !== null);
  if (validValues.length === 0) {
    return { avg: null, min: null, max: null, available: false };
  }
  const sum = validValues.reduce((a, b) => a + b, 0);
  return {
    avg: sum / validValues.length,
    min: Math.min(...validValues),
    max: Math.max(...validValues),
    available: true,
  };
}

/**
 * 对多个 TimingData 条目进行统计聚合，计算各阶段的 avg/min/max。
 *
 * @param {TimingData[]} entries - parseTimingEntry 返回的 TimingData 数组
 * @returns {TimingSummaryResult} 各阶段的统计聚合结果
 */
function computeTimingSummary(entries) {
  const phases = [
    'dnsLookup',
    'tcpConnection',
    'tlsHandshake',
    'ttfb',
    'contentDownload',
    'totalTime',
  ];

  const result = {};
  for (const phase of phases) {
    const values = entries.map((e) => e[phase]);
    result[phase] = computePhaseSummary(values);
  }

  return result;
}

// ─── Content Script 特有逻辑 ────────────────────────────────────

/**
 * 收集指定域名的 Resource Timing 数据。
 * 调用 performance.getEntriesByType('resource')，过滤指定域名，
 * 对每个条目调用 parseTimingEntry。
 *
 * @param {string} domain - 要采集的目标域名
 * @returns {{ entries: TimingData[], summary: TimingSummaryResult }}
 */
function collectTimingData(domain) {
  const resourceEntries = performance.getEntriesByType('resource');

  const matchingEntries = resourceEntries.filter((entry) => {
    try {
      const entryDomain = new URL(entry.name).hostname;
      return entryDomain === domain;
    } catch {
      return false;
    }
  });

  const entries = matchingEntries.map(parseTimingEntry);
  const summary = computeTimingSummary(entries);

  return {
    success: true,
    domain,
    entries,
    summary,
  };
}

/**
 * 发起一次新的 fetch HEAD 请求到目标域名，使用 PerformanceObserver
 * 实时捕获该请求的完整 Timing 数据。
 *
 * @param {string} domain - 目标域名
 * @returns {Promise<{ entries: TimingData[], summary: TimingSummaryResult }>}
 */
function probeAndCollect(domain) {
  return new Promise((resolve, reject) => {
    const probeUrl = `https://${domain}/?_net_probe=${Date.now()}`;
    let resolved = false;

    // 设置超时（10 秒）
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        observer.disconnect();
        // 超时后回退到 collectTimingData
        resolve(collectTimingData(domain));
      }
    }, 10000);

    // 使用 PerformanceObserver 捕获新请求的 Timing
    const observer = new PerformanceObserver((list) => {
      const observedEntries = list.getEntries();
      for (const entry of observedEntries) {
        try {
          if (entry.name === probeUrl && !resolved) {
            resolved = true;
            clearTimeout(timeout);
            observer.disconnect();

            const timingData = parseTimingEntry(entry);
            const summary = computeTimingSummary([timingData]);

            resolve({
              success: true,
              domain,
              entries: [timingData],
              summary,
              isProbe: true,
            });
            return;
          }
        } catch {
          // 忽略解析错误，继续等待
        }
      }
    });

    observer.observe({ type: 'resource', buffered: false });

    // 发起 fetch HEAD 请求（no-cache）
    fetch(probeUrl, {
      method: 'HEAD',
      cache: 'no-cache',
      mode: 'no-cors',
    }).catch(() => {
      // fetch 失败时回退到已有数据
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        observer.disconnect();
        resolve(collectTimingData(domain));
      }
    });
  });
}

// ─── 消息监听器 ─────────────────────────────────────────────────

/**
 * 监听来自 Background Service Worker 的消息。
 * 处理 COLLECT_TIMING 消息类型。
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'COLLECT_TIMING') {
    return false;
  }

  const domain = message.domain;
  if (!domain) {
    sendResponse({
      success: false,
      error: '未指定目标域名',
    });
    return false;
  }

  // 先收集已有的 Resource Timing 数据
  const existingData = collectTimingData(domain);

  // 如果有 probe 标志，额外发起探测请求
  if (message.probe) {
    probeAndCollect(domain)
      .then((probeData) => {
        // 合并已有数据和探测数据
        const allEntries = [...existingData.entries, ...probeData.entries];
        const summary = computeTimingSummary(allEntries);
        sendResponse({
          success: true,
          domain,
          entries: allEntries,
          summary,
        });
      })
      .catch((err) => {
        // 探测失败时返回已有数据
        sendResponse(existingData);
      });
    return true; // 异步响应
  }

  // 默认只返回已有数据
  sendResponse(existingData);
  return false;
});
