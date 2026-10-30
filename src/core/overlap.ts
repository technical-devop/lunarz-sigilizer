import {
  BBox,
  Stroke,
  Transform,
  Vec,
  pyFloat,
  roundTo,
  sampleStrokes,
  stableSeed,
  stableUnit,
} from './geometry';
import {
  CandidateSpec,
  Contact,
  GenerationBudget,
  NetworkAnchor,
  PlacementCandidate,
  PlacedLetter,
  Variant,
  buildLetter,
  componentCount,
  contactVisualAudit,
  detectContacts,
  detectPrototypeContacts,
  letterComponentCount,
  reduceIntention,
  scoreCandidate,
  sharedByPair,
  sharedProvenance,
  transformFromAnchors,
  verifyResult,
} from './generator';
import { getGlyph, type Glyph } from './glyphs';

export const EXACT_KINDS = ['shared', 'cross', 'touch'] as const;
export const NEAR_KIND = 'near';
export const CONTACT_TOLERANCE = 0.032;
export const SHARED_MIN_LENGTH = 0.075;
export const TARGET_ANCHOR_CAP = 20;
export const DEFAULT_CANDIDATE_CAP = 150;
export const INTRINSIC_NEAR_TOLERANCE = 0.001;

export const OVERLAP_VARIANTS: readonly Variant[] = [
  new Variant(
    'overlap-parallel',
    'Parallel Overlap',
    'collinear shared-stroke joins only; long exact overlap intervals',
    ['shared'],
    { shared: 4.5 },
    0.94,
    0.945,
    0,
    'weave',
    ['shared'],
  ),
  new Variant(
    'overlap-cross',
    'Crossing Overlap',
    'proper interior intersections only; perpendicular-biased joins',
    ['cross'],
    { cross: 4.5 },
    0.88,
    0.94,
    0.1,
    'weave',
    ['cross'],
  ),
  new Variant(
    'overlap-lattice',
    'Overlap Lattice',
    'alternating shared-stroke and crossing joins; balanced overlap lattice',
    ['shared', 'cross'],
    { shared: 3.0, cross: 2.8 },
    0.91,
    0.942,
    0.06,
    'weave',
    ['shared', 'cross', 'shared'],
  ),
];

export function getOverlapVariant(key: string): Variant {
  const variant = OVERLAP_VARIANTS.find((candidate) => candidate.key === key);
  if (!variant) {
    throw new Error(`unknown overlap variant ${key}`);
  }
  return variant;
}

export function allStrokes(placed: readonly PlacedLetter[]): Stroke[] {
  return placed.flatMap((letter) => letter.strokes);
}

export function targetAnchorsOverlap(
  placed: readonly PlacedLetter[],
  seed: bigint,
  letterIndex: number,
  cap: number,
): NetworkAnchor[] {
  const anchors = placed
    .flatMap((letter) => letter.anchors)
    .filter((anchor) => anchor.kind === 'segment');
  if (anchors.length === 0) {
    return [];
  }
  const midpoints: { owner: number; midpoint: Vec }[] = [];
  for (const stroke of allStrokes(placed)) {
    for (const segment of stroke.segments()) {
      midpoints.push({ owner: stroke.owner ?? -1, midpoint: segment.midpoint });
    }
  }
  const crowding = (anchor: NetworkAnchor): number => {
    const owner = anchor.owner;
    const point = anchor.pos;
    return midpoints.filter(
      (entry) => entry.owner !== owner && entry.midpoint.sub(point).norm() < 0.18,
    ).length;
  };
  const ranked = anchors.map((anchor) => ({
    crowd: crowding(anchor),
    negativeLength: -anchor.segmentLength,
    hash: stableUnit(seed, letterIndex, 'overlap-target', anchor.anchorId),
    anchor,
  }));
  ranked.sort(
    (left, right) =>
      left.crowd - right.crowd ||
      left.negativeLength - right.negativeLength ||
      left.hash - right.hash,
  );
  const byOwner = new Map<number, NetworkAnchor[]>();
  for (const row of ranked.slice(0, Math.max(cap * 2, cap))) {
    const group = byOwner.get(row.anchor.owner) ?? [];
    group.push(row.anchor);
    byOwner.set(row.anchor.owner, group);
  }
  const ownerOrder = [...byOwner.keys()].sort((left, right) => {
    return (
      stableUnit(seed, letterIndex, 'overlap-owner', left) -
      stableUnit(seed, letterIndex, 'overlap-owner', right) ||
      left - right
    );
  });
  const positions = new Map<number, number>(ownerOrder.map((owner) => [owner, 0]));
  const selected: NetworkAnchor[] = [];
  while (selected.length < cap) {
    let added = false;
    for (const owner of ownerOrder) {
      if (selected.length >= cap) {
        break;
      }
      const group = byOwner.get(owner) ?? [];
      const position = positions.get(owner) ?? 0;
      if (position < group.length) {
        selected.push(group[position]!);
        positions.set(owner, position + 1);
        added = true;
      }
    }
    if (!added) {
      break;
    }
  }
  return selected;
}

