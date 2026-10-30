import { describe, expect, it } from 'vitest';

import { detectContacts } from '../generator';

import {
  BBox,
  Segment,
  Stroke,
  Transform,
  Vec,
  collinearOverlap,
  pointSegmentDistance,
  sampleStrokes,
  segmentIntersection,
  stableSeed,
  stableUnit,
} from '../geometry';

describe('prototype geometry primitives', () => {
  it('matches Python stable_seed and stable_unit for known reference parts', () => {
    expect(stableSeed('calm', 'size-spine', 'size-hierarchy-v1')).toBe(
      14759392546341412399n,
    );
    expect(stableSeed('B', 'size-spine', 'size-hierarchy-v1')).toBe(
      4948922214697012294n,
    );
    expect(stableUnit('calm', 'size-spine', 'size-hierarchy-v1')).toBeCloseTo(
      0.800108273165486,
      15,
    );
    expect(stableUnit('BCDFGHJKLMN', 'size-spine', 'size-hierarchy-v1')).toBeCloseTo(
      0.13273713729772615,
      15,
    );
  });

  it('keeps vector arithmetic and transforms in the prototype coordinate space', () => {
    const left = new Vec(3, 4);
    const right = new Vec(-1, 2);

    expect(left.add(right).asList()).toEqual([2, 6]);
    expect(left.sub(right).asList()).toEqual([4, 2]);
    expect(left.dot(right)).toBe(5);
    expect(left.cross(right)).toBe(10);
    expect(left.norm()).toBe(5);
    expect(left.unit().norm()).toBeCloseTo(1, 15);

    const transform = new Transform(Math.PI / 2, 2, 5, -3);
    const point = transform.apply(new Vec(1, 0));

    expect(point.x).toBeCloseTo(5, 12);
    expect(point.y).toBeCloseTo(-1, 12);
    expect(transform.svgMatrix()).toBe(
      'matrix(0.000000000 2.000000000 -2.000000000 0.000000000 5.000000000 -3.000000000)',
    );
  });

  it('detects intersections, collinear overlaps and nearest points', () => {
    const horizontal = new Segment(new Vec(0, 0), new Vec(2, 0), 'a', 0);
    const vertical = new Segment(new Vec(1, -1), new Vec(1, 1), 'b', 0);
    const overlap = new Segment(new Vec(0.5, 0), new Vec(1.5, 0), 'c', 0);

    const hit = segmentIntersection(horizontal, vertical);
    expect(hit).not.toBeNull();
    expect(hit![0].x).toBeCloseTo(1, 12);
    expect(hit![0].y).toBeCloseTo(0, 12);
    expect(hit![1]).toBeCloseTo(0.5, 12);
    expect(hit![2]).toBeCloseTo(0.5, 12);

    const shared = collinearOverlap(horizontal, overlap, 0.032, 0.075);
    expect(shared).not.toBeNull();
    expect(shared![2]).toBeCloseTo(1, 12);

    const [distance, t, nearest] = pointSegmentDistance(
      new Vec(0.5, 2),
      new Vec(0, 0),
      new Vec(2, 0),
    );
    expect(distance).toBeCloseTo(2, 12);
    expect(t).toBeCloseTo(0.25, 12);
    expect(nearest.x).toBeCloseTo(0.5, 12);
  });

  it('only treats mathematically coincident collinear segments as exact shared', () => {
    const base = new Segment(new Vec(0, 0), new Vec(1, 0), 'base', 0);
    const offset = new Segment(new Vec(0, 0.02), new Vec(1, 0.02), 'offset', 0);
    const exact = new Segment(new Vec(0.2, 0), new Vec(0.8, 0), 'exact', 0);
    const reversed = new Segment(new Vec(0.8, 0), new Vec(0.2, 0), 'reversed', 0);
    const angle = (5 * Math.PI) / 180;
    const angledOffset = new Segment(
      new Vec(0, 0.02),
      new Vec(Math.cos(angle), 0.02 + Math.sin(angle)),
      'angled-offset',
      0,
    );
    const angledExactFirst = new Segment(new Vec(0, 0), new Vec(1, 1), 'angled-a', 0);
    const angledExactSecond = new Segment(
      new Vec(0.2, 0.2),
      new Vec(0.8, 0.8),
      'angled-b',
      0,
    );

    expect(collinearOverlap(base, exact, 0.032, 0.075)).not.toBeNull();
    expect(collinearOverlap(base, reversed, 0.032, 0.075)).not.toBeNull();
    expect(collinearOverlap(base, offset, 0.032, 0.075)).toBeNull();
    expect(collinearOverlap(base, angledOffset, 0.032, 0.075)).toBeNull();
    expect(collinearOverlap(angledExactFirst, angledExactSecond, 0.032, 0.075)).not.toBeNull();
  });

  it('keeps offset endpoints as near diagnostics and never as exact shared joins', () => {
    const base = new Segment(new Vec(0, 0), new Vec(1, 0), 'base', 0);
    const offset = new Segment(new Vec(0, 0.02), new Vec(1, 0.02), 'offset', 0);

    const contacts = detectContacts(
      [new Stroke('offset', offset.p1 ? [offset.p0, offset.p1] : [])],
      [new Stroke('base', [base.p0, base.p1])],
      0.032,
      0.075,
    );

    expect(contacts.filter((contact) => contact.kind === 'shared')).toHaveLength(0);
    expect(contacts.some((contact) => contact.kind === 'near')).toBe(true);
  });

  it('builds bounds and samples every segment endpoint', () => {
    const box = BBox.fromPoints([
      new Vec(-1, 2),
      new Vec(3, -4),
      new Vec(0, 0),
    ]);

    expect(box.asDict()).toMatchObject({
      min_x: -1,
      min_y: -4,
      max_x: 3,
      max_y: 2,
      width: 4,
      height: 6,
    });
    expect(box.center.asList()).toEqual([1, -1]);
    expect(box.span).toBe(6);
    expect(box.expanded(1).intersectionArea(box)).toBe(24);

    const stroke = {
      segments: () => [new Segment(new Vec(0, 0), new Vec(1, 0), 'a', 0)],
    };
    expect(sampleStrokes([stroke as never], 2)).toHaveLength(3);
  });
});
