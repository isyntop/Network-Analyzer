/**
 * Globalping API 客户端基础封装
 *
 * 提供 Globalping API 的底层调用能力，包括创建测量、获取结果和轮询机制。
 * 所有函数接受 baseUrl 参数，保持纯函数设计，不直接依赖 config.js。
 */

/**
 * 辅助函数：延迟指定毫秒数
 *
 * @param {number} ms - 延迟时间（毫秒）
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 创建测量任务（POST /measurements）
 *
 * @param {object} params - 测量请求参数，符合 Globalping API MeasurementRequest 格式
 * @param {string} params.type - 测量类型：'ping' | 'mtr' | 'traceroute' | 'dns' | 'http'
 * @param {string} params.target - 目标域名或 IP 地址
 * @param {Array} [params.locations] - 探测节点位置
 * @param {object} [params.measurementOptions] - 测量选项
 * @param {string} baseUrl - API 基础地址，例如 'https://api.globalping.io/v1'
 * @returns {Promise<{id: string, probesCount: number}>} 创建的测量任务信息
 * @throws {Error} 请求失败时抛出错误，包含 HTTP 状态码和响应信息
 */
export async function postMeasurement(params, baseUrl) {
  const url = `${baseUrl}/measurements`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    let errorMessage;
    try {
      const errorBody = await response.json();
      errorMessage = errorBody.message || errorBody.error || JSON.stringify(errorBody);
    } catch {
      errorMessage = response.statusText;
    }
    const error = new Error(`API 请求失败 (${response.status}): ${errorMessage}`);
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  return { id: data.id, probesCount: data.probesCount };
}

/**
 * 获取测量结果（GET /measurements/:id）
 *
 * @param {string} id - 测量任务 ID
 * @param {string} baseUrl - API 基础地址
 * @returns {Promise<object>} 测量结果对象，包含 status、type、target、results 等字段
 * @throws {Error} 请求失败时抛出错误
 */
