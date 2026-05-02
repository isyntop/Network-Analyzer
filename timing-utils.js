/**
 * Timing 工具模块（ES module，供测试使用）
 *
 * 提供 Resource Timing 数据解析和统计聚合的纯函数。
 * content.js 中内联了相同逻辑（因为 content_scripts 不支持 ES module import）。
 */

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
export function parseTimingEntry(entry) {
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
export function computeTimingSummary(entries) {
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
