/**
 * The Playwright `test` every spec imports, so the whole suite shares one browser setup.
 *
 * On Windows it replaces real pointer lock with an in-page fake. Chromium implements pointer
 * lock there with the global Win32 `ClipCursor`, sized to the page's on-screen rectangle —
 * and a headless page still has one, the viewport placed near screen (0,0). Every mission
 * start requests the lock, so a local run trapped the developer's real mouse in an invisible
 * box at the top-left of the primary monitor until they alt-tabbed. Linux (and so CI) has no
 * such side effect, and keeps the real lock.
 */
import { test as base } from '@playwright/test';

export { expect } from '@playwright/test';

/**
 * Grant the lock without asking the browser for it. Refusing instead would reject the
 * request and show the "Mouse capture is off" toast, changing what the tests and their
 * screenshots see. Mouse moves still carry movementX/Y; unlike a real lock, moves past the
 * viewport edge are dropped and the first move after locking can be a few pixels off.
 */
function fakePointerLock() {
  let locked = null;
  const fire = (type) => queueMicrotask(() => document.dispatchEvent(new Event(type)));
  Object.defineProperty(Document.prototype, 'pointerLockElement', {
    configurable: true,
    get: () => locked,
  });
  Element.prototype.requestPointerLock = function () {
    locked = this;
    fire('pointerlockchange');
    return Promise.resolve();
  };
  Document.prototype.exitPointerLock = function () {
    if (locked) {
      locked = null;
      fire('pointerlockchange');
    }
  };
}

export const test = base.extend({
  context: async ({ context }, use) => {
    if (process.platform === 'win32') await context.addInitScript(fakePointerLock);
    await use(context);
  },
});
