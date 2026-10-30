import { formatCoordinate } from './geometry';
import type { SigilComposition } from './compose';

export const SIGIL_STROKE = '#D9E6F5';
export const SIGIL_STROKE_WIDTH = 4;
export const SIGIL_STROKE_HIGHLIGHT_WIDTH = 6;
export const SIGIL_BACKGROUND = '#151B28';
export const SIGIL_GLOW = '#2C3A56';
export const SIGIL_GRADIENT_ID = 'sigil-night';

/**
 * Prototype reference output (the Python-generated calm size-spine SVG)
 * uses glyph paths in 0..1 coordinates with per-letter transform matrices
 * (scales 1.22 / 0.705 / 0.69 / 0.675 for BE CALM) and a single
 * stroke-width="0.012". SVG scales stroke-width by the path transform, so
 * the rendered width is stroke-width * |scale|. The app canvas applies a far
 * larger canvasScale (~350), so a fixed width of 4 would render as ~1700 px
 * of effective paint (solid squares). Compensate per letter so the effective
 * rendered width stays exactly at the requested target width.
 *
 * CSS presentation-attribute cascade note: `.sigilpath` must NOT declare a
 * fixed `stroke-width` — any CSS declaration overrides the per-letter
 * `stroke-width` presentation attribute, collapsing every scale-compensated
 * value (e.g. 0.0085) back to the fixed CSS value and re-introducing the
 * blow-out (fixed * scale). The attribute owns the width; CSS owns color.
 */
export function strokeWidthForScale(scale: number, targetWidth: number = SIGIL_STROKE_WIDTH): number {
  const target = Number.isFinite(targetWidth) && targetWidth > 0 ? targetWidth : SIGIL_STROKE_WIDTH;
  if (!Number.isFinite(scale) || scale <= 0) {
    return target;
  }
  // Round-trip through the same 9-decimal formatting used for the exported
  // SVG attribute so preview (React number prop) and export (string attr)
  // carry bit-identical widths.
  return Number(formatCoordinate(target / scale));
}

export interface SvgOptions {
  readonly stroke?: string;
  readonly strokeWidth?: number;
  readonly includeMetadata?: boolean;
  readonly includeBackground?: boolean;
  readonly gradientId?: string;
}

function formatNumber(value: number): string {
  return formatCoordinate(value);
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

export function letterTransformToSvg(transform: {
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
  readonly scale: number;
  readonly mirror: boolean;
  readonly angle?: number;
}): string {
  const angle =
    typeof transform.angle === 'number'
      ? transform.angle
      : (transform.rotation * Math.PI) / 180;
  const cosine = Math.cos(angle) * transform.scale;
  const sine = Math.sin(angle) * transform.scale;
  const a = transform.mirror ? -cosine : cosine;
  const b = transform.mirror ? -sine : sine;
  const c = -sine;
  const d = cosine;

  return `matrix(${formatNumber(a)} ${formatNumber(b)} ${formatNumber(c)} ${formatNumber(d)} ${formatNumber(transform.x)} ${formatNumber(transform.y)})`;
}

export function compositionToSvg(
  composition: SigilComposition,
  options: SvgOptions = {},
): string {
  const stroke = escapeAttribute(options.stroke ?? SIGIL_STROKE);
  const effectiveWidth = options.strokeWidth ?? SIGIL_STROKE_WIDTH;
  const includeMetadata = options.includeMetadata ?? false;
  const includeBackground = options.includeBackground ?? true;
  const gradientId = sanitizeGradientId(options.gradientId ?? SIGIL_GRADIENT_ID);
  const escapedGradientId = escapeAttribute(gradientId);

  const paths = composition.letters.map((letter) => {
    const transform = letterTransformToSvg(letter.transform);
    const perLetterWidth = formatNumber(
      effectiveWidth / Math.max(1e-9, Math.abs(letter.transform.scale)),
    );
    const metadata = includeMetadata
      ? ` data-letter="${escapeAttribute(letter.letter)}" data-source-index="${letter.sourceIndex}" data-surviving-index="${letter.survivingIndex}"`
      : '';
    return [
      `<path d="${letter.renderPath}"`,
      `transform="${transform}"`,
      'fill="none"',
      `stroke="${stroke}"`,
      `stroke-width="${perLetterWidth}"`,
      'stroke-linecap="round"',
      'stroke-linejoin="round"',
      `${metadata}`,
      '/>',
    ]
      .join(' ')
      .replace('  />', ' />');
  });

  const svgAttributes = [
    'xmlns="http://www.w3.org/2000/svg"',
    `viewBox="0 0 ${composition.width} ${composition.height}"`,
    `width="${composition.width}"`,
    `height="${composition.height}"`,
    'role="img"',
    'aria-label="Lunarz sigil composition"',
    includeMetadata ? `data-seed="${escapeAttribute(composition.seed)}"` : '',
  ]
    .filter((part) => part.length > 0)
    .join(' ');

  const background = includeBackground
    ? [
        '<defs>',
        `<radialGradient id="${escapedGradientId}" cx="50%" cy="42%" r="65%">`,
        `<stop offset="0%" stop-color="${SIGIL_GLOW}"/>`,
        `<stop offset="100%" stop-color="${SIGIL_BACKGROUND}"/>`,
        '</radialGradient>',
        '</defs>',
        `<rect x="0" y="0" width="${composition.width}" height="${composition.height}" fill="url(#${escapedGradientId})"/>`,
      ].join('\n')
    : '';

  return [
    `<svg ${svgAttributes}>`,
    '<title>Lunarz Sigil</title>',
    background,
    ...paths,
    '</svg>',
  ]
    .filter((part) => part.length > 0)
    .join('\n');
}

export function compositionToExportSvg(
  composition: SigilComposition,
  options: Omit<SvgOptions, 'includeMetadata' | 'includeBackground'> = {},
): string {
  return compositionToSvg(composition, {
    ...options,
    includeMetadata: false,
    includeBackground: true,
  });
}
