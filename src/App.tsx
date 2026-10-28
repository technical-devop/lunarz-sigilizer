import { useId, useMemo, useState } from 'react';

import {
  composeSigil,
  compositionToExportSvg,
  letterTransformToSvg,
  processIntention,
  variantSeeds,
  SIGIL_BACKGROUND,
  SIGIL_GLOW,
  SIGIL_STROKE,
  SIGIL_STROKE_WIDTH,
  type SigilComposition,
} from './core';

type Phase = 'intend' | 'reduce' | 'compose';

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
 * Clean standalone vector scene shared by preview base layer and both
 * exports. Contains explicit night background + light lines only — never
 * source letters, indices, seeds, intention text, or remote references.
 */
export function buildExportSvg(composition: SigilComposition): string {
  return compositionToExportSvg(composition);
}

/** Filenames intentionally carry only the chosen slot, never the seed. */
export function exportFileName(kind: 'svg' | 'png', selectedIndex: number): string {
  return `lunarz-sigil-arrangement-${selectedIndex + 1}.${kind}`;
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
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function assemblyOffset(survivingIndex: number): { dx: number; dy: number } {
  const angle = survivingIndex * 2.399963 + 0.7;
  const distance = 110 + (survivingIndex % 3) * 34;
  return {
    dx: Math.round(Math.cos(angle) * distance),
    dy: Math.round(Math.sin(angle) * distance),
  };
}

function SigilSvg({
  composition,
  highlighted,
  showSources,
  animatedKey,
  decorative,
}: {
  composition: SigilComposition;
  highlighted: number | null;
  showSources: boolean;
  animatedKey: string;
  decorative: boolean;
}): React.JSX.Element {
  const rawId = useId();
  const gradientId = `sigil-night-${rawId.replaceAll(/[^A-Za-z0-9_-]/g, '')}`;
  return (
    <svg
      key={animatedKey}
      viewBox={`0 0 ${composition.width} ${composition.height}`}
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : `Sigil composition from ${composition.letters.length} letters, seed ${composition.seed}`}
    >
      {decorative ? null : <title>Lunarz Sigil</title>}
      <defs>
        <radialGradient id={gradientId} cx="50%" cy="42%" r="65%">
          <stop offset="0%" stopColor={SIGIL_GLOW} />
          <stop offset="100%" stopColor={SIGIL_BACKGROUND} />
        </radialGradient>
      </defs>
      <rect
        x="0"
        y="0"
        width={composition.width}
        height={composition.height}
        fill={`url(#${gradientId})`}
        data-scene="base-night"
      />
      {composition.letters.map((letter) => {
        const dim = highlighted !== null && highlighted !== letter.survivingIndex;
        const { dx, dy } = assemblyOffset(letter.survivingIndex);
        return (
          <g
            key={`${letter.survivingIndex}-${letter.sourceIndex}`}
            className="assemble"
            style={{ ['--dx' as string]: `${dx}px`, ['--dy' as string]: `${dy}px`, ['--i' as string]: letter.survivingIndex }}
          >
            <path
              d={letter.renderPath}
              transform={letterTransformToSvg(letter.transform)}
              stroke={SIGIL_STROKE}
              strokeWidth={SIGIL_STROKE_WIDTH}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`sigilpath${highlighted === letter.survivingIndex ? ' is-lit' : ''}${dim ? ' is-dim' : ''}`}
              style={{ ['--i' as string]: letter.survivingIndex }}
              aria-hidden="true"
              focusable="false"
            />
            {showSources ? (
              <text
                x={letter.transform.x}
                y={letter.transform.y - 34}
                className="sourcelabel"
                aria-hidden="true"
              >
                {letter.letter}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

export default function App(): React.JSX.Element {
  const [draft, setDraft] = useState('');
  const [committed, setCommitted] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('intend');
  const [stage, setStage] = useState(0);
  const [regen, setRegen] = useState(0);
  const [selected, setSelected] = useState(0);
  const [assembleKey, setAssembleKey] = useState(0);
  const [showSources, setShowSources] = useState(false);
  const [highlighted, setHighlighted] = useState<number | null>(null);
  const [exportNote, setExportNote] = useState('');

  const intention = useMemo(
    () => (committed === null ? null : processIntention(committed)),
    [committed],
  );

  const compositions = useMemo<SigilComposition[]>(() => {
    if (!intention || intention.letters.length === 0) {
      return [];
    }
    return variantSeeds(intention.letters, regen).map((seed) =>
      composeSigil(intention, { seed }),
    );
  }, [intention, regen]);

  const active = compositions[selected] ?? null;
  const hasLetters = (intention?.letters.length ?? 0) > 0;
  const inCompose = phase === 'compose';
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
    setRegen(0);
    setSelected(0);
    setHighlighted(null);
    setExportNote('');
  }

  function continueStage(): void {
    if (stage < 3) {
      const next = stage + 1;
      setStage(next);
      if (next === 3) {
        setPhase('compose');
        setAssembleKey((value) => value + 1);
      }
    } else {
      setPhase('compose');
      setAssembleKey((value) => value + 1);
    }
  }

  function replay(): void {
    setStage(0);
    setPhase('reduce');
    setHighlighted(null);
  }

  function skip(): void {
    setStage(3);
    setPhase('compose');
    setAssembleKey((value) => value + 1);
  }

  function startOver(): void {
    setCommitted(null);
    setPhase('intend');
    setStage(0);
    setRegen(0);
    setSelected(0);
    setHighlighted(null);
    setExportNote('');
    setShowSources(false);
  }

  function discardEdit(): void {
    if (committed !== null) {
      setDraft(committed);
    }
  }

  function regenerate(): void {
    setRegen((value) => value + 1);
    setSelected(0);
    setHighlighted(null);
    setExportNote('');
  }

  function exportSvg(): void {
    if (!active) {
      return;
    }
    downloadText(exportFileName('svg', selected), buildExportSvg(active), 'image/svg+xml');
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
        URL.revokeObjectURL(url);
        setExportNote('This browser would not rasterize the preview.');
        return;
      }
      context.fillStyle = SIGIL_BACKGROUND;
      context.fillRect(0, 0, size, size);
      context.drawImage(image, 0, 0, size, size);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => {
        if (!blob) {
          setExportNote('This browser would not rasterize the preview.');
          return;
        }
        const pngUrl = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = pngUrl;
        anchor.download = exportFileName('png', selected);
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(pngUrl), 1000);
        setExportNote('Saved as PNG, exactly as previewed.');
      }, 'image/png');
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
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
              <h2 id="release-heading">
                Release, in three passes
              </h2>
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
                  <div className="letters" aria-label="Surviving letters">
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
            <h2 id="compose-heading">
              Three small arrangements
            </h2>
            <p>
              The same kept letters, set three ways. Choose the one you want to keep.
              Regenerate keeps the letters and changes only their positions.
            </p>

            {!hasLetters ? (
              <div className="empty">
                <p style={{ margin: 0 }}>
                  {emptyKind === 'all-vowel'
                    ? 'Vowels alone cannot build. Add a consonant above and three arrangements will appear here.'
                    : emptyKind === 'unsupported-only'
                      ? 'Nothing here could enter the mark. Letters A–Z build; the rest are held aside with care.'
                      : 'Three arrangements will appear here once your kept letters gather.'}
                </p>
              </div>
            ) : !inCompose ? (
              <div className="empty">
                <p style={{ margin: 0 }}>
                  Reduction first. Continue through the passes, or Skip, and the three
                  arrangements will gather here. Nothing is built yet.
                </p>
              </div>
            ) : (
              <>
                <div className="sigilgrid" role="group" aria-label="Choose an arrangement">
                  {compositions.map((composition, index) => (
                    <button
                      key={composition.seed}
                      type="button"
                      className="variant"
                      aria-pressed={selected === index}
                      aria-label={`Arrangement ${index + 1}${selected === index ? ', chosen' : ''}, seed ${composition.seed}`}
                      onClick={() => {
                        setSelected(index);
                        setExportNote('');
                      }}
                    >
                      <span className="variant__frame" aria-hidden="true">
                        <SigilSvg
                          composition={composition}
                          highlighted={selected === index ? highlighted : null}
                          showSources={showSources}
                          animatedKey={`${composition.seed}-${regen}-${assembleKey}`}
                          decorative
                        />
                      </span>
                      <span className="variant__meta">
                        <span>{selected === index ? `No. ${index + 1} · yours` : `No. ${index + 1}`}</span>
                        <span className="variant__dot" aria-hidden="true" />
                      </span>
                    </button>
                  ))}
                </div>

                <div className="btnrow" role="group" aria-label="Arrangement controls">
                  <button type="button" className="btn" onClick={regenerate}>
                    Regenerate, same letters
                  </button>
                  <button
                    type="button"
                    className="btn btn--quiet"
                    aria-pressed={showSources}
                    onClick={() => setShowSources((value) => !value)}
                  >
                    {showSources ? 'Hide source letters' : 'Show source letters'}
                  </button>
                </div>

                {active ? (
                  <div className="preview">
                    <div className="stagehead">
                      <p className="card__kicker" style={{ margin: 0 }}>
                        Chosen preview · seed {active.seed}
                      </p>
                      <span className="stagehead__status">
                        {active.letters.length} {active.letters.length === 1 ? 'letter' : 'letters'}
                      </span>
                    </div>
                    <div className="preview__stage">
                      <SigilSvg
                        composition={active}
                        highlighted={highlighted}
                        showSources={showSources}
                        animatedKey={`chosen-${active.seed}-${regen}-${assembleKey}`}
                        decorative={false}
                      />
                    </div>
                    <div className="letters" role="group" aria-label="Highlight a source letter">
                      {active.letters.map((letter) => (
                        <button
                          key={letter.survivingIndex}
                          type="button"
                          className={`chip chip--action${highlighted === letter.survivingIndex ? ' is-lit' : ''}`}
                          aria-pressed={highlighted === letter.survivingIndex}
                          aria-label={`Highlight letter ${letter.letter}`}
                          onMouseEnter={() => setHighlighted(letter.survivingIndex)}
                          onMouseLeave={() => setHighlighted(null)}
                          onFocus={() => setHighlighted(letter.survivingIndex)}
                          onBlur={() => setHighlighted(null)}
                          onClick={() =>
                            setHighlighted((current) =>
                              current === letter.survivingIndex ? null : letter.survivingIndex,
                            )
                          }
                        >
                          {letter.letter}
                        </button>
                      ))}
                    </div>
                    <p className="field__help" id="overlay-note">
                      Source letters and highlights are inspection overlays only — exports
                      contain clean lines on the night background, with no labels or
                      highlights.
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
                ) : null}
              </>
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
