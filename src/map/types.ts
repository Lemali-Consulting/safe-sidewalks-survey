export interface SelectedSegment {
  objectId: number
  id: string
  streetName: string | null
  neighborhood: string | null
  district: string | null
  assessed: boolean
  /** [longitude, latitude] */
  clickCoordinates: [number, number]
}
