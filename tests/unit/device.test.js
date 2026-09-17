import { describe, it, expect } from 'vitest';
import { classifyDevice, lowerTierId, TIER_ORDER } from '../../src/core/device.js';

/**
 * Renderer strings as browsers actually report them.
 *
 * The two devices this project was tuned against cannot be run from here, so this is the
 * only part of targeting them that can be verified: given exactly what those devices say
 * about themselves, does the detection put them on the tier that was budgeted for them.
 */
const desktop = (renderer) => ({ renderer, coarsePointer: false, cores: 16, memory: 8 });
const phone = (renderer) => ({ renderer, coarsePointer: true, cores: 8, memory: 8 });

describe('the two target devices', () => {
  it('puts an RTX 4070 SUPER on the ultra tier', () => {
    expect(
      classifyDevice(
        desktop(
          'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11-32.0.15.6094)',
        ),
      ),
    ).toBe('ultra');
  });

  it('puts a Galaxy S26 on the mobile tier, on either of its two GPUs', () => {
    // Snapdragon variant.
    expect(classifyDevice(phone('Adreno (TM) 840'))).toBe('mobile');
    // Exynos variant.
    expect(classifyDevice(phone('ANGLE (Samsung Xclipse 950)'))).toBe('mobile');
  });
});

describe('classifyDevice', () => {
  it('drops a software rasteriser to the cheapest tier', () => {
    // This is what a headless test runner reports, and the right answer there too.
    expect(classifyDevice(desktop('Google SwiftShader'))).toBe('potato');
    expect(classifyDevice(desktop('llvmpipe (LLVM 15.0.7, 256 bits)'))).toBe('potato');
    expect(classifyDevice(desktop('Microsoft Basic Render Driver'))).toBe('potato');
    // Even a coarse pointer and a plausible core count must not lift it.
    expect(classifyDevice({ ...phone('SwiftShader'), cores: 16, memory: 16 })).toBe('potato');
  });

  it('recognises other discrete desktop parts', () => {
    expect(classifyDevice(desktop('ANGLE (NVIDIA GeForce RTX 5080, D3D11)'))).toBe('ultra');
    expect(classifyDevice(desktop('ANGLE (AMD Radeon RX 7900 XT, D3D11)'))).toBe('ultra');
    expect(classifyDevice(desktop('ANGLE (NVIDIA GeForce RTX 3060, D3D11)'))).toBe('high');
    expect(classifyDevice(desktop('Apple M3 Max'))).toBe('ultra');
  });

  it('puts integrated desktop graphics on a modest tier', () => {
    expect(classifyDevice(desktop('ANGLE (Intel, Intel(R) UHD Graphics 620, D3D11)'))).toBe('low');
    expect(classifyDevice(desktop('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics, D3D11)'))).toBe(
      'low',
    );
  });

  it('puts older mobile silicon a step below flagship', () => {
    expect(classifyDevice(phone('Adreno (TM) 650'))).toBe('low');
    expect(classifyDevice(phone('Mali-G78'))).toBe('low');
    expect(classifyDevice(phone('Apple A15 GPU'))).toBe('low');
  });

  it('never puts a phone on a desktop budget', () => {
    // Whatever a phone reports, it must not land on high or ultra: those tiers ask for
    // four cascades at 2048 and ambient occlusion, which no phone should be handed blind.
    const strings = [
      'Adreno (TM) 840',
      'Mali-G925',
      'Apple A19 Pro GPU',
      'ANGLE (Samsung Xclipse 950)',
      'PowerVR Rogue',
      '',
      'NVIDIA GeForce RTX 4090', // a masked or spoofed string on a handset
    ];
    for (const renderer of strings) {
      const tier = classifyDevice(phone(renderer));
      expect(['potato', 'low', 'mobile'], `phone reporting "${renderer}"`).toContain(tier);
    }
  });

  it('falls back sensibly when the renderer is masked', () => {
    // Firefox and Safari mask the renderer string; only the other signals remain.
    expect(classifyDevice({ renderer: '', coarsePointer: false, cores: 16, memory: 16 })).toBe(
      'high',
    );
    expect(classifyDevice({ renderer: '', coarsePointer: false, cores: 2, memory: 2 })).toBe('low');
    expect(classifyDevice({ renderer: '', coarsePointer: true, cores: 8, memory: 8 })).toBe(
      'mobile',
    );
    expect(classifyDevice({ renderer: '', coarsePointer: true, cores: 4, memory: 2 })).toBe('low');
  });

  it('is case-insensitive and tolerates missing signals', () => {
    expect(classifyDevice({ renderer: 'GOOGLE SWIFTSHADER' })).toBe('potato');
    expect(classifyDevice({})).toBe('low');
  });

  it('always returns a real tier', () => {
    const inputs = [
      {},
      desktop(''),
      phone(''),
      desktop('something nobody has ever shipped'),
      phone('!!!'),
    ];
    for (const input of inputs) expect(TIER_ORDER).toContain(classifyDevice(input));
  });
});

describe('lowerTierId', () => {
  it('steps down one tier at a time', () => {
    expect(lowerTierId('ultra')).toBe('high');
    expect(lowerTierId('high')).toBe('mobile');
    expect(lowerTierId('mobile')).toBe('low');
    expect(lowerTierId('low')).toBe('potato');
  });

  it('stops at the bottom rather than wrapping', () => {
    expect(lowerTierId('potato')).toBeNull();
    expect(lowerTierId('not-a-tier')).toBeNull();
  });
});
