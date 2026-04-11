import { useEffect, useState } from 'react'

const KEY = 'better-survey:contact'

interface Contact {
  name?: string
  email?: string
  if_on_behalf_of_any_organizatio?: string
}

export function useContactStorage(): [Contact, (next: Contact) => void] {
  const [contact, setContact] = useState<Contact>(() => {
    try {
      const raw = localStorage.getItem(KEY)
      return raw ? (JSON.parse(raw) as Contact) : {}
    } catch {
      return {}
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(contact))
    } catch {
      /* storage quota / disabled — ignore */
    }
  }, [contact])

  return [contact, setContact]
}
