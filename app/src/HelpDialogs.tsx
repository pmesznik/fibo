import { useMemo } from 'react'
import { X } from './FiboIcons'
import type { Photo } from './api'
import { useEscape } from './ui'

function Shell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEscape(onClose)
  return (
    <>
      <div className="fixed inset-0 z-[1700]" style={{ background: 'rgba(0,0,0,.45)' }} onClick={onClose} />
      <div className="glass fixed left-1/2 top-1/2 z-[1800] flex max-h-[85vh] w-[min(92vw,480px)] -translate-x-1/2 -translate-y-1/2 flex-col" style={{ borderRadius: 'var(--r-lg)' }} role="dialog" aria-label={title}>
        <div className="dr-head" style={{ paddingBottom: 0 }}>
          <span>{title}</span>
          <button className="ico" aria-label="Zamknij" onClick={onClose}><X size={22} /></button>
        </div>
        <div style={{ padding: '4px 16px 16px', overflowY: 'auto' }}>{children}</div>
      </div>
    </>
  )
}

const SHORTCUTS: [string, string][] = [
  ['0 – 5', 'Ocena zaznaczonych zdjęć (0 czyści ocenę)'],
  ['F', 'Dodaj lub usuń z ulubionych'],
  ['C', 'Porównaj 2 do 4 zaznaczonych zdjęć obok siebie (wspólne powiększenie)'],
  ['P, X, U', 'Flaga selekcji: wybierz, odrzuć, zdejmij (powtórzony klawisz zdejmuje flagę)'],
  ['6, 7, 8, 9', 'Etykieta kolorowa: czerwona, żółta, zielona, niebieska (powtórzony klawisz ją zdejmuje)'],
  ['Enter', 'Otwórz zaznaczone zdjęcie'],
  ['Prawy przycisk', 'Menu: tagi, album, nazwa, data, lokalizacja, eksport, ukrywanie, Kosz'],
  ['? lub F1', 'Ta lista skrótów'],
  ['Esc', 'Zamknij okno, menu lub panel'],
  ['Podgląd: ← →', 'Poprzednie i następne zdjęcie'],
  ['Podgląd: E', 'Edycja zdjęcia'],
  ['Podgląd: F', 'Ulubione'],
  ['Podgląd: spacja', 'Pokaz slajdów'],
  ['Podgląd: + − i kółko', 'Powiększanie'],
  ['Podgląd: B', 'Przytrzymaj, aby zobaczyć oryginał'],
  ['Podgląd: Ctrl+Z, Ctrl+Y', 'Cofnij i ponów zmiany w edytorze'],
]

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Shell title="Skróty klawiszowe" onClose={onClose}>
      <dl style={{ margin: 0 }}>
        {SHORTCUTS.map(([k, d]) => (
          <div key={k} style={{ display: 'flex', gap: 12, padding: '6px 0', borderBottom: '1px solid var(--glass-line)' }}>
            <dt style={{ flex: '0 0 180px', fontWeight: 650, fontSize: 13.5 }}>{k}</dt>
            <dd style={{ margin: 0, color: 'var(--muted)', fontSize: 13.5 }}>{d}</dd>
          </div>
        ))}
      </dl>
    </Shell>
  )
}

const mb = (b: number) => (b >= 1073741824 ? `${(b / 1073741824).toFixed(2)} GB` : `${(b / 1048576).toFixed(1)} MB`)
const whenYear = (p: Photo) => (p.taken && /^\d{4}/.test(p.taken) ? p.taken.slice(0, 4) : new Date(p.modified * 1000).getFullYear().toString())

/** Statystyki biblioteki liczone lokalnie na liście zdjęć. */
export function StatsDialog({ photos, onClose }: { photos: Photo[]; onClose: () => void }) {
  const s = useMemo(() => {
    const years = new Map<string, number>()
    const cams = new Map<string, number>()
    let size = 0, tagged = 0, geo = 0, rated = 0, fav = 0, captioned = 0
    for (const p of photos) {
      size += p.size
      years.set(whenYear(p), (years.get(whenYear(p)) ?? 0) + 1)
      if (p.camera) cams.set(p.camera, (cams.get(p.camera) ?? 0) + 1)
      if (p.tags.length) tagged++
      if (p.lat != null && p.lon != null) geo++
      if (p.rating > 0) rated++
      if (p.favorite) fav++
      if (p.caption) captioned++
    }
    const top = (m: Map<string, number>, n: number) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
    return { size, tagged, geo, rated, fav, captioned, years: [...years.entries()].sort((a, b) => b[0].localeCompare(a[0])), cams: top(cams, 5) }
  }, [photos])
  const pct = (n: number) => (photos.length ? `${n} (${Math.round((n / photos.length) * 100)}%)` : '0')
  const rows: [string, string][] = [
    ['Zdjęcia', String(photos.length)], ['Łączny rozmiar', mb(s.size)], ['Z tagami', pct(s.tagged)], ['Z lokalizacją', pct(s.geo)],
    ['Z oceną', pct(s.rated)], ['Ulubione', pct(s.fav)], ['Z opisem', pct(s.captioned)],
  ]
  const maxYear = Math.max(1, ...s.years.map((y) => y[1]))
  return (
    <Shell title="Statystyki biblioteki" onClose={onClose}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid var(--glass-line)', fontSize: 14 }}>
          <span style={{ color: 'var(--muted)' }}>{k}</span><b>{v}</b>
        </div>
      ))}
      {s.years.length > 0 && (
        <>
          <h3 style={{ margin: '14px 0 6px', fontSize: 14 }}>Zdjęcia według lat</h3>
          {s.years.map(([y, n]) => (
            <div key={y} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, margin: '3px 0' }}>
              <span style={{ width: 40 }}>{y}</span>
              <div style={{ flex: 1, background: 'var(--tonal)', borderRadius: 4, height: 10 }}><div style={{ width: `${(n / maxYear) * 100}%`, height: '100%', background: 'var(--accent)', borderRadius: 4 }} /></div>
              <span style={{ width: 44, textAlign: 'right' }}>{n}</span>
            </div>
          ))}
        </>
      )}
      {s.cams.length > 0 && (
        <>
          <h3 style={{ margin: '14px 0 6px', fontSize: 14 }}>Najczęstsze aparaty</h3>
          {s.cams.map(([c, n]) => (
            <div key={c} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, padding: '3px 0' }}><span className="truncate">{c}</span><b>{n}</b></div>
          ))}
        </>
      )}
    </Shell>
  )
}
