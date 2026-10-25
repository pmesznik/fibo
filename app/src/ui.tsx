import { useState, type ReactNode } from 'react'

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
