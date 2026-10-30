import {
  BBox,
  Transform,
  Vec,
  roundTo,
  sampleStrokes,
  stableSeed,
} from './geometry';
import {
  CandidateSpec,
  Contact,
  GenerationBudget,
  NetworkAnchor,
  INTENTIONS,
  PlacementCandidate,
  PlacedLetter,
  Variant,
  buildLetter,
  detectContacts,
  detectPrototypeContacts,
  reduceIntention,
  sharedProvenance,
  transformFromAnchors,
  verifyResult,
} from './generator';
import { getGlyph, type Glyph } from './glyphs';
import {
  EXACT_KINDS,
  balancedSpecs,
  collectContacts,
  exactConnectivity,
  overlapScore,
  targetAnchorsOverlap,
} from './overlap';

export const CONTACT_TOLERANCE = 0.032;
export const SHARED_MIN_LENGTH = 0.075;
export const TARGET_ANCHOR_CAP = 20;
export const DEFAULT_CANDIDATE_CAP = 150;
export const SCALE_FLOOR = 0.55;
export const SEED_DOMAIN = 'size-hierarchy-v1';

export interface SizeVariant {
  readonly key: string;
  readonly name: string;
  readonly policy: string;
  readonly scale_recipe: string;
}

export function scaleForVariant(variantKey: string, index: number, total: number): number {
  if (variantKey === 'size-spine') {
    if (index === 0) {
      return 1.22;
    }
    return Math.max(SCALE_FLOOR, roundTo(0.72 - 0.015 * index, 6));
  }
  if (variantKey === 'size-steps') {
    if (total <= 1) {
      return 1.15;
    }
    return Math.max(
      SCALE_FLOOR,
      roundTo(1.22 - ((1.22 - 0.58) * index) / (total - 1), 6),
    );
  }
  if (variantKey === 'size-anchor') {
    if (index === 0) {
      return 1.12;
    }
    if (index === total - 1 && total > 1) {
      return 0.92;
    }
    return Math.max(0.58, roundTo(0.72 - 0.02 * index, 6));
  }
  throw new Error(`unknown size-hierarchy variant ${variantKey}`);
}

export const SIZE_VARIANTS: readonly SizeVariant[] = [
  {
    key: 'size-spine',
    name: 'Spine Dominant',
    policy:
      'parallel shared-stroke joins; letter 1 is a large spine (1.22), rest small (~0.70-0.60) sharing part of it',
    scale_recipe: 's0=1.22, s[i>0]=max(0.60, 0.72-0.015*i)',
  },
  {
    key: 'size-steps',
    name: 'Graduated Steps',
    policy:
      'parallel shared-stroke joins; full staircase 1.22 down to 0.58 across the word',
    scale_recipe: 's[i]=1.22-(0.64)*i/(n-1), linear 1.22->0.58',
  },
  {
    key: 'size-anchor',
    name: 'Dual Anchor',
    policy:
      'parallel shared-stroke joins; large spine (1.12) + medium end anchor (0.92), small middle letters',
    scale_recipe: 's0=1.12, s[last]=0.92, middle=max(0.58, 0.72-0.02*i)',
  },
];

export const VARIANT_KEYS = SIZE_VARIANTS.map((variant) => variant.key);

export function getSizeVariant(key: string): SizeVariant {
  const variant = SIZE_VARIANTS.find((candidate) => candidate.key === key);
  if (!variant) {
    throw new Error(`unknown size-hierarchy variant ${key}`);
  }
  return variant;
}

export function specsSharedOnly(
  glyph: Glyph,
  targets: readonly NetworkAnchor[],
  seed: bigint,
  letterIndex: number,
  cap: number,
): { specs: CandidateSpec[]; rawTotal: number } {
  const localGroup = glyph.anchors.filter((anchor) => anchor.kind === 'segment');
  const targetGroup = targets.filter((anchor) => anchor.kind === 'segment');
  const specs: CandidateSpec[] = [];
  for (const local of localGroup) {
    for (const target of targetGroup) {
      const targetLength = Math.max(0.05, target.segmentLength);
      for (const fraction of [0, 0.22, -0.22, 0.4, -0.4, 0.6, -0.6]) {
        specs.push(
          new CandidateSpec('shared', local, target, 0, fraction * targetLength),
        );
      }
    }
  }
  const rawTotal = specs.length;
  const picked = balancedSpecs(specs, cap, seed, letterIndex, 'shared');
  return { specs: picked, rawTotal };
}

