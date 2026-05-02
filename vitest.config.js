import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 测试文件放在 tests/ 目录下
    include: ['tests/**/*.test.{js,mjs}'],
    // 全局设置文件，用于注入 Chrome API mock
    setupFiles: ['tests/chrome-mock.js'],
    // 属性测试默认迭代次数
    testTimeout: 30000,
  },
});
