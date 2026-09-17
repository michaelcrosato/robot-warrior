/**
 * Canvas drawing primitives shared by every HUD element.
 */
import { G } from '../sim/state.js';
import { TAU } from '../core/math.js';
import { ctx } from '../core/gl.js';

export const hudColor = '#adcb8b';

export const hudDim = '#708763';

export const hudAmber = '#e6b372';

export const hudRed = '#ed8865';

export function txt(text, x, y, size = 11, color = hudColor, align = 'left') {
  ctx.fillStyle = color;
  ctx.font = `${Math.round(size * G.hudScale)}px Consolas,"Liberation Mono",monospace`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

export function ln(x1, y1, x2, y2, c = hudColor, w = 1) {
  ctx.strokeStyle = c;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

export function poly(points, fill, stroke = null, width = 1) {
  ctx.beginPath();
  ctx.moveTo(...points[0]);
  for (let i = 1; i < points.length; i++) ctx.lineTo(...points[i]);
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.stroke();
  }
}

export function rect(x, y, w, h, fill, stroke = null) {
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w, h);
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }
}

export function circle(x, y, r, c, width = 1, fill = null) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  ctx.strokeStyle = c;
  ctx.lineWidth = width;
  ctx.stroke();
}

export function damageColor(r) {
  return r > 0.62 ? hudColor : r > 0.28 ? hudAmber : hudRed;
}

export function corners(x, y, w, h, c = hudColor, len = 8) {
  ctx.strokeStyle = c;
  ctx.lineWidth = 1.2;
  for (const sx of [-1, 1])
    for (const sy of [-1, 1]) {
      const xx = x + (sx * w) / 2,
        yy = y + (sy * h) / 2;
      ctx.beginPath();
      ctx.moveTo(xx - sx * len, yy);
      ctx.lineTo(xx, yy);
      ctx.lineTo(xx, yy - sy * len);
      ctx.stroke();
    }
}

export function panelBox(x, y, w, h, title) {
  rect(x - 4, y - 4, w + 8, h + 8, '#202721', '#555e4c');
  rect(x - 2, y - 2, w + 4, h + 4, '#101910', '#121a13');
  rect(x, y, w, h, '#0d180f', '#596748');
  rect(x + 1, y + 1, w - 2, 20 * G.hudScale, '#273423');
  txt(title, x + 9 * G.hudScale, y + 10 * G.hudScale, 9, '#a7b792');
  ln(x, y + 20 * G.hudScale, x + w, y + 20 * G.hudScale, '#596748');
  for (let i = 0; i < 4; i++) {
    const xx = i % 2 ? x + w + 1 : x - 2,
      yy = i < 2 ? y - 2 : y + h + 2;
    circle(xx, yy, 1.5, '#96957b', 1, '#171d18');
  }
}
