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

interface Props {
  selectedId: string | null
  onSelect: (segment: SelectedSegment) => void
  onExitDetail?: () => void
}

const blockStyle = (feature: any, selectedId: string | null) => {
  const isSelected = selectedId && String(feature.properties.ID) === selectedId
  if (isSelected) return { color: '#f97316', weight: 7, opacity: 1 }
  return { color: '#0284c7', weight: 4, opacity: 0.9 }
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

export default function PittsburghMap({ selectedId, onSelect, onExitDetail }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const overviewLayerRef = useRef<L.GeoJSON | null>(null)
  const detailLayerRef = useRef<any>(null)
  const surveyPointsLayerRef = useRef<any>(null)
  const maskLayerRef = useRef<L.GeoJSON | null>(null)

  const [mode, setMode] = useState<'overview' | 'detail'>('overview')
  const [focusedHood, setFocusedHood] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Latest-ref for selection, so Leaflet handlers always see the latest prop.
  const onSelectRef = useRef(onSelect)
  const selectedIdRef = useRef<string | null>(selectedId)
  useEffect(() => {
    onSelectRef.current = onSelect
  }, [onSelect])
  useEffect(() => {
    selectedIdRef.current = selectedId
    detailLayerRef.current?.setStyle?.((f: any) => blockStyle(f, selectedId))
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

    // Add a filtered block layer — only this neighborhood's segments.
    const blocks = EL.featureLayer({
      url: SIDEWALK_BLOCKS_URL,
      where: `Hood='${hood.replace(/'/g, "''")}'`,
      simplifyFactor: 0.35,
      precision: 5,
      style: (feature: any) => blockStyle(feature, selectedIdRef.current),
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
          fillColor: '#dc2626',
          color: '#fef08a',
          weight: 1,
          fillOpacity: 0.9,
        }),
    }).addTo(map)
    surveyPointsLayerRef.current = surveyPoints

    setMode('detail')
    setFocusedHood(hood)
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
      )}

      {mode === 'overview' && !loadError && (
        <div className="pointer-events-none absolute bottom-4 left-1/2 z-[400] -translate-x-1/2 rounded-lg bg-white/90 px-4 py-2 text-xs font-semibold text-gray-700 shadow-lg">
          Tap a neighborhood to start assessing
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
