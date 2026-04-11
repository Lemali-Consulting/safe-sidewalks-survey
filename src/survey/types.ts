export type AnswerValue = string | string[] | null | undefined

export type Answers = Record<string, AnswerValue>

export type ChoiceList = Array<{ code: string; label: string }>

export type QuestionType =
  | 'text'
  | 'email'
  | 'longtext'
  | 'select_one'
  | 'select_many'
  | 'photo'

export interface Question {
  name: string
  label: string
  hint?: string
  type: QuestionType
  required?: boolean
  choices?: ChoiceList
  /** Returns true if the question should be shown given current answers. */
  relevant?: (answers: Answers) => boolean
}

export interface Section {
  title: string
  description?: string
  questions: Question[]
}
