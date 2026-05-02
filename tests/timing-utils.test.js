/**
 * timing-utils.js 单元测试
 *
 * 测试 parseTimingEntry 和 computeTimingSummary 纯函数。
 */

import { describe, it, expect } from 'vitest';
import { parseTimingEntry, computeTimingSummary } from '../timing-utils.js';

// ─── 辅助：构造 PerformanceResourceTiming 模拟对象 ──────────────

/**
 * 创建一个正常的（非跨域限制）HTTPS 资源 Timing 条目
 */
function makeNormalHttpsEntry(overrides = {}) {
  return {
    name: 'https://api.example.com/data.json',
    startTime: 100,
    domainLookupStart: 110,
    domainLookupEnd: 120,
    connectStart: 120,
    connectEnd: 140,
    secureConnectionStart: 125,
    requestStart: 140,
    responseStart: 200,
    responseEnd: 250,
    ...overrides,
  };
}

/**
 * 创建一个正常的 HTTP（非 HTTPS）资源 Timing 条目
 */
function makeNormalHttpEntry(overrides = {}) {
  return {
    name: 'http://cdn.example.com/style.css',
    startTime: 50,
    domainLookupStart: 55,
    domainLookupEnd: 60,
    connectStart: 60,
    connectEnd: 70,
    secureConnectionStart: 0,
    requestStart: 70,
    responseStart: 100,
    responseEnd: 130,
    ...overrides,
  };
}

/**
 * 创建一个跨域限制的资源 Timing 条目
 */
function makeCrossOriginEntry(overrides = {}) {
  return {
    name: 'https://third-party.com/tracker.js',
    startTime: 200,
    domainLookupStart: 0,
    domainLookupEnd: 0,
    connectStart: 0,
    connectEnd: 0,
    secureConnectionStart: 0,
    requestStart: 0,
    responseStart: 0,
    responseEnd: 350,
    ...overrides,
  };
}

// ─── parseTimingEntry 测试 ──────────────────────────────────────

describe('parseTimingEntry', () => {
  it('should parse a normal HTTPS entry correctly', () => {
    const entry = makeNormalHttpsEntry();
    const result = parseTimingEntry(entry);

    expect(result.url).toBe('https://api.example.com/data.json');
    expect(result.domain).toBe('api.example.com');
    expect(result.dnsLookup).toBe(10);       // 120 - 110
    expect(result.tcpConnection).toBe(20);   // 140 - 120
    expect(result.tlsHandshake).toBe(15);    // 140 - 125
    expect(result.ttfb).toBe(60);            // 200 - 140
    expect(result.contentDownload).toBe(50); // 250 - 200
    expect(result.totalTime).toBe(150);      // 250 - 100
    expect(result.isCrossOriginRestricted).toBe(false);
  });

  it('should parse a normal HTTP entry with null TLS', () => {
    const entry = makeNormalHttpEntry();
    const result = parseTimingEntry(entry);

    expect(result.domain).toBe('cdn.example.com');
    expect(result.dnsLookup).toBe(5);        // 60 - 55
    expect(result.tcpConnection).toBe(10);   // 70 - 60
    expect(result.tlsHandshake).toBeNull();  // secureConnectionStart === 0
    expect(result.ttfb).toBe(30);            // 100 - 70
    expect(result.contentDownload).toBe(30); // 130 - 100
    expect(result.totalTime).toBe(80);       // 130 - 50
    expect(result.isCrossOriginRestricted).toBe(false);
  });

  it('should detect cross-origin restricted entries', () => {
    const entry = makeCrossOriginEntry();
    const result = parseTimingEntry(entry);

    expect(result.domain).toBe('third-party.com');
    expect(result.dnsLookup).toBeNull();
    expect(result.tcpConnection).toBeNull();
    expect(result.tlsHandshake).toBeNull();
    expect(result.ttfb).toBeNull();
    expect(result.contentDownload).toBeNull();
    expect(result.totalTime).toBe(150);      // 350 - 200
    expect(result.isCrossOriginRestricted).toBe(true);
  });

  it('should NOT mark as cross-origin when startTime is 0', () => {
    // startTime === 0 means it's not cross-origin restricted, just early
    const entry = makeCrossOriginEntry({ startTime: 0 });
    const result = parseTimingEntry(entry);

    expect(result.isCrossOriginRestricted).toBe(false);
  });

  it('should handle entries with zero DNS but non-zero connect (cached DNS)', () => {
    const entry = makeNormalHttpsEntry({
      domainLookupStart: 0,
      domainLookupEnd: 0,
      connectStart: 120,
      connectEnd: 140,
    });
    const result = parseTimingEntry(entry);

    // connectStart/End are non-zero, so not cross-origin restricted
    expect(result.isCrossOriginRestricted).toBe(false);
    expect(result.dnsLookup).toBe(0);
    expect(result.tcpConnection).toBe(20);
  });

  it('should extract domain from URL correctly', () => {
    const entry = makeNormalHttpsEntry({
      name: 'https://sub.domain.example.com:8443/path/to/resource?q=1',
    });
    const result = parseTimingEntry(entry);
    expect(result.domain).toBe('sub.domain.example.com');
  });

  it('should handle invalid URL gracefully', () => {
    const entry = makeNormalHttpsEntry({ name: 'not-a-valid-url' });
    const result = parseTimingEntry(entry);
    expect(result.domain).toBe('');
    expect(result.url).toBe('not-a-valid-url');
  });
});

