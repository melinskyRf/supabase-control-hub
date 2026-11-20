import { test, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
test('capacity, failover and credential regression suite', () => {
  expect(() => execFileSync(process.execPath, ['tests/core.test.mjs'], { cwd: process.cwd(), stdio: 'pipe' })).not.toThrow();
});
