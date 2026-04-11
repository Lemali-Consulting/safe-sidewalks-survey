import { NEIGHBORHOODS_URL, SIDEWALK_SURVEY_VIEW_URL } from './config'

export interface NeighborhoodFeature {
  type: 'Feature'
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon
  properties: {
    hood: string
    surveyCount: number
  }
}

export interface NeighborhoodCollection {
  type: 'FeatureCollection'
  features: NeighborhoodFeature[]
  maxCount: number
}

type SurveyCountResponse = {
  features?: Array<{ attributes: { neighborhood: string | null; n: number } }>
}

type BoundaryResponse = GeoJSON.FeatureCollection<
  GeoJSON.Polygon | GeoJSON.MultiPolygon,
  { hood?: string }
>

/** Fetches neighborhood polygons + per-neighborhood submission counts and
 * joins them into a single FeatureCollection. Safe to call once on load. */
export async function fetchNeighborhoods(): Promise<NeighborhoodCollection> {
  const [boundaries, counts] = await Promise.all([
    fetchBoundaries(),
    fetchCounts(),
  ])

  let maxCount = 0
  const features: NeighborhoodFeature[] = boundaries.features
    .filter((f) => !!f.properties?.hood)
    .map((f) => {
      const hood = f.properties!.hood as string
      const surveyCount = counts.get(hood) ?? 0
      if (surveyCount > maxCount) maxCount = surveyCount
      return {
        type: 'Feature',
        geometry: f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon,
        properties: { hood, surveyCount },
      }
    })

  return { type: 'FeatureCollection', features, maxCount }
}

async function fetchBoundaries(): Promise<BoundaryResponse> {
  const params = new URLSearchParams({
    where: '1=1',
    outFields: 'hood',
    returnGeometry: 'true',
    outSR: '4326',
    f: 'geojson',
  })
  const res = await fetch(`${NEIGHBORHOODS_URL}/query?${params}`)
  return (await res.json()) as BoundaryResponse
}

async function fetchCounts(): Promise<Map<string, number>> {
  const params = new URLSearchParams({
    where: '1=1',
    groupByFieldsForStatistics: 'neighborhood',
    outStatistics: JSON.stringify([
      {
        statisticType: 'count',
        onStatisticField: 'objectid',
        outStatisticFieldName: 'n',
      },
    ]),
    f: 'json',
  })
  const res = await fetch(`${SIDEWALK_SURVEY_VIEW_URL}/query?${params}`)
  const data = (await res.json()) as SurveyCountResponse
  const map = new Map<string, number>()
  for (const f of data.features ?? []) {
    const hood = f.attributes.neighborhood
    if (hood) map.set(hood, f.attributes.n)
  }
  return map
}
