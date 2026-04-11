import type { Answers, Question } from './types'

export function isVisible(question: Question, answers: Answers): boolean {
  return question.relevant ? question.relevant(answers) : true
}

export function visibleFieldNames(
  questions: Question[],
  answers: Answers,
): string[] {
  return questions.filter((q) => isVisible(q, answers)).map((q) => q.name)
}
