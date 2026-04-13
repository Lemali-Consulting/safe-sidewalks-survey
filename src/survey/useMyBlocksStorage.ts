import { useCallback, useState } from 'react'

const KEY = 'better-survey:my-blocks'

export function useMyBlocksStorage(): [Set<string>, (id: string) => void] {
  const [ids, setIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(KEY)
      return new Set(raw ? (JSON.parse(raw) as string[]) : [])
    } catch {
      return new Set()
    }
  })

  const add = useCallback((id: string) => {
    if (!id) return
    setIds((prev) => {
      if (prev.has(id)) return prev
      const next = new Set(prev)
      next.add(id)
      try {
        localStorage.setItem(KEY, JSON.stringify([...next]))
      } catch {
        /* storage quota / disabled — ignore */
      }
      return next
    })
  }, [])

  return [ids, add]
}
