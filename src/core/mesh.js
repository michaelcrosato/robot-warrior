/**
 * GPU upload and the cache of shared primitive meshes.
 */
import { boxGeom, cylinderGeom, dishGeom, ringGeom, rockGeom, sphereGeom } from './geometry.js';
import { gl } from './gl.js';

export function upload(data) {
  const b = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, b);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
  return { b, count: data.length / 9, data };
}

export const geo = {
  box: upload(boxGeom()),
  bevel: upload(boxGeom(0.19)),
  cyl: upload(cylinderGeom()),
  cone: upload(cylinderGeom(7, 0.35)),
  sphere: upload(sphereGeom()),
  dish: upload(dishGeom()),
  ring: upload(ringGeom()),
  disk: upload(cylinderGeom(32)),
};

for (let i = 0; i < 6; i++) geo['rock' + i] = upload(rockGeom(i + 1));