export function balancedSpecs(
  specs: readonly CandidateSpec[],
  cap: number,
  seed: bigint,
  letterIndex: number,
  mode: string,
): CandidateSpec[] {
  if (specs.length <= cap) {
    return [...specs];
  }
  const groups = new Map<string, CandidateSpec[]>();
  for (const spec of specs) {
    const group = groups.get(spec.local.anchorId) ?? [];
    group.push(spec);
    groups.set(spec.local.anchorId, group);
  }
  for (const group of groups.values()) {
    group.sort(
      (left, right) =>
        stableUnit(
          seed,
          letterIndex,
          'overlap-spec',
          mode,
          left.local.anchorId,
          left.target.anchorId,
          pyFloat(roundTo(left.angleOffset, 9)),
          pyFloat(roundTo(left.slide, 9)),
        ) -
        stableUnit(
          seed,
          letterIndex,
          'overlap-spec',
          mode,
          right.local.anchorId,
          right.target.anchorId,
          pyFloat(roundTo(right.angleOffset, 9)),
          pyFloat(roundTo(right.slide, 9)),
        ),
    );
  }
  const order = [...groups.keys()].sort(
    (left, right) =>
      stableUnit(seed, letterIndex, 'overlap-group', mode, left) -
      stableUnit(seed, letterIndex, 'overlap-group', mode, right),
  );
  const picked: CandidateSpec[] = [];
  let depth = 0;
  while (picked.length < cap) {
    let added = false;
    for (const anchorId of order) {
      const group = groups.get(anchorId)!;
      if (depth < group.length) {
        picked.push(group[depth]!);
        added = true;
        if (picked.length >= cap) {
          break;
        }
      }
    }
    if (!added) {
      break;
    }
    depth += 1;
  }
  return picked;
}

export function specsForVariant(
  glyph: Glyph,
  targets: readonly NetworkAnchor[],
  variant: Variant,
  seed: bigint,
  letterIndex: number,
  cap: number,
): { specs: CandidateSpec[]; rawTotal: number } {
  const localGroup = glyph.anchors.filter((anchor) => anchor.kind === 'segment');
  const targetGroup = targets.filter((anchor) => anchor.kind === 'segment');
  const groups = new Map<string, CandidateSpec[]>();

  if (variant.modes.includes('shared')) {
    const sharedSpecs: CandidateSpec[] = [];
    for (const local of localGroup) {
      for (const target of targetGroup) {
        const targetLength = Math.max(0.05, target.segmentLength);
        for (const fraction of [0, 0.22, -0.22, 0.4, -0.4]) {
          sharedSpecs.push(
            new CandidateSpec('shared', local, target, 0, fraction * targetLength),
          );
        }
      }
    }
    groups.set('shared', sharedSpecs);
  }

  if (variant.modes.includes('cross')) {
    const crossSpecs: CandidateSpec[] = [];
    for (const local of localGroup) {
      for (const target of targetGroup) {
        for (const angle of [
          Math.PI / 2,
          -Math.PI / 2,
          Math.PI / 3,
          -Math.PI / 3,
          (2 * Math.PI) / 3,
          (-2 * Math.PI) / 3,
        ]) {
          crossSpecs.push(new CandidateSpec('cross', local, target, angle, 0));
        }
      }
    }
    groups.set('cross', crossSpecs);
  }

  const rawTotal = [...groups.values()].reduce((sum, specs) => sum + specs.length, 0);
  const modeCount = Math.max(1, groups.size);
  const picked: CandidateSpec[] = [];
  let modeIndex = 0;
  for (const [mode, specs] of groups) {
    const quota = Math.floor(cap / modeCount) + (modeIndex < cap % modeCount ? 1 : 0);
    picked.push(...balancedSpecs(specs, quota, seed, letterIndex, mode));
    modeIndex += 1;
  }
  return { specs: picked, rawTotal };
}

