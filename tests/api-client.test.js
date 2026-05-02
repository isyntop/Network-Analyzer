import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  sleep,
  postMeasurement,
  getMeasurement,
  executeMeasurement,
  parsePingResult,
  parseMtrResult,
  ping,
  mtr,
  shouldFallback,
  healthCheck,
  createApiClientWithFallback,
} from '../api-client.js';

const BASE_URL = 'https://api.globalping.io/v1';

describe('api-client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('sleep', () => {
    it('should resolve after the specified delay', async () => {
      vi.useFakeTimers();
      let resolved = false;
      const promise = sleep(100).then(() => { resolved = true; });

      expect(resolved).toBe(false);
      await vi.advanceTimersByTimeAsync(100);
      await promise;
      expect(resolved).toBe(true);

      vi.useRealTimers();
    });

    it('should resolve immediately for 0ms', async () => {
      vi.useFakeTimers();
      let resolved = false;
      const promise = sleep(0).then(() => { resolved = true; });

      await vi.advanceTimersByTimeAsync(0);
      await promise;
      expect(resolved).toBe(true);

      vi.useRealTimers();
    });
  });

  describe('postMeasurement', () => {
    it('should POST to /measurements and return id and probesCount', async () => {
      const mockResponse = { id: 'test-id-123', probesCount: 3 };
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const params = {
        type: 'ping',
        target: 'example.com',
        locations: [{ magic: 'CN' }],
      };

      const result = await postMeasurement(params, BASE_URL);

      expect(fetch).toHaveBeenCalledWith(`${BASE_URL}/measurements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      expect(result).toEqual({ id: 'test-id-123', probesCount: 3 });
    });

    it('should throw error with status code on HTTP error with JSON body', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: () => Promise.resolve({ message: 'Invalid target' }),
      });

      await expect(postMeasurement({ type: 'ping', target: '' }, BASE_URL))
        .rejects.toThrow('API 请求失败 (400): Invalid target');
    });

    it('should throw error with statusText when JSON parsing fails', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.reject(new Error('not json')),
      });

      await expect(postMeasurement({ type: 'ping', target: 'x.com' }, BASE_URL))
        .rejects.toThrow('API 请求失败 (500): Internal Server Error');
    });

    it('should attach status property to thrown error', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        json: () => Promise.resolve({ message: 'Rate limited' }),
      });

      try {
        await postMeasurement({ type: 'ping', target: 'x.com' }, BASE_URL);
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err.status).toBe(429);
      }
    });
  });

  describe('getMeasurement', () => {
    it('should GET /measurements/:id and return the result', async () => {
      const mockResult = {
        id: 'test-id-123',
        status: 'finished',
        type: 'ping',
        target: 'example.com',
        results: [],
      };
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResult),
      });

      const result = await getMeasurement('test-id-123', BASE_URL);

      expect(fetch).toHaveBeenCalledWith(`${BASE_URL}/measurements/test-id-123`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      });
      expect(result).toEqual(mockResult);
    });

    it('should throw error on HTTP error', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: () => Promise.resolve({ message: 'Measurement not found' }),
      });

      await expect(getMeasurement('nonexistent', BASE_URL))
        .rejects.toThrow('API 请求失败 (404): Measurement not found');
    });
  });

  describe('executeMeasurement', () => {
    it('should create measurement and poll until finished', async () => {
      // POST response
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'meas-1', probesCount: 1 }),
      });
      // First GET: in-progress
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'meas-1', status: 'in-progress' }),
      });
      // Second GET: finished
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'meas-1', status: 'finished', results: [{ probe: {}, result: {} }] }),
      });

      const result = await executeMeasurement(
        { type: 'ping', target: 'example.com' },
        BASE_URL,
      );

      expect(result.status).toBe('finished');
      expect(fetch).toHaveBeenCalledTimes(3);
    });

    it('should return immediately when first poll returns finished', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'meas-2', probesCount: 1 }),
      });
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'meas-2', status: 'finished', results: [] }),
      });

      const result = await executeMeasurement(
        { type: 'ping', target: 'example.com' },
        BASE_URL,
      );

      expect(result.status).toBe('finished');
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('should return result when status is failed', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'meas-3', probesCount: 1 }),
      });
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'meas-3', status: 'failed', results: [] }),
      });

      const result = await executeMeasurement(
        { type: 'ping', target: 'unreachable.test' },
        BASE_URL,
      );

      expect(result.status).toBe('failed');
    });

    it('should throw timeout error when max attempts exceeded', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'meas-4', probesCount: 1 }),
      });
      // All 30 polls return in-progress
      for (let i = 0; i < 30; i++) {
        fetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ id: 'meas-4', status: 'in-progress' }),
        });
      }

      await expect(
        executeMeasurement({ type: 'ping', target: 'slow.test' }, BASE_URL),
      ).rejects.toThrow('测量超时');
    }, 120000);

    it('should throw timeout error when timeout parameter is exceeded', async () => {
      // Use a very short timeout to trigger the timeout check
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'meas-5', probesCount: 1 }),
      });
      // Return in-progress so it keeps polling
      fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'meas-5', status: 'in-progress' }),
      });

      // Use a 1ms timeout — the first sleep(500ms) will push past it
      await expect(
        executeMeasurement({ type: 'ping', target: 'slow.test' }, BASE_URL, 1),
      ).rejects.toThrow('测量超时');
    });

    it('should propagate POST errors', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: () => Promise.resolve({ message: 'Invalid params' }),
      });

      await expect(
        executeMeasurement({ type: 'ping', target: '' }, BASE_URL),
      ).rejects.toThrow('API 请求失败 (400)');
    });

    it('should propagate GET errors during polling', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'meas-6', probesCount: 1 }),
      });
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.resolve({ message: 'Server error' }),
      });

      await expect(
        executeMeasurement({ type: 'ping', target: 'example.com' }, BASE_URL),
      ).rejects.toThrow('API 请求失败 (500)');
    });
  });
});


describe('parsePingResult', () => {
  it('should parse a successful ping response', () => {
    const response = {
      id: 'test-1',
      status: 'finished',
      results: [{
        probe: {
          continent: 'AS',
          country: 'CN',
          city: 'Beijing',
          state: null,
          network: 'China Telecom',
          tags: [],
          resolvers: [],
        },
        result: {
          status: 'finished',
          rawOutput: 'PING example.com ...',
          stats: { min: 10.5, avg: 15.2, max: 20.1, loss: 0, rcv: 3, drop: 0, total: 3 },
          timings: [{ rtt: 10.5 }, { rtt: 15.2 }, { rtt: 20.1 }],
        },
      }],
    };

    const result = parsePingResult(response);

    expect(result.success).toBe(true);
    expect(result.probe.location).toBe('Beijing, CN, AS');
    expect(result.probe.network).toBe('China Telecom');
    expect(result.stats.min).toBe(10.5);
    expect(result.stats.avg).toBe(15.2);
    expect(result.stats.max).toBe(20.1);
    expect(result.stats.packetLoss).toBe(0);
    expect(result.stats.sent).toBe(3);
    expect(result.stats.received).toBe(3);
    expect(result.rawOutput).toBe('PING example.com ...');
    expect(result.error).toBeUndefined();
  });

  it('should handle failed ping result', () => {
    const response = {
      id: 'test-2',
      status: 'finished',
      results: [{
        probe: {
          continent: 'AS',
          country: 'CN',
          city: 'Shanghai',
          network: 'China Unicom',
        },
        result: {
          status: 'failed',
          rawOutput: 'Request timeout',
        },
      }],
    };

    const result = parsePingResult(response);

    expect(result.success).toBe(false);
    expect(result.probe.location).toBe('Shanghai, CN, AS');
    expect(result.error).toBe('Request timeout');
    expect(result.stats.packetLoss).toBe(100);
  });

  it('should handle empty results array', () => {
    const response = { id: 'test-3', status: 'finished', results: [] };

    const result = parsePingResult(response);

    expect(result.success).toBe(false);
    expect(result.error).toBe('无探测结果');
    expect(result.probe.location).toBe('unknown');
  });

  it('should handle missing results property', () => {
    const response = { id: 'test-4', status: 'finished' };

    const result = parsePingResult(response);

    expect(result.success).toBe(false);
    expect(result.error).toBe('无探测结果');
  });

  it('should handle partial probe info', () => {
    const response = {
      results: [{
        probe: { country: 'US', network: 'AWS' },
        result: {
          status: 'finished',
          stats: { min: 1, avg: 2, max: 3, loss: 0, rcv: 3, drop: 0, total: 3 },
          timings: [],
        },
      }],
    };

    const result = parsePingResult(response);

    expect(result.success).toBe(true);
    expect(result.probe.location).toBe('US');
    expect(result.probe.network).toBe('AWS');
  });

  it('should handle ping with packet loss', () => {
    const response = {
      results: [{
        probe: { city: 'Tokyo', country: 'JP', continent: 'AS', network: 'NTT' },
        result: {
          status: 'finished',
          rawOutput: 'some output',
          stats: { min: 50, avg: 80, max: 120, loss: 33.33, rcv: 2, drop: 1, total: 3 },
          timings: [{ rtt: 50 }, { rtt: 120 }],
        },
      }],
    };

    const result = parsePingResult(response);

    expect(result.success).toBe(true);
    expect(result.stats.packetLoss).toBe(33.33);
    expect(result.stats.sent).toBe(3);
    expect(result.stats.received).toBe(2);
  });
});

describe('parseMtrResult', () => {
  it('should parse a successful MTR response', () => {
    const response = {
      id: 'mtr-1',
      status: 'finished',
      results: [{
        probe: {
          continent: 'AS',
          country: 'CN',
          city: 'Beijing',
          network: 'China Telecom',
        },
        result: {
          status: 'finished',
          rawOutput: 'MTR output...',
          hops: [
            {
              stats: { min: 1, avg: 2, max: 3, loss: 0, rcv: 3, drop: 0, total: 3, stDev: 0.5 },
              asn: [4134],
              timings: [{ rtt: 1 }, { rtt: 2 }, { rtt: 3 }],
              resolvedAddress: '10.0.0.1',
              resolvedHostname: 'gateway.local',
              duplicate: false,
            },
            {
              stats: { min: 5, avg: 8, max: 12, loss: 0, rcv: 3, drop: 0, total: 3, stDev: 2.1 },
              asn: [4134],
              timings: [{ rtt: 5 }, { rtt: 8 }, { rtt: 12 }],
              resolvedAddress: '192.168.1.1',
              resolvedHostname: null,
              duplicate: false,
            },
          ],
        },
      }],
    };

    const result = parseMtrResult(response);

    expect(result.success).toBe(true);
    expect(result.probe.location).toBe('Beijing, CN, AS');
    expect(result.probe.network).toBe('China Telecom');
    expect(result.hops).toHaveLength(2);

    expect(result.hops[0].hop).toBe(1);
    expect(result.hops[0].host).toBe('gateway.local');
    expect(result.hops[0].rttMin).toBe(1);
    expect(result.hops[0].rttAvg).toBe(2);
    expect(result.hops[0].rttMax).toBe(3);
    expect(result.hops[0].stDev).toBe(0.5);
    expect(result.hops[0].loss).toBe(0);
    expect(result.hops[0].sent).toBe(3);
    expect(result.hops[0].received).toBe(3);
    expect(result.hops[0].isTimeout).toBe(false);

    expect(result.hops[1].hop).toBe(2);
    expect(result.hops[1].host).toBe('192.168.1.1');
    expect(result.hops[1].isTimeout).toBe(false);
  });

  it('should handle timeout hops (null address and hostname)', () => {
    const response = {
      results: [{
        probe: { city: 'Tokyo', country: 'JP', continent: 'AS', network: 'NTT' },
        result: {
          status: 'finished',
          rawOutput: 'MTR output...',
          hops: [
            {
              stats: { min: 1, avg: 2, max: 3, loss: 0, rcv: 3, drop: 0, total: 3, stDev: 0.5 },
              asn: [],
              timings: [{ rtt: 1 }],
              resolvedAddress: '10.0.0.1',
              resolvedHostname: 'gw.local',
              duplicate: false,
            },
            {
              stats: { min: 0, avg: 0, max: 0, loss: 100, rcv: 0, drop: 3, total: 3, stDev: 0 },
              asn: [],
              timings: [],
              resolvedAddress: null,
              resolvedHostname: null,
              duplicate: false,
            },
            {
              stats: { min: 10, avg: 15, max: 20, loss: 0, rcv: 3, drop: 0, total: 3, stDev: 3 },
              asn: [13335],
              timings: [{ rtt: 10 }],
              resolvedAddress: '1.1.1.1',
              resolvedHostname: 'one.one.one.one',
              duplicate: false,
            },
          ],
        },
      }],
    };

    const result = parseMtrResult(response);

    expect(result.hops).toHaveLength(3);
    expect(result.hops[1].isTimeout).toBe(true);
    expect(result.hops[1].host).toBe('* * *');
    expect(result.hops[1].loss).toBe(100);
    expect(result.hops[0].isTimeout).toBe(false);
    expect(result.hops[2].isTimeout).toBe(false);
  });

  it('should handle failed MTR result', () => {
    const response = {
      results: [{
        probe: { city: 'London', country: 'GB', continent: 'EU', network: 'BT' },
        result: {
          status: 'failed',
          rawOutput: 'MTR failed: host unreachable',
        },
      }],
    };

    const result = parseMtrResult(response);

    expect(result.success).toBe(false);
    expect(result.hops).toEqual([]);
    expect(result.error).toBe('MTR failed: host unreachable');
  });

  it('should handle empty results array', () => {
    const response = { id: 'mtr-3', status: 'finished', results: [] };

    const result = parseMtrResult(response);

    expect(result.success).toBe(false);
    expect(result.error).toBe('无探测结果');
    expect(result.hops).toEqual([]);
  });

  it('should handle empty hops array', () => {
    const response = {
      results: [{
        probe: { city: 'Berlin', country: 'DE', continent: 'EU', network: 'DT' },
        result: {
          status: 'finished',
          rawOutput: 'MTR output...',
          hops: [],
        },
      }],
    };

    const result = parseMtrResult(response);

    expect(result.success).toBe(true);
    expect(result.hops).toEqual([]);
  });
});

describe('ping', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should execute ping with default options', async () => {
    // POST response
    fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 'ping-1', probesCount: 1 }),
    });
    // GET response - finished
    fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        id: 'ping-1',
        status: 'finished',
        results: [{
          probe: { city: 'Beijing', country: 'CN', continent: 'AS', network: 'CT' },
          result: {
            status: 'finished',
            rawOutput: 'PING ...',
            stats: { min: 10, avg: 15, max: 20, loss: 0, rcv: 3, drop: 0, total: 3 },
            timings: [{ rtt: 10 }, { rtt: 15 }, { rtt: 20 }],
          },
        }],
      }),
    });

    const result = await ping('example.com');

    expect(result.success).toBe(true);
    expect(result.stats.min).toBe(10);
    expect(result.stats.avg).toBe(15);

    // Verify the POST body
    const postCall = fetch.mock.calls[0];
    const body = JSON.parse(postCall[1].body);
    expect(body.type).toBe('ping');
    expect(body.target).toBe('example.com');
    expect(body.locations).toEqual([{ magic: 'CN' }]);
    expect(body.measurementOptions.packets).toBe(3);
  });

  it('should use custom options', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 'ping-2', probesCount: 1 }),
    });
    fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        id: 'ping-2',
        status: 'finished',
        results: [{
          probe: { city: 'Tokyo', country: 'JP', continent: 'AS', network: 'NTT' },
          result: {
            status: 'finished',
            stats: { min: 5, avg: 8, max: 12, loss: 0, rcv: 5, drop: 0, total: 5 },
            timings: [],
          },
        }],
      }),
    });

    const result = await ping('example.com', { packets: 5, location: 'JP' });

    expect(result.success).toBe(true);
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.locations).toEqual([{ magic: 'JP' }]);
    expect(body.measurementOptions.packets).toBe(5);
  });

  it('should return error result on API failure', async () => {
    fetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: () => Promise.resolve({ message: 'Server error' }),
    });

    const result = await ping('example.com');

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.stats.min).toBe(0);
  });
});

describe('mtr', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should execute mtr with default options', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 'mtr-1', probesCount: 1 }),
    });
    fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        id: 'mtr-1',
        status: 'finished',
        results: [{
          probe: { city: 'Beijing', country: 'CN', continent: 'AS', network: 'CT' },
          result: {
            status: 'finished',
            rawOutput: 'MTR ...',
            hops: [{
              stats: { min: 1, avg: 2, max: 3, loss: 0, rcv: 3, drop: 0, total: 3, stDev: 0.5 },
              asn: [4134],
              timings: [{ rtt: 2 }],
              resolvedAddress: '10.0.0.1',
              resolvedHostname: 'gw.local',
              duplicate: false,
            }],
          },
        }],
      }),
    });

    const result = await mtr('example.com');

    expect(result.success).toBe(true);
    expect(result.hops).toHaveLength(1);
    expect(result.hops[0].host).toBe('gw.local');

    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.type).toBe('mtr');
    expect(body.target).toBe('example.com');
    expect(body.locations).toEqual([{ magic: 'CN' }]);
    expect(body.measurementOptions.protocol).toBe('ICMP');
    expect(body.measurementOptions.packets).toBe(3);
  });

  it('should use custom options including port', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 'mtr-2', probesCount: 1 }),
    });
    fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        id: 'mtr-2',
        status: 'finished',
        results: [{
          probe: { city: 'Tokyo', country: 'JP', continent: 'AS', network: 'NTT' },
          result: {
            status: 'finished',
            hops: [],
          },
        }],
      }),
    });

    const result = await mtr('example.com', { protocol: 'TCP', packets: 5, port: 443, location: 'JP' });

    expect(result.success).toBe(true);
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.measurementOptions.protocol).toBe('TCP');
    expect(body.measurementOptions.packets).toBe(5);
    expect(body.measurementOptions.port).toBe(443);
    expect(body.locations).toEqual([{ magic: 'JP' }]);
  });

  it('should not include port when not specified', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 'mtr-3', probesCount: 1 }),
    });
    fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        id: 'mtr-3',
        status: 'finished',
        results: [{
          probe: { city: 'Berlin', country: 'DE', continent: 'EU', network: 'DT' },
          result: { status: 'finished', hops: [] },
        }],
      }),
    });

    await mtr('example.com');

    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.measurementOptions.port).toBeUndefined();
  });

  it('should return error result on API failure', async () => {
    fetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: () => Promise.resolve({ message: 'Server error' }),
    });

    const result = await mtr('example.com');

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.hops).toEqual([]);
  });
});


// ============================================================
// 降级策略与健康检查测试
// ============================================================

describe('shouldFallback', () => {
  it('should return true for network errors (no status)', () => {
    expect(shouldFallback(new Error('fetch failed'))).toBe(true);
  });

  it('should return true for HTTP 500 errors', () => {
    const error = new Error('Server Error');
    error.status = 500;
    expect(shouldFallback(error)).toBe(true);
  });

  it('should return true for HTTP 502 errors', () => {
    const error = new Error('Bad Gateway');
    error.status = 502;
    expect(shouldFallback(error)).toBe(true);
  });

  it('should return true for HTTP 503 errors', () => {
    const error = new Error('Service Unavailable');
    error.status = 503;
    expect(shouldFallback(error)).toBe(true);
  });

  it('should return false for HTTP 400 errors', () => {
    const error = new Error('Bad Request');
    error.status = 400;
    expect(shouldFallback(error)).toBe(false);
  });

  it('should return false for HTTP 404 errors', () => {
    const error = new Error('Not Found');
    error.status = 404;
    expect(shouldFallback(error)).toBe(false);
  });

  it('should return false for HTTP 429 errors', () => {
    const error = new Error('Too Many Requests');
    error.status = 429;
    expect(shouldFallback(error)).toBe(false);
  });

  it('should return true for timeout errors (no status)', () => {
    expect(shouldFallback(new Error('测量超时'))).toBe(true);
  });
});

describe('healthCheck', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return true when API returns 404 (reachable)', async () => {
    fetch.mockResolvedValueOnce({ status: 404 });

    const result = await healthCheck('https://api.globalping.io/v1');

    expect(result).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    const callArgs = fetch.mock.calls[0];
    expect(callArgs[0]).toBe('https://api.globalping.io/v1/measurements/health-check-probe');
    expect(callArgs[1].method).toBe('GET');
    expect(callArgs[1].signal).toBeDefined();
  });

  it('should return true when API returns 200', async () => {
    fetch.mockResolvedValueOnce({ status: 200 });

    const result = await healthCheck('https://api.globalping.io/v1');
    expect(result).toBe(true);
  });

  it('should return true when API returns 400', async () => {
    fetch.mockResolvedValueOnce({ status: 400 });

    const result = await healthCheck('https://api.globalping.io/v1');
    expect(result).toBe(true);
  });

  it('should return false when API returns 500', async () => {
    fetch.mockResolvedValueOnce({ status: 500 });

    const result = await healthCheck('https://api.globalping.io/v1');
    expect(result).toBe(false);
  });

  it('should return false when API returns 503', async () => {
    fetch.mockResolvedValueOnce({ status: 503 });

    const result = await healthCheck('https://api.globalping.io/v1');
    expect(result).toBe(false);
  });

  it('should return false on network error', async () => {
    fetch.mockRejectedValueOnce(new Error('Network error'));

    const result = await healthCheck('https://api.globalping.io/v1');
    expect(result).toBe(false);
  });

  it('should return false on abort/timeout', async () => {
    fetch.mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'));

    const result = await healthCheck('https://api.globalping.io/v1');
    expect(result).toBe(false);
  });
});

describe('createApiClientWithFallback', () => {
  const PRIMARY_URL = 'https://api.globalping.io/v1';
  const FALLBACK_URL = 'https://fallback.api.example.com/v1';

  const testConfig = {
    apiEndpoints: [
      { name: 'Primary', baseUrl: PRIMARY_URL, priority: 1, isAvailable: true, lastChecked: 0 },
      { name: 'Fallback', baseUrl: FALLBACK_URL, priority: 2, isAvailable: true, lastChecked: 0 },
    ],
    activeEndpointIndex: 0,
  };

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getActiveEndpoint', () => {
    it('should return the first endpoint name initially', () => {
      const client = createApiClientWithFallback(testConfig);
      expect(client.getActiveEndpoint()).toBe('Primary');
    });

    it('should return custom endpoint name when customEndpoint is set', () => {
      const client = createApiClientWithFallback({
        ...testConfig,
        customEndpoint: 'https://custom.api.example.com/v1',
      });
      expect(client.getActiveEndpoint()).toBe('自定义端点');
    });

    it('should return null when no endpoints configured', () => {
      const client = createApiClientWithFallback({ apiEndpoints: [] });
      expect(client.getActiveEndpoint()).toBeNull();
    });
  });

  describe('pingWithFallback', () => {
    it('should use primary endpoint when it succeeds', async () => {
      // POST to primary
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'p1', probesCount: 1 }),
      });
      // GET from primary - finished
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          id: 'p1',
          status: 'finished',
          results: [{
            probe: { city: 'Beijing', country: 'CN', continent: 'AS', network: 'CT' },
            result: {
              status: 'finished',
              stats: { min: 10, avg: 15, max: 20, loss: 0, rcv: 3, drop: 0, total: 3 },
            },
          }],
        }),
      });

      const client = createApiClientWithFallback(testConfig);
      const result = await client.pingWithFallback('example.com');

      expect(result.success).toBe(true);
      expect(result.stats.avg).toBe(15);
      expect(client.getActiveEndpoint()).toBe('Primary');

      // Verify it used the primary URL
      expect(fetch.mock.calls[0][0]).toBe(`${PRIMARY_URL}/measurements`);
    });

    it('should fallback to secondary when primary returns 5xx', async () => {
      // POST to primary fails with 500
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.resolve({ message: 'Server error' }),
      });
      // POST to fallback succeeds
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'p2', probesCount: 1 }),
      });
      // GET from fallback - finished
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          id: 'p2',
          status: 'finished',
          results: [{
            probe: { city: 'Tokyo', country: 'JP', continent: 'AS', network: 'NTT' },
            result: {
              status: 'finished',
              stats: { min: 5, avg: 8, max: 12, loss: 0, rcv: 3, drop: 0, total: 3 },
            },
          }],
        }),
      });

      const client = createApiClientWithFallback(testConfig);
      const result = await client.pingWithFallback('example.com');

      expect(result.success).toBe(true);
      expect(client.getActiveEndpoint()).toBe('Fallback');
    });

    it('should fallback when primary throws network error', async () => {
      // Primary network error
      fetch.mockRejectedValueOnce(new Error('Failed to fetch'));
      // POST to fallback succeeds
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'p3', probesCount: 1 }),
      });
      // GET from fallback - finished
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          id: 'p3',
          status: 'finished',
          results: [{
            probe: { city: 'Berlin', country: 'DE', continent: 'EU', network: 'DT' },
            result: {
              status: 'finished',
              stats: { min: 20, avg: 25, max: 30, loss: 0, rcv: 3, drop: 0, total: 3 },
            },
          }],
        }),
      });

      const client = createApiClientWithFallback(testConfig);
      const result = await client.pingWithFallback('example.com');

      expect(result.success).toBe(true);
      expect(client.getActiveEndpoint()).toBe('Fallback');
    });

    it('should NOT fallback on HTTP 400 error', async () => {
      // POST to primary fails with 400
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: () => Promise.resolve({ message: 'Invalid target' }),
      });

      const client = createApiClientWithFallback(testConfig);

      // 400 error should not trigger fallback - it should be returned as error result
      const result = await client.pingWithFallback('');

      expect(result.success).toBe(false);
      expect(result.error).toContain('400');
      // Should NOT have tried the fallback endpoint
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch.mock.calls[0][0]).toBe(`${PRIMARY_URL}/measurements`);
    });

    it('should return error result when all endpoints fail', async () => {
      // Primary network error
      fetch.mockRejectedValueOnce(new Error('Failed to fetch'));
      // Fallback network error
      fetch.mockRejectedValueOnce(new Error('Failed to fetch'));

      const client = createApiClientWithFallback(testConfig);

      // All endpoints fail, but pingWithFallback catches and returns error result
      const result = await client.pingWithFallback('example.com');
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('mtrWithFallback', () => {
    it('should use primary endpoint when it succeeds', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'm1', probesCount: 1 }),
      });
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          id: 'm1',
          status: 'finished',
          results: [{
            probe: { city: 'Beijing', country: 'CN', continent: 'AS', network: 'CT' },
            result: {
              status: 'finished',
              hops: [{
                stats: { min: 1, avg: 2, max: 3, loss: 0, rcv: 3, drop: 0, total: 3, stDev: 0.5 },
                resolvedAddress: '10.0.0.1',
                resolvedHostname: 'gw.local',
              }],
            },
          }],
        }),
      });

      const client = createApiClientWithFallback(testConfig);
      const result = await client.mtrWithFallback('example.com');

      expect(result.success).toBe(true);
      expect(result.hops).toHaveLength(1);
    });

    it('should fallback on primary 5xx error', async () => {
      // Primary 502
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        json: () => Promise.resolve({ message: 'Bad Gateway' }),
      });
      // Fallback succeeds
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'm2', probesCount: 1 }),
      });
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          id: 'm2',
          status: 'finished',
          results: [{
            probe: { city: 'Tokyo', country: 'JP', continent: 'AS', network: 'NTT' },
            result: { status: 'finished', hops: [] },
          }],
        }),
      });

      const client = createApiClientWithFallback(testConfig);
      const result = await client.mtrWithFallback('example.com');

      expect(result.success).toBe(true);
      expect(client.getActiveEndpoint()).toBe('Fallback');
    });
  });

  describe('checkAvailability', () => {
    it('should check all endpoints and return availability', async () => {
      // Primary health check - 404 (reachable)
      fetch.mockResolvedValueOnce({ status: 404 });
      // Fallback health check - 200 (reachable)
      fetch.mockResolvedValueOnce({ status: 200 });

      const client = createApiClientWithFallback(testConfig);
      const results = await client.checkAvailability();

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({ name: 'Primary', baseUrl: PRIMARY_URL, available: true });
      expect(results[1]).toEqual({ name: 'Fallback', baseUrl: FALLBACK_URL, available: true });
    });

    it('should mark unavailable endpoints correctly', async () => {
      // Primary health check - network error
      fetch.mockRejectedValueOnce(new Error('Network error'));
      // Fallback health check - 200
      fetch.mockResolvedValueOnce({ status: 200 });

      const client = createApiClientWithFallback(testConfig);
      const results = await client.checkAvailability();

      expect(results[0].available).toBe(false);
      expect(results[1].available).toBe(true);
      // Active endpoint should be the first available one
      expect(client.getActiveEndpoint()).toBe('Fallback');
    });

    it('should mark 5xx as unavailable', async () => {
      fetch.mockResolvedValueOnce({ status: 500 });
      fetch.mockResolvedValueOnce({ status: 503 });

      const client = createApiClientWithFallback(testConfig);
      const results = await client.checkAvailability();

      expect(results[0].available).toBe(false);
      expect(results[1].available).toBe(false);
    });

    it('should use cached results within TTL', async () => {
      // First check
      fetch.mockResolvedValueOnce({ status: 200 });
      fetch.mockResolvedValueOnce({ status: 200 });

      const client = createApiClientWithFallback(testConfig);
      await client.checkAvailability();

      // Second check should use cache (no additional fetch calls)
      const results = await client.checkAvailability();

      expect(fetch).toHaveBeenCalledTimes(2); // Only the first 2 calls
      expect(results).toHaveLength(2);
      expect(results[0].available).toBe(true);
      expect(results[1].available).toBe(true);
    });
  });

  describe('custom endpoint priority', () => {
    it('should try custom endpoint first', async () => {
      const customUrl = 'https://custom.api.example.com/v1';
      const configWithCustom = {
        ...testConfig,
        customEndpoint: customUrl,
      };

      // Custom endpoint POST succeeds
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'c1', probesCount: 1 }),
      });
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          id: 'c1',
          status: 'finished',
          results: [{
            probe: { city: 'Shanghai', country: 'CN', continent: 'AS', network: 'CU' },
            result: {
              status: 'finished',
              stats: { min: 5, avg: 10, max: 15, loss: 0, rcv: 3, drop: 0, total: 3 },
            },
          }],
        }),
      });

      const client = createApiClientWithFallback(configWithCustom);
      const result = await client.pingWithFallback('example.com');

      expect(result.success).toBe(true);
      expect(client.getActiveEndpoint()).toBe('自定义端点');
      // Verify it used the custom URL
      expect(fetch.mock.calls[0][0]).toBe(`${customUrl}/measurements`);
    });
  });
});