function hasExactShared(
  contacts: readonly Contact[],
  newOwner: number,
  targetOwner: number,
): boolean {
  for (const contact of contacts) {
    if (contact.oldOwner !== targetOwner || contact.newOwner !== newOwner) {
      continue;
    }
    if (
      contact.kind === 'shared' &&
      contact.sharedLength + 1e-9 >= SHARED_MIN_LENGTH
    ) {
      return true;
    }
  }
  return false;
}

const SHIM = new Variant(
  'size-hierarchy',
  '',
  '',
  ['shared'],
  { shared: 4.5 },
  1,
  1,
  0,
  'weave',
  ['shared'],
);

function minimumContact(
  contacts: readonly Contact[],
  target: NetworkAnchor,
): Contact {
  return [...contacts].sort((left, right) => {
    return (
      left.point.sub(target.pos).norm() - right.point.sub(target.pos).norm() ||
      roundTo(left.point.x, 9) - roundTo(right.point.x, 9) ||
      roundTo(left.point.y, 9) - roundTo(right.point.y, 9)
    );
  })[0]!;
}

export interface SizeHierarchyOptions {
  readonly seed?: bigint;
  readonly sigilId?: string;
  readonly candidateCap?: number;
  readonly intention?: string;
  readonly requireAllStrokesExact?: boolean;
  readonly spineIndex?: number;
}

export function spineOrder(total: number, spineIndex = 0): number[] {
  if (total <= 0) {
    return [];
  }
  const raw = Number.isFinite(spineIndex) ? Math.trunc(spineIndex) : 0;
  const spine = Math.max(0, Math.min(total - 1, raw));
  const order = [spine];
  for (let index = 0; index < total; index += 1) {
    if (index !== spine) {
      order.push(index);
    }
  }
  return order;
}