export function hasRequiredExactContact(
  spec: CandidateSpec,
  contacts: readonly Contact[],
  newOwner: number,
  targetOwner: number,
  sharedMinLength: number,
): boolean {
  for (const contact of contacts) {
    if (contact.oldOwner !== targetOwner || contact.newOwner !== newOwner) {
      continue;
    }
    if (spec.mode === 'shared') {
      if (contact.kind === 'shared' && contact.sharedLength + 1e-9 >= sharedMinLength) {
        return true;
      }
    } else if (spec.mode === 'cross') {
      if (contact.kind === 'cross' && contact.proper) {
        return true;
      }
    }
  }
  return false;
}

export interface OverlapScore {
  readonly score: number;
  readonly metrics: Record<string, unknown>;
  readonly contacts: readonly Contact[];
}

export function overlapScore(
  spec: CandidateSpec,
  transform: Transform,
  newStrokes: readonly Stroke[],
  oldStrokes: readonly Stroke[],
  oldBBox: BBox,
  centroid: Vec,
  contacts: readonly Contact[],
  variant: Variant,
  seed: bigint,
  letterIndex: number,
  candidateIndex: number,
  requiredMode: string,
  sharedMinLength: number,
): OverlapScore {
  const base = scoreCandidate(
    spec,
    transform,
    newStrokes,
    oldStrokes,
    oldBBox,
    centroid,
    contacts,
    variant,
    seed,
    letterIndex,
    candidateIndex,
  );
  const metrics = { ...base.metrics };
  let score = base.score;
  const newOwner = newStrokes[0]?.owner ?? -1;
  const crossLetter = contacts.filter((contact) => contact.oldOwner !== newOwner);
  const exact = crossLetter.filter((contact) =>
    (EXACT_KINDS as readonly string[]).includes(contact.kind),
  );
  const shared = crossLetter.filter((contact) => contact.kind === 'shared');
  const proper = crossLetter.filter((contact) => contact.kind === 'cross' && contact.proper);
  const near = crossLetter.filter((contact) => contact.kind === NEAR_KIND);

  const properUnique = new Set(
    proper.map(
      (contact) =>
        `${contact.newStrokeId}|${contact.oldStrokeId}|${roundTo(contact.point.x, 7)}|${roundTo(contact.point.y, 7)}`,
    ),
  );
  const targetShared = sharedByPair(
    shared.filter((contact) => contact.oldOwner === spec.target.owner),
  );
  const targetSharedTotal = [...targetShared.values()].reduce((sum, value) => sum + value, 0);
  const sharedTotal = [...sharedByPair(shared).values()].reduce((sum, value) => sum + value, 0);
  const contactedStrokes = new Set(exact.map((contact) => contact.oldStrokeId));
  const perpendicularity =
    proper.length > 0
      ? proper.reduce((sum, contact) => sum + Math.abs(Math.sin(contact.angle)), 0) /
        proper.length
      : 0;
  const span = Math.max(oldBBox.span, 1e-9);

  score += 0.35 * exact.length;
  score += 2.8 * Math.min(targetSharedTotal / span, 0.9);
  score += 2.6 * Math.min(sharedTotal / Math.max(span, 1e-9), 0.9);
  score += 0.9 * Math.min(properUnique.size, 2);
  score += 1.2 * perpendicularity;
  score -= 0.8 * near.length;
  score -= 1.8 * Math.max(0, properUnique.size - 1);
  score -= 0.9 * Math.max(0, contactedStrokes.size - 1);
  score -=
    1.2 *
    Math.max(0, Number(metrics.bbox_overlap_ratio_not_a_join ?? 0) - 0.1);
  score -= 0.7 * Math.max(0, Number(metrics.growth ?? 1) - 1.7);
  score -= 0.5 * Math.max(0, Number(metrics.aspect ?? 1) - 2);
  if (spec.mode === requiredMode) {
    score += 0.45;
  }
  if (spec.mode === 'cross') {
    score += 0.55 * perpendicularity;
  }

  Object.assign(metrics, {
    overlap_exact_contacts: exact.length,
    overlap_target_shared_total: roundTo(targetSharedTotal, 9),
    overlap_shared_total: roundTo(sharedTotal, 9),
    overlap_near_contacts: near.length,
    overlap_proper_crossings: properUnique.size,
    overlap_perpendicularity: roundTo(perpendicularity, 9),
    overlap_target_owner: spec.target.owner,
    overlap_target_stroke_id: spec.target.strokeId,
    overlap_required_mode: requiredMode,
    shared_min_length: sharedMinLength,
  });
  return { score, metrics, contacts };
}

