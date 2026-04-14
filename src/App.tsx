import { useState } from 'react'
import PittsburghMap from './map/PittsburghMap'
import SurveyPanel from './survey/SurveyPanel'
import type { SelectedSegment } from './map/types'
import type { SubmissionResult } from './survey/submission'
import { useMyBlocksStorage } from './survey/useMyBlocksStorage'

export default function App() {
  const [segment, setSegment] = useState<SelectedSegment | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [findNearestTick, setFindNearestTick] = useState(0)
  const [myBlocks, addMyBlock] = useMyBlocksStorage()

  function handleSelect(next: SelectedSegment) {
    setSegment(next)
    // On mobile, require explicit confirmation before opening the survey sheet
    // so mis-taps don't drop the user into a form for the wrong block. The
    // confirmation bar below lets them verify the highlighted block first.
    setSheetOpen(false)
  }

  function handleSubmitted(result: SubmissionResult) {
    if (result.ok) {
      if (segment?.id) addMyBlock(segment.id)
      // eslint-disable-next-line no-console
      console.log('[better-survey] submit result', result)
    }
  }

  function handleFindNext() {
    setSegment(null)
    setSheetOpen(false)
    setFindNearestTick((n) => n + 1)
  }

  return (
    <div className="relative flex h-full w-full flex-col md:flex-row">
      <header className="absolute left-0 right-0 top-0 z-[1000] flex items-center justify-between bg-white/90 px-4 py-2 text-sm shadow backdrop-blur md:right-[400px]">
        <div>
          <h1 className="text-sm font-semibold text-gray-900">
            Pittsburgh Sidewalk Survey
          </h1>
          <p className="text-[11px] text-gray-500">
            Pick a neighborhood, then a sidewalk segment. Red dots mark completed
            submissions.
          </p>
        </div>
      </header>

      <main className="relative flex-1">
        <PittsburghMap
          selectedId={segment?.id ?? null}
          onSelect={handleSelect}
          onExitDetail={() => {
            setSegment(null)
            setSheetOpen(false)
          }}
          findNearestTick={findNearestTick}
          myBlocks={myBlocks}
        />
      </main>

      {/* Desktop: right-rail panel. Always mounted above md. */}
      <aside className="hidden w-[400px] shrink-0 border-l border-gray-200 bg-white md:block">
        <SurveyPanel
          segment={segment}
          onDismiss={() => setSegment(null)}
          onSubmitted={handleSubmitted}
          onFindNext={handleFindNext}
        />
      </aside>

      {/* Mobile: confirmation bar shown after selection, before the sheet opens.
          Guards against mis-taps since the map view is occluded once the sheet
          is up — users get a chance to see the highlighted block first. */}
      {segment && !sheetOpen && (
        <div className="fixed inset-x-0 bottom-0 z-[1000] border-t border-gray-200 bg-white p-3 shadow-2xl md:hidden">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            Selected
          </p>
          <p className="mb-2 truncate text-sm font-semibold text-gray-900">
            {segment.streetName ?? 'Unnamed sidewalk'}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setSegment(null)}
              className="flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              Pick another
            </button>
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              className="flex-[2] rounded-md bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-500"
            >
              Survey this block
            </button>
          </div>
        </div>
      )}

      {/* Mobile: bottom sheet. Slides up once the user confirms the selection. */}
      <div
        className={`fixed inset-x-0 bottom-0 z-[1000] h-[75vh] rounded-t-2xl border-t border-gray-200 bg-white shadow-2xl transition-transform duration-200 ease-out md:hidden ${
          sheetOpen && segment ? 'translate-y-0' : 'translate-y-full'
        }`}
        role="dialog"
        aria-label="Survey"
      >
        <SurveyPanel
          segment={segment}
          onDismiss={() => {
            setSheetOpen(false)
            setSegment(null)
          }}
          onSubmitted={handleSubmitted}
          onFindNext={handleFindNext}
        />
      </div>
    </div>
  )
}
