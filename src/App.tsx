import { useEffect, useId, useMemo, useState } from 'react';

import { processIntention } from './core/intention';
import {
  SIGIL_BACKGROUND,
  SIGIL_GLOW,
  SIGIL_STROKE,
  SIGIL_STROKE_WIDTH,
} from './core/svg';
import {
  WHEEL1_RADIUS,
  WHEEL2_GROUPS,
  WHEEL2_RADII,
  WHEEL_CANVAS,
  type WheelMode,
  type WheelPoint,
  type WheelSequenceEntry,
  type WheelSigil,
} from './core/wheel';
import { wheelToExportSvg } from './core/wheelSvg';

type Phase = 'intend' | 'reduce' | 'compose';

const NO_LAYOUT_MESSAGE =
  'These letters could not settle into a clear mark. Begin again with different words.';
const WORKER_UNAVAILABLE_MESSAGE =
  'This browser could not start the background composer. Enable Web Workers or use a current browser, then try again.';
const WORKER_FAILURE_MESSAGE =
  'The background composer stopped unexpectedly. Reload the app, or use a browser with Web Workers enabled, then try again.';

const STAGE_COPY = [
  'Everything you typed, as arrived.',
  'Vowels rest. They softened the word; they do not build the mark.',
  'Repeats rest. What remains has already been said once.',
  'What remains. These letters build the mark.',
] as const;

function reasonLabel(reason: string): string {
  switch (reason) {
    case 'whitespace':
      return 'space';
    case 'digit':
      return 'digit';
    case 'punctuation':
      return 'punctuation';
    case 'combining-mark':
      return 'combining mark';
    case 'control':
      return 'control character';
    default:
      return 'unsupported character';
  }
}

function codePointLabel(codePoint: number): string {
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
}

/**
 * Clean standalone vector scene shared by the preview and both exports.
 * Contains the explicit night background and the wheel path only — never
 * guides, source letters, order badges, intention text, or seeds.
 */
export function buildExportSvg(sigil: WheelSigil): string {
  return wheelToExportSvg(sigil);
}

/** Filenames carry no intention, seed, or source letters. */
export function exportFileName(kind: 'svg' | 'png'): string {
  return `lunarz-sigil.${kind}`;
}

function downloadText(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => {
    if (typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(url);
    }
  }, 1000);
}

const USED_CLASS = 'is-used';
const HIGHLIGHT_CLASS = 'is-highlighted';

function pointClass(point: WheelPoint, used: Set<string>, highlighted: string | null): string {
  const classes: string[] = ['wheel-point'];
  if (used.has(point.letter)) {
    classes.push(USED_CLASS);
  }
  if (point.letter === highlighted) {
    classes.push(HIGHLIGHT_CLASS);
  }
  return classes.join(' ');
}

function labelClass(letter: string, used: Set<string>, highlighted: string | null): string {
  const classes: string[] = ['wheel-label'];
  if (used.has(letter)) {
    classes.push(USED_CLASS);
  }
  if (letter === highlighted) {
    classes.push(HIGHLIGHT_CLASS);
  }
  return classes.join(' ');
}

function labelPosition(sigil: WheelSigil, point: WheelPoint): { x: number; y: number } {
  const angle = Math.atan2(point.y - sigil.cy, point.x - sigil.cx);
  const radius = point.radius + (sigil.mode === 'single' ? 14 : 10);
  return {
    x: sigil.cx + radius * Math.cos(angle),
    y: sigil.cy + radius * Math.sin(angle),
  };
}

function orderPosition(
  sigil: WheelSigil,
  entry: WheelSequenceEntry,
): { x: number; y: number } {
  const angle = Math.atan2(entry.y - sigil.cy, entry.x - sigil.cx);
  const radius = entry.radius * 0.78;
  return {
    x: sigil.cx + radius * Math.cos(angle),
    y: sigil.cy + radius * Math.sin(angle),
  };
}