export function chooseOverlapAttachment(
  spec: CandidateSpec,
  contacts: readonly Contact[],
  newOwner: number,
  placed: readonly PlacedLetter[],
): Record<string, unknown> {
  const exact = contacts.filter(
    (contact) =>
      contact.oldOwner !== newOwner &&
      (EXACT_KINDS as readonly string[]).includes(contact.kind),
  );
  if (exact.length === 0) {
    throw new Error('overlap candidate has no exact cross-letter contact');
  }
  const preferred = exact.filter((contact) => contact.oldOwner === spec.target.owner);
  const pool = preferred.length > 0 ? preferred : exact;
  const priority: Record<string, number> = { shared: 0, cross: 1, touch: 2 };
  const modePenalty = (contact: Contact): number => {
    if (spec.mode === 'shared' && contact.kind !== 'shared') {
      return 1;
    }
    if (spec.mode === 'cross' && !(contact.kind === 'cross' && contact.proper)) {
      return 1;
    }
    return 0;
  };
  const contact = [...pool].sort((left, right) => {
    return (
      modePenalty(left) - modePenalty(right) ||
      roundTo(left.point.sub(spec.target.pos).norm(), 9) -
        roundTo(right.point.sub(spec.target.pos).norm(), 9) ||
      (priority[left.kind] ?? 9) - (priority[right.kind] ?? 9) ||
      (left.kind < right.kind ? -1 : left.kind > right.kind ? 1 : 0) ||
      roundTo(left.point.x, 9) - roundTo(right.point.x, 9) ||
      roundTo(left.point.y, 9) - roundTo(right.point.y, 9)
    );
  })[0]!;
  return {
    from_letter: newOwner,
    from_char: spec.local.anchorId.split(':')[0],
    to_letter: contact.oldOwner,
    to_char: placed[contact.oldOwner]?.char ?? '',
    mode: spec.mode,
    exact: true,
    local_anchor: spec.local.asDict(),
    target_anchor: spec.target.ref(),
    actual_contact: {
      kind: contact.kind,
      exact: true,
      point: contact.point.asList(),
      new_stroke_id: contact.newStrokeId,
      old_stroke_id: contact.oldStrokeId,
      angle_deg: roundTo((contact.angle * 180) / Math.PI, 6),
      angle_rad: roundTo(contact.angle, 9),
      shared_length: roundTo(contact.sharedLength, 9),
      p0: contact.p0 ? contact.p0.asList() : null,
      p1: contact.p1 ? contact.p1.asList() : null,
    },
  };
}

export function collectContacts(strokes: readonly Stroke[]): Contact[] {
  const contacts: Contact[] = [];
  for (let index = 0; index < strokes.length; index += 1) {
    for (let other = index + 1; other < strokes.length; other += 1) {
      contacts.push(
        ...detectContacts(
          [strokes[index]!],
          [strokes[other]!],
          CONTACT_TOLERANCE,
          SHARED_MIN_LENGTH,
        ),
      );
    }
  }
  return [...new Map(contacts.map((contact) => [contact.key(), contact])).values()];
}

