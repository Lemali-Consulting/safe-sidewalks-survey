import type { Answers, AnswerValue } from './types'

const FEATURE_SERVICE =
  'https://services1.arcgis.com/YZCmUqbcsUpOKfj7/arcgis/rest/services/survey123_74576e994b99487e87a7bb2dedebcfbc_form/FeatureServer/0'

export interface SubmissionGeometry {
  longitude: number
  latitude: number
}

export interface SubmissionInput {
  answers: Answers
  geometry?: SubmissionGeometry
  photos: File[]
}

export type SubmissionMode = 'live' | 'mock'

export interface SubmissionOptions {
  mode: SubmissionMode
}

export interface SubmissionResult {
  ok: boolean
  objectId?: number
  globalId?: string
  error?: string
  mocked?: boolean
  mockedRequest?: { url: string; body: string; photoCount: number }
}

export function serializeAttributes(
  answers: Answers,
): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {}
  for (const [key, value] of Object.entries(answers)) {
    const v = serializeValue(value)
    if (v === undefined) continue
    out[key] = v
  }
  return out
}

function serializeValue(v: AnswerValue): string | undefined {
  if (v == null) return undefined
  if (Array.isArray(v)) {
    if (v.length === 0) return undefined
    return v.join(' ')
  }
  const s = String(v)
  return s.length === 0 ? undefined : s
}

interface FeatureAdd {
  attributes: Record<string, string | number | null>
  geometry?: { x: number; y: number; spatialReference: { wkid: number } }
}

export function buildApplyEditsBody(input: SubmissionInput): string {
  const feature: FeatureAdd = {
    attributes: serializeAttributes(input.answers),
  }
  if (input.geometry) {
    feature.geometry = {
      x: input.geometry.longitude,
      y: input.geometry.latitude,
      spatialReference: { wkid: 4326 },
    }
  }
  const params = new URLSearchParams()
  params.set('f', 'json')
  params.set('adds', JSON.stringify([feature]))
  return params.toString()
}

export async function submitSurvey(
  input: SubmissionInput,
  options: SubmissionOptions,
): Promise<SubmissionResult> {
  const body = buildApplyEditsBody(input)
  const url = `${FEATURE_SERVICE}/applyEdits`

  if (options.mode === 'mock') {
    // Deterministic-ish fake ObjectID so the UI can "continue" as if live.
    const objectId = Math.floor(Date.now() % 1_000_000)
    return {
      ok: true,
      objectId,
      mocked: true,
      mockedRequest: { url, body, photoCount: input.photos.length },
    }
  }

  const applyResp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const applyJson = (await applyResp.json()) as {
    addResults?: Array<{
      objectId?: number
      globalId?: string
      success: boolean
      error?: { description?: string }
    }>
    error?: { message?: string }
  }

  const addResult = applyJson.addResults?.[0]
  if (!addResult || !addResult.success) {
    return {
      ok: false,
      error:
        addResult?.error?.description ?? applyJson.error?.message ?? 'applyEdits failed',
    }
  }

  const objectId = addResult.objectId!
  for (const photo of input.photos) {
    const form = new FormData()
    form.set('f', 'json')
    form.set('attachment', photo, photo.name)
    const attResp = await fetch(`${FEATURE_SERVICE}/${objectId}/addAttachment`, {
      method: 'POST',
      body: form,
    })
    const attJson = (await attResp.json()) as {
      addAttachmentResult?: { success: boolean; error?: { description?: string } }
    }
    if (!attJson.addAttachmentResult?.success) {
      return {
        ok: false,
        objectId,
        error:
          attJson.addAttachmentResult?.error?.description ?? 'addAttachment failed',
      }
    }
  }

  return { ok: true, objectId, globalId: addResult.globalId }
}