function WheelSvg({
  sigil,
  showWheel,
  showSequence,
  highlighted,
}: {
  sigil: WheelSigil;
  showWheel: boolean;
  showSequence: boolean;
  highlighted: string | null;
}): React.JSX.Element {
  const rawId = useId();
  const gradientId = `sigil-night-${rawId.replaceAll(/[^A-Za-z0-9_-]/g, '')}`;
  const used = new Set(sigil.sequence.map((entry) => entry.letter));
  const highlightedPoint = sigil.points.find((point) => point.letter === highlighted) ?? null;
  const visiblePoints = showWheel
    ? sigil.points
    : highlightedPoint
      ? [highlightedPoint]
      : [];
  const ringRadii =
    sigil.mode === 'single'
      ? [WHEEL1_RADIUS]
      : WHEEL2_GROUPS.map((group) => WHEEL2_RADII[group.ring]);

  return (
    <svg
      key={`${sigil.mode}-${sigil.pathD ?? 'dot'}`}
      viewBox={`0 0 ${WHEEL_CANVAS} ${WHEEL_CANVAS}`}
      role="img"
      aria-label={`Sigil mark from ${sigil.letters.length} ${
        sigil.letters.length === 1 ? 'letter' : 'letters'
      }`}
    >
      <title>Lunarz Sigil</title>
      <defs>
        <radialGradient id={gradientId} cx="50%" cy="42%" r="65%">
          <stop offset="0%" stopColor={SIGIL_GLOW} />
          <stop offset="100%" stopColor={SIGIL_BACKGROUND} />
        </radialGradient>
      </defs>
      <rect
        x="0"
        y="0"
        width={WHEEL_CANVAS}
        height={WHEEL_CANVAS}
        fill={`url(#${gradientId})`}
        data-scene="base-night"
      />

      {showWheel ? (
        <g className="wheel-rings" aria-hidden="true">
          {ringRadii.map((radius) => (
            <circle
              key={radius}
              className="wheel-ring"
              cx={sigil.cx}
              cy={sigil.cy}
              r={radius}
              fill="none"
            />
          ))}
        </g>
      ) : null}

      {sigil.dot ? (
        <circle
          className="wheel-dot"
          cx={sigil.dot.x}
          cy={sigil.dot.y}
          r={sigil.dot.radius}
          fill={SIGIL_STROKE}
          stroke="none"
          aria-hidden="true"
          focusable="false"
        />
      ) : sigil.pathD ? (
        <path
          className="sigilpath wheelmark"
          d={sigil.pathD}
          fill="none"
          stroke={SIGIL_STROKE}
          strokeWidth={SIGIL_STROKE_WIDTH}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        />
      ) : null}

      {visiblePoints.length > 0 ? (
        <g className="wheel-points" aria-hidden="true">
          {visiblePoints.map((point) => (
            <circle
              key={point.letter}
              className={pointClass(point, used, highlighted)}
              cx={point.x}
              cy={point.y}
              r={2}
            />
          ))}
        </g>
      ) : null}

      {visiblePoints.length > 0 ? (
        <g className="wheel-labels" aria-hidden="true">
          {visiblePoints.map((point) => {
            const position = labelPosition(sigil, point);
            return (
              <text
                key={point.letter}
                className={labelClass(point.letter, used, highlighted)}
                x={position.x}
                y={position.y}
                textAnchor="middle"
                dominantBaseline="middle"
              >
                {point.letter}
              </text>
            );
          })}
        </g>
      ) : null}

      {showSequence ? (
        <g className="wheel-orders" aria-hidden="true">
          {sigil.sequence.map((entry) => {
            const position = orderPosition(sigil, entry);
            return (
              <text
                key={`${entry.letter}-${entry.order}`}
                className={`wheel-order${entry.letter === highlighted ? ` ${HIGHLIGHT_CLASS}` : ''}`}
                x={position.x}
                y={position.y}
                textAnchor="middle"
                dominantBaseline="middle"
              >
                {entry.order}
              </text>
            );
          })}
        </g>
      ) : null}
    </svg>
  );
}

