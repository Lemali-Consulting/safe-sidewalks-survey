import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SurveyPanel from './SurveyPanel'
import type { SelectedSegment } from '../map/types'
import * as submissionMod from './submission'

const segment: SelectedSegment = {
  objectId: 1,
  id: 'seg-1',
  streetName: 'Main St',
  neighborhood: 'Downtown',
  district: '1',
  assessed: false,
  clickCoordinates: [-80, 40.44],
}

/** Find the input that lives under the same field-wrapper as a label. */
function inputForLabel(labelText: string): HTMLInputElement {
  // Scope to the actual form labels (inside a <label><span>), not the
  // error banner's <li> items that repeat the same field name.
  const spans = Array.from(document.querySelectorAll('label > span')) as HTMLElement[]
  const span = spans.find((s) => s.textContent?.trim().startsWith(labelText))
  if (!span) throw new Error(`no form label matching "${labelText}"`)
  const wrapper = span.closest('div.space-y-2')
  const input = wrapper?.querySelector('input')
  if (!input) throw new Error(`no input under label "${labelText}"`)
  return input as HTMLInputElement
}

function fillAllRequired() {
  fireEvent.change(inputForLabel('Username'), { target: { value: 'Ada' } })
  fireEvent.change(inputForLabel('Email address'), {
    target: { value: 'ada@example.com' },
  })
  // select_one renders radios; click the "Whole block" option.
  fireEvent.click(screen.getByLabelText('Whole block'))
}

describe('SurveyPanel required-field gating', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.spyOn(submissionMod, 'submitSurvey').mockResolvedValue({
      ok: true,
      mocked: true,
    } as submissionMod.SubmissionResult)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not show the missing-required list until Submit is clicked', () => {
    render(<SurveyPanel segment={segment} onDismiss={() => {}} mock />)
    expect(screen.queryByText(/Please fill in these required fields/i)).toBeNull()
  })

  it('lists every missing required field after clicking Submit', () => {
    render(<SurveyPanel segment={segment} onDismiss={() => {}} mock />)
    fireEvent.click(screen.getByRole('button', { name: /submit/i }))

    expect(screen.getByText(/Please fill in these required fields/i)).toBeInTheDocument()
    // The missing-required <ul> items should name each field.
    const list = screen
      .getByText(/Please fill in these required fields/i)
      .parentElement!.querySelector('ul')!
    expect(list.textContent).toContain('Username')
    expect(list.textContent).toContain('Email')
    expect(list.textContent).toContain('How much sidewalk is present')
  })

  it('does not call submitSurvey when required fields are missing', () => {
    render(<SurveyPanel segment={segment} onDismiss={() => {}} mock />)
    fireEvent.click(screen.getByRole('button', { name: /submit/i }))
    expect(submissionMod.submitSurvey).not.toHaveBeenCalled()
    expect(window.confirm).not.toHaveBeenCalled()
  })

  it('drops a field from the missing list once the user fills it in', () => {
    render(<SurveyPanel segment={segment} onDismiss={() => {}} mock />)
    fireEvent.click(screen.getByRole('button', { name: /submit/i }))
    const banner = screen.getByText(/Please fill in these required fields/i).parentElement!
    expect(banner.textContent).toContain('Username')

    fireEvent.change(inputForLabel('Username'), { target: { value: 'Ada' } })
    expect(banner.textContent).not.toContain('Username')
    expect(banner.textContent).toContain('Email')
  })

  it('asks for confirmation and submits once all required fields are filled', async () => {
    render(<SurveyPanel segment={segment} onDismiss={() => {}} mock />)
    fillAllRequired()

    fireEvent.click(screen.getByRole('button', { name: /submit/i }))
    await Promise.resolve()

    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/submit/i))
    expect(submissionMod.submitSurvey).toHaveBeenCalledTimes(1)
  })

  it('aborts submission if the user cancels the confirmation prompt', async () => {
    ;(window.confirm as ReturnType<typeof vi.fn>).mockReturnValue(false)
    render(<SurveyPanel segment={segment} onDismiss={() => {}} mock />)
    fillAllRequired()

    fireEvent.click(screen.getByRole('button', { name: /submit/i }))
    await Promise.resolve()

    expect(window.confirm).toHaveBeenCalled()
    expect(submissionMod.submitSurvey).not.toHaveBeenCalled()
  })
})
