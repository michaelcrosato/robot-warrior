import { describe, it, expect } from 'vitest';
import * as common from '../../src/core/shaders/common.js';
import * as scene from '../../src/core/shaders/scene.js';
import * as sky from '../../src/core/shaders/sky.js';
import * as post from '../../src/core/shaders/post.js';

/**
 * Shader sources are assembled by concatenating JavaScript template literals, which puts
 * two specific traps in the way. Both have been hit; neither is caught by anything that
 * reads like a test failure — the first shows up as a GLSL compile error at runtime with a
 * line number that matches no file, the second as a JavaScript parse error at build time.
 */

/**
 * Every complete shader program source, by name.
 *
 * The cast is needed because these modules also export numbers — MAX_POINT_LIGHTS, which
 * the scene shader interpolates into its own source.
 *
 * @type {Record<string, string>}
 */
const SOURCES = /** @type {Record<string, string>} */ (
  Object.fromEntries(
    Object.entries({ ...scene, ...sky, ...post }).filter(
      ([name, value]) => typeof value === 'string' && /_(VS|FS)$/.test(name),
    ),
  )
);

/** The chunks that get concatenated into those sources. @type {Record<string, string>} */
const CHUNKS = /** @type {Record<string, string>} */ (
  Object.fromEntries(Object.entries(common).filter(([, value]) => typeof value === 'string'))
);

describe('shader sources', () => {
  it('finds every program source', () => {
    // A guard on the guard: if the naming convention changes, these tests must not
    // silently start checking nothing.
    expect(Object.keys(SOURCES).length).toBeGreaterThanOrEqual(8);
  });

  for (const [name, source] of Object.entries(SOURCES)) {
    it(`${name} opens with the version directive`, () => {
      // GLSL ES requires #version to be the very first characters of the source. Not even
      // a newline may precede it, which is why the version header is concatenated rather
      // than written inline — a template literal that starts on the next line fails.
      expect(
        source.startsWith('#version 300 es\n'),
        `${name} starts: ${JSON.stringify(source.slice(0, 24))}`,
      ).toBe(true);
    });

    it(`${name} has an entry point, and writes an output if it has one to write`, () => {
      expect(source, `${name} needs a main()`).toMatch(/void\s+main\s*\(/);

      // SHADOW_FS is the exception and is meant to be: the cascade pass binds no colour
      // attachment, so there is nothing to write. It exists only because a program needs
      // a fragment stage.
      if (name.endsWith('_FS') && name !== 'SHADOW_FS') {
        expect(source, `${name} must declare an out variable`).toMatch(/out\s+vec4\s+\w+;/);
      }
    });
  }

  for (const [name, chunk] of Object.entries({ ...SOURCES, ...CHUNKS })) {
    it(`${name} contains no backtick`, () => {
      // A backtick anywhere in the GLSL — including inside a comment — closes the
      // enclosing JavaScript template literal. It has happened twice: once writing
      // `normalize` in a comment, once in the sky shader. The build fails with a parse
      // error pointing at the shader file, which is a confusing way to learn this.
      expect(chunk.includes('`'), `${name} contains a backtick`).toBe(false);
    });
  }

  it('no source declares a precision before the version directive', () => {
    for (const [name, source] of Object.entries(SOURCES)) {
      const version = source.indexOf('#version');
      expect(version, `${name}`).toBe(0);
    }
  });
});