export function generateSizeSigil(
  source: string,
  variantKey: string,
  options: SizeHierarchyOptions = {},
): Record<string, any> {
  const original = options.intention ?? source;
  source = reduceIntention(source);
  if (!source) {
    throw new Error(`intention reduces to empty (no consonants): ${original}`);
  }
  if (source.length > 26) {
    throw new Error('source is limited to 26 letters');
  }
  getSizeVariant(variantKey);
  for (const char of source) {
    if (!getGlyph(char)) {
      throw new Error(`unsupported character ${char}`);
    }
  }

  const seedValue = options.seed ?? stableSeed(source, variantKey, SEED_DOMAIN);
  const candidateCap = options.candidateCap ?? DEFAULT_CANDIDATE_CAP;
  const budget = new GenerationBudget(
    seedValue,
    candidateCap,
    TARGET_ANCHOR_CAP,
    Math.min(26, source.length),
  );
  const placed: PlacedLetter[] = [];
  const total = source.length;
  const placementOrder = spineOrder(total, options.spineIndex ?? 0);
  const effectiveSpine = placementOrder[0] ?? 0;
  const placementSource = placementOrder
    .map((originalIndex) => source[originalIndex]!)
    .join('');
  const scales = Array.from({ length: total }, (_, index) =>
    scaleForVariant(variantKey, index, total),
  );

  const firstGlyph = getGlyph(placementSource[0]!)!;
  const firstCenter = firstGlyph.bounds.center;
  const firstTransform = new Transform(
    0,
    scales[0]!,
    -scales[0]! * firstCenter.x,
    -scales[0]! * firstCenter.y,
  );
  placed.push(buildLetter(0, placementSource[0]!, firstTransform, firstGlyph));

  for (let index = 1; index < total; index += 1) {
    const char = placementSource[index]!;
    const glyph = getGlyph(char)!;
    const scale = scales[index]!;
    const targets = targetAnchorsOverlap(
      placed,
      seedValue,
      index,
      budget.targetAnchorCap,
    );
    if (targets.length === 0) {
      throw new Error(`no segment target anchors for letter ${index} (${char})`);
    }
    const oldStrokes = placed.flatMap((letter) => letter.strokes);
    const oldBBox = BBox.fromPoints(oldStrokes.flatMap((stroke) => stroke.points));
    const oldSamples = sampleStrokes(oldStrokes, 1);
    const centroid = new Vec(
      oldSamples.reduce((sum, point) => sum + point.x, 0) /
        Math.max(1, oldSamples.length),
      oldSamples.reduce((sum, point) => sum + point.y, 0) /
        Math.max(1, oldSamples.length),
    );
    const specResult = specsSharedOnly(
      glyph,
      targets,
      seedValue,
      index,
      candidateCap,
    );
    budget.candidatesRaw += specResult.rawTotal;

    let best: PlacementCandidate | null = null;
    let bestRelaxed: PlacementCandidate | null = null;
    for (
      let candidateIndex = 0;
      candidateIndex < specResult.specs.length;
      candidateIndex += 1
    ) {
      const spec = specResult.specs[candidateIndex]!;
      const transform = transformFromAnchors(
        spec.local,
        spec.target,
        spec.mode,
        scale,
        spec.angleOffset,
        spec.slide,
      );
      const newStrokes = glyph.worldStrokes(index, transform);
      const contacts = detectContacts(
        newStrokes,
        oldStrokes,
        CONTACT_TOLERANCE,
        SHARED_MIN_LENGTH,
      );
      if (!hasExactShared(contacts, index, spec.target.owner)) {
        continue;
      }
      if (options.requireAllStrokesExact) {
        const covered = new Set<string>();
        for (const contact of contacts) {
          if (
            contact.newOwner === index &&
            contact.oldOwner !== index &&
            (EXACT_KINDS as readonly string[]).includes(contact.kind)
          ) {
            covered.add(contact.newStrokeId);
          }
        }
        if (!newStrokes.every((stroke) => covered.has(stroke.strokeId))) {
          continue;
        }
      }
      const scoringContacts = detectPrototypeContacts(
        newStrokes,
        oldStrokes,
        CONTACT_TOLERANCE,
        SHARED_MIN_LENGTH,
      );
      const scored = overlapScore(
        spec,
        transform,
        newStrokes,
        oldStrokes,
        oldBBox,
        centroid,
        scoringContacts,
        SHIM,
        seedValue,
        index,
        candidateIndex,
        'shared',
        SHARED_MIN_LENGTH,
      );
      const score = scored.score + (spec.target.owner === 0 ? 0.6 : 0);
      budget.candidatesEvaluated += 1;
      const candidate = new PlacementCandidate(
        spec,
        transform,
        newStrokes,
        contacts,
        score,
        { ...scored.metrics },
      );
      const maxCross = Number(candidate.metrics.max_crossings_per_new_stroke ?? 0);
      const shallow = Number(candidate.metrics.shallow_crossings ?? 0);
      if (!(maxCross > 4 || shallow > 3)) {
        if (!best || candidate.score > best.score) {
          best = candidate;
        }
      } else {
        candidate.relaxed = true;
        if (!bestRelaxed || candidate.score > bestRelaxed.score) {
          bestRelaxed = candidate;
        }
      }
    }

    const chosen = best ?? bestRelaxed;
    if (!chosen) {
      throw new Error(`no exact parallel-shared placement for letter ${index} (${char})`);
    }
    if (best === null && chosen === bestRelaxed) {
      budget.fallbacks.push({
        letter_index: index,
        char,
        reason:
          'all parallel-shared candidates exceeded tangle limits; used least-bad exact candidate',
        metrics: chosen.metrics,
      });
    }

    const letter = buildLetter(index, char, chosen.transform, glyph);
    const shared = chosen.contacts.filter(
      (contact) =>
        contact.oldOwner !== index &&
        contact.kind === 'shared' &&
        contact.sharedLength + 1e-9 >= SHARED_MIN_LENGTH,
    );
    if (shared.length === 0) {
      throw new Error(`no exact shared interval for letter ${index} (${char})`);
    }
    const preferred = shared.filter(
      (contact) => contact.oldOwner === chosen.spec.target.owner,
    );
    const pool = preferred.length > 0 ? preferred : shared;
    const contact = minimumContact(pool, chosen.spec.target);
    const toChar = placed[contact.oldOwner]?.char ?? '';
    letter.attachment = {
      from_letter: index,
      from_char: chosen.spec.local.anchorId.split(':')[0],
      to_letter: contact.oldOwner,
      to_char: toChar,
      mode: 'shared',
      exact: true,
      local_anchor: chosen.spec.local.asDict(),
      target_anchor: {
        ...chosen.spec.target.ref(),
        stroke_index: chosen.spec.target.strokeIndex,
        segment_index: chosen.spec.target.segmentIndex,
      },
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
      readability_rotation_deg: roundTo(
        (chosen.transform.angle * 180) / Math.PI,
        6,
      ),
      candidate_score: roundTo(chosen.score, 9),
    };
    placed.push(letter);
  }

  const allStrokes = placed.flatMap((letter) => letter.strokes);
  const allContacts = collectContacts(allStrokes);
  const connectivity = exactConnectivity(allStrokes, allContacts, placed.length);
  if (
    Number(connectivity.full_stroke_components) !== 1 ||
    Number(connectivity.full_letter_components) !== 1
  ) {
    throw new Error('generated full network disconnected');
  }
  if (Boolean(connectivity.near_only_dependency)) {
    throw new Error('size-hierarchy layout depends on near-only connectivity');
  }

  const worldBBox = BBox.fromPoints(allStrokes.flatMap((stroke) => stroke.points));
  const sharedRecords = sharedProvenance(allContacts, placed);
  const attachments = placed.slice(1).map((letter) => letter.attachment!);
  const spineJoins = attachments.filter(
    (attachment) =>
      Number(attachment.to_letter) === 0 || Number(attachment.from_letter) === 0,
  ).length;
  const variant = getSizeVariant(variantKey);

  const result: Record<string, any> = {
    schema: 'lunarz-size-hierarchy-sigil/1',
    sigil_id: options.sigilId ?? `${source.toLowerCase()}-${variantKey}`,
    intention: original,
    source,
    reduced_source: source,
    reduced_letters: [...source],
    variant: variantKey,
    variant_name: variant.name,
    policy: variant.policy,
    scale_recipe: variant.scale_recipe,
    seed: seedValue.toString(),
    seed_domain: SEED_DOMAIN,
    placement: 'parallel-aligned overlap only (shared collinear intervals, angle 0)',
    parameters: {
      contact_tolerance: CONTACT_TOLERANCE,
      shared_min_length: SHARED_MIN_LENGTH,
      candidate_cap_per_letter: candidateCap,
      target_anchor_cap: TARGET_ANCHOR_CAP,
      scale_floor: SCALE_FLOOR,
      placement_modes: ['shared'],
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
    contacts: [...allContacts]
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
    metrics: {},
    budget: budget.asDict(),
  };

  result.letters = placed.map((letter) => ({
    index: letter.index,
    char: letter.char,
    transform: letter.transform.asDict(),
    scale: roundTo(letter.transform.scale, 9),
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

  const perLetterScales = result.letters.map((letter: any) => Number(letter.scale));
  result.metrics = {
    letters_expected: source.length,
    letters_present: placed.length,
    stroke_components: 1,
    letter_components: 1,
    actual_contacts: allContacts.length,
    exact_contacts: Number(connectivity.exact_contacts),
    near_contacts: Number(connectivity.near_contacts),
    shared_strokes: sharedRecords.length,
    shared_overlap_total: roundTo(
      sharedRecords.reduce((sum, record) => sum + Number(record.overlap_length), 0),
      9,
    ),
    attachment_mode_counts: { shared: attachments.length },
    fallback_count: budget.fallbacks.length,
    near_only_dependency: Boolean(connectivity.near_only_dependency),
    visual_divergence: connectivity.visual_divergence,
    bbox_overlap_is_not_used_for_connectivity: true,
    per_letter_scales: perLetterScales,
    scale_min: roundTo(Math.min(...perLetterScales), 9),
    scale_max: roundTo(Math.max(...perLetterScales), 9),
    scale_range: roundTo(
      Math.max(...perLetterScales) - Math.min(...perLetterScales),
      9,
    ),
    scale_ratio: roundTo(
      Math.max(...perLetterScales) / Math.max(Math.min(...perLetterScales), 1e-9),
      9,
    ),
    scale_unique_count: new Set(
      perLetterScales.map((scale: number) => roundTo(scale, 6)),
    ).size,
    spine_letter: 0,
    spine_scale: perLetterScales[0],
    spine_joins: spineJoins,
  };
  if (placementOrder.every((value, index) => value === index)) {
    result.full_verification = verifyResult(result);
  }
  return remapSpineResult(result, placementOrder, effectiveSpine);
}

function remapSpineResult(
  result: Record<string, any>,
  placementOrder: readonly number[],
  spineIndex: number,
): Record<string, any> {
  if (placementOrder.every((value, index) => value === index)) {
    return result;
  }

  const remapOwner = (value: unknown): number => {
    const step = Number(value);
    return Number.isInteger(step) && step >= 0 && step < placementOrder.length
      ? placementOrder[step]!
      : step;
  };
  const remapStrokeId = (value: unknown): unknown => {
    if (typeof value !== 'string') {
      return value;
    }
    const colon = value.indexOf(':');
    if (colon <= 0) {
      return value;
    }
    const ownerText = value.slice(0, colon);
    if (!/^\d+$/.test(ownerText)) {
      return value;
    }
    const step = Number(ownerText);
    if (!Number.isInteger(step) || step < 0 || step >= placementOrder.length) {
      return value;
    }
    return `${placementOrder[step]}${value.slice(colon)}`;
  };
  const remapAttachment = (attachment: any): any => {
    if (!attachment) {
      return attachment;
    }
    const targetAnchor = attachment.target_anchor
      ? {
          ...attachment.target_anchor,
          owner: remapOwner(attachment.target_anchor.owner),
          stroke_id: remapStrokeId(attachment.target_anchor.stroke_id),
          anchor_id: remapStrokeId(attachment.target_anchor.anchor_id),
        }
      : attachment.target_anchor;
    const actualContact = attachment.actual_contact
      ? {
          ...attachment.actual_contact,
          new_stroke_id: remapStrokeId(attachment.actual_contact.new_stroke_id),
          old_stroke_id: remapStrokeId(attachment.actual_contact.old_stroke_id),
        }
      : attachment.actual_contact;
    return {
      ...attachment,
      from_letter: remapOwner(attachment.from_letter),
      to_letter: remapOwner(attachment.to_letter),
      target_anchor: targetAnchor,
      actual_contact: actualContact,
    };
  };

  const lettersByOriginalIndex = new Map<number, any>();
  for (const record of result.letters as any[]) {
    const step = Number(record.index);
    const originalIndex = placementOrder[step]!;
    lettersByOriginalIndex.set(originalIndex, {
      ...record,
      index: originalIndex,
      anchors: (record.anchors as any[]).map((anchor) => ({
        ...anchor,
        owner: remapOwner(anchor.owner),
        stroke_id: remapStrokeId(anchor.stroke_id),
        id: remapStrokeId(anchor.id),
      })),
      attachment: remapAttachment(record.attachment),
    });
  }
  const letters = [...lettersByOriginalIndex.keys()]
    .sort((left, right) => left - right)
    .map((index) => lettersByOriginalIndex.get(index)!);

  const attachments = (result.attachments as any[])
    .map((attachment) => remapAttachment(attachment))
    .sort(
      (left, right) =>
        Number(left.from_letter) - Number(right.from_letter) ||
        Number(left.to_letter) - Number(right.to_letter),
    );

  const sharedStrokes = (result.shared_strokes as any[])
    .map((record) => ({
      ...record,
      letter_a: remapOwner(record.letter_a),
      letter_b: remapOwner(record.letter_b),
      new_stroke_id: remapStrokeId(record.new_stroke_id),
      old_stroke_id: remapStrokeId(record.old_stroke_id),
    }))
    .sort(
      (left, right) =>
        Number(left.letter_a) - Number(right.letter_a) ||
        Number(left.letter_b) - Number(right.letter_b) ||
        String(left.new_stroke_id).localeCompare(String(right.new_stroke_id)) ||
        String(left.old_stroke_id).localeCompare(String(right.old_stroke_id)),
    );

  const contacts = (result.contacts as any[])
    .map((contact) => ({
      ...contact,
      new_owner: remapOwner(contact.new_owner),
      old_owner: remapOwner(contact.old_owner),
      new_stroke_id: remapStrokeId(contact.new_stroke_id),
      old_stroke_id: remapStrokeId(contact.old_stroke_id),
    }))
    .sort(
      (left, right) =>
        Number(left.new_owner) - Number(right.new_owner) ||
        Number(left.old_owner) - Number(right.old_owner) ||
        (left.kind < right.kind ? -1 : left.kind > right.kind ? 1 : 0) ||
        roundTo(Number(left.point[0]), 6) - roundTo(Number(right.point[0]), 6) ||
        roundTo(Number(left.point[1]), 6) - roundTo(Number(right.point[1]), 6),
    );

  const placementScales = result.metrics.per_letter_scales as number[];
  const perLetterScales = new Array<number>(placementOrder.length);
  for (let step = 0; step < placementOrder.length; step += 1) {
    perLetterScales[placementOrder[step]!] = placementScales[step]!;
  }
  const normalizedSpine = Math.max(
    0,
    Math.min(placementOrder.length - 1, Math.trunc(spineIndex)),
  );
  const spineJoins = attachments.filter(
    (attachment) =>
      Number(attachment.from_letter) === normalizedSpine ||
      Number(attachment.to_letter) === normalizedSpine,
  ).length;
  result.letters = letters;
  result.attachments = attachments;
  result.attachment_graph = {
    ...result.attachment_graph,
    edges: attachments,
  };
  result.shared_strokes = sharedStrokes;
  result.contacts = contacts;
  result.metrics = {
    ...result.metrics,
    per_letter_scales: perLetterScales,
    scale_min: roundTo(Math.min(...perLetterScales), 9),
    scale_max: roundTo(Math.max(...perLetterScales), 9),
    scale_range: roundTo(
      Math.max(...perLetterScales) - Math.min(...perLetterScales),
      9,
    ),
    scale_ratio: roundTo(
      Math.max(...perLetterScales) / Math.max(Math.min(...perLetterScales), 1e-9),
      9,
    ),
    scale_unique_count: new Set(
      perLetterScales.map((scale) => roundTo(scale, 6)),
    ).size,
    spine_letter: normalizedSpine,
    spine_scale: perLetterScales[normalizedSpine],
    spine_joins: spineJoins,
  };
  result.full_verification = verifyResult(result);
  return result;
}

export function generateSizeHierarchyAll(
  candidateCap = DEFAULT_CANDIDATE_CAP,
): Record<string, any>[] {
  const results: Record<string, any>[] = [];
  for (const intention of INTENTIONS) {
    const raw = intention.intention || intention.label || intention.source;
    for (const variant of SIZE_VARIANTS) {
      const seed = stableSeed(intention.id, variant.key, SEED_DOMAIN);
      const result = generateSizeSigil(raw, variant.key, {
        seed,
        sigilId: `${intention.id}-${variant.key}`,
        candidateCap,
      });
      if (result.source !== intention.source) {
        throw new Error(`reduced mismatch for ${intention.id}`);
      }
      result.intention_id = intention.id;
      result.intention_label = intention.label;
      result.length_class = intention.lengthClass;
      result.brief = intention.brief;
      results.push(result);
    }
  }
  return results;
}