// ─── computeTimingSummary 测试 ──────────────────────────────────

describe('computeTimingSummary', () => {
  it('should compute correct avg/min/max for multiple entries', () => {
    const entries = [
      parseTimingEntry(makeNormalHttpsEntry({
        domainLookupStart: 100, domainLookupEnd: 110,  // dns=10
        connectStart: 110, connectEnd: 130,             // tcp=20
        secureConnectionStart: 115,                     // tls=15
        requestStart: 130, responseStart: 180,          // ttfb=50
        responseEnd: 230, startTime: 90,                // download=50, total=140
      })),
      parseTimingEntry(makeNormalHttpsEntry({
        domainLookupStart: 200, domainLookupEnd: 220,  // dns=20
        connectStart: 220, connectEnd: 250,             // tcp=30
        secureConnectionStart: 230,                     // tls=20
        requestStart: 250, responseStart: 350,          // ttfb=100
        responseEnd: 450, startTime: 190,               // download=100, total=260
      })),
    ];

    const summary = computeTimingSummary(entries);

    expect(summary.dnsLookup.avg).toBe(15);
    expect(summary.dnsLookup.min).toBe(10);
    expect(summary.dnsLookup.max).toBe(20);
    expect(summary.dnsLookup.available).toBe(true);

    expect(summary.tcpConnection.avg).toBe(25);
    expect(summary.tcpConnection.min).toBe(20);
    expect(summary.tcpConnection.max).toBe(30);

    expect(summary.tlsHandshake.avg).toBe(17.5);
    expect(summary.tlsHandshake.min).toBe(15);
    expect(summary.tlsHandshake.max).toBe(20);

    expect(summary.ttfb.avg).toBe(75);
    expect(summary.ttfb.min).toBe(50);
    expect(summary.ttfb.max).toBe(100);

    expect(summary.contentDownload.avg).toBe(75);
    expect(summary.totalTime.avg).toBe(200);
  });

  it('should mark phase as unavailable when all entries are null', () => {
    const entries = [
      parseTimingEntry(makeCrossOriginEntry()),
      parseTimingEntry(makeCrossOriginEntry({ startTime: 300, responseEnd: 500 })),
    ];

    const summary = computeTimingSummary(entries);

    expect(summary.dnsLookup.available).toBe(false);
    expect(summary.dnsLookup.avg).toBeNull();
    expect(summary.dnsLookup.min).toBeNull();
    expect(summary.dnsLookup.max).toBeNull();

    expect(summary.tcpConnection.available).toBe(false);
    expect(summary.tlsHandshake.available).toBe(false);
    expect(summary.ttfb.available).toBe(false);
    expect(summary.contentDownload.available).toBe(false);

    // totalTime should still be available
    expect(summary.totalTime.available).toBe(true);
  });

  it('should handle mixed entries (some cross-origin, some normal)', () => {
    const entries = [
      parseTimingEntry(makeNormalHttpsEntry()),
      parseTimingEntry(makeCrossOriginEntry()),
    ];

    const summary = computeTimingSummary(entries);

    // DNS should only use the one non-null value
    expect(summary.dnsLookup.available).toBe(true);
    expect(summary.dnsLookup.avg).toBe(10);
    expect(summary.dnsLookup.min).toBe(10);
    expect(summary.dnsLookup.max).toBe(10);

    // totalTime should use both values
    expect(summary.totalTime.available).toBe(true);
    expect(summary.totalTime.min).toBe(150);
    expect(summary.totalTime.max).toBe(150);
  });

  it('should handle empty entries array', () => {
    const summary = computeTimingSummary([]);

    expect(summary.dnsLookup.available).toBe(false);
    expect(summary.tcpConnection.available).toBe(false);
    expect(summary.tlsHandshake.available).toBe(false);
    expect(summary.ttfb.available).toBe(false);
    expect(summary.contentDownload.available).toBe(false);
    expect(summary.totalTime.available).toBe(false);
  });

  it('should handle single entry', () => {
    const entries = [parseTimingEntry(makeNormalHttpsEntry())];
    const summary = computeTimingSummary(entries);

    // avg === min === max for single entry
    expect(summary.dnsLookup.avg).toBe(summary.dnsLookup.min);
    expect(summary.dnsLookup.avg).toBe(summary.dnsLookup.max);
    expect(summary.totalTime.avg).toBe(summary.totalTime.min);
    expect(summary.totalTime.avg).toBe(summary.totalTime.max);
  });

  it('should handle HTTP entries where TLS is null', () => {
    const entries = [
      parseTimingEntry(makeNormalHttpEntry()),
      parseTimingEntry(makeNormalHttpEntry({
        name: 'http://cdn.example.com/script.js',
        startTime: 100,
        domainLookupStart: 105,
        domainLookupEnd: 115,
        connectStart: 115,
        connectEnd: 125,
        secureConnectionStart: 0,
        requestStart: 125,
        responseStart: 160,
        responseEnd: 200,
      })),
    ];

    const summary = computeTimingSummary(entries);

    // TLS should be unavailable for HTTP entries
    expect(summary.tlsHandshake.available).toBe(false);
    expect(summary.tlsHandshake.avg).toBeNull();

    // Other phases should be available
    expect(summary.dnsLookup.available).toBe(true);
    expect(summary.tcpConnection.available).toBe(true);
  });
});
