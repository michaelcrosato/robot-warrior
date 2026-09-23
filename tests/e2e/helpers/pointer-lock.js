/**
 * Keep automated browser runs on Windows from engaging real pointer lock.
 *
 * Chromium implements pointer lock on Windows with the global Win32 `ClipCursor`, sized to
 * the page's on-screen rectangle — and a headless page still has one, the viewport placed
 * near screen (0,0). Every mission start requests the lock, so a local run trapped the
 * developer's real mouse in an invisible box at the top-left of the primary monitor until
 * they alt-tabbed. Linux (and so CI) has no such side effect and keeps the real lock.
 *
 * Shared by the e2e fixture and by scripts that drive the game in a browser, so that nothing
 * run on a Windows machine can do it again. See AGENTS.md.
 */

/**
 * Grant the lock without asking the browser for it. Refusing instead would reject the
 * request and show the "Mouse capture is off" toast, changing what tests and screenshots
 * see. Mouse moves still carry movementX/Y; unlike a real lock, moves past the viewport
 * edge are dropped and the first move after locking can be a few pixels off.
 *
 * Runs in the page, as an init script, so it must not close over anything.
 */
export function fakePointerLock() {
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

/**
 * Install the fake on a browser context when running on Windows; a no-op elsewhere.
 * @param {import('@playwright/test').BrowserContext} context
 */
export async function guardPointerLock(context) {
  if (process.platform === 'win32') await context.addInitScript(fakePointerLock);
}
