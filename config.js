/**
 * 配置管理模块
 *
 * 管理 Network Analyzer 的配置，包括 API 端点、Ping/MTR 默认参数等。
 * 配置存储在 chrome.storage.local 中，支持用户自定义。
 */

/** chrome.storage.local 中存储配置的键名 */
const STORAGE_KEY = 'network_analyzer_config';

/**
 * 默认配置
 * @type {ExtensionConfig}
 */
export const DEFAULT_CONFIG = {
  apiEndpoints: [
    {
      name: 'Globalping API',
      baseUrl: 'https://api.globalping.io/v1',
      priority: 1,
      isAvailable: true,
      lastChecked: 0,
    },
    {
      name: 'Globalping API (备选)',
      baseUrl: 'https://api.globalping.io/v1',
      priority: 2,
      isAvailable: true,
      lastChecked: 0,
    },
  ],
  activeEndpointIndex: 0,
  customEndpoint: undefined,
  pingDefaults: {
    packets: 3,
    location: 'CN',
  },
  mtrDefaults: {
    protocol: 'ICMP',
    packets: 3,
  },
};

/**
 * 从 chrome.storage.local 读取配置。
 * 如果 storage 中不存在配置，则返回默认配置的深拷贝。
 *
 * @returns {Promise<ExtensionConfig>} 当前配置对象
 */
export async function getConfig() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    if (result[STORAGE_KEY]) {
      return result[STORAGE_KEY];
    }
  } catch {
    // storage 读取失败时静默降级，返回默认配置
  }
  return structuredClone(DEFAULT_CONFIG);
}

/**
 * 合并部分配置并保存到 chrome.storage.local。
 * 使用浅合并策略：顶层属性覆盖，嵌套对象整体替换。
 *
 * @param {Partial<ExtensionConfig>} partialConfig - 要合并的部分配置
 * @returns {Promise<ExtensionConfig>} 合并后的完整配置对象
 */
export async function setConfig(partialConfig) {
  const currentConfig = await getConfig();
  const mergedConfig = { ...currentConfig, ...partialConfig };
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: mergedConfig });
  } catch {
    // storage 写入失败时静默处理，仍返回合并后的配置
  }
  return mergedConfig;
}

/**
 * 验证 API 端点 URL 是否合法。
 * 端点必须以 https:// 开头，拒绝非 HTTPS 端点。
 *
 * @param {string} url - 要验证的 API 端点 URL
 * @returns {boolean} 如果 URL 以 https:// 开头则返回 true，否则返回 false
 */
export function validateEndpoint(url) {
  if (typeof url !== 'string') {
    return false;
  }
  return url.startsWith('https://');
}
