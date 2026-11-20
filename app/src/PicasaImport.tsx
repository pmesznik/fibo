import { useEffect, useMemo, useState } from 'react'
import { X } from './FiboIcons'
import { picasaImport, picasaScan, type PicasaReport, type PicasaScan } from './api'

const fmt = (n: number) => n.toLocaleString('pl-PL')
const pl = (n: number, one: string, few: string, many: string) =>
  n === 1 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many
const fold = (s: string) => s.split(/\s+/).filter(Boolean).join(' ').toLowerCase()

/**
 * Przenoszenie imion z Picasy 3. Program czyta tylko pliki .picasa.ini w folderach biblioteki (niczego w nich nie zmienia) i pokazuje imiona,
 * które znalazł. Wpisanie tego samego imienia w dwóch wierszach łączy je w jedną osobę, puste imię pomija wiersz.
 */
export function PicasaImport({ say, onClose, onDone }: { say: (m: string, kind?: 'ok' | 'err') => void; onClose: () => void; onDone: () => void }) {
  const [scan, setScan] = useState<PicasaScan | null>(null)
  const [to, setTo] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<PicasaReport | null>(null)

  useEffect(() => {
    let dead = false
    picasaScan().then((s) => {
      if (dead) return
      setScan(s)
      setTo(Object.fromEntries(s.names.map((n) => [n.key, n.name])))
    }).catch((e) => { if (!dead) { say(`Błąd: ${e}`, 'err'); onClose() } })
    return () => { dead = true }
  }, [say, onClose])

  // Podobne imiona (to samo pierwsze słowo, np. „Martyna”, „Martyna Knebel”): podpowiedź, że może to jedna osoba.
  const similar = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const n of scan?.names ?? []) {
      const first = fold(to[n.key] ?? n.name).split(' ')[0]
      if (first) m.set(first, [...(m.get(first) ?? []), n.name])
    }
    return m
  }, [scan, to])

  const total = (scan?.names ?? []).reduce((s, n) => s + (fold(to[n.key] ?? '') ? n.matched : 0), 0)
  const people = new Set((scan?.names ?? []).filter((n) => fold(to[n.key] ?? '')).map((n) => fold(to[n.key]))).size

  const run = async () => {
    if (!scan || busy) return
    setBusy(true)
    try {
      const r = await picasaImport(scan.names.map((n) => ({ key: n.key, to: to[n.key] ?? '' })))
      setReport(r)
      onDone()
      say(`Z Picasy przeniesiono ${fmt(r.imported)} ${pl(r.imported, 'twarz', 'twarze', 'twarzy')}`, 'ok')
    } catch (e) { say(`Błąd: ${e}`, 'err') }
    setBusy(false)
  }

  return (
    <>
      <div className="fixed inset-0 z-[1700]" style={{ background: 'rgba(0,0,0,.45)' }} onClick={busy ? undefined : onClose} />
      <div className="glass fixed left-1/2 top-1/2 z-[1800] flex max-h-[88vh] w-[min(94vw,700px)] -translate-x-1/2 -translate-y-1/2 flex-col" style={{ borderRadius: 'var(--r-lg)' }} role="dialog" aria-label="Przenieś osoby z Picasy">
        <div className="dr-head" style={{ paddingBottom: 0 }}>
          <span>Przenieś osoby z Picasy</span>
          <button className="ico" aria-label="Zamknij" disabled={busy} onClick={onClose}><X size={22} /></button>
        </div>

        {!scan && <div className="empty" style={{ height: 180 }}>Czytam pliki Picasy w folderach biblioteki…</div>}

        {scan && report && (
          <div className="sheet-body" style={{ padding: '8px 16px 16px' }}>
            <p style={{ margin: '4px 0 10px' }}>Gotowe. Przeniesiono <b>{fmt(report.imported)}</b> {pl(report.imported, 'twarz', 'twarze', 'twarzy')}{report.people_created > 0 && <>, w tym założono {fmt(report.people_created)} {pl(report.people_created, 'nową osobę', 'nowe osoby', 'nowych osób')}</>}. Twarze są potwierdzone.</p>
            {(report.kept > 0 || report.conflicts > 0) && (
              <p style={{ margin: '0 0 10px', color: 'var(--muted)', fontSize: 13 }}>
                {report.kept > 0 && <>Pominięto {fmt(report.kept)}, bo ustawiłeś je już w FIBO. </>}
                {report.conflicts > 0 && <>Pominięto {fmt(report.conflicts)}, bo ta osoba miała już inną twarz na tym zdjęciu.</>}
              </p>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="chip accent" onClick={onClose}>Zamknij</button></div>
          </div>
        )}

        {scan && !report && (
          <>
            <div style={{ padding: '4px 16px 8px', color: 'var(--muted)', fontSize: 13 }}>
              Znaleziono {fmt(scan.named)} {pl(scan.named, 'nazwaną twarz', 'nazwane twarze', 'nazwanych twarzy')} w {fmt(scan.files)} {pl(scan.files, 'folderze', 'folderach', 'folderach')} biblioteki. Pliki Picasy są tylko czytane.
              {' '}Przenieść da się te, które FIBO wykrył na zdjęciu{scan.no_face + scan.no_photo > 0 && <> ({fmt(scan.no_face)} bez wykrytej twarzy, {fmt(scan.no_photo)} ze zdjęć spoza biblioteki)</>}.
              {' '}Wpisz to samo imię w dwóch wierszach, żeby je połączyć, a puste imię pomija wiersz.
            </div>
            {scan.names.length === 0 ? (
              <div className="empty" style={{ height: 160 }}>Nie znaleziono imion z Picasy w folderach biblioteki.</div>
            ) : (
              <div className="sheet-body" style={{ padding: '0 16px 8px' }}>
                {scan.names.map((n) => {
                  const mine = fold(to[n.key] ?? n.name).split(' ')[0]
                  const others = (similar.get(mine) ?? []).filter((x) => x !== n.name)
                  return (
                    <div key={n.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--line, rgba(128,128,128,.2))', opacity: fold(to[n.key] ?? '') ? 1 : 0.5 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <input type="text" aria-label={`Imię w FIBO dla „${n.name}” z Picasy`} value={to[n.key] ?? ''} placeholder="(pomiń)" style={{ width: '100%' }}
                          onChange={(e) => setTo((t) => ({ ...t, [n.key]: e.target.value }))} />
                        <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 3 }}>
                          {n.existing !== null && <span className="state-on">już jest w FIBO</span>}
                          {n.existing !== null && (n.variants.length > 0 || others.length > 0) && ' · '}
                          {n.variants.length > 0 && <>połączone: {n.variants.join(', ')}</>}
                          {n.variants.length > 0 && others.length > 0 && ' · '}
                          {others.length > 0 && <>podobne: {others.slice(0, 3).join(', ')}</>}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', whiteSpace: 'nowrap', fontSize: 13 }}>
                        <b>{fmt(n.matched)}</b>
                        <div style={{ color: 'var(--muted)', fontSize: 12 }}>z {fmt(n.faces)}</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px 14px' }}>
              <span style={{ color: 'var(--muted)', fontSize: 13, flex: 1 }}>{fmt(total)} {pl(total, 'twarz', 'twarze', 'twarzy')} do {fmt(people)} {pl(people, 'osoby', 'osób', 'osób')}, jako potwierdzone</span>
              <button className="chip" disabled={busy} onClick={onClose}>Anuluj</button>
              <button className="chip accent" disabled={busy || total === 0} onClick={run}>{busy ? 'Przenoszę…' : `Przenieś ${fmt(total)}`}</button>
            </div>
          </>
        )}
      </div>
    </>
  )
}