export default function App(): React.JSX.Element {
  const [draft, setDraft] = useState('');
  const [committed, setCommitted] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('intend');
  const [stage, setStage] = useState(0);
  const [wheelMode, setWheelMode] = useState<WheelMode>('multi');
  const [showWheel, setShowWheel] = useState(false);
  const [showSequence, setShowSequence] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const highlighted = pinned ?? hovered;
  const [exportNote, setExportNote] = useState('');
  const [pending, setPending] = useState<{
    key: string;
    sigil: WheelSigil | null;
    error: string | null;
  } | null>(null);

  const intention = useMemo(
    () => (committed === null ? null : processIntention(committed)),
    [committed],
  );

  const wheelKey =
    intention === null
      ? ''
      : `${intention.input}\u0000${intention.letters.join('')}\u0000${wheelMode}`;

  useEffect(() => {
    if (!intention || intention.letters.length === 0) {
      setPending(null);
      return;
    }
    const key = wheelKey;
    let cancelled = false;
    let worker: Worker | null = null;

    const fail = (message: string): void => {
      if (!cancelled) {
        setPending({ key, sigil: null, error: message });
      }
    };

    setPending({ key, sigil: null, error: null });

    if (typeof Worker === 'undefined') {
      fail(WORKER_UNAVAILABLE_MESSAGE);
      return () => {
        cancelled = true;
      };
    }

    try {
      worker = new Worker(new URL('./core/sigil.worker.ts', import.meta.url), {
        type: 'module',
      });
      worker.onmessage = (event: MessageEvent) => {
        if (cancelled) {
          return;
        }
        const data = event.data as
          | { ok: true; sigil?: WheelSigil }
          | { ok: false; error?: string };
        if (data.ok) {
          if (!data.sigil || data.sigil.isEmpty) {
            fail(NO_LAYOUT_MESSAGE);
            return;
          }
          setPending({ key, sigil: data.sigil, error: null });
          return;
        }
        const detail = data.error ? ` (${data.error})` : '';
        fail(`${NO_LAYOUT_MESSAGE}${detail}`);
      };
      worker.onerror = (event: ErrorEvent) => {
        event.preventDefault?.();
        worker?.terminate();
        worker = null;
        fail(WORKER_FAILURE_MESSAGE);
      };
      worker.onmessageerror = () => {
        worker?.terminate();
        worker = null;
        fail(WORKER_FAILURE_MESSAGE);
      };
      worker.postMessage({ input: intention.input, wheelMode });
    } catch {
      fail(WORKER_UNAVAILABLE_MESSAGE);
    }

    return () => {
      cancelled = true;
      worker?.terminate();
    };
  }, [intention, wheelKey, wheelMode]);

  const pendingBatch = pending && pending.key === wheelKey ? pending : null;
  const active = pendingBatch?.sigil ?? null;
  const compositionError = pendingBatch?.error ?? null;
  const hasLetters = (intention?.letters.length ?? 0) > 0;
  const inCompose = phase === 'compose';
  const isPreparing =
    inCompose && hasLetters && active === null && compositionError === null;
  const isDirty = committed !== null && draft !== committed;

  const vowelCount =
    intention?.characters.filter((character) => character.classification === 'vowel').length ?? 0;
  const emptyKind =
    intention && intention.isEmpty
      ? intention.characters.length === 0
        ? 'empty'
        : vowelCount > 0
          ? 'all-vowel'
          : intention.unsupported.length > 0
            ? 'unsupported-only'
            : 'empty'
      : null;

  const actionableUnsupported = (intention?.unsupported ?? []).filter(
    (entry) => entry.reason !== 'whitespace' && entry.reason !== 'punctuation',
  );

  function begin(): void {
    if (draft.trim().length === 0) {
      return;
    }
    setCommitted(draft);
    setPhase('reduce');
    setStage(0);
    setHovered(null);
    setPinned(null);
    setExportNote('');
    setShowWheel(false);
    setShowSequence(false);
  }

  function continueStage(): void {
    if (stage < 3) {
      const next = stage + 1;
      setStage(next);
      if (next === 3) {
        setPhase('compose');
      }
    } else {
      setPhase('compose');
    }
  }

  function replay(): void {
    setStage(0);
    setPhase('reduce');
    setHovered(null);
    setPinned(null);
  }

  function skip(): void {
    setStage(3);
    setPhase('compose');
  }

  function startOver(): void {
    setCommitted(null);
    setPhase('intend');
    setStage(0);
    setHovered(null);
    setPinned(null);
    setExportNote('');
    setShowWheel(false);
    setShowSequence(false);
  }

  function discardEdit(): void {
    if (committed !== null) {
      setDraft(committed);
    }
  }

  function chooseMode(mode: WheelMode): void {
    setWheelMode(mode);
    setHovered(null);
    setPinned(null);
    setExportNote('');
  }

  function previewHighlight(letter: string | null): void {
    setHovered(letter);
  }

  function toggleHighlight(letter: string): void {
    setHovered(null);
    setPinned((current) => (current === letter ? null : letter));
  }

  function exportSvg(): void {
    if (!active) {
      return;
    }
    downloadText(exportFileName('svg'), buildExportSvg(active), 'image/svg+xml');
    setExportNote('Saved as SVG, exactly as previewed.');
  }

  function exportPng(): void {
    if (!active) {
      return;
    }
    const source = buildExportSvg(active);
    const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml' }));
    const image = new Image();
    image.onload = () => {
      const size = 1024;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext('2d');
      if (!context) {
        if (typeof URL.revokeObjectURL === 'function') {
          URL.revokeObjectURL(url);
        }
        setExportNote('This browser would not rasterize the preview.');
        return;
      }
      context.fillStyle = SIGIL_BACKGROUND;
      context.fillRect(0, 0, size, size);
      context.drawImage(image, 0, 0, size, size);
      if (typeof URL.revokeObjectURL === 'function') {
        URL.revokeObjectURL(url);
      }
      canvas.toBlob((blob) => {
        if (!blob) {
          setExportNote('This browser would not rasterize the preview.');
          return;
        }
        const pngUrl = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = pngUrl;
        anchor.download = exportFileName('png');
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => {
          if (typeof URL.revokeObjectURL === 'function') {
            URL.revokeObjectURL(pngUrl);
          }
        }, 1000);
        setExportNote('Saved as PNG, exactly as previewed.');
      }, 'image/png');
    };
    image.onerror = () => {
      if (typeof URL.revokeObjectURL === 'function') {
        URL.revokeObjectURL(url);
      }
      setExportNote('This browser would not rasterize the preview.');
    };
    image.src = url;
  }

  return (
    <div className="ritual">
      <a className="ritual__skip" href="#main">
        Skip to the bench
      </a>

      <header className="ritual__top">
        <h1 className="wordmark">
          Lunarz Sigilizer
          <small>A quiet bench for one intention</small>
        </h1>
        <ol className="phases" aria-label="Ritual phases">
          <li aria-current={phase === 'intend' ? 'step' : undefined}>1 · Intend</li>
          <li aria-current={phase === 'reduce' ? 'step' : undefined}>2 · Release</li>
          <li aria-current={phase === 'compose' ? 'step' : undefined}>3 · Compose</li>
        </ol>
      </header>

      <div className="ritual__sky" aria-hidden="true">
        <pre className="moon">
          {`        .      ·       ·           ·\n   ·        ·                  ·\n ·              .-""-.              ·\n   ·           / .--. \\      ·\n  ·    ·      | (    ) |          ·\n              \\ '--' /     ·\n        ·      '-...-'              ·\n   ·                ·       ·           ·`}
        </pre>
      </div>

      <main id="main" className="ritual__bench">
        <div className="bench__col">
          <section className="card" aria-labelledby="intention-heading">
            <p className="card__kicker">First movement</p>
            <h2 id="intention-heading">What is your intention?</h2>
            <p>
              Write it plainly, in your own words. Nothing leaves this device. Spaces rest
              quietly aside; only consonants go on to build the mark.
            </p>
            <div className="field">
              <label className="field__label" htmlFor="intention-input">
                Your intention
              </label>
              <div className="field__inputrow">
                <input
                  id="intention-input"
                  type="text"
                  value={draft}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="e.g. sleep through the whole night"
                  maxLength={280}
                  aria-invalid={emptyKind !== null && committed !== null}
                  aria-describedby="intention-help intention-status"
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && draft.trim().length > 0) {
                      begin();
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={draft.trim().length === 0}
                  onClick={begin}
                >
                  {committed === null ? 'Begin the reduction' : 'Begin again'}
                </button>
              </div>
              <p id="intention-help" className="field__help">
                One sentence is enough. Letters, spaces and punctuation are all welcome.
              </p>
              <p id="intention-status" className="field__error" role="status">
                {committed !== null && emptyKind === 'empty'
                  ? 'There is nothing here yet. Offer one sentence first.'
                  : committed !== null && emptyKind === 'all-vowel'
                    ? 'Only vowels so far — they soften, they do not build. Add a consonant to continue.'
                    : ''}
              </p>
              {isDirty ? (
                <p className="field__warn" role="status">
                  Edited after beginning. The mark below still uses: “{committed}”.
                  Begin again to rebuild from the edited words, or discard the edit.
                </p>
              ) : null}
              {isDirty || committed !== null ? (
                <div className="btnrow" role="group" aria-label="Intention edit controls">
                  {isDirty ? (
                    <button type="button" className="btn" onClick={discardEdit}>
                      Discard edit
                    </button>
                  ) : null}
                  <button type="button" className="btn" onClick={startOver}>
                    Start over
                  </button>
                </div>
              ) : null}
            </div>
          </section>

          <section className="card" aria-labelledby="release-heading" aria-live="polite">
            <p className="card__kicker">Second movement</p>
            <div className="stagehead">
              <h2 id="release-heading">Release, in three passes</h2>
              <span className="stagehead__status">
                Pass {Math.min(stage + 1, 4)} of 4
              </span>
            </div>
            <p>{STAGE_COPY[stage] ?? STAGE_COPY[0]}</p>

            {!intention || intention.characters.length === 0 ? (
              <div className="empty">
                <p style={{ margin: 0 }}>
                  Begin above and your words will appear here, letter by letter.
                </p>
              </div>
            ) : (
              <>
                <div className="tokenstream" data-stage={stage} role="list" aria-label="Letter reduction">
                  {intention.characters.map((character) => {
                    const key = `${character.index}-${character.char}`;
                    if (character.classification === 'kept') {
                      return (
                        <span key={key} role="listitem" className="token token--kept" title="Kept consonant">
                          <span aria-hidden="true" className="token__mark">●</span>
                          {character.char === ' ' ? '␣' : character.char}
                          <span className="sr-only">(kept)</span>
                        </span>
                      );
                    }
                    if (character.classification === 'vowel') {
                      return (
                        <span key={key} role="listitem" className="token token--vowel" title="Vowel, released">
                          <span aria-hidden="true" className="token__mark">○</span>
                          {character.char}
                          <span className="sr-only">(vowel, released)</span>
                        </span>
                      );
                    }
                    if (character.classification === 'duplicate') {
                      return (
                        <span key={key} role="listitem" className="token token--duplicate" title="Repeated letter, released">
                          <span aria-hidden="true" className="token__mark">=</span>
                          {character.char}
                          <span className="sr-only">(repeated, released)</span>
                        </span>
                      );
                    }
                    const display =
                      character.char === ' '
                        ? '␣'
                        : character.char === '\n'
                          ? '↵'
                          : character.char === '\t'
                            ? '⇥'
                            : character.char;
                    return (
                      <span key={key} role="listitem" className="token token--unsupported token--space" title={`${reasonLabel(character.unsupportedReason ?? 'non-ascii')}, set aside`}>
                        <span aria-hidden="true" className="token__mark">□</span>
                        {display}
                        <span className="sr-only">({reasonLabel(character.unsupportedReason ?? 'non-ascii')}, set aside)</span>
                      </span>
                    );
                  })}
                </div>

                <ul className="legend" aria-label="Legend">
                  <li><code>●</code> kept consonant</li>
                  <li><code>○</code> vowel, released</li>
                  <li><code>=</code> repeated, released</li>
                  <li><code>□</code> set gently aside</li>
                </ul>

                <div className="setaside">
                  <p style={{ margin: 0 }}>
                    Set gently aside — spaces and punctuation rest, they are not faults.
                    {actionableUnsupported.length > 0
                      ? ` ${actionableUnsupported.length} ${actionableUnsupported.length === 1 ? 'character cannot' : 'characters cannot'} enter the mark and ${actionableUnsupported.length === 1 ? 'is' : 'are'} named below.`
                      : ''}
                  </p>
                  {actionableUnsupported.length > 0 ? (
                    <ul>
                      {actionableUnsupported.slice(0, 8).map((entry) => (
                        <li key={`${entry.index}-${entry.codePoint}`}>
                          <code>
                            {entry.char} · {codePointLabel(entry.codePoint)} · {reasonLabel(entry.reason)}
                          </code>
                        </li>
                      ))}
                      {actionableUnsupported.length > 8 ? (
                        <li>
                          <code>
                            …and {actionableUnsupported.length - 8} more, held aside untouched
                          </code>
                        </li>
                      ) : null}
                    </ul>
                  ) : null}
                </div>

                {hasLetters ? (
                  <div className="letters" role="group" aria-label="Surviving letters">
                    {intention.letters.map((letter, index) => (
                      <span key={`${letter}-${index}`} className="chip">
                        {letter}
                      </span>
                    ))}
                  </div>
                ) : null}

                <div className="btnrow" role="group" aria-label="Pacing controls">
                  <button type="button" className="btn" onClick={replay}>
                    Replay
                  </button>
                  <button type="button" className="btn" onClick={skip}>
                    Skip
                  </button>
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={continueStage}
                    disabled={!hasLetters}
                  >
                    {stage >= 3 ? 'Gather the kept letters' : 'Continue'}
                  </button>
                </div>
              </>
            )}
          </section>
        </div>

        <div className="bench__col">
          <section className="card" aria-labelledby="compose-heading">
            <p className="card__kicker">Third movement</p>
            <h2 id="compose-heading">One quiet mark</h2>
            <p>
              The same kept letters, set once around the wheel. The three-ring wheel is
              the default; choose the single ring if that reads more plainly.
            </p>

            <fieldset className="wheelchoice">
              <legend className="wheelchoice__legend">Wheel</legend>
              <div className="wheelchoice__options">
                <label className="wheelchoice__option">
                  <input
                    type="radio"
                    name="wheel-mode"
                    value="multi"
                    checked={wheelMode === 'multi'}
                    onChange={() => chooseMode('multi')}
                  />
                  <span>
                    <strong>Three rings</strong>
                    <small>A–M · N–U · V–Z</small>
                  </span>
                </label>
                <label className="wheelchoice__option">
                  <input
                    type="radio"
                    name="wheel-mode"
                    value="single"
                    checked={wheelMode === 'single'}
                    onChange={() => chooseMode('single')}
                  />
                  <span>
                    <strong>Single ring</strong>
                    <small>A–Z, once around</small>
                  </span>
                </label>
              </div>
            </fieldset>

            {!hasLetters ? (
              <div className="empty">
                <p style={{ margin: 0 }}>
                  {emptyKind === 'all-vowel'
                    ? 'Vowels alone cannot build. Add a consonant above and the mark will appear here.'
                    : emptyKind === 'unsupported-only'
                      ? 'Nothing here could enter the mark. Letters A–Z build; the rest are held aside with care.'
                      : 'Your wheel mark will appear here once your kept letters gather.'}
                </p>
              </div>
            ) : !inCompose ? (
              <div className="empty">
                <p style={{ margin: 0 }}>
                  Reduction first. Continue through the passes, or Skip, and the wheel mark
                  will gather here. Nothing is built yet.
                </p>
              </div>
            ) : compositionError ? (
              <div className="empty">
                <p className="field__error" role="alert" style={{ margin: 0 }}>
                  {compositionError}
                </p>
              </div>
            ) : isPreparing || !active ? (
              <div className="empty">
                <p style={{ margin: 0 }}>
                  The wheel mark will appear here once your kept letters gather.
                </p>
              </div>
            ) : (
              <div className="preview">
                <div className="stagehead">
                  <p className="card__kicker" style={{ margin: 0 }}>
                    Chosen wheel · {active.mode === 'multi' ? 'three rings' : 'single ring'}
                  </p>
                  <span className="stagehead__status">
                    {active.letters.length} {active.letters.length === 1 ? 'letter' : 'letters'}
                  </span>
                </div>
                <div className="preview__stage">
                  <WheelSvg
                    sigil={active}
                    showWheel={showWheel}
                    showSequence={showSequence}
                    highlighted={highlighted}
                  />
                </div>

                <div className="btnrow" role="group" aria-label="Inspection">
                  <button
                    type="button"
                    className="btn btn--quiet"
                    aria-pressed={showWheel}
                    onClick={() => setShowWheel((value) => !value)}
                  >
                    Show wheel
                  </button>
                  <button
                    type="button"
                    className="btn btn--quiet"
                    aria-pressed={showSequence}
                    onClick={() => setShowSequence((value) => !value)}
                  >
                    Show sequence
                  </button>
                </div>

                {showSequence ? (
                  <ol className="sequences" aria-label="Wheel sequence">
                    {active.sequence.map((entry) => (
                      <li key={`${entry.letter}-${entry.sourceIndex}`}>
                        <button
                          type="button"
                          className={`sequences__item${highlighted === entry.letter ? ' is-lit' : ''}`}
                          aria-pressed={highlighted === entry.letter}
                          aria-label={`Letter ${entry.letter}, position ${entry.order}`}
                          onMouseEnter={() => previewHighlight(entry.letter)}
                          onMouseLeave={() => previewHighlight(null)}
                          onFocus={() => previewHighlight(entry.letter)}
                          onBlur={() => previewHighlight(null)}
                          onClick={() => toggleHighlight(entry.letter)}
                        >
                          <span className="sequences__order">{entry.order}</span> {entry.letter}
                        </button>
                      </li>
                    ))}
                  </ol>
                ) : null}

                <div className="letters" role="group" aria-label="Highlight a source letter">
                  {active.sequence.map((entry) => (
                    <button
                      key={entry.sourceIndex}
                      type="button"
                      className={`chip chip--action${highlighted === entry.letter ? ' is-lit' : ''}`}
                      aria-pressed={highlighted === entry.letter}
                      aria-label={`Highlight letter ${entry.letter}`}
                      onMouseEnter={() => previewHighlight(entry.letter)}
                      onMouseLeave={() => previewHighlight(null)}
                      onFocus={() => previewHighlight(entry.letter)}
                      onBlur={() => previewHighlight(null)}
                      onClick={() => toggleHighlight(entry.letter)}
                    >
                      {entry.letter}
                    </button>
                  ))}
                </div>

                <p className="field__help" id="overlay-note">
                  Wheel and sequence overlays are inspection only — exports contain clean
                  lines on the night background, with no labels, order, or highlights.
                </p>
                <p className="quiet" role="status">
                  This one is yours, if you want it. Keep it somewhere quiet.
                </p>
                <div className="btnrow" role="group" aria-label="Export the chosen sigil">
                  <button type="button" className="btn btn--primary" onClick={exportSvg} aria-describedby="overlay-note">
                    Save SVG
                  </button>
                  <button type="button" className="btn" onClick={exportPng} aria-describedby="overlay-note">
                    Save PNG
                  </button>
                </div>
                <p className="field__help" role="status" aria-live="polite">
                  {exportNote || 'Exports match the chosen preview exactly — same lines, same night. Overlays are never exported.'}
                </p>
              </div>
            )}
          </section>
        </div>
      </main>

      <footer className="ritual__foot">
        <span>Kept on this device only · nothing is sent anywhere.</span>
      </footer>
    </div>
  );
}
