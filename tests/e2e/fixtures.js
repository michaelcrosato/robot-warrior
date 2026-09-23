/**
 * The Playwright `test` every spec imports, so the whole suite shares one browser setup.
 *
 * On Windows it replaces real pointer lock with an in-page fake; see helpers/pointer-lock.js
 * for why a real lock is unacceptable there. Linux, and so CI, keeps the real lock.
 */
import { test as base } from '@playwright/test';
import { guardPointerLock } from './helpers/pointer-lock.js';

export { expect } from '@playwright/test';

export const test = base.extend({
  context: async ({ context }, use) => {
    await guardPointerLock(context);
    await use(context);
  },
});
