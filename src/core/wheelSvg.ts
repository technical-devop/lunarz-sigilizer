import { formatCoordinate } from './geometry';
import {
  SIGIL_BACKGROUND,
  SIGIL_GLOW,
  SIGIL_GRADIENT_ID,
  SIGIL_STROKE,
  SIGIL_STROKE_WIDTH,
} from './svg';
import { WHEEL_CANVAS, type WheelSigil } from './wheel';

export interface WheelSvgOptions {
  readonly stroke?: string;
  readonly strokeWidth?: number;
  readonly includeBackground?: boolean;
  readonly gradientId?: string;
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function sanitizeGradientId(value: string): string {
  const cleaned = value.replaceAll(/[^A-Za-z0-9_-]/g, '');
  return cleaned.length > 0 ? cleaned : SIGIL_GRADIENT_ID;
}

function markMarkup(
  sigil: WheelSigil,
  stroke: string,
  strokeWidth: number,
): string {
  if (sigil.dot) {
    return `<circle cx="${formatCoordinate(sigil.dot.x)}" cy="${formatCoordinate(sigil.dot.y)}" r="${formatCoordinate(sigil.dot.radius)}" fill="${stroke}"/>`;
  }
  if (!sigil.pathD) {
    return '';
  }
  return [
    `<path d="${sigil.pathD}"`,
    'fill="none"',
    `stroke="${stroke}"`,
    `stroke-width="${formatCoordinate(strokeWidth)}"`,
    'stroke-linecap="round"',
    'stroke-linejoin="round"/>',
  ].join(' ');
}

export function wheelToExportSvg(
  sigil: WheelSigil,
  options: WheelSvgOptions = {},
): string {
  const stroke = escapeAttribute(options.stroke ?? SIGIL_STROKE);
  const strokeWidth = options.strokeWidth ?? SIGIL_STROKE_WIDTH;
  const includeBackground = options.includeBackground ?? true;
  const gradientId = escapeAttribute(
    sanitizeGradientId(options.gradientId ?? SIGIL_GRADIENT_ID),
  );
  const background = includeBackground
    ? [
        '<defs>',
        `<radialGradient id="${gradientId}" cx="50%" cy="42%" r="65%">`,
        `<stop offset="0%" stop-color="${SIGIL_GLOW}"/>`,
        `<stop offset="100%" stop-color="${SIGIL_BACKGROUND}"/>`,
        '</radialGradient>',
        '</defs>',
        `<rect x="0" y="0" width="${WHEEL_CANVAS}" height="${WHEEL_CANVAS}" fill="url(#${gradientId})"/>`,
      ].join('\n')
    : '';
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WHEEL_CANVAS} ${WHEEL_CANVAS}" width="${WHEEL_CANVAS}" height="${WHEEL_CANVAS}" role="img" aria-label="Lunarz sigil">`,
    '<title>Lunarz Sigil</title>',
    background,
    markMarkup(sigil, stroke, strokeWidth),
    '</svg>',
  ]
    .filter((part) => part.length > 0)
    .join('\n');
}
