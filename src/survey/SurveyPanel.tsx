import { useEffect, useMemo, useState } from 'react'
import { sections } from './schema'
import type { Answers, AnswerValue } from './types'
import { isVisible } from './visibility'
import QuestionField from './QuestionField'
import PhotoUploader from './PhotoUploader'
import { submitSurvey } from './submission'
import type { SubmissionResult } from './submission'
import { useContactStorage } from './useContactStorage'
import type { SelectedSegment } from '../map/types'

interface Props {
  segment: SelectedSegment | null
  onDismiss: () => void
  /** If true, submissions use mock mode. Defaults to dev builds only. */
  mock?: boolean
  onSubmitted?: (result: SubmissionResult) => void
}

export default function SurveyPanel({
  segment,
  onDismiss,
  mock = import.meta.env.DEV,
  onSubmitted,
}: Props) {
  const [contact, setContact] = useContactStorage()
  const [answers, setAnswers] = useState<Answers>({})
  const [photos, setPhotos] = useState<File[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [status, setStatus] = useState<SubmissionResult | null>(null)

  // When a new segment is chosen, seed the answers with its attributes +
  // the stored contact info. The user can still edit everything.
  useEffect(() => {
    if (!segment) return
    setAnswers({
      ...contact,
      _id: segment.id,
      street_name: segment.streetName ?? '',
      neighborhood: segment.neighborhood ?? '',
      council_district: segment.district ?? '',
    })
    setPhotos([])
    setStatus(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segment?.id])

  const combined: Answers = useMemo(() => ({ ...contact, ...answers }), [contact, answers])

  function setAnswer(name: string, value: AnswerValue) {
    // Contact fields persist across segments in localStorage.
    if (name === 'name' || name === 'email' || name === 'if_on_behalf_of_any_organizatio') {
      setContact({ ...contact, [name]: typeof value === 'string' ? value : '' })
    }
    setAnswers((prev) => ({ ...prev, [name]: value }))
  }

  async function handleSubmit() {
    if (!segment) return
    setSubmitting(true)
    setStatus(null)
    const result = await submitSurvey(
      {
        answers: combined,
        geometry: {
          longitude: segment.clickCoordinates[0],
          latitude: segment.clickCoordinates[1],
        },
        photos,
      },
      { mode: mock ? 'mock' : 'live' },
    )
    setSubmitting(false)
    setStatus(result)
    onSubmitted?.(result)
  }

  if (!segment) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-sm text-gray-500">
        <div>
          <p className="font-semibold text-gray-900">
            Click a sidewalk segment on the map to begin.
          </p>
          <p className="mt-2">
            Blue lines are sidewalks you can assess. Red dots mark completed submissions.
          </p>
        </div>
      </div>
    )
  }

  // If the mock submit reported success, show a confirmation screen.
  if (status?.ok && status.mocked) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <div className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
          MOCK SUBMIT
        </div>
        <h2 className="text-lg font-semibold text-gray-900">Would have submitted ✓</h2>
        <p className="text-sm text-gray-600">
          Dev mode — no data was sent to ArcGIS. Check the browser console for the
          recorded payload.
        </p>
        <button
          type="button"
          onClick={onDismiss}
          className="mt-2 rounded-md bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500"
        >
          Pick another segment
        </button>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-gray-200 px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Segment
            </p>
            <h2 className="text-base font-semibold text-gray-900">
              {segment.streetName ?? 'Unnamed sidewalk'}
            </h2>
            <p className="text-xs text-gray-500">
              {[segment.neighborhood, segment.district && `District ${segment.district}`]
                .filter(Boolean)
                .join(' · ') || 'Pittsburgh'}
            </p>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            aria-label="Close survey"
          >
            ×
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="space-y-8">
          {sections.map((section) => {
            const visibleQuestions = section.questions.filter((q) => isVisible(q, combined))
            if (visibleQuestions.length === 0) return null
            return (
              <section key={section.title} className="space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">{section.title}</h3>
                  {section.description && (
                    <p className="text-xs text-gray-500">{section.description}</p>
                  )}
                </div>
                {visibleQuestions.map((q) => {
                  if (q.name === '_id') return null // hidden, auto-filled
                  if (q.type === 'photo') {
                    return <PhotoUploader key={q.name} photos={photos} onChange={setPhotos} />
                  }
                  return (
                    <QuestionField
                      key={q.name}
                      question={q}
                      value={combined[q.name]}
                      allAnswers={combined}
                      onChange={(v) => setAnswer(q.name, v)}
                    />
                  )
                })}
              </section>
            )
          })}
        </div>
      </div>

      <footer className="border-t border-gray-200 bg-white px-5 py-3">
        {status && !status.ok && (
          <p className="mb-2 text-xs text-rose-600">Error: {status.error}</p>
        )}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting || !combined.name || !combined.email}
          className="w-full rounded-md bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {submitting ? 'Submitting…' : mock ? 'Submit (mock)' : 'Submit'}
        </button>
        {mock && (
          <p className="mt-2 text-center text-[10px] uppercase tracking-wider text-amber-600">
            Development mode — no data is sent
          </p>
        )}
      </footer>
    </div>
  )
}
