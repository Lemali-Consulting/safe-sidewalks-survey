import { describe, it, expect } from 'vitest'
import {
  toLocalMeters,
  nearestPointOnSegment,
  nearestOnLineString,
  computeBlockCompletion,
  type BlockInput,
  type CompletionOptions,
} from './geometry'

describe('toLocalMeters', () => {
  it('converts a 0.001° latitude step to ~111 m', () => {
    const a = toLocalMeters(-80, 40.44, 40.44)
    const b = toLocalMeters(-80, 40.441, 40.44)
    expect(b.y - a.y).toBeCloseTo(111.32, 1)
    expect(b.x - a.x).toBeCloseTo(0, 5)
  })

  it('shrinks east-west distance by cos(refLat)', () => {
    const a = toLocalMeters(-80, 40.44, 40.44)
    const b = toLocalMeters(-79.999, 40.44, 40.44)
    // 111320 * cos(40.44°) * 0.001 ≈ 84.7 m
    expect(b.x - a.x).toBeCloseTo(84.7, 0)
  })
})

describe('nearestPointOnSegment', () => {
  it('assigns positive signed offset to points on the left of A→B', () => {
    // A→B points north (y+). Point west of the segment is on the left.
    const r = nearestPointOnSegment(-1, 5, 0, 0, 0, 10)
    expect(r.distance).toBeCloseTo(1, 5)
    expect(r.signedOffset).toBeCloseTo(1, 5)
    expect(r.t).toBeCloseTo(0.5, 5)
  })

  it('assigns negative signed offset to points on the right of A→B', () => {
    const r = nearestPointOnSegment(1, 5, 0, 0, 0, 10)
    expect(r.distance).toBeCloseTo(1, 5)
    expect(r.signedOffset).toBeCloseTo(-1, 5)
  })

  it('clamps t to [0,1] and returns endpoint distance for points past B', () => {
    const r = nearestPointOnSegment(0, 15, 0, 0, 0, 10)
    expect(r.t).toBe(1)
    expect(r.distance).toBeCloseTo(5, 5)
  })

  it('returns the point-to-point distance for a degenerate segment', () => {
    const r = nearestPointOnSegment(3, 4, 0, 0, 0, 0)
    expect(r.distance).toBeCloseTo(5, 5)
  })
})

describe('nearestOnLineString', () => {
  it('picks the closest segment in a multi-segment polyline', () => {
    const coords = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]
    const r = nearestOnLineString({ x: 11, y: 5 }, coords)
    expect(r).not.toBeNull()
    expect(r!.segmentIndex).toBe(1)
    expect(r!.distance).toBeCloseTo(1, 5)
  })

  it('returns null for a polyline with fewer than 2 points', () => {
    expect(nearestOnLineString({ x: 0, y: 0 }, [])).toBeNull()
    expect(nearestOnLineString({ x: 0, y: 0 }, [{ x: 1, y: 1 }])).toBeNull()
  })
})

describe('computeBlockCompletion', () => {
  const block: BlockInput = {
    id: 'block-1',
    lines: [
      [
        [-80, 40.44],
        [-80, 40.441],
      ],
    ],
  }
  const opts: CompletionOptions = {
    matchDistanceM: 15,
    centerlineThresholdM: 1,
    refLat: 40.44,
  }

  it('marks the right side when a point is east of a north-going block', () => {
    // 5 m east of the midpoint (lng +0.00006 ≈ 5.08 m at this latitude).
    const status = computeBlockCompletion([block], [[-79.99994, 40.4405]], opts)
    const s = status.get('block-1')
    expect(s).toBeDefined()
    expect(s!.right).toBe(true)
    expect(s!.left).toBe(false)
  })

  it('marks the left side when a point is west of a north-going block', () => {
    const status = computeBlockCompletion([block], [[-80.00006, 40.4405]], opts)
    const s = status.get('block-1')!
    expect(s.left).toBe(true)
    expect(s.right).toBe(false)
  })

  it('marks both sides when a point lies within the centerline threshold', () => {
    const status = computeBlockCompletion([block], [[-80, 40.4405]], opts)
    const s = status.get('block-1')!
    expect(s.left).toBe(true)
    expect(s.right).toBe(true)
  })

  it('ignores points farther than matchDistanceM from every block', () => {
    const status = computeBlockCompletion([block], [[-80, 40.45]], opts)
    expect(status.size).toBe(0)
  })

  it('assigns a point to its closest block when multiple blocks are in range', () => {
    const blockA: BlockInput = {
      id: 'A',
      lines: [
        [
          [-80, 40.44],
          [-80, 40.441],
        ],
      ],
    }
    const blockB: BlockInput = {
      id: 'B',
      // ~8.5 m east of block A.
      lines: [
        [
          [-79.9999, 40.44],
          [-79.9999, 40.441],
        ],
      ],
    }
    const status = computeBlockCompletion(
      [blockA, blockB],
      [[-79.9999, 40.4405]],
      { ...opts, matchDistanceM: 20 },
    )
    expect(status.has('A')).toBe(false)
    expect(status.get('B')).toBeDefined()
  })
})
