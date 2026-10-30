import { useEffect, useState, type ReactNode, useRef } from 'react'

const KEY = 'sec-open'
const load = (): Record<string, boolean> => {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') } catch { return {} }
}

/** Sekcja rozwijana; stan otwarte/zwinięte jest zapamiętywany (standard, 7.5). */
export function Sec({ id, icon, title, hint, defaultOpen = false, children }: {
  id: string; icon: ReactNode; title: string; hint?: string; defaultOpen?: boolean; children: ReactNode
}) {
  const [open, setOpen] = useState(() => load()[id] ?? defaultOpen)
  return (
    <details
      className="sec"
      open={open}
      onToggle={(e) => {
        const o = (e.currentTarget as HTMLDetailsElement).open
        setOpen(o)
        try { localStorage.setItem(KEY, JSON.stringify({ ...load(), [id]: o })) } catch { /* brak pamięci */ }
      }}
    >
      <summary>
        <span className="ic">{icon}</span>
        <span>{title}{hint && <span className="st">{hint}</span>}</span>
      </summary>
      <div className="sec-body">{children}</div>
    </details>
  )
}

export function Chip({ on, off, onClick, children, label }: {
  on?: boolean; off?: boolean; onClick?: () => void; children: ReactNode; label?: string
}) {
  return (
    <button type="button" aria-pressed={on} aria-label={label} onClick={onClick} className={`chip ${on ? 'on' : ''} ${off ? 'off' : ''}`}>
      {children}
    </button>
  )
}

export function Toast({ text, kind }: { text: string | null; kind?: 'ok' | 'err' }) {
  if (!text) return null
  return <div role="status" className={`toast ${kind ?? ''}`}>{text}</div>
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
const focusables = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0)
/** Najwyższe okno dialogowe: okna renderowane później leżą w drzewie niżej, więc to ostatni element z rolą dialog. */
const topDialog = () => { const all = document.querySelectorAll<HTMLElement>('[role=dialog]'); return all[all.length - 1] ?? null }

/**
 * Wspólna obsługa okna dialogowego: Escape zamyka, fokus trafia do okna (jeśli nic w nim jeszcze nie ma fokusu), Tab krąży tylko po jego elementach,
 * a po zamknięciu fokus wraca tam, gdzie był. `active` = false wyłącza obsługę, gdy okno jest ukryte.
 */
export function useEscape(onClose: () => void, active = true) {
  // Najnowsza funkcja zamykająca w referencji: okna tworzą ją od nowa przy każdym renderze, a efekt (fokus) nie może się przez to powtarzać.
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    if (!active) return
    const previous = document.activeElement as HTMLElement | null
    const raf = requestAnimationFrame(() => {
      const d = topDialog()
      if (d && !d.contains(document.activeElement)) (focusables(d)[0] ?? d).focus({ preventScroll: true })
    })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeRef.current(); return }
      if (e.key !== 'Tab') return
      const d = topDialog()
      if (!d) return
      const list = focusables(d)
      if (!list.length) { e.preventDefault(); d.focus(); return }
      const here = document.activeElement as HTMLElement | null
      const outside = !here || !d.contains(here)
      if (e.shiftKey && (outside || here === list[0])) { e.preventDefault(); list[list.length - 1].focus() }
      else if (!e.shiftKey && (outside || here === list[list.length - 1])) { e.preventDefault(); list[0].focus() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKey, true)
      if (previous && previous !== document.body && document.contains(previous)) previous.focus({ preventScroll: true })
    }
  }, [active])
}
