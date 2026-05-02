/**
 * Chrome Extension API Mock
 *
 * 模拟 Chrome 扩展环境中的 chrome.* API，使测试可以在 Node.js 环境中运行。
 * 该文件作为 vitest setupFiles 自动加载。
 */

/**
 * 创建一个可注册/触发的事件监听器 mock
 */
function createEvent() {
  const listeners = [];
  return {
    addListener(fn) {
      listeners.push(fn);
    },
    removeListener(fn) {
      const idx = listeners.indexOf(fn);
      if (idx !== -1) listeners.splice(idx, 1);
    },
    hasListeners() {
      return listeners.length > 0;
    },
    // 测试辅助：触发所有监听器
    _fire(...args) {
      listeners.forEach((fn) => fn(...args));
    },
    // 测试辅助：清除所有监听器
    _clear() {
      listeners.length = 0;
    },
    // 测试辅助：获取监听器数量
    _count() {
      return listeners.length;
    },
  };
}

/**
 * 创建 chrome.storage 的 mock 实现
 */
function createStorageArea() {
  let store = {};
  return {
    get(keys, callback) {
      if (typeof keys === 'string') {
        const result = {};
        if (store[keys] !== undefined) result[keys] = store[keys];
        if (callback) callback(result);
        return Promise.resolve(result);
      }
      if (Array.isArray(keys)) {
        const result = {};
        keys.forEach((k) => {
          if (store[k] !== undefined) result[k] = store[k];
        });
        if (callback) callback(result);
        return Promise.resolve(result);
      }
      // keys is null/undefined — return all
      const result = { ...store };
      if (callback) callback(result);
      return Promise.resolve(result);
    },
    set(items, callback) {
      Object.assign(store, items);
      if (callback) callback();
      return Promise.resolve();
    },
    remove(keys, callback) {
      if (typeof keys === 'string') keys = [keys];
      keys.forEach((k) => delete store[k]);
      if (callback) callback();
      return Promise.resolve();
    },
    clear(callback) {
      store = {};
      if (callback) callback();
      return Promise.resolve();
    },
    // 测试辅助：直接获取内部存储
    _getStore() {
      return { ...store };
    },
    // 测试辅助：直接设置内部存储
    _setStore(data) {
      store = { ...data };
    },
  };
}

/**
 * 全局 chrome 对象 mock
 */
const chromeMock = {
  // chrome.webRequest
  webRequest: {
    onResponseStarted: createEvent(),
    onBeforeRequest: createEvent(),
    onCompleted: createEvent(),
    onErrorOccurred: createEvent(),
  },

  // chrome.runtime
  runtime: {
    onMessage: createEvent(),
    sendMessage(message, callback) {
      if (callback) callback();
    },
    sendNativeMessage(hostName, message, callback) {
      if (callback) callback();
    },
    lastError: null,
    getURL(path) {
      return `chrome-extension://mock-extension-id/${path}`;
    },
    id: 'mock-extension-id',
  },

  // chrome.tabs
  tabs: {
    onRemoved: createEvent(),
    onUpdated: createEvent(),
    onActivated: createEvent(),
    query(queryInfo, callback) {
      const result = [{ id: 1, url: 'https://example.com', active: true }];
      if (callback) callback(result);
      return Promise.resolve(result);
    },
    sendMessage(tabId, message, callback) {
      if (callback) callback();
      return Promise.resolve();
    },
    get(tabId, callback) {
      const tab = { id: tabId, url: 'https://example.com' };
      if (callback) callback(tab);
      return Promise.resolve(tab);
    },
  },

  // chrome.storage
  storage: {
    local: createStorageArea(),
    sync: createStorageArea(),
    onChanged: createEvent(),
  },

  // chrome.webNavigation
  webNavigation: {
    onBeforeNavigate: createEvent(),
    onCompleted: createEvent(),
    onCommitted: createEvent(),
  },
};

// 注入到全局
globalThis.chrome = chromeMock;

/**
 * 测试辅助工具函数
 */

/**
 * 重置所有 chrome mock 状态（清除监听器和存储）
 */
export function resetChromeMock() {
  // 清除 webRequest 事件监听器
  chromeMock.webRequest.onResponseStarted._clear();
  chromeMock.webRequest.onBeforeRequest._clear();
  chromeMock.webRequest.onCompleted._clear();
  chromeMock.webRequest.onErrorOccurred._clear();

  // 清除 runtime 事件监听器
  chromeMock.runtime.onMessage._clear();
  chromeMock.runtime.lastError = null;

  // 清除 tabs 事件监听器
  chromeMock.tabs.onRemoved._clear();
  chromeMock.tabs.onUpdated._clear();
  chromeMock.tabs.onActivated._clear();

  // 清除 storage
  chromeMock.storage.local.clear();
  chromeMock.storage.sync.clear();
  chromeMock.storage.onChanged._clear();

  // 清除 webNavigation 事件监听器
  chromeMock.webNavigation.onBeforeNavigate._clear();
  chromeMock.webNavigation.onCompleted._clear();
  chromeMock.webNavigation.onCommitted._clear();
}

/**
 * 获取 chrome mock 对象（用于直接操作）
 */
export function getChromeMock() {
  return chromeMock;
}

export { createEvent, createStorageArea };