export function exactConnectivity(
  strokes: readonly Stroke[],
  contacts: readonly Contact[],
  letterCount: number,
): Record<string, unknown> {
  const exact = contacts.filter((contact) =>
    (EXACT_KINDS as readonly string[]).includes(contact.kind),
  );
  const near = contacts.filter((contact) => contact.kind === NEAR_KIND);
  const fullStrokes = componentCount(strokes, contacts);
  const fullLetters = letterComponentCount(letterCount, contacts);
  const exactStrokes = componentCount(strokes, exact);
  const exactLetters = letterComponentCount(letterCount, exact);
  const exactPairs = new Set(
    exact
      .filter((contact) => contact.newOwner !== contact.oldOwner)
      .map((contact) => {
        const low = Math.min(contact.newOwner, contact.oldOwner);
        const high = Math.max(contact.newOwner, contact.oldOwner);
        return `${low}|${high}`;
      }),
  );
  const nearPairs = new Set(
    near
      .filter((contact) => contact.newOwner !== contact.oldOwner)
      .map((contact) => {
        const low = Math.min(contact.newOwner, contact.oldOwner);
        const high = Math.max(contact.newOwner, contact.oldOwner);
        return `${low}|${high}`;
      }),
  );
  const nearOnlyPairs = [...nearPairs]
    .filter((pair) => !exactPairs.has(pair))
    .map((pair) => {
      const [a, b] = pair.split('|');
      return { letter_a: Number(a), letter_b: Number(b) };
    })
    .sort((left, right) => left.letter_a - right.letter_a || left.letter_b - right.letter_b);
  const byKind: Record<string, number> = {};
  for (const contact of contacts) {
    byKind[contact.kind] = (byKind[contact.kind] ?? 0) + 1;
  }
  const sortedByKind = Object.fromEntries(
    Object.entries(byKind).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
  );
  const span = BBox.fromPoints(strokes.flatMap((stroke) => stroke.points)).span;
  return {
    exact_contacts: exact.length,
    near_contacts: near.length,
    contacts_by_kind: sortedByKind,
    visual_divergence: contactVisualAudit(contacts, span),
    full_stroke_components: fullStrokes,
    full_letter_components: fullLetters,
    exact_stroke_components: exactStrokes,
    exact_letter_components: exactLetters,
    exact_connected_strokes: exactStrokes === 1,
    exact_connected_letters: exactLetters === 1,
    near_only_dependency: exactStrokes !== 1 || exactLetters !== 1,
    near_only_letter_pairs: nearOnlyPairs,
    near_is_never_used_for_attachments: true,
  };
}

export function reconstructStrokes(result: Record<string, any>): Map<string, Stroke> {
  const strokes = new Map<string, Stroke>();
  for (const letter of result.letters as any[]) {
    const glyph = getGlyph(String(letter.char));
    if (!glyph) {
      throw new Error(`missing glyph ${letter.char}`);
    }
    const data = letter.transform;
    const transform = new Transform(
      (Number(data.angle_deg) * Math.PI) / 180,
      Number(data.scale),
      Number(data.tx),
      Number(data.ty),
    );
    for (const stroke of glyph.worldStrokes(Number(letter.index), transform)) {
      strokes.set(stroke.strokeId, stroke);
    }
  }
  return strokes;
}

export function exactConnectivityForResult(
  result: Record<string, any>,
): Record<string, unknown> {
  const strokes = [...reconstructStrokes(result).values()];
  return exactConnectivity(strokes, collectContacts(strokes), result.letters.length);
}

