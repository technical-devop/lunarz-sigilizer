import { formatCoordinate } from './geometry';
import { GLYPH_BOX_SIZE } from './glyphs';
import type { SigilComposition } from './compose';

/**
 * Single explicit base scene shared by on-screen preview and both exports.
 * Keep these hex values in sync with `--color-sigil-*` tokens in ritual.css.
 */
export const SIGIL_STROKE = '#D9E6F5';
export const SIGIL_STROKE_WIDTH = 4;
export const SIGIL_BACKGROUND = '#151B28';
export const SIGIL_GLOW = '#2C3A56';
export const SIGIL_GRADIENT_ID = 'sigil-night';

export interface SvgOptions {
  readonly stroke?: string;
  readonly strokeWidth?: number;
  /**
   * When true, per-path `data-letter` / `data-source-index` /
   * `data-surviving-index` plus root `data-seed` are emitted for in-memory
   * editor/highlight use. Exports must leave this false (default) so no
   * source letters, indices, or deterministic seeds leak into files.
   */
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
}): string {
  const mirrorScale = transform.mirror ? -transform.scale : transform.scale;
  const halfGlyph = GLYPH_BOX_SIZE / 2;

  return [
    `translate(${formatNumber(transform.x)} ${formatNumber(transform.y)})`,
    `rotate(${formatNumber(transform.rotation)})`,
    `scale(${formatNumber(mirrorScale)} ${formatNumber(transform.scale)})`,
    `translate(${formatNumber(-halfGlyph)} ${formatNumber(-halfGlyph)})`,
  ].join(' ');
}

export function compositionToSvg(composition: SigilComposition, options: SvgOptions = {}): string {
  const stroke = escapeAttribute(options.stroke ?? SIGIL_STROKE);
  const strokeWidth = formatNumber(options.strokeWidth ?? SIGIL_STROKE_WIDTH);
  const includeMetadata = options.includeMetadata ?? false;
  const includeBackground = options.includeBackground ?? true;
  const gradientId = sanitizeGradientId(options.gradientId ?? SIGIL_GRADIENT_ID);
  const escapedGradientId = escapeAttribute(gradientId);

  const paths = composition.letters.map((letter) => {
    const transform = letterTransformToSvg(letter.transform);
    const metadata = includeMetadata
      ? ` data-letter="${escapeAttribute(letter.letter)}" data-source-index="${letter.sourceIndex}" data-surviving-index="${letter.survivingIndex}"`
      : '';
    return [
      `<path d="${letter.renderPath}"`,
      `transform="${transform}"`,
      'fill="none"',
      `stroke="${stroke}"`,
      `stroke-width="${strokeWidth}"`,
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
    includeMetadata ? `data-seed="${composition.seed}"` : '',
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

/**
 * Clean standalone file for Save SVG / Save PNG. Never includes source
 * letters, indices, seeds, intention text, or remote references.
 */
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
