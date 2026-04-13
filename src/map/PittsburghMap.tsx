import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
// @ts-expect-error — esri-leaflet ships runtime-only types
import * as EL from 'esri-leaflet'
import {
  PITTSBURGH_CENTER,
  PITTSBURGH_ZOOM,
  SIDEWALK_BLOCKS_URL,
  SIDEWALK_SURVEY_VIEW_URL,
} from './config'
import type { SelectedSegment } from './types'
import {
  fetchNeighborhoods,
  type NeighborhoodCollection,
  type NeighborhoodFeature,
} from './neighborhoods'
import {
  computeBlockCompletion,
  findNearestBlock,
  pointInPolygon,
  type BlockInput,
} from './geometry'

interface Props {
  selectedId: string | null
  onSelect: (segment: SelectedSegment) => void
  onExitDetail?: () => void
  /** Increment to externally trigger the "find nearest unsurveyed block" flow. */
  findNearestTick?: number
}

type SideStatus = { left: boolean; right: boolean }
type CompletionMap = Map<string, SideStatus>

/** Minimal shape we rely on from an esri-leaflet feature layer child. The
 *  package ships runtime-only types, so we describe just what we touch. */
interface EsriFeatureLayer {
  feature?: GeoJSON.Feature
  getBounds?: () => L.LatLngBounds
}

const COLORS = {
  notDone: '#0284c7',
  partial: '#65a30d',
  done: '#15803d',
  selected: '#f97316',
  submission: '#dc2626',
  userLocation: '#2563eb',
} as const

const blockKey = (props: any) => String(props?.ID ?? props?.OBJECTID ?? '')

const blockStyle = (
  feature: any,
  selectedId: string | null,
  completion: CompletionMap,
) => {
  const key = blockKey(feature.properties)
  if (selectedId && key === selectedId) {
    return { color: COLORS.selected, weight: 7, opacity: 1 }
  }
  const status = completion.get(key)
  if (status?.left && status?.right) {
    return { color: COLORS.done, weight: 5, opacity: 0.95 }
  }
  if (status?.left || status?.right) {
    return { color: COLORS.partial, weight: 4, opacity: 0.9, dashArray: '6 4' }
  }
  return { color: COLORS.notDone, weight: 4, opacity: 0.9 }
}

/** Choropleth color ramp: light sky → deep sky based on normalized density. */
function fillColorFor(ratio: number): string {
  if (ratio <= 0) return '#e2e8f0' // slate-200 for untouched
  if (ratio < 0.1) return '#bae6fd'
  if (ratio < 0.25) return '#7dd3fc'
  if (ratio < 0.5) return '#38bdf8'
  if (ratio < 0.75) return '#0284c7'
  return '#075985'
}

const hoodStyle = (feature: NeighborhoodFeature, maxCount: number) => {
  const ratio = maxCount > 0 ? feature.properties.surveyCount / maxCount : 0
  return {
    fillColor: fillColorFor(ratio),
    fillOpacity: 0.6,
    color: '#475569',
    weight: 1,
  }
}

/** Builds a world-sized polygon with the focused neighborhood cut out as
 * a hole — draws a dimming veil over everything except the hood. */
function buildMaskFeature(
  hood: NeighborhoodFeature,
): GeoJSON.Feature<GeoJSON.Polygon> {
  const outer: GeoJSON.Position[] = [
    [-180, -85],
    [180, -85],
    [180, 85],
    [-180, 85],
    [-180, -85],
  ]
  const holes: GeoJSON.Position[][] = []
  const geom = hood.geometry
  if (geom.type === 'Polygon') {
    holes.push(geom.coordinates[0])
  } else if (geom.type === 'MultiPolygon') {
    for (const poly of geom.coordinates) {
      if (poly[0]) holes.push(poly[0])
    }
  }
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [outer, ...holes] },
    properties: {},
  }
}

function LineSwatch({
  color,
  weight,
  dashed,
}: {
  color: string
  weight: number
  dashed?: boolean
}) {
  return (
    <svg width="22" height="10" aria-hidden>
      <line
        x1="1"
        y1="5"
        x2="21"
        y2="5"
        stroke={color}
        strokeWidth={weight}
        strokeLinecap="round"
        strokeDasharray={dashed ? '4 3' : undefined}
      />
    </svg>
  )
}

function DotSwatch({ color }: { color: string }) {
  return (
    <svg width="22" height="10" aria-hidden>
      <circle cx="11" cy="5" r="3" fill={color} stroke="#fef08a" strokeWidth="1" />
    </svg>
  )
}

