import type { Answers, AnswerValue, Question, Section } from './types'

const hasValue = (v: AnswerValue) => {
  if (v == null) return false
  if (Array.isArray(v)) return v.length > 0
  return String(v).length > 0
}

const includes = (v: AnswerValue, code: string) =>
  Array.isArray(v) ? v.includes(code) : false

const segmentPicked = (a: Answers) => hasValue(a._id)

const hasSidewalk = (a: Answers) =>
  segmentPicked(a) &&
  hasValue(a.how_much_sidewalk_is_present_on) &&
  a.how_much_sidewalk_is_present_on !== 'No sidewalk'

const issuesPresent = (a: Answers) =>
  hasSidewalk(a) && a.is_there_any_structural_or_obst === 'Yes'

// Matches Survey123 coded values. Some display labels are longer than the
// stored code — we keep codes identical to what the FeatureServer expects.
const CHOICE = {
  howMuchSidewalk: [
    { code: 'No sidewalk', label: 'No sidewalk' },
    { code: 'Less than half the block', label: 'Less than half the block' },
    { code: 'More than half the block', label: 'More than half the block' },
    { code: 'Whole block', label: 'Whole block' },
  ],
  width: [
    { code: 'Less than 4 feet', label: 'Less than 4 feet' },
    { code: '4 feet or wider', label: '4 feet or wider' },
  ],
  accessible: [
    {
      code: 'Less than half the block on thi',
      label: 'Less than half the block on this side of the sidewalk',
    },
    {
      code: 'More than half the block on thi',
      label: 'More than half the block on this side of the sidewalk',
    },
    {
      code: 'Whole block on this side of the',
      label: 'Whole block on this side of the sidewalk',
    },
  ],
  yesNo: [
    { code: 'Yes', label: 'Yes' },
    { code: 'No', label: 'No' },
  ],
  structuralIssues: [
    { code: 'Poor_sidewalk_surface_or_cracke', label: 'Poor or cracked sidewalk surface' },
    { code: 'Uneven_sections_of_the_sidewalk', label: 'Uneven sections of the sidewalk' },
    { code: 'Vegetation/overgrowth_', label: 'Vegetation / overgrowth' },
    { code: 'other', label: 'Other (please describe)' },
  ],
  obstructionIssues: [
    { code: 'Trash_can_blocking_sidewalk_', label: 'Trash can blocking sidewalk' },
    { code: 'Sidewalk_parking_', label: 'Sidewalk parking' },
    { code: 'Blocked_by_pole_(less_than_4_fe', label: 'Blocked by pole (less than 4 feet available)' },
    { code: 'Construction', label: 'Construction' },
    { code: 'other', label: 'Other (please describe)' },
  ],
  otherSafety: [
    { code: 'Poor_lighting_condition_at_nigh', label: 'Poor lighting condition at night' },
    { code: 'Poor_visibility_at_the_crosswal', label: 'Poor visibility at the crosswalk' },
    { code: 'other', label: 'Other (please describe)' },
  ],
  ada: [
    { code: 'Both corners are good', label: 'Both corners are good' },
    {
      code: 'Both corners are missing or in',
      label: 'Both corners are missing or in poor condition',
    },
    {
      code: 'One corner is good; one corner',
      label: 'One corner is good; one corner is missing or in poor condition',
    },
  ],
} as const

