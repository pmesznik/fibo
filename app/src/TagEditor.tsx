import { useMemo, useState } from 'react'
import { Plus, X } from './FiboIcons'
import type { Photo } from './api'
import { Chip } from './ui'

export type TagCount = { name: string; count: number }

/** Dodawanie i zdejmowanie tagów dla jednego lub wielu zdjęć. */
export function TagEditor({ photos, allTags, onAdd, onRemove }: {
  photos: Photo[]
  allTags: TagCount[]
  onAdd: (tag: string) => void
  onRemove: (tag: string) => void
}) {
  const [text, setText] = useState('')
  const n = photos.length

  // Tagi zdjęć wraz z liczbą zdjęć, które je mają (przy wielu zdjęciach bywa "2/5").
  const own = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of photos) for (const t of p.tags) m.set(t, (m.get(t) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pl'))
  }, [photos])

  const q = text.trim().toLowerCase()
  const suggestions = allTags
    .filter((t) => (own.find(([o]) => o === t.name)?.[1] ?? 0) < n && (!q || t.name.includes(q)))
    .slice(0, 10)

  const submit = (value: string) => {
    if (!value.trim()) return
    onAdd(value)
    setText('')
  }

  return (
    <div>
      <label htmlFor="tag-input" style={{ marginTop: 0 }}>Dodaj tag</label>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          id="tag-input" type="text" value={text} maxLength={40} placeholder="np. wakacje"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(text) } }}
          autoComplete="off"
        />
        <button className="ico" aria-label="Dodaj tag" disabled={!text.trim()} onClick={() => submit(text)}
          style={{ background: 'var(--accent)', color: '#fff', minWidth: 46, borderRadius: 14 }}><Plus size={20} /></button>
      </div>

      {suggestions.length > 0 && (
        <>
          <label>{q ? 'Pasujące tagi' : 'Istniejące tagi'}</label>
          <div className="chips">
            {suggestions.map((t) => <Chip key={t.name} onClick={() => submit(t.name)} label={`Dodaj tag ${t.name}`}>{t.name} <b>{t.count}</b></Chip>)}
          </div>
        </>
      )}

      <label>{n > 1 ? `Tagi zaznaczonych zdjęć (${n})` : 'Tagi tego zdjęcia'}</label>
      {own.length === 0 ? (
        <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13 }}>Brak tagów. Wpisz nazwę powyżej i zatwierdź Enterem.</p>
      ) : (
        <div className="chips">
          {own.map(([name, c]) => (
            <Chip key={name} on onClick={() => onRemove(name)} label={`Usuń tag ${name}`}>
              {name}{n > 1 && c < n ? ` ${c}/${n}` : ''} <X size={13} />
            </Chip>
          ))}
        </div>
      )}
    </div>
  )
}
