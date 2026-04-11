import { describe, it, expect } from 'vitest'
import { visibleFieldNames } from './visibility'
import { questions } from './schema'
import type { Answers } from './types'

const empty: Answers = {}

function visible(answers: Answers) {
  return new Set(visibleFieldNames(questions, answers))
}

describe('visibleFieldNames', () => {
  it('shows only contact info and location before a sidewalk segment is picked', () => {
    const v = visible(empty)

    expect(v.has('name')).toBe(true)
    expect(v.has('email')).toBe(true)
    expect(v.has('if_on_behalf_of_any_organizatio')).toBe(true)
    expect(v.has('_id')).toBe(true)

    expect(v.has('how_much_sidewalk_is_present_on')).toBe(false)
    expect(v.has('field_36')).toBe(false)
    expect(v.has('please_provide_a_photo_of_the_s')).toBe(false)
  })

  it('reveals the condition block once a segment _id is set', () => {
    const v = visible({ _id: '12345' })
    expect(v.has('how_much_sidewalk_is_present_on')).toBe(true)
    expect(v.has('field_36')).toBe(true)
    expect(v.has('please_provide_a_photo_of_the_s')).toBe(true)
  })

  it('hides width/accessibility/issues when answer is "No sidewalk"', () => {
    const v = visible({
      _id: '12345',
      how_much_sidewalk_is_present_on: 'No sidewalk',
    })
    expect(v.has('how_much_sidewalk_is_present_on')).toBe(true)
    expect(v.has('what_is_the_width_of_the_sidewa')).toBe(false)
    expect(v.has('_do_you_think_you_could_use_thi')).toBe(false)
    expect(v.has('is_there_any_structural_or_obst')).toBe(false)
    expect(v.has('if_there_are_any_other_safety_c')).toBe(false)
  })

  it('reveals width/accessibility/issues when sidewalk is present', () => {
    const v = visible({
      _id: '12345',
      how_much_sidewalk_is_present_on: 'Whole block',
    })
    expect(v.has('what_is_the_width_of_the_sidewa')).toBe(true)
    expect(v.has('_do_you_think_you_could_use_thi')).toBe(true)
    expect(v.has('is_there_any_structural_or_obst')).toBe(true)
    expect(v.has('if_there_are_any_other_safety_c')).toBe(true)
  })

  it('opens structural + obstruction branches when issues = Yes', () => {
    const v = visible({
      _id: '12345',
      how_much_sidewalk_is_present_on: 'Whole block',
      is_there_any_structural_or_obst: 'Yes',
    })
    expect(v.has('is_the_issue_structural')).toBe(true)
    expect(v.has('is_the_issue_obstruction_relate')).toBe(true)
  })

  it('keeps structural branch closed when issues = No', () => {
    const v = visible({
      _id: '12345',
      how_much_sidewalk_is_present_on: 'Whole block',
      is_there_any_structural_or_obst: 'No',
    })
    expect(v.has('is_the_issue_structural')).toBe(false)
    expect(v.has('is_the_issue_obstruction_relate')).toBe(false)
  })

  it('reveals structural issues checklist only when is_the_issue_structural = Yes', () => {
    const base = {
      _id: '12345',
      how_much_sidewalk_is_present_on: 'Whole block',
      is_there_any_structural_or_obst: 'Yes',
    }
    expect(visible({ ...base, is_the_issue_structural: 'No' }).has('indicate_the_structural_issues')).toBe(false)
    expect(visible({ ...base, is_the_issue_structural: 'Yes' }).has('indicate_the_structural_issues')).toBe(true)
  })

  it('reveals "Other (describe)" text box only when structural issues include Other', () => {
    const base = {
      _id: '12345',
      how_much_sidewalk_is_present_on: 'Whole block',
      is_there_any_structural_or_obst: 'Yes',
      is_the_issue_structural: 'Yes',
    }
    expect(
      visible({ ...base, indicate_the_structural_issues: ['Uneven_sections_of_the_sidewalk'] })
        .has('indicate_the_structural_issues_other'),
    ).toBe(false)
    expect(
      visible({ ...base, indicate_the_structural_issues: ['Uneven_sections_of_the_sidewalk', 'other'] })
        .has('indicate_the_structural_issues_other'),
    ).toBe(true)
  })

  it('reveals obstruction "Other" text box only when obstruction list includes Other', () => {
    const base = {
      _id: '12345',
      how_much_sidewalk_is_present_on: 'Whole block',
      is_there_any_structural_or_obst: 'Yes',
      is_the_issue_obstruction_relate: 'Yes',
    }
    expect(
      visible({ ...base, indicate_the_obstruction_relate: ['Construction'] })
        .has('indicate_the_obstruction_relate_other'),
    ).toBe(false)
    expect(
      visible({ ...base, indicate_the_obstruction_relate: ['Construction', 'other'] })
        .has('indicate_the_obstruction_relate_other'),
    ).toBe(true)
  })

  it('reveals "other safety concerns" text box only when that list includes Other', () => {
    const base = {
      _id: '12345',
      how_much_sidewalk_is_present_on: 'Whole block',
    }
    expect(
      visible({ ...base, if_there_are_any_other_safety_c: ['Poor_lighting_condition_at_nigh'] })
        .has('if_there_are_any_other_safety_c_other'),
    ).toBe(false)
    expect(
      visible({ ...base, if_there_are_any_other_safety_c: ['other'] })
        .has('if_there_are_any_other_safety_c_other'),
    ).toBe(true)
  })
})