export const sections: Section[] = [
  {
    title: 'Sidewalk condition',
    description: 'Questions about the sidewalk segment you picked on the map.',
    questions: [
      {
        name: '_id',
        label: 'Sidewalk segment ID',
        type: 'text',
        required: true,
        // _id is auto-filled from the map click — the UI hides it, but it
        // still needs to round-trip through the schema.
      },
      {
        name: 'how_much_sidewalk_is_present_on',
        label: 'How much sidewalk is present on this side of the street?',
        type: 'select_one',
        choices: [...CHOICE.howMuchSidewalk],
        relevant: segmentPicked,
      },
      {
        name: 'what_is_the_width_of_the_sidewa',
        label: 'What is the width of the sidewalk at its narrowest point?',
        type: 'select_one',
        choices: [...CHOICE.width],
        relevant: hasSidewalk,
      },
      {
        name: '_do_you_think_you_could_use_thi',
        label:
          'How much of the sidewalk is safely accessible & navigable while walking or with a wheelchair or stroller?',
        hint: 'A safely accessible and navigable sidewalk should have a firm, stable, slip-resistant surface with minimal height changes.',
        type: 'select_one',
        choices: [...CHOICE.accessible],
        relevant: hasSidewalk,
      },
      {
        name: 'is_there_any_structural_or_obst',
        label:
          'Are there any structural or obstruction issues present on this side of the sidewalk?',
        type: 'select_one',
        choices: [...CHOICE.yesNo],
        relevant: hasSidewalk,
      },
      {
        name: 'is_the_issue_structural',
        label: 'Is the issue structural?',
        type: 'select_one',
        choices: [...CHOICE.yesNo],
        relevant: issuesPresent,
      },
      {
        name: 'indicate_the_structural_issues',
        label: 'Indicate the structural issue(s)',
        type: 'select_many',
        choices: [...CHOICE.structuralIssues],
        relevant: (a) => issuesPresent(a) && a.is_the_issue_structural === 'Yes',
      },
      {
        name: 'indicate_the_structural_issues_other',
        label: 'Please describe the other structural issue',
        type: 'text',
        relevant: (a) =>
          issuesPresent(a) &&
          a.is_the_issue_structural === 'Yes' &&
          includes(a.indicate_the_structural_issues, 'other'),
      },
      {
        name: 'is_the_issue_obstruction_relate',
        label: 'Is the issue obstruction related?',
        type: 'select_one',
        choices: [...CHOICE.yesNo],
        relevant: issuesPresent,
      },
      {
        name: 'indicate_the_obstruction_relate',
        label: 'Indicate the obstruction related issue(s)',
        type: 'select_many',
        choices: [...CHOICE.obstructionIssues],
        relevant: (a) => issuesPresent(a) && a.is_the_issue_obstruction_relate === 'Yes',
      },
      {
        name: 'indicate_the_obstruction_relate_other',
        label: 'Please describe the other obstruction issue',
        type: 'text',
        relevant: (a) =>
          issuesPresent(a) &&
          a.is_the_issue_obstruction_relate === 'Yes' &&
          includes(a.indicate_the_obstruction_relate, 'other'),
      },
      {
        name: 'if_there_are_any_other_safety_c',
        label: 'Any other safety concerns?',
        type: 'select_many',
        choices: [...CHOICE.otherSafety],
        relevant: hasSidewalk,
      },
      {
        name: 'if_there_are_any_other_safety_c_other',
        label: 'Please describe the other safety concern',
        type: 'text',
        relevant: (a) =>
          hasSidewalk(a) && includes(a.if_there_are_any_other_safety_c, 'other'),
      },
    ],
  },
  {
    title: 'ADA ramps & DWS',
    description:
      'Condition of the ADA ramp and Detectable Warning Surface at both ends of this block.',
    questions: [
      {
        name: 'field_36',
        label:
          'What is the condition of the ADA ramp & DWS on this side at both ends of the sidewalk?',
        type: 'select_one',
        choices: [...CHOICE.ada],
        relevant: segmentPicked,
      },
      {
        name: 'other_ada_dws_comments',
        label: 'Other ADA & DWS comments',
        type: 'longtext',
        relevant: segmentPicked,
      },
    ],
  },
  {
    title: 'Photos',
    description: 'Upload up to 5 photos showing the conditions you just described.',
    questions: [
      {
        name: 'please_provide_a_photo_of_the_s',
        label: 'Photos of the sidewalk conditions',
        type: 'photo',
        relevant: segmentPicked,
      },
    ],
  },
  {
    title: 'Your contact info',
    description:
      'Saved locally in your browser so you do not have to re-enter it next time.',
    questions: [
      {
        name: 'name',
        label: 'Username',
        type: 'text',
        required: true,
      },
      {
        name: 'email',
        label: 'Email address',
        type: 'email',
        required: true,
      },
      {
        name: 'if_on_behalf_of_any_organizatio',
        label: 'If on behalf of any organization, name of the organization',
        type: 'text',
      },
    ],
  },
]

export const questions: Question[] = sections.flatMap((s) => s.questions)