export function generateOverlapSigil(
  source: string,
  variantKey: string,
  options: { seed?: bigint; sigilId?: string; candidateCap?: number } = {},
): Record<string, any> {
  const original = source;
  source = reduceIntention(source);
  if (!source) {
    throw new Error(`intention reduces to empty (no consonants): ${original}`);
  }
  if (source.length > 26) {
    throw new Error('source is limited to 26 letters');
  }
  const variant = getOverlapVariant(variantKey);
  for (const char of source) {
    if (!getGlyph(char)) {
      throw new Error(`unsupported character ${char}`);
    }
  }
  const seedValue = options.seed ?? stableSeed(source, variantKey, 'overlap-v1');
  const candidateCap = options.candidateCap ?? DEFAULT_CANDIDATE_CAP;
  const budget = new GenerationBudget(
    seedValue,
    candidateCap,
    TARGET_ANCHOR_CAP,
    Math.min(26, source.length),
  );
  const placed: PlacedLetter[] = [];

  const firstGlyph = getGlyph(source[0]!)!;
  const firstScale = variant.scaleBase;
  const firstCenter = firstGlyph.bounds.center;
  const firstTransform = new Transform(
    0,
    firstScale,
    -firstScale * firstCenter.x,
    -firstScale * firstCenter.y,
  );
  placed.push(buildLetter(0, source[0]!, firstTransform, firstGlyph));

  for (let index = 1; index < source.length; index += 1) {
    const char = source[index]!;
    const glyph = getGlyph(char)!;
    const scale = Math.max(0.38, variant.scaleBase * variant.scaleDecay ** index);
    const targets = targetAnchorsOverlap(placed, seedValue, index, budget.targetAnchorCap);
    if (targets.length === 0) {
      throw new Error(`no segment target anchors for letter ${index} (${char})`);
    }
    const oldStrokes = allStrokes(placed);
    const oldBBox = BBox.fromPoints(oldStrokes.flatMap((stroke) => stroke.points));
    const oldSamples = sampleStrokes(oldStrokes, 1);
    const centroid = new Vec(
      oldSamples.reduce((sum, point) => sum + point.x, 0) / Math.max(1, oldSamples.length),
      oldSamples.reduce((sum, point) => sum + point.y, 0) / Math.max(1, oldSamples.length),
    );
    const specResult = specsForVariant(
      glyph,
      targets,
      variant,
      seedValue,
      index,
      candidateCap,
    );
    budget.candidatesRaw += specResult.rawTotal;
    const requiredMode =
      variant.modeSchedule.length > 0
        ? variant.modeSchedule[(index - 1) % variant.modeSchedule.length]!
        : variant.modes[0]!;

    let best: PlacementCandidate | null = null;
    let bestRequired: PlacementCandidate | null = null;
    let bestRelaxed: PlacementCandidate | null = null;
    let bestRequiredRelaxed: PlacementCandidate | null = null;

    for (let candidateIndex = 0; candidateIndex < specResult.specs.length; candidateIndex += 1) {
      const spec = specResult.specs[candidateIndex]!;
      const positioned = transformFromAnchors(
        spec.local,
        spec.target,
        spec.mode,
        scale,
        spec.angleOffset,
        spec.slide,
      );
      const newStrokes = glyph.worldStrokes(index, positioned);
      const contacts = detectContacts(
        newStrokes,
        oldStrokes,
        CONTACT_TOLERANCE,
        SHARED_MIN_LENGTH,
      );
      if (
        !hasRequiredExactContact(
          spec,
          contacts,
          index,
          spec.target.owner,
          SHARED_MIN_LENGTH,
        )
      ) {
        continue;
      }
      const scoringContacts = detectPrototypeContacts(
        newStrokes,
        oldStrokes,
        CONTACT_TOLERANCE,
        SHARED_MIN_LENGTH,
      );
      const scored = overlapScore(
        spec,
        positioned,
        newStrokes,
        oldStrokes,
        oldBBox,
        centroid,
        scoringContacts,
        variant,
        seedValue,
        index,
        candidateIndex,
        requiredMode,
        SHARED_MIN_LENGTH,
      );
      budget.candidatesEvaluated += 1;
      const candidate = new PlacementCandidate(
        spec,
        positioned,
        newStrokes,
        contacts,
        scored.score,
        { ...scored.metrics },
      );
      candidate.metrics.required_mode = requiredMode;
      const maxCross = Number(candidate.metrics.max_crossings_per_new_stroke ?? 0);
      const shallow = Number(candidate.metrics.shallow_crossings ?? 0);
      const tangled = maxCross > 4 || shallow > 3;
      if (!tangled) {
        if (!best || candidate.score > best.score) {
          best = candidate;
        }
        if (
          spec.mode === requiredMode &&
          (!bestRequired || candidate.score > bestRequired.score)
        ) {
          bestRequired = candidate;
        }
      } else {
        candidate.relaxed = true;
        if (!bestRelaxed || candidate.score > bestRelaxed.score) {
          bestRelaxed = candidate;
        }
        if (
          spec.mode === requiredMode &&
          (!bestRequiredRelaxed || candidate.score > bestRequiredRelaxed.score)
        ) {
          bestRequiredRelaxed = candidate;
        }
      }
    }

    let chosen = bestRequired ?? best;
    if (!chosen) {
      chosen = bestRequiredRelaxed ?? bestRelaxed;
      if (chosen) {
        budget.fallbacks.push({
          letter_index: index,
          char,
          reason: 'all exact-overlap candidates exceeded tangle limits; used least-bad exact candidate',
          metrics: chosen.metrics,
        });
      }
    }
    if (!chosen) {
      throw new Error(`no exact overlap placement found for letter ${index} (${char})`);
    }
    if (chosen.spec.mode !== requiredMode) {
      budget.fallbacks.push({
        letter_index: index,
        char,
        reason: `required overlap mode ${requiredMode} unavailable; used ${chosen.spec.mode}`,
        metrics: chosen.metrics,
      });
    }

    const letter = buildLetter(index, char, chosen.transform, glyph);
    const attachment = chooseOverlapAttachment(
      chosen.spec,
      chosen.contacts,
      index,
      placed,
    );
    attachment.readability_rotation_deg = roundTo(
      (chosen.transform.angle * 180) / Math.PI,
      6,
    );
    attachment.candidate_score = roundTo(chosen.score, 9);
    const metricsSource = chosen.metrics;
    const candidateMetrics: Record<string, unknown> = {};
    for (const key of [
      'overlap_exact_contacts',
      'overlap_target_shared_total',
      'overlap_shared_total',
      'overlap_near_contacts',
      'overlap_proper_crossings',
      'overlap_perpendicularity',
      'overlap_target_owner',
      'overlap_target_stroke_id',
    ]) {
      if (key in metricsSource) {
        candidateMetrics[key] = metricsSource[key];
      }
    }
    attachment.candidate_metrics = candidateMetrics;
    letter.attachment = attachment;
    placed.push(letter);
  }

  const strokes = allStrokes(placed);
  const contacts = collectContacts(strokes);
  const connectivity = exactConnectivity(strokes, contacts, placed.length);
  if (
    Number(connectivity.full_stroke_components) !== 1 ||
    Number(connectivity.full_letter_components) !== 1
  ) {
    throw new Error(
      `generated full network disconnected: strokes=${connectivity.full_stroke_components}, letters=${connectivity.full_letter_components}`,
    );
  }
  const worldBBox = BBox.fromPoints(strokes.flatMap((stroke) => stroke.points));
  const sharedRecords = sharedProvenance(contacts, placed);
  const attachments = placed.slice(1).map((letter) => letter.attachment!);
  const attachmentPoints = new Set(
    attachments.map((record) => {
      const point = (record.actual_contact as any).point as [number, number];
      return `${roundTo(Number(point[0]), 6)}|${roundTo(Number(point[1]), 6)}`;
    }),
  );
  const properCross = contacts.filter(
    (contact) =>
      contact.kind === 'cross' && contact.proper && contact.newOwner !== contact.oldOwner,
  );
  const accidentalCrossings = properCross.filter(
    (contact) =>
      !attachmentPoints.has(
        `${roundTo(contact.point.x, 6)}|${roundTo(contact.point.y, 6)}`,
      ),
  );
  const modeCounts: Record<string, number> = {};
  for (const record of attachments) {
    const mode = String(record.mode);
    modeCounts[mode] = (modeCounts[mode] ?? 0) + 1;
  }
  const metrics = {
    letters_expected: source.length,
    letters_present: placed.length,
    stroke_components: Number(connectivity.full_stroke_components),
    letter_components: Number(connectivity.full_letter_components),
    actual_contacts: contacts.length,
    exact_contacts: Number(connectivity.exact_contacts),
    near_contacts: Number(connectivity.near_contacts),
    proper_crossings: new Set(
      properCross.map(
        (contact) =>
          `${contact.newStrokeId}|${contact.oldStrokeId}|${roundTo(contact.point.x, 7)}|${roundTo(contact.point.y, 7)}`,
      ),
    ).size,
    accidental_crossings: accidentalCrossings.length,
    shared_strokes: sharedRecords.length,
    shared_overlap_total: roundTo(
      sharedRecords.reduce((sum, record) => sum + Number(record.overlap_length), 0),
      9,
    ),
    attachment_mode_counts: modeCounts,
    fallback_count: budget.fallbacks.length,
    near_only_dependency: Boolean(connectivity.near_only_dependency),
    visual_divergence: connectivity.visual_divergence,
    bbox_overlap_is_not_used_for_connectivity: true,
  };
  const result: Record<string, any> = {
    schema: 'lunarz-overlap-sigil/1',
    sigil_id: options.sigilId ?? `${source.toLowerCase()}-${variant.key}`,
    intention: original,
    source,
    reduced_source: source,
    reduced_letters: [...source],
    variant: variant.key,
    variant_name: variant.name,
    policy: variant.policy,
    seed: seedValue.toString(),
    parameters: {
      contact_tolerance: CONTACT_TOLERANCE,
      shared_min_length: SHARED_MIN_LENGTH,
      candidate_cap_per_letter: candidateCap,
      target_anchor_cap: TARGET_ANCHOR_CAP,
      scale_min: 0.38,
      scale_sequence: `${variant.scaleBase} * ${variant.scaleDecay}^i, floor 0.38`,
      placement_modes: [...variant.modes],
      mode_schedule: [...variant.modeSchedule],
    },
    bounds: {
      ...worldBBox.asDict(),
      panel_width: 320,
      panel_height: 300,
    },
    letters: [],
    attachments,
    attachment_graph: {
      nodes: [...source].map((char, index) => ({ index, char })),
      edges: attachments,
    },
    shared_strokes: sharedRecords,
    contacts: [...contacts]
      .sort(
        (left, right) =>
          left.newOwner - right.newOwner ||
          left.oldOwner - right.oldOwner ||
          (left.kind < right.kind ? -1 : left.kind > right.kind ? 1 : 0) ||
          roundTo(left.point.x, 6) - roundTo(right.point.x, 6) ||
          roundTo(left.point.y, 6) - roundTo(right.point.y, 6),
      )
      .map((contact) => ({
        kind: contact.kind,
        new_stroke_id: contact.newStrokeId,
        old_stroke_id: contact.oldStrokeId,
        new_owner: contact.newOwner,
        old_owner: contact.oldOwner,
        point: contact.point.asList(),
        angle_deg: roundTo((contact.angle * 180) / Math.PI, 6),
        shared_length: roundTo(contact.sharedLength, 9),
        p0: contact.p0 ? contact.p0.asList() : null,
        p1: contact.p1 ? contact.p1.asList() : null,
        proper: contact.proper,
        exact: (EXACT_KINDS as readonly string[]).includes(contact.kind),
      })),
    exact_check: connectivity,
    metrics,
    budget: budget.asDict(),
  };
  result.letters = placed.map((letter) => ({
    index: letter.index,
    char: letter.char,
    transform: letter.transform.asDict(),
    svg_matrix: letter.transform.svgMatrix(),
    bbox: letter.bbox.asDict(),
    local_strokes: letter.glyph.strokes.map((stroke, index) => ({
      index,
      closed: stroke.closed,
      points: stroke.points.map((point) => point.asList()),
    })),
    anchors: letter.anchors.map((anchor) => anchor.asDict()),
    attachment: letter.attachment,
  }));
  result.full_verification = verifyResult(result);
  return result;
}
