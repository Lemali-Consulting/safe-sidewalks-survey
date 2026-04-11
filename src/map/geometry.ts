/** Geometry helpers for matching survey points to sidewalk blocks. Everything
 * here operates in a local meter plane (equirectangular projection) — good
 * enough for a single Pittsburgh neighborhood, and lets us reason about
 * distances and sides in plain Euclidean terms. */

const M_PER_DEG_LAT = 111_320

export interface Point2D {
  x: number
  y: number
}

export interface SegmentNearest {
  /** Clamped perpendicular distance in meters (non-negative). */
  distance: number
  /** Signed perpendicular distance from the *infinite* line through A→B.
   *  Positive means the point lies on the left of the travel direction,
   *  negative means the right. Magnitude equals |distance| for points that
   *  project onto the interior of the segment. */
  signedOffset: number
  /** Parameter along the segment, clamped to [0, 1]. */
  t: number
}

export interface NearestResult extends SegmentNearest {
  segmentIndex: number
}

export interface BlockInput {
  id: string
  /** One or more [lng, lat] polylines (handles LineString and MultiLineString). */
  lines: Array<Array<[number, number]>>
}

export interface CompletionOptions {
  /** Points farther than this from every block are discarded. */
  matchDistanceM: number
  /** If |signedOffset| is below this, treat the point as centerline-ambiguous
   *  and credit both sides. */
  centerlineThresholdM: number
  /** Reference latitude used for the local meter projection. */
  refLat: number
}

export function toLocalMeters(lng: number, lat: number, refLat: number): Point2D {
  const mPerDegLng = M_PER_DEG_LAT * Math.cos((refLat * Math.PI) / 180)
  return { x: lng * mPerDegLng, y: lat * M_PER_DEG_LAT }
}

export function nearestPointOnSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): SegmentNearest {
  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) {
    const ex = px - ax
    const ey = py - ay
    return { distance: Math.hypot(ex, ey), signedOffset: 0, t: 0 }
  }
  const tRaw = ((px - ax) * dx + (py - ay) * dy) / lenSq
  const t = Math.max(0, Math.min(1, tRaw))
  const cx = ax + t * dx
  const cy = ay + t * dy
  const distance = Math.hypot(px - cx, py - cy)
  // Cross product of (A→B) × (A→P). Positive = P on the left of travel.
  const cross = dx * (py - ay) - dy * (px - ax)
  const signedOffset = cross / Math.sqrt(lenSq)
  return { distance, signedOffset, t }
}

export function nearestOnLineString(
  pt: Point2D,
  coords: Point2D[],
): NearestResult | null {
  if (coords.length < 2) return null
  let best: NearestResult | null = null
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i]
    const b = coords[i + 1]
    const r = nearestPointOnSegment(pt.x, pt.y, a.x, a.y, b.x, b.y)
    if (!best || r.distance < best.distance) {
      best = { ...r, segmentIndex: i }
    }
  }
  return best
}

export function computeBlockCompletion(
  blocks: BlockInput[],
  points: Array<[number, number]>,
  opts: CompletionOptions,
): Map<string, { left: boolean; right: boolean }> {
  const status = new Map<string, { left: boolean; right: boolean }>()
  if (blocks.length === 0 || points.length === 0) return status

  // Pre-project every block's polylines once.
  const projected = blocks.map((b) => ({
    id: b.id,
    lines: b.lines.map((line) =>
      line.map(([lng, lat]) => toLocalMeters(lng, lat, opts.refLat)),
    ),
  }))

  for (const [lng, lat] of points) {
    const p = toLocalMeters(lng, lat, opts.refLat)
    let bestId: string | null = null
    let bestDistance = opts.matchDistanceM
    let bestOffset = 0

    for (const block of projected) {
      for (const line of block.lines) {
        const r = nearestOnLineString(p, line)
        if (r && r.distance < bestDistance) {
          bestDistance = r.distance
          bestOffset = r.signedOffset
          bestId = block.id
        }
      }
    }

    if (bestId !== null) {
      const existing = status.get(bestId) ?? { left: false, right: false }
      if (Math.abs(bestOffset) < opts.centerlineThresholdM) {
        existing.left = true
        existing.right = true
      } else if (bestOffset > 0) {
        existing.left = true
      } else {
        existing.right = true
      }
      status.set(bestId, existing)
    }
  }

  return status
}