export async function getMeasurement(id, baseUrl) {
  const url = `${baseUrl}/measurements/${id}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    let errorMessage;
    try {
      const errorBody = await response.json();
      errorMessage = errorBody.message || errorBody.error || JSON.stringify(errorBody);
    } catch {
      errorMessage = response.statusText;
    }
    const error = new Error(`API 请求失败 (${response.status}): ${errorMessage}`);
    error.status = response.status;
    throw error;
  }

  return response.json();
}

/**
 * 轮询配置常量
 */
const POLL_CONFIG = {
  maxAttempts: 30,
  initialInterval: 500,
  maxInterval: 3000,
  backoffMultiplier: 1.2,
};

/**
 * 执行完整的测量流程：创建测量 + 轮询结果
 *
 * 封装 POST 创建测量和 GET 轮询结果的完整流程。
 * 使用退避策略：初始间隔 500ms，退避系数 1.2，最大间隔 3s，最多轮询 30 次。
 *
 * @param {object} params - 测量请求参数
 * @param {string} baseUrl - API 基础地址
 * @param {number} [timeout] - 超时时间（毫秒），可选。如果提供，将作为额外的超时限制
 * @returns {Promise<object>} 完成的测量结果
 * @throws {Error} 测量超时或失败时抛出错误
 */
export async function executeMeasurement(params, baseUrl, timeout) {
  // Step 1: POST 创建测量
  const { id } = await postMeasurement(params, baseUrl);

  // Step 2: GET 轮询结果
  const startTime = Date.now();
  let attempts = 0;
  let interval = POLL_CONFIG.initialInterval;

  while (attempts < POLL_CONFIG.maxAttempts) {
    // 检查超时
    if (timeout && (Date.now() - startTime) >= timeout) {
      throw new Error('测量超时');
    }

    await sleep(interval);
    attempts++;

    const result = await getMeasurement(id, baseUrl);

    if (result.status !== 'in-progress') {
      return result;
    }

    // 退避策略：interval = interval * backoffMultiplier，但不超过 maxInterval
    interval = Math.min(interval * POLL_CONFIG.backoffMultiplier, POLL_CONFIG.maxInterval);
  }

  throw new Error('测量超时');
}

/**
 * 解析 Globalping API 的 Ping 测量响应，提取 PingResult。
 *
 * @param {object} measurementResponse - Globalping API GET /measurements/:id 的完整响应
 * @returns {PingResult} 解析后的 Ping 结果
 */
export function parsePingResult(measurementResponse) {
  const probeResult = measurementResponse.results && measurementResponse.results[0];

  if (!probeResult) {
    return {
      success: false,
      probe: { location: 'unknown', network: 'unknown' },
      stats: { min: 0, avg: 0, max: 0, packetLoss: 0, sent: 0, received: 0 },
      error: '无探测结果',
    };
  }

  const probe = probeResult.probe || {};
  const location = [probe.city, probe.country, probe.continent]
    .filter(Boolean)
    .join(', ') || 'unknown';
  const network = probe.network || 'unknown';

  const result = probeResult.result || {};

  if (result.status === 'failed') {
    return {
      success: false,
      probe: { location, network },
      stats: { min: 0, avg: 0, max: 0, packetLoss: 100, sent: 0, received: 0 },
      rawOutput: result.rawOutput,
      error: result.rawOutput || '探测失败',
    };
  }

  const stats = result.stats || {};

  return {
    success: true,
    probe: { location, network },
    stats: {
      min: stats.min || 0,
      avg: stats.avg || 0,
      max: stats.max || 0,
      packetLoss: stats.loss || 0,
      sent: stats.total || 0,
      received: stats.rcv || 0,
    },
    rawOutput: result.rawOutput,
  };
}

/**
 * 解析 Globalping API 的 MTR 测量响应，提取 MtrResult。
 *
 * @param {object} measurementResponse - Globalping API GET /measurements/:id 的完整响应
 * @returns {MtrResult} 解析后的 MTR 结果
 */
export function parseMtrResult(measurementResponse) {
  const probeResult = measurementResponse.results && measurementResponse.results[0];

  if (!probeResult) {
    return {
      success: false,
      probe: { location: 'unknown', network: 'unknown' },
      hops: [],
      error: '无探测结果',
    };
  }

  const probe = probeResult.probe || {};
  const location = [probe.city, probe.country, probe.continent]
    .filter(Boolean)
    .join(', ') || 'unknown';
  const network = probe.network || 'unknown';

  const result = probeResult.result || {};

  if (result.status === 'failed') {
    return {
      success: false,
      probe: { location, network },
      hops: [],
      rawOutput: result.rawOutput,
      error: result.rawOutput || '探测失败',
    };
  }

  const rawHops = result.hops || [];
  const hops = rawHops.map((hop, index) => {
    const isTimeout = !hop.resolvedAddress && !hop.resolvedHostname;
    const stats = hop.stats || {};

    return {
      hop: index + 1,
      host: hop.resolvedHostname || hop.resolvedAddress || '* * *',
      loss: stats.loss || 0,
      sent: stats.total || 0,
      received: stats.rcv || 0,
      rttMin: stats.min || 0,
      rttAvg: stats.avg || 0,
      rttMax: stats.max || 0,
      stDev: stats.stDev || 0,
      isTimeout,
    };
  });

  return {
    success: true,
    probe: { location, network },
    hops,
    rawOutput: result.rawOutput,
  };
}

/**
 * 执行 Ping 测量：构造请求、调用 executeMeasurement、解析结果。
 *
 * @param {string} target - 目标域名或 IP 地址
 * @param {object} [options={}] - Ping 选项
 * @param {number} [options.packets=3] - 发送包数
 * @param {string} [options.location='CN'] - 探测节点位置
 * @param {Array} [options.locations] - 自定义探测节点位置数组
 * @param {string} [baseUrl='https://api.globalping.io/v1'] - API 基础地址
 * @returns {Promise<PingResult>} Ping 结果
 */
export async function ping(target, options = {}, baseUrl = 'https://api.globalping.io/v1') {
  const params = {
    type: 'ping',
    target,
    locations: options.locations || [{ magic: options.location || 'CN' }],
    measurementOptions: {
      packets: options.packets || 3,
    },
  };

  const timeout = 30000; // Ping 超时 30 秒

  try {
    const response = await executeMeasurement(params, baseUrl, timeout);
    return parsePingResult(response);
  } catch (error) {
    return {
      success: false,
      probe: { location: 'unknown', network: 'unknown' },
      stats: { min: 0, avg: 0, max: 0, packetLoss: 0, sent: 0, received: 0 },
      error: error.message || '探测失败',
    };
  }
}

/**
 * 执行 MTR 测量：构造请求、调用 executeMeasurement、解析结果。
 *
 * @param {string} target - 目标域名或 IP 地址
 * @param {object} [options={}] - MTR 选项
 * @param {string} [options.protocol='ICMP'] - 协议类型：'ICMP' | 'TCP' | 'UDP'
 * @param {number} [options.packets=3] - 发送包数
 * @param {number} [options.port] - 端口号
 * @param {string} [options.location='CN'] - 探测节点位置
 * @param {Array} [options.locations] - 自定义探测节点位置数组
 * @param {string} [baseUrl='https://api.globalping.io/v1'] - API 基础地址
 * @returns {Promise<MtrResult>} MTR 结果
 */
export async function mtr(target, options = {}, baseUrl = 'https://api.globalping.io/v1') {
  const measurementOptions = {
    protocol: options.protocol || 'ICMP',
    packets: options.packets || 3,
  };

  if (options.port) {
    measurementOptions.port = options.port;
  }

  const params = {
    type: 'mtr',
    target,
    locations: options.locations || [{ magic: options.location || 'CN' }],
    measurementOptions,
  };

  const timeout = 60000; // MTR 超时 60 秒

  try {
    const response = await executeMeasurement(params, baseUrl, timeout);
    return parseMtrResult(response);
  } catch (error) {
    return {
      success: false,
      probe: { location: 'unknown', network: 'unknown' },
      hops: [],
      error: error.message || '探测失败',
    };
  }
}

// ============================================================
// API 降级策略与健康检查
// ============================================================

/**
 * 健康检查缓存有效期（毫秒）：5 分钟
 */
const HEALTH_CHECK_CACHE_TTL = 5 * 60 * 1000;

/**
 * 判断一个错误是否应该触发降级。
 *
 * 降级条件：
 * - fetch 抛出异常（网络错误）
 * - 超时
 * - HTTP 5xx 状态码
 *
 * 不降级条件：
 * - HTTP 4xx 客户端错误（400、404 等）
 *
 * @param {Error} error - 捕获到的错误
 * @returns {boolean} 是否应该降级
 */
export function shouldFallback(error) {
  // 如果错误对象上有 status 属性，检查是否为 5xx
  if (error && typeof error.status === 'number') {
    // 4xx 错误不降级
    if (error.status >= 400 && error.status < 500) {
      return false;
    }
    // 5xx 错误降级
    if (error.status >= 500) {
      return true;
    }
  }
  // 网络错误（fetch 抛出异常，没有 status）或超时 → 降级
  return true;
}

/**
 * 向 API 端点发送轻量级 GET 请求验证可达性。
 *
 * 使用 GET /measurements/health-check-probe 请求，即使返回 404 也算可达。
 * 只有网络错误或 5xx 才算不可达。
 *
 * @param {string} baseUrl - API 基础地址，例如 'https://api.globalping.io/v1'
 * @returns {Promise<boolean>} 端点是否可达
 */
export async function healthCheck(baseUrl) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${baseUrl}/measurements/health-check-probe`, {
      method: 'GET',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // 4xx（如 404）也算可达，只有 5xx 算不可达
    if (response.status >= 500) {
      return false;
    }
    return true;
  } catch {
    // 网络错误、超时等 → 不可达
    return false;
  }
}

