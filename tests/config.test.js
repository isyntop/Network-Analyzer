/**
 * 配置管理模块单元测试
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { resetChromeMock } from './chrome-mock.js';
import { DEFAULT_CONFIG, getConfig, setConfig, validateEndpoint } from '../config.js';

describe('config.js', () => {
  beforeEach(() => {
    resetChromeMock();
  });

  describe('DEFAULT_CONFIG', () => {
    it('包含主备 API 端点', () => {
      expect(DEFAULT_CONFIG.apiEndpoints).toHaveLength(2);
      expect(DEFAULT_CONFIG.apiEndpoints[0].name).toBe('Globalping API');
      expect(DEFAULT_CONFIG.apiEndpoints[0].baseUrl).toBe('https://api.globalping.io/v1');
      expect(DEFAULT_CONFIG.apiEndpoints[0].priority).toBe(1);
      expect(DEFAULT_CONFIG.apiEndpoints[1].priority).toBe(2);
    });

    it('包含 Ping 默认参数', () => {
      expect(DEFAULT_CONFIG.pingDefaults).toEqual({ packets: 3, location: 'CN' });
    });

    it('包含 MTR 默认参数', () => {
      expect(DEFAULT_CONFIG.mtrDefaults).toEqual({ protocol: 'ICMP', packets: 3 });
    });

    it('所有默认端点均为 HTTPS', () => {
      for (const endpoint of DEFAULT_CONFIG.apiEndpoints) {
        expect(endpoint.baseUrl.startsWith('https://')).toBe(true);
      }
    });
  });

  describe('getConfig()', () => {
    it('storage 为空时返回默认配置', async () => {
      const config = await getConfig();
      expect(config).toEqual(DEFAULT_CONFIG);
    });

    it('返回的默认配置是独立副本，修改不影响原始默认值', async () => {
      const config = await getConfig();
      config.pingDefaults.packets = 10;
      const config2 = await getConfig();
      expect(config2.pingDefaults.packets).toBe(3);
    });

    it('storage 中有配置时返回已存储的配置', async () => {
      const customConfig = {
        ...DEFAULT_CONFIG,
        pingDefaults: { packets: 5, location: 'US' },
      };
      await chrome.storage.local.set({ network_analyzer_config: customConfig });

      const config = await getConfig();
      expect(config.pingDefaults).toEqual({ packets: 5, location: 'US' });
    });
  });

  describe('setConfig()', () => {
    it('正确合并部分配置', async () => {
      const result = await setConfig({ pingDefaults: { packets: 10, location: 'US' } });
      expect(result.pingDefaults).toEqual({ packets: 10, location: 'US' });
      // 其他字段保持默认
      expect(result.mtrDefaults).toEqual(DEFAULT_CONFIG.mtrDefaults);
      expect(result.apiEndpoints).toEqual(DEFAULT_CONFIG.apiEndpoints);
    });

    it('合并后的配置被持久化到 storage', async () => {
      await setConfig({ pingDefaults: { packets: 7, location: 'JP' } });
      const config = await getConfig();
      expect(config.pingDefaults).toEqual({ packets: 7, location: 'JP' });
    });

    it('多次 setConfig 累积合并', async () => {
      await setConfig({ pingDefaults: { packets: 5, location: 'US' } });
      await setConfig({ mtrDefaults: { protocol: 'TCP', packets: 5 } });

      const config = await getConfig();
      expect(config.pingDefaults).toEqual({ packets: 5, location: 'US' });
      expect(config.mtrDefaults).toEqual({ protocol: 'TCP', packets: 5 });
    });

    it('可以设置自定义端点', async () => {
      const result = await setConfig({ customEndpoint: 'https://my-api.example.com/v1' });
      expect(result.customEndpoint).toBe('https://my-api.example.com/v1');
    });
  });

  describe('validateEndpoint()', () => {
    it('接受 https:// 开头的 URL', () => {
      expect(validateEndpoint('https://api.globalping.io/v1')).toBe(true);
      expect(validateEndpoint('https://example.com')).toBe(true);
      expect(validateEndpoint('https://localhost:8443')).toBe(true);
    });

    it('拒绝 http:// 开头的 URL', () => {
      expect(validateEndpoint('http://api.globalping.io/v1')).toBe(false);
      expect(validateEndpoint('http://example.com')).toBe(false);
    });

    it('拒绝其他协议', () => {
      expect(validateEndpoint('ftp://example.com')).toBe(false);
      expect(validateEndpoint('ws://example.com')).toBe(false);
    });

    it('拒绝无协议的字符串', () => {
      expect(validateEndpoint('example.com')).toBe(false);
      expect(validateEndpoint('api.globalping.io/v1')).toBe(false);
    });

    it('拒绝空字符串', () => {
      expect(validateEndpoint('')).toBe(false);
    });

    it('拒绝非字符串类型', () => {
      expect(validateEndpoint(null)).toBe(false);
      expect(validateEndpoint(undefined)).toBe(false);
      expect(validateEndpoint(123)).toBe(false);
      expect(validateEndpoint({})).toBe(false);
    });
  });
});
