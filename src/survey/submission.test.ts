import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  buildApplyEditsBody,
  serializeAttributes,
  submitSurvey,
  type SubmissionInput,
} from './submission'

const BASE_ANSWERS = {
  name: 'Test User',
  email: 'test@example.com',
  _id: '12345',
  how_much_sidewalk_is_present_on: 'Whole block',
  what_is_the_width_of_the_sidewa: '4 feet or wider',
  is_there_any_structural_or_obst: 'Yes',
  is_the_issue_structural: 'Yes',
  indicate_the_structural_issues: ['Uneven_sections_of_the_sidewalk', 'other'],
  indicate_the_structural_issues_other: 'Tree root',
  field_36: 'Both corners are good',
}

const input = (): SubmissionInput => ({
  answers: { ...BASE_ANSWERS },
  geometry: { longitude: -80.0, latitude: 40.44 },
  photos: [],
})

describe('serializeAttributes', () => {
  it('joins select_many arrays into space-separated strings (Survey123 convention)', () => {
    const attrs = serializeAttributes({
      indicate_the_structural_issues: ['Uneven_sections_of_the_sidewalk', 'other'],
      name: 'Test',
    })
    expect(attrs.indicate_the_structural_issues).toBe(
      'Uneven_sections_of_the_sidewalk other',
    )
    expect(attrs.name).toBe('Test')
  })

  it('drops empty arrays and empty strings', () => {
    const attrs = serializeAttributes({
      indicate_the_structural_issues: [],
      indicate_the_obstruction_relate_other: '',
      name: 'ok',
    })
    expect(attrs).not.toHaveProperty('indicate_the_structural_issues')
    expect(attrs).not.toHaveProperty('indicate_the_obstruction_relate_other')
    expect(attrs.name).toBe('ok')
  })

  it('drops null and undefined', () => {
    const attrs = serializeAttributes({ name: 'ok', email: null, extra: undefined })
    expect(attrs.name).toBe('ok')
    expect(attrs).not.toHaveProperty('email')
    expect(attrs).not.toHaveProperty('extra')
  })
})

describe('buildApplyEditsBody', () => {
  it('produces a URL-encoded body with f=json, adds=[...] containing attributes and point geometry', () => {
    const body = buildApplyEditsBody(input())
    const params = new URLSearchParams(body)

    expect(params.get('f')).toBe('json')
    const adds = JSON.parse(params.get('adds') ?? '[]')
    expect(adds).toHaveLength(1)

    expect(adds[0].geometry).toEqual({
      x: -80,
      y: 40.44,
      spatialReference: { wkid: 4326 },
    })

    expect(adds[0].attributes.name).toBe('Test User')
    expect(adds[0].attributes.indicate_the_structural_issues).toBe(
      'Uneven_sections_of_the_sidewalk other',
    )
  })

  it('omits geometry fields when no location provided', () => {
    const body = buildApplyEditsBody({ ...input(), geometry: undefined })
    const adds = JSON.parse(new URLSearchParams(body).get('adds')!)
    expect(adds[0].geometry).toBeUndefined()
  })
})

describe('submitSurvey (mock mode)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('does not call fetch in mock mode', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const result = await submitSurvey(input(), { mode: 'mock' })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(result.ok).toBe(true)
    expect(result.objectId).toBeTypeOf('number')
    expect(result.mocked).toBe(true)
  })

  it('records the applyEdits body that would have been sent', async () => {
    const result = await submitSurvey(input(), { mode: 'mock' })
    expect(result.mockedRequest).toBeDefined()
    expect(result.mockedRequest!.url).toMatch(
      /survey123_74576e994b99487e87a7bb2dedebcfbc_form\/FeatureServer\/0\/applyEdits$/,
    )
    const adds = JSON.parse(
      new URLSearchParams(result.mockedRequest!.body).get('adds')!,
    )
    expect(adds[0].attributes.name).toBe('Test User')
  })
})

describe('submitSurvey (live mode)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('posts applyEdits and then one addAttachment per photo', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      // applyEdits response
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            addResults: [{ objectId: 9999, globalId: 'g-1', success: true }],
          }),
          { status: 200 },
        ),
      )
      // addAttachment response(s)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ addAttachmentResult: { objectId: 1, success: true } }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ addAttachmentResult: { objectId: 2, success: true } }), {
          status: 200,
        }),
      )

    const photo1 = new File(['hello'], 'a.jpg', { type: 'image/jpeg' })
    const photo2 = new File(['world'], 'b.jpg', { type: 'image/jpeg' })

    const result = await submitSurvey(
      { ...input(), photos: [photo1, photo2] },
      { mode: 'live' },
    )

    expect(result.ok).toBe(true)
    expect(result.objectId).toBe(9999)

    expect(fetchMock).toHaveBeenCalledTimes(3)

    const [applyCall, att1, att2] = fetchMock.mock.calls
    expect(applyCall[0]).toMatch(/\/FeatureServer\/0\/applyEdits$/)
    expect((applyCall[1] as RequestInit).method).toBe('POST')

    expect(att1[0]).toMatch(/\/FeatureServer\/0\/9999\/addAttachment$/)
    expect(att2[0]).toMatch(/\/FeatureServer\/0\/9999\/addAttachment$/)
  })

  it('returns ok:true with photoError when applyEdits succeeded but an attachment failed', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            addResults: [{ objectId: 42, globalId: 'g-42', success: true }],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            addAttachmentResult: { success: false, error: { description: 'file too large' } },
          }),
          { status: 200 },
        ),
      )

    const photo = new File(['x'], 'a.jpg', { type: 'image/jpeg' })
    const result = await submitSurvey({ ...input(), photos: [photo] }, { mode: 'live' })

    expect(result.ok).toBe(true)
    expect(result.objectId).toBe(42)
    expect(result.photoError).toMatch(/file too large/)
    expect(result.photosUploaded).toBe(0)
    expect(result.photosTotal).toBe(1)
  })

  it('surfaces an error if applyEdits returns success:false', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          addResults: [{ success: false, error: { description: 'bad field' } }],
        }),
        { status: 200 },
      ),
    )

    const result = await submitSurvey(input(), { mode: 'live' })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/bad field/)
  })
})