/**
 * 创建带降级策略的 API 客户端工厂函数。
 *
 * @param {object} config - 配置对象，结构参考 config.js 中的 DEFAULT_CONFIG
 * @param {Array} config.apiEndpoints - API 端点列表，每个包含 name、baseUrl、priority、isAvailable、lastChecked
 * @param {number} [config.activeEndpointIndex=0] - 当前活跃端点索引
 * @param {string} [config.customEndpoint] - 用户自定义端点
 * @returns {object} 带降级策略的 API 客户端对象
 */
export function createApiClientWithFallback(config) {
  // 构建有序端点列表：自定义端点优先级最高，然后按 priority 排序
  const endpoints = [];

  if (config.customEndpoint) {
    endpoints.push({
      name: '自定义端点',
      baseUrl: config.customEndpoint,
      priority: 0,
      isAvailable: true,
      lastChecked: 0,
    });
  }

  if (config.apiEndpoints && Array.isArray(config.apiEndpoints)) {
    const sorted = [...config.apiEndpoints].sort((a, b) => a.priority - b.priority);
    endpoints.push(...sorted);
  }

  // 健康检查缓存：{ baseUrl: { available: boolean, checkedAt: number } }
  const healthCache = new Map();

  // 当前活跃端点名称
  let activeEndpointName = endpoints.length > 0 ? endpoints[0].name : null;

  /**
   * 检查缓存是否有效
   */
  function isCacheValid(baseUrl) {
    const cached = healthCache.get(baseUrl);
    if (!cached) return false;
    return (Date.now() - cached.checkedAt) < HEALTH_CHECK_CACHE_TTL;
  }

  /**
   * 获取缓存的可用性
   */
  function getCachedAvailability(baseUrl) {
    const cached = healthCache.get(baseUrl);
    if (cached && (Date.now() - cached.checkedAt) < HEALTH_CHECK_CACHE_TTL) {
      return cached.available;
    }
    return null;
  }

  /**
   * 更新缓存
   */
  function updateCache(baseUrl, available) {
    healthCache.set(baseUrl, { available, checkedAt: Date.now() });
  }

  /**
   * 带降级的通用请求执行器。
   *
   * @param {Function} requestFn - 接受 baseUrl 参数的异步请求函数
   * @returns {Promise<*>} 请求结果
   */
  async function executeWithFallback(requestFn) {
    let lastError = null;

    for (const endpoint of endpoints) {
      // 如果缓存标记为不可用且缓存有效，跳过
      const cachedAvail = getCachedAvailability(endpoint.baseUrl);
      if (cachedAvail === false) {
        continue;
      }

      try {
        const result = await requestFn(endpoint.baseUrl);
        activeEndpointName = endpoint.name;
        // 请求成功，更新缓存为可用
        updateCache(endpoint.baseUrl, true);
        return result;
      } catch (error) {
        lastError = error;

        if (!shouldFallback(error)) {
          // 4xx 错误不降级，直接抛出
          throw error;
        }

        // 标记该端点不可用
        updateCache(endpoint.baseUrl, false);
        // 继续尝试下一个端点
      }
    }

    // 所有端点均失败
    throw lastError || new Error('所有 API 端点均不可用');
  }

  return {
    /**
     * 带降级的 Ping 测量。
     *
     * @param {string} target - 目标域名或 IP
     * @param {object} [options={}] - Ping 选项
     * @returns {Promise<PingResult>}
     */
    async pingWithFallback(target, options = {}) {
      const params = {
        type: 'ping',
        target,
        locations: options.locations || [{ magic: options.location || 'CN' }],
        measurementOptions: {
          packets: options.packets || 3,
        },
      };
      const timeout = 30000;

      try {
        const response = await executeWithFallback(
          (baseUrl) => executeMeasurement(params, baseUrl, timeout),
        );
        return parsePingResult(response);
      } catch (error) {
        return {
          success: false,
          probe: { location: 'unknown', network: 'unknown' },
          stats: { min: 0, avg: 0, max: 0, packetLoss: 0, sent: 0, received: 0 },
          error: error.message || '探测失败',
        };
      }
    },

    /**
     * 带降级的 MTR 测量。
     *
     * @param {string} target - 目标域名或 IP
     * @param {object} [options={}] - MTR 选项
     * @returns {Promise<MtrResult>}
     */
    async mtrWithFallback(target, options = {}) {
      const measurementOptions = {
        protocol: options.protocol || 'ICMP',
        packets: options.packets || 3,
      };
      if (options.port) {
        measurementOptions.port = options.port;
      }
      const params = {
        type: 'mtr',
        target,
        locations: options.locations || [{ magic: options.location || 'CN' }],
        measurementOptions,
      };
      const timeout = 60000;

      try {
        const response = await executeWithFallback(
          (baseUrl) => executeMeasurement(params, baseUrl, timeout),
        );
        return parseMtrResult(response);
      } catch (error) {
        return {
          success: false,
          probe: { location: 'unknown', network: 'unknown' },
          hops: [],
          error: error.message || '探测失败',
        };
      }
    },

    /**
     * 预检所有端点可达性，缓存结果。
     *
     * @returns {Promise<Array<{name: string, baseUrl: string, available: boolean}>>}
     */
    async checkAvailability() {
      const results = [];

      for (const endpoint of endpoints) {
        // 如果缓存有效，直接使用缓存
        if (isCacheValid(endpoint.baseUrl)) {
          results.push({
            name: endpoint.name,
            baseUrl: endpoint.baseUrl,
            available: healthCache.get(endpoint.baseUrl).available,
          });
          continue;
        }

        const available = await healthCheck(endpoint.baseUrl);
        updateCache(endpoint.baseUrl, available);
        results.push({
          name: endpoint.name,
          baseUrl: endpoint.baseUrl,
          available,
        });
      }

      // 更新活跃端点为第一个可用的
      const firstAvailable = results.find((r) => r.available);
      if (firstAvailable) {
        activeEndpointName = firstAvailable.name;
      }

      return results;
    },

    /**
     * 返回当前活跃端点名称。
     *
     * @returns {string|null}
     */
    getActiveEndpoint() {
      return activeEndpointName;
    },
  };
}
