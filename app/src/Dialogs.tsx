import { useEffect, useRef, useState } from 'react'
import { FolderOpen, Plus, X } from './FiboIcons'
import type { Album } from './api'
import { pl } from './pl'
import { useEscape } from './ui'

function Shell({ title, onClose, children, label }: { title: string; onClose: () => void; children: React.ReactNode; label: string }) {
  useEscape(onClose)
  return (
    <>
      <div className="fixed inset-0 z-[2300]" style={{ background: 'rgba(0,0,0,.45)' }} onClick={onClose} />
      <div className="glass fixed left-1/2 top-1/2 z-[2400] flex max-h-[85vh] w-[min(94vw,420px)] -translate-x-1/2 -translate-y-1/2 flex-col"
        style={{ borderRadius: 'var(--r-lg)' }} role="dialog" aria-modal="true" aria-label={label}>
        <div className="dr-head" style={{ paddingBottom: 6 }}>
          <span style={{ fontSize: 20 }}>{title}</span>
          <button className="ico" aria-label="Zamknij" onClick={onClose}><X size={22} /></button>
        </div>
        <div style={{ padding: '0 16px 16px', overflowY: 'auto' }}>{children}</div>
      </div>
    </>
  )
}

/** Okno z jednym polem tekstowym (nowy album, zmiana nazwy). `onSubmit` zwraca komunikat błędu albo nic, gdy się udało. */
export function PromptDialog({ title, label, initial = '', confirm, hint, onSubmit, onClose }: {
  title: string; label: string; initial?: string; confirm: string; hint?: string
  onSubmit: (value: string) => Promise<string | void> | string | void
  onClose: () => void
}) {
  const [value, setValue] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { input.current?.focus(); input.current?.select() }, [])

  const submit = async () => {
    if (busy) return
    setBusy(true)
    try {
      const err = await onSubmit(value)
      if (err) setError(err); else onClose()
    } catch (e) { setError(String(e)) } finally { setBusy(false) }
  }

  return (
    <Shell title={title} onClose={onClose} label={title}>
      <label htmlFor="prompt-input" style={{ marginTop: 0 }}>{label}</label>
      <input id="prompt-input" ref={input} type="text" value={value} onChange={(e) => { setValue(e.target.value); setError(null) }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit() } }} autoComplete="off" />
      {hint && !error && <p style={{ margin: '8px 2px 0', fontSize: 13, color: 'var(--muted)' }}>{hint}</p>}
      {error && <p role="alert" style={{ margin: '8px 2px 0', fontSize: 13.5, color: 'var(--err)' }}>{error}</p>}
      <button className="primary" style={{ marginTop: 14 }} disabled={busy || !value.trim()} onClick={submit}>{busy ? 'Chwila…' : confirm}</button>
      <button className="wide" onClick={onClose}>Anuluj</button>
    </Shell>
  )
}

/** Wybór albumu, do którego dodać zaznaczone zdjęcia, albo założenie nowego. */
export function AlbumPicker({ albums, count, onPick, onCreate, onClose }: {
  albums: Album[]
  count: number
  onPick: (album: Album) => void
  onCreate: () => void
  onClose: () => void
}) {
  return (
    <Shell title="Dodaj do albumu" onClose={onClose} label="Dodaj do albumu">
      <p style={{ margin: '0 0 10px', color: 'var(--muted)', fontSize: 13.5 }}>
        {count} {pl(count, 'zdjęcie', 'zdjęcia', 'zdjęć')}. Zdjęcie może być w wielu albumach, a pliki zostają na swoim miejscu.
      </p>
      <button className="wide" style={{ marginTop: 0 }} onClick={onCreate}><Plus size={18} /> Nowy album…</button>
      {albums.length === 0 && <p style={{ margin: '12px 2px 0', color: 'var(--muted)', fontSize: 13.5 }}>Nie masz jeszcze albumów. Załóż pierwszy przyciskiem powyżej.</p>}
      {albums.map((a) => (
        <button key={a.id} className="item" style={{ width: '100%', textAlign: 'left', cursor: 'pointer', color: 'var(--text)' }} onClick={() => onPick(a)}>
          <span className="ico" style={{ display: 'grid', placeItems: 'center', color: 'var(--accent)' }}><FolderOpen size={20} /></span>
          <span className="truncate" style={{ flex: 1, fontWeight: 600 }}>{a.name}</span>
          <small style={{ color: 'var(--muted)', paddingRight: 6 }}>{a.count}</small>
        </button>
      ))}
    </Shell>
  )
}
