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

export interface NearestBlockResult {
  id: string
  /** Distance in meters from the query point to the block polyline. */
  distance: number
}

/** Finds the geometrically closest block to a [lng, lat] query point, skipping
 * any block already marked fully surveyed (both sides done). Partially-done
 * blocks are still candidates, matching the proposal: finish partials first. */
export function findNearestBlock(
  queryLngLat: [number, number],
  blocks: BlockInput[],
  completion: Map<string, { left: boolean; right: boolean }>,
  refLat: number,
): NearestBlockResult | null {
  if (blocks.length === 0) return null
  const p = toLocalMeters(queryLngLat[0], queryLngLat[1], refLat)
  let best: NearestBlockResult | null = null
  for (const block of blocks) {
    const status = completion.get(block.id)
    if (status?.left && status?.right) continue
    for (const line of block.lines) {
      const coords = line.map(([lng, lat]) => toLocalMeters(lng, lat, refLat))
      const r = nearestOnLineString(p, coords)
      if (!r) continue
      if (!best || r.distance < best.distance) {
        best = { id: block.id, distance: r.distance }
      }
    }
  }
  return best
}

/** Ray-casting point-in-polygon for GeoJSON Polygon and MultiPolygon geometries
 * in lon/lat space. Handles holes via even-odd containment. */
export function pointInPolygon(
  point: [number, number],
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon,
): boolean {
  if (geometry.type === 'Polygon') {
    return polygonContains(point, geometry.coordinates)
  }
  for (const poly of geometry.coordinates) {
    if (polygonContains(point, poly)) return true
  }
  return false
}

function polygonContains(
  point: [number, number],
  rings: GeoJSON.Position[][],
): boolean {
  if (rings.length === 0) return false
  if (!ringContains(point, rings[0])) return false
  for (let i = 1; i < rings.length; i++) {
    if (ringContains(point, rings[i])) return false
  }
  return true
}

function ringContains(point: [number, number], ring: GeoJSON.Position[]): boolean {
  const [x, y] = point
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0]
    const yi = ring[i][1]
    const xj = ring[j][0]
    const yj = ring[j][1]
    const intersect =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
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