function Legend() {
  const [open, setOpen] = useState(true)
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="pointer-events-auto rounded-full bg-white/95 px-3 py-1.5 text-[11px] font-semibold text-gray-800 shadow-lg backdrop-blur hover:bg-white"
      >
        Legend
      </button>
    )
  }
  const rows: Array<{ label: string; swatch: React.ReactNode }> = [
    {
      label: 'Not surveyed',
      swatch: <LineSwatch color={COLORS.notDone} weight={4} />,
    },
    {
      label: 'One side done',
      swatch: <LineSwatch color={COLORS.partial} weight={4} dashed />,
    },
    {
      label: 'Both sides done',
      swatch: <LineSwatch color={COLORS.done} weight={5} />,
    },
    { label: 'Submission', swatch: <DotSwatch color={COLORS.submission} /> },
  ]
  return (
    <div className="pointer-events-auto rounded-lg bg-white/95 px-3 py-2 text-[11px] text-gray-800 shadow-lg backdrop-blur">
      <div className="mb-1 flex items-center justify-between gap-3">
        <span className="font-semibold">Legend</span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Hide legend"
          className="text-gray-500 hover:text-gray-900"
        >
          ×
        </button>
      </div>
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center gap-2">
            {r.swatch}
            <span>{r.label}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function PittsburghMap({ selectedId, onSelect, onExitDetail, findNearestTick }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const overviewLayerRef = useRef<L.GeoJSON | null>(null)
  const detailLayerRef = useRef<any>(null)
  const surveyPointsLayerRef = useRef<any>(null)
  const maskLayerRef = useRef<L.GeoJSON | null>(null)
  const completionRef = useRef<CompletionMap>(new Map())
  const userMarkerRef = useRef<L.LayerGroup | null>(null)
  const neighborhoodsRef = useRef<NeighborhoodCollection | null>(null)
  /** Set when the user triggered "Find me" from overview mode — we hop into
   * detail, then once blocks + completion are ready, auto-select the nearest
   * unsurveyed block from this location. */
  const pendingLocateRef = useRef<[number, number] | null>(null)

  const [mode, setMode] = useState<'overview' | 'detail'>('overview')
  const [focusedHood, setFocusedHood] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [locating, setLocating] = useState(false)
  const [locateError, setLocateError] = useState<string | null>(null)

  // Latest-ref for selection, so Leaflet handlers always see the latest prop.
  const onSelectRef = useRef(onSelect)
  const selectedIdRef = useRef<string | null>(selectedId)
  useEffect(() => {
    onSelectRef.current = onSelect
  }, [onSelect])
  useEffect(() => {
    selectedIdRef.current = selectedId
    detailLayerRef.current?.setStyle?.((f: any) =>
      blockStyle(f, selectedId, completionRef.current),
    )
  }, [selectedId])

  // One-time map init.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = L.map(containerRef.current, {
      center: PITTSBURGH_CENTER,
      zoom: PITTSBURGH_ZOOM,
      minZoom: 11,
      maxZoom: 19,
      zoomControl: false,
      // Canvas was for the 30k-polyline case; now that sidewalks load one
      // neighborhood at a time (a few hundred at most), SVG is plenty.
    })
    mapRef.current = map

    L.control.zoom({ position: 'bottomleft' }).addTo(map)

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map)

    // Dedicated pane for the "everything-outside-the-focused-hood" mask,
    // sitting above the tile layer (200) but below the overlay pane (400).
    map.createPane('mask')
    const maskPane = map.getPane('mask')
    if (maskPane) {
      maskPane.style.zIndex = '350'
      maskPane.style.pointerEvents = 'none'
    }

    // Submission dots are created on-demand in enterDetail, filtered to the
    // focused neighborhood — that way they never spill outside the hood's
    // boundary (a dot for a neighboring hood would be confusing).

    // Load neighborhood overview asynchronously. StrictMode mounts the effect
    // twice in dev — if the fetch resolves after the first tear-down, ignore.
    let cancelled = false
    fetchNeighborhoods()
      .then((collection) => {
        if (cancelled || mapRef.current !== map) return
        neighborhoodsRef.current = collection
        addOverviewLayer(map, collection)
      })
      .catch((err) => {
        if (cancelled) return
        console.error('[better-survey] neighborhood load failed', err)
        setLoadError('Could not load neighborhoods')
      })

    return () => {
      cancelled = true
      map.remove()
      mapRef.current = null
      overviewLayerRef.current = null
      detailLayerRef.current = null
      surveyPointsLayerRef.current = null
      maskLayerRef.current = null
      userMarkerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function addOverviewLayer(map: L.Map, collection: NeighborhoodCollection) {
    const fc: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: collection.features as unknown as GeoJSON.Feature[],
    }
    const layer = L.geoJSON(fc, {
      style: (feat) => hoodStyle(feat as unknown as NeighborhoodFeature, collection.maxCount),
      onEachFeature: (feat, featureLayer) => {
        const f = feat as unknown as NeighborhoodFeature
        const tooltip = `${f.properties.hood} — ${f.properties.surveyCount} submissions`
        featureLayer.bindTooltip(tooltip, { sticky: true })
        featureLayer.on('click', () => enterDetail(f))
      },
    }).addTo(map)
    overviewLayerRef.current = layer
  }

  function enterDetail(hoodFeature: NeighborhoodFeature) {
    const map = mapRef.current
    if (!map) return
    const hood = hoodFeature.properties.hood

    // Hide overview polygons but keep them cached for the back button.
    if (overviewLayerRef.current) map.removeLayer(overviewLayerRef.current)

    // Drape a dim veil over everything outside the focused neighborhood.
    const mask = L.geoJSON(buildMaskFeature(hoodFeature), {
      pane: 'mask',
      style: { fillColor: '#0f172a', fillOpacity: 0.55, stroke: false },
      interactive: false,
    }).addTo(map)
    maskLayerRef.current = mask

    // Zoom to the picked neighborhood's bounds.
    const gjLayer = L.geoJSON(hoodFeature as unknown as GeoJSON.GeoJsonObject)
    map.fitBounds(gjLayer.getBounds(), { padding: [40, 40], maxZoom: 17 })

    // Reset any completion state left over from the previous neighborhood.
    completionRef.current = new Map()

    // Add a filtered block layer — only this neighborhood's segments.
    const blocks = EL.featureLayer({
      url: SIDEWALK_BLOCKS_URL,
      where: `Hood='${hood.replace(/'/g, "''")}'`,
      simplifyFactor: 0.35,
      precision: 5,
      style: (feature: any) =>
        blockStyle(feature, selectedIdRef.current, completionRef.current),
    })
    blocks.on('click', (ev: any) => {
      const f = ev.layer?.feature
      if (!f) return
      const props = f.properties ?? {}
      const latlng: L.LatLng = ev.latlng
      onSelectRef.current({
        objectId: Number(props.OBJECTID),
        id: String(props.ID ?? props.OBJECTID),
        streetName: props.Streetname ?? null,
        neighborhood: props.Hood ?? hood,
        district: props.District != null ? String(props.District) : null,
        assessed: props.Assessed === 'Yes',
        clickCoordinates: [latlng.lng, latlng.lat],
      })
    })
    blocks.addTo(map)
    detailLayerRef.current = blocks

    // Submission dots — also filtered to this neighborhood so we never show
    // points from an adjacent hood that happened to be in the viewport.
    const hoodEscaped = hood.replace(/'/g, "''")
    const surveyPoints = EL.featureLayer({
      url: SIDEWALK_SURVEY_VIEW_URL,
      where: `neighborhood='${hoodEscaped}'`,
      pointToLayer: (_feature: unknown, latlng: L.LatLng) =>
        L.circleMarker(latlng, {
          radius: 3,
          fillColor: COLORS.submission,
          color: '#fef08a',
          weight: 1,
          fillOpacity: 0.9,
        }),
    }).addTo(map)
    surveyPointsLayerRef.current = surveyPoints

    // Wait for both layers to report loaded before computing completion.
    // The `Assessed` flag upstream is stale, so we derive "done" from the
    // spatial relationship between submission points and block polylines.
    let blocksLoaded = false
    let pointsLoaded = false
    const recompute = () => {
      if (!blocksLoaded || !pointsLoaded) return
      const blockInputs: BlockInput[] = []
      blocks.eachFeature((layer: any) => {
        const f = layer.feature
        if (!f?.geometry) return
        const id = blockKey(f.properties)
        if (!id) return
        const lines: Array<Array<[number, number]>> = []
        if (f.geometry.type === 'LineString') {
          lines.push(f.geometry.coordinates as Array<[number, number]>)
        } else if (f.geometry.type === 'MultiLineString') {
          for (const line of f.geometry.coordinates) {
            lines.push(line as Array<[number, number]>)
          }
        }
        if (lines.length > 0) blockInputs.push({ id, lines })
      })

      const pts: Array<[number, number]> = []
      surveyPoints.eachFeature((layer: any) => {
        const f = layer.feature
        const c = f?.geometry?.coordinates
        if (Array.isArray(c) && c.length >= 2) pts.push([c[0], c[1]])
      })

      completionRef.current = computeBlockCompletion(blockInputs, pts, {
        matchDistanceM: 15,
        centerlineThresholdM: 1,
        refLat: PITTSBURGH_CENTER[0],
      })
      blocks.setStyle?.((f: any) =>
        blockStyle(f, selectedIdRef.current, completionRef.current),
      )

      const pending = pendingLocateRef.current
      if (pending) {
        pendingLocateRef.current = null
        selectNearestUnsurveyed(pending, blockInputs, hood)
      }
    }
    blocks.on('load', () => {
      blocksLoaded = true
      recompute()
    })
    surveyPoints.on('load', () => {
      pointsLoaded = true
      recompute()
    })

    setMode('detail')
    setFocusedHood(hood)
  }

  /** Collects currently-loaded blocks from the detail layer as plain geometry
   *  inputs, so we can run findNearestBlock without touching Leaflet internals. */
  function collectBlockInputs(): BlockInput[] {
    const layer = detailLayerRef.current
    if (!layer) return []
    const out: BlockInput[] = []
    layer.eachFeature((featLayer: EsriFeatureLayer) => {
      const f = featLayer.feature
      if (!f?.geometry) return
      const id = blockKey(f.properties)
      if (!id) return
      const lines: Array<Array<[number, number]>> = []
      if (f.geometry.type === 'LineString') {
        lines.push(f.geometry.coordinates as Array<[number, number]>)
      } else if (f.geometry.type === 'MultiLineString') {
        for (const line of f.geometry.coordinates) {
          lines.push(line as Array<[number, number]>)
        }
      }
      if (lines.length > 0) out.push({ id, lines })
    })
    return out
  }

  function selectNearestUnsurveyed(
    userLngLat: [number, number],
    blockInputs: BlockInput[],
    hood: string,
  ) {
    const map = mapRef.current
    if (!map) return
    const nearest = findNearestBlock(
      userLngLat,
      blockInputs,
      completionRef.current,
      PITTSBURGH_CENTER[0],
    )
    if (!nearest) {
      setLocateError('No unsurveyed blocks left nearby — nice work!')
      return
    }

    // Look up the matching feature in the Leaflet layer so we can pull its
    // metadata and pan to its bounds.
    const layer = detailLayerRef.current
    let target: EsriFeatureLayer | null = null
    layer?.eachFeature((featLayer: EsriFeatureLayer) => {
      if (target) return
      if (blockKey(featLayer.feature?.properties) === nearest.id) {
        target = featLayer
      }
    })
    if (!target) return
    const hit: EsriFeatureLayer = target

    const props = hit.feature?.properties ?? {}
    onSelectRef.current({
      objectId: Number(props.OBJECTID),
      id: String(props.ID ?? props.OBJECTID),
      streetName: props.Streetname ?? null,
      neighborhood: props.Hood ?? hood,
      district: props.District != null ? String(props.District) : null,
      assessed: props.Assessed === 'Yes',
      // Use the walker's live position as the submission point rather than
      // an arbitrary midpoint on the polyline.
      clickCoordinates: userLngLat,
    })

    try {
      const b = hit.getBounds?.()
      if (b?.isValid?.()) {
        map.fitBounds(b, { padding: [60, 60], maxZoom: 18 })
      }
    } catch {
      // Some layer types don't expose getBounds — fall back to the user point.
      map.panTo([userLngLat[1], userLngLat[0]])
    }
  }

  function setUserMarker(lng: number, lat: number) {
    const map = mapRef.current
    if (!map) return
    if (userMarkerRef.current) {
      map.removeLayer(userMarkerRef.current)
      userMarkerRef.current = null
    }
    const group = L.layerGroup([
      L.circleMarker([lat, lng], {
        radius: 14,
        fillColor: COLORS.userLocation,
        color: COLORS.userLocation,
        weight: 2,
        fillOpacity: 0.15,
        opacity: 0.3,
        interactive: false,
      }),
      L.circleMarker([lat, lng], {
        radius: 6,
        fillColor: COLORS.userLocation,
        color: '#ffffff',
        weight: 2,
        fillOpacity: 1,
        interactive: false,
      }),
    ]).addTo(map)
    userMarkerRef.current = group
  }

  const handleFindMeRef = useRef<() => void>(() => {})

  // Let the parent trigger the "find nearest unsurveyed block" flow by
  // incrementing findNearestTick (e.g. from the post-submit success screen).
  useEffect(() => {
    handleFindMeRef.current = handleFindMe
  })

  useEffect(() => {
    if (findNearestTick === undefined || findNearestTick === 0) return
    handleFindMeRef.current()
  }, [findNearestTick])

  function handleFindMe() {
    if (!('geolocation' in navigator)) {
      setLocateError('Geolocation is not available in this browser')
      return
    }
    setLocateError(null)
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false)
        const lng = pos.coords.longitude
        const lat = pos.coords.latitude
        setUserMarker(lng, lat)

        if (mode === 'detail') {
          const map = mapRef.current
          if (!map) return
          const hood = focusedHood ?? ''
          selectNearestUnsurveyed([lng, lat], collectBlockInputs(), hood)
          return
        }

        // Overview mode: find the neighborhood containing the user.
        const hoods = neighborhoodsRef.current
        if (!hoods) {
          setLocateError('Neighborhoods still loading — try again in a moment')
          return
        }
        const hood = hoods.features.find((f) =>
          pointInPolygon([lng, lat], f.geometry),
        )
        if (!hood) {
          setLocateError("You're outside Pittsburgh's neighborhood boundaries")
          return
        }
        pendingLocateRef.current = [lng, lat]
        enterDetail(hood)
      },
      (err) => {
        setLocating(false)
        const message =
          err.code === err.PERMISSION_DENIED
            ? 'Location permission denied'
            : err.code === err.POSITION_UNAVAILABLE
              ? 'Location unavailable'
              : 'Could not get your location'
        setLocateError(message)
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    )
  }

  function exitDetail() {
    const map = mapRef.current
    if (!map) return
    if (detailLayerRef.current) {
      map.removeLayer(detailLayerRef.current)
      detailLayerRef.current = null
    }
    if (surveyPointsLayerRef.current) {
      map.removeLayer(surveyPointsLayerRef.current)
      surveyPointsLayerRef.current = null
    }
    if (maskLayerRef.current) {
      map.removeLayer(maskLayerRef.current)
      maskLayerRef.current = null
    }
    completionRef.current = new Map()
    pendingLocateRef.current = null
    if (overviewLayerRef.current) overviewLayerRef.current.addTo(map)
    map.setView(PITTSBURGH_CENTER, PITTSBURGH_ZOOM)
    setMode('overview')
    setFocusedHood(null)
    onExitDetail?.()
  }

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />

      {mode === 'detail' && focusedHood && (
        <>
          <div className="pointer-events-none absolute left-1/2 top-16 z-[400] flex -translate-x-1/2 flex-col items-center gap-2">
            <button
              type="button"
              onClick={exitDetail}
              className="pointer-events-auto flex items-center gap-2 rounded-full bg-white/95 px-4 py-2 text-xs font-semibold text-gray-900 shadow-lg backdrop-blur hover:bg-white"
            >
              <span className="text-base">←</span>
              <span>Back · {focusedHood}</span>
            </button>
          </div>
          <div className="absolute right-4 top-16 z-[400]">
            <Legend />
          </div>
        </>
      )}

      <button
        type="button"
        onClick={handleFindMe}
        disabled={locating}
        aria-label="Find my location and jump to the nearest unsurveyed block"
        className="absolute bottom-4 right-4 z-[400] flex items-center gap-2 rounded-full bg-white/95 px-4 py-2 text-xs font-semibold text-gray-900 shadow-lg backdrop-blur hover:bg-white disabled:cursor-wait disabled:opacity-60"
      >
        <span aria-hidden className="text-base leading-none">📍</span>
        <span>{locating ? 'Locating…' : 'Find nearest block'}</span>
      </button>

      {locateError && (
        <div className="pointer-events-auto absolute bottom-16 right-4 z-[400] flex max-w-[260px] items-start gap-2 rounded-lg bg-white px-3 py-2 text-[11px] font-medium text-rose-700 shadow-lg">
          <span>{locateError}</span>
          <button
            type="button"
            onClick={() => setLocateError(null)}
            aria-label="Dismiss location error"
            className="text-gray-400 hover:text-gray-900"
          >
            ×
          </button>
        </div>
      )}

      {mode === 'overview' && !loadError && (
        <div className="pointer-events-none absolute bottom-16 left-1/2 z-[400] -translate-x-1/2 rounded-lg bg-white/90 px-4 py-2 text-xs font-semibold text-gray-700 shadow-lg">
          Tap a neighborhood, or use “Find nearest block”
        </div>
      )}

      {loadError && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-[400] -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white px-4 py-2 text-xs font-semibold text-rose-600 shadow-lg">
          {loadError}
        </div>
      )}
    </div>
  )
}
