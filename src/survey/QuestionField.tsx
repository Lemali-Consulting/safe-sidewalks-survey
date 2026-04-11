import type { Answers, AnswerValue, Question } from './types'

interface Props {
  question: Question
  value: AnswerValue
  onChange: (value: AnswerValue) => void
  allAnswers: Answers
}

export default function QuestionField({ question, value, onChange }: Props) {
  return (
    <div className="space-y-2">
      <label className="block">
        <span className="text-sm font-semibold text-gray-900">
          {question.label}
          {question.required && <span className="ml-1 text-rose-600">*</span>}
        </span>
        {question.hint && (
          <span className="mt-1 block text-xs text-gray-500">{question.hint}</span>
        )}
      </label>
      {renderInput(question, value, onChange)}
    </div>
  )
}

function renderInput(
  question: Question,
  value: AnswerValue,
  onChange: (value: AnswerValue) => void,
) {
  switch (question.type) {
    case 'text':
    case 'email':
      return (
        <input
          type={question.type}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30"
        />
      )
    case 'longtext':
      return (
        <textarea
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30"
        />
      )
    case 'select_one':
      return (
        <div className="space-y-1.5">
          {question.choices?.map((c) => (
            <label
              key={c.code}
              className="flex cursor-pointer items-start gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50 has-[:checked]:border-sky-500 has-[:checked]:bg-sky-50"
            >
              <input
                type="radio"
                name={question.name}
                value={c.code}
                checked={value === c.code}
                onChange={() => onChange(c.code)}
                className="mt-0.5"
              />
              <span>{c.label}</span>
            </label>
          ))}
        </div>
      )
    case 'select_many': {
      const current = Array.isArray(value) ? value : []
      return (
        <div className="space-y-1.5">
          {question.choices?.map((c) => {
            const checked = current.includes(c.code)
            return (
              <label
                key={c.code}
                className="flex cursor-pointer items-start gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50 has-[:checked]:border-sky-500 has-[:checked]:bg-sky-50"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    const next = checked
                      ? current.filter((x) => x !== c.code)
                      : [...current, c.code]
                    onChange(next)
                  }}
                  className="mt-0.5"
                />
                <span>{c.label}</span>
              </label>
            )
          })}
        </div>
      )
    }
    case 'photo':
      // Photos are handled by the PhotoUploader component outside this field.
      return null
  }
}
