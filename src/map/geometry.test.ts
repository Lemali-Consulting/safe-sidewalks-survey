import { describe, it, expect } from 'vitest'
import {
  toLocalMeters,
  nearestPointOnSegment,
  nearestOnLineString,
  computeBlockCompletion,
  findNearestBlock,
  pointInPolygon,
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

describe('findNearestBlock', () => {
  const north: BlockInput = {
    id: 'north',
    lines: [
      [
        [-80, 40.441],
        [-80, 40.442],
      ],
    ],
  }
  const south: BlockInput = {
    id: 'south',
    lines: [
      [
        [-80, 40.439],
        [-80, 40.44],
      ],
    ],
  }
  const far: BlockInput = {
    id: 'far',
    lines: [
      [
        [-79.99, 40.45],
        [-79.99, 40.451],
      ],
    ],
  }

  it('returns the geometrically closest block when completion is empty', () => {
    const result = findNearestBlock(
      [-80, 40.4395],
      [north, south, far],
      new Map(),
      40.44,
    )
    expect(result?.id).toBe('south')
  })

  it('skips blocks that are fully surveyed on both sides', () => {
    const completion = new Map([
      ['south', { left: true, right: true }],
    ])
    const result = findNearestBlock(
      [-80, 40.4395],
      [north, south, far],
      completion,
      40.44,
    )
    expect(result?.id).toBe('north')
  })

  it('still picks partially-surveyed blocks (only one side done)', () => {
    const completion = new Map([
      ['south', { left: true, right: false }],
    ])
    const result = findNearestBlock(
      [-80, 40.4395],
      [north, south, far],
      completion,
      40.44,
    )
    expect(result?.id).toBe('south')
  })

  it('returns null when the block list is empty', () => {
    expect(
      findNearestBlock([-80, 40.44], [], new Map(), 40.44),
    ).toBeNull()
  })

  it('returns null when every block is fully surveyed', () => {
    const completion = new Map([
      ['north', { left: true, right: true }],
      ['south', { left: true, right: true }],
      ['far', { left: true, right: true }],
    ])
    expect(
      findNearestBlock(
        [-80, 40.4395],
        [north, south, far],
        completion,
        40.44,
      ),
    ).toBeNull()
  })

  it('reports the distance to the chosen block in meters', () => {
    // Query point is ~11.1 m south of the south block's southern end.
    const result = findNearestBlock(
      [-80, 40.4389],
      [south],
      new Map(),
      40.44,
    )
    expect(result).not.toBeNull()
    expect(result!.distance).toBeCloseTo(11.1, 0)
  })
})

describe('pointInPolygon', () => {
  const square: GeoJSON.Polygon = {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ],
    ],
  }

  it('returns true for a point strictly inside', () => {
    expect(pointInPolygon([5, 5], square)).toBe(true)
  })

  it('returns false for a point outside', () => {
    expect(pointInPolygon([15, 5], square)).toBe(false)
  })

  it('handles MultiPolygon: inside either sub-polygon counts', () => {
    const mp: GeoJSON.MultiPolygon = {
      type: 'MultiPolygon',
      coordinates: [
        [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
            [0, 0],
          ],
        ],
        [
          [
            [10, 10],
            [11, 10],
            [11, 11],
            [10, 11],
            [10, 10],
          ],
        ],
      ],
    }
    expect(pointInPolygon([0.5, 0.5], mp)).toBe(true)
    expect(pointInPolygon([10.5, 10.5], mp)).toBe(true)
    expect(pointInPolygon([5, 5], mp)).toBe(false)
  })

  it('respects polygon holes', () => {
    const withHole: GeoJSON.Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
        [
          [4, 4],
          [6, 4],
          [6, 6],
          [4, 6],
          [4, 4],
        ],
      ],
    }
    expect(pointInPolygon([5, 5], withHole)).toBe(false)
    expect(pointInPolygon([1, 1], withHole)).toBe(true)
  })
})
