/**
 * 测试框架验证 - 确保 vitest + fast-check + chrome mock 正常工作
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { resetChromeMock, getChromeMock } from './chrome-mock.js';

describe('测试框架验证', () => {
  it('vitest 正常运行', () => {
    expect(1 + 1).toBe(2);
  });

  it('fast-check 正常运行', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (a, b) => {
        return a + b === b + a;
      }),
      { numRuns: 10 }
    );
  });

  it('chrome mock 全局可用', () => {
    expect(globalThis.chrome).toBeDefined();
    expect(globalThis.chrome.webRequest).toBeDefined();
    expect(globalThis.chrome.runtime).toBeDefined();
    expect(globalThis.chrome.tabs).toBeDefined();
    expect(globalThis.chrome.storage).toBeDefined();
    expect(globalThis.chrome.webNavigation).toBeDefined();
  });

  it('chrome.webRequest 事件 mock 可用', () => {
    const mock = getChromeMock();
    let called = false;
    mock.webRequest.onResponseStarted.addListener(() => {
      called = true;
    });
    mock.webRequest.onResponseStarted._fire({});
    expect(called).toBe(true);
    resetChromeMock();
  });

  it('chrome.storage.local mock 可用', async () => {
    const mock = getChromeMock();
    await mock.storage.local.set({ key: 'value' });
    const result = await mock.storage.local.get('key');
    expect(result).toEqual({ key: 'value' });
    resetChromeMock();
  });

  it('chrome.tabs 事件 mock 可用', () => {
    const mock = getChromeMock();
    let removedTabId = null;
    mock.tabs.onRemoved.addListener((tabId) => {
      removedTabId = tabId;
    });
    mock.tabs.onRemoved._fire(42);
    expect(removedTabId).toBe(42);
    resetChromeMock();
  });

  it('chrome.webNavigation 事件 mock 可用', () => {
    const mock = getChromeMock();
    let navDetails = null;
    mock.webNavigation.onBeforeNavigate.addListener((details) => {
      navDetails = details;
    });
    mock.webNavigation.onBeforeNavigate._fire({ tabId: 1, frameId: 0 });
    expect(navDetails).toEqual({ tabId: 1, frameId: 0 });
    resetChromeMock();
  });

  it('resetChromeMock 正确清除状态', async () => {
    const mock = getChromeMock();
    // 添加监听器和存储数据
    mock.webRequest.onResponseStarted.addListener(() => {});
    await mock.storage.local.set({ test: 'data' });

    expect(mock.webRequest.onResponseStarted._count()).toBe(1);

    // 重置
    resetChromeMock();

    expect(mock.webRequest.onResponseStarted._count()).toBe(0);
    const result = await mock.storage.local.get('test');
    expect(result).toEqual({});
  });
});
