import { useEffect, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { CalendarDays, Search, Check, Copy, Download, Images, Pause, RefreshCw, RotateCw, Save, Users, Wand2, X } from './FiboIcons'
import { clipStart, clipStop, facesStart, facesStop, inTauri, type FacesProgress } from './api'

type Kind = 'scan' | 'faces' | 'dups' | 'backup' | 'colors' | 'rotate' | 'export' | 'gallery' | 'pdf' | 'gif' | 'import' | 'check' | 'refresh' | 'sidecar' | 'paste' | 'calendar' | 'clip' | 'raw' | 'organize' | 'quality'
type Job = {
  kind: Kind
  done: number
  total: number
  faces: number
  grouping: boolean
  finished: boolean
  error: string | null
  /** Kliknięto „Wstrzymaj”, program jeszcze kończy bieżące zdjęcia. */
  stopping: boolean
  /** Zadanie zakończyło się przed końcem, bo je wstrzymano. */
  stopped: boolean
  /** Zdjęcia pominięte, bo ich plik był niedostępny. */
  skipped: number
  start: number
  /** Punkty pomiarowe (czas, zrobione) z ostatnich sekund do liczenia prędkości. */
  pts: { t: number; d: number }[]
  /** Wygładzona prędkość (elementy na sekundę) i jej historia do wykresu. */
  rate: number
  history: number[]
  doneAt: number | null
  /** Opis etapu, gdy zadanie ma kilka (np. „Porównuję zdjęcia…”). */
  label: string | null
}

const PHOTOS: [string, string, string] = ['zdjęcie', 'zdjęcia', 'zdjęć']
const META: Record<Kind, { title: string; unit: [string, string, string]; Icon: typeof Images }> = {
  scan: { title: 'Dodawanie zdjęć do biblioteki', unit: PHOTOS, Icon: Images },
  faces: { title: 'Rozpoznawanie twarzy', unit: PHOTOS, Icon: Users },
  dups: { title: 'Szukanie duplikatów', unit: PHOTOS, Icon: Copy },
  backup: { title: 'Kopia zdjęć na dysk', unit: PHOTOS, Icon: Save },
  colors: { title: 'Liczenie kolorów zdjęć', unit: PHOTOS, Icon: Images },
  rotate: { title: 'Obracanie zdjęć', unit: PHOTOS, Icon: RotateCw },
  export: { title: 'Eksport zdjęć', unit: PHOTOS, Icon: Download },
  gallery: { title: 'Tworzenie galerii HTML', unit: PHOTOS, Icon: Download },
  pdf: { title: 'Tworzenie pliku PDF', unit: PHOTOS, Icon: Download },
  gif: { title: 'Tworzenie animowanego GIF', unit: PHOTOS, Icon: Download },
  import: { title: 'Import z karty pamięci', unit: PHOTOS, Icon: Download },
  check: { title: 'Sprawdzanie plików', unit: ['plik', 'pliki', 'plików'], Icon: Check },
  refresh: { title: 'Odświeżanie danych zdjęć', unit: PHOTOS, Icon: RefreshCw },
  sidecar: { title: 'Zapis metadanych do plików XMP', unit: PHOTOS, Icon: Save },
  paste: { title: 'Wklejanie edycji do zdjęć', unit: PHOTOS, Icon: Wand2 },
  quality: { title: 'Ocena jakości zdjęć', unit: PHOTOS, Icon: Images },
  organize: { title: 'Porządkowanie zdjęć w folderach', unit: PHOTOS, Icon: Copy },
  raw: { title: 'Wywoływanie zdjęcia RAW', unit: PHOTOS, Icon: Images },
  clip: { title: 'Indeksowanie zdjęć do szukania po treści', unit: PHOTOS, Icon: Search },
  calendar: { title: 'Tworzenie kalendarza', unit: ['strona', 'strony', 'stron'], Icon: CalendarDays },
}

/** Zadanie z interfejsu (np. wklejanie edycji do wielu zdjęć) zgłasza postęp do okna postępu tak samo jak zadania z programu. */
export function reportJob(kind: Kind, done: number, total: number, finished = false) {
  window.dispatchEvent(new CustomEvent('fibo-job', { detail: { kind, done, total, finished } }))
}

const pl = (n: number, a: string, b: string, c: string) => (n === 1 ? a : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? b : c)
const fmt = (n: number) => n.toLocaleString('pl-PL')

/** Czas do końca zaokrąglony tak, żeby nie migał: do 10 s co sekundę, potem co 5 s, minuty i godziny. */
function eta(sec: number): string {
  if (!isFinite(sec) || sec < 0) return 'liczę…'
  if (sec < 5) return 'za chwilę'
  if (sec < 60) return `ok. ${Math.round(sec / 5) * 5} s`
  if (sec < 3600) { const m = Math.floor(sec / 60); const s = Math.round((sec % 60) / 10) * 10; return s === 60 ? `ok. ${m + 1} min` : `ok. ${m} min${s ? ` ${s} s` : ''}` }
  const h = Math.floor(sec / 3600); const m = Math.round((sec % 3600) / 60)
  return `ok. ${h} h ${m} min`
}
const dur = (ms: number) => { const s = Math.max(1, Math.round(ms / 1000)); return s < 60 ? `${s} s` : s < 3600 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min` }

/** Wykres prędkości: wypełniony obszar z gładką linią i świecącą kropką przy ostatnim pomiarze. */
function SpeedChart({ values, id }: { values: number[]; id: string }) {
  const W = 300, H = 64, P = 4
  if (values.length < 2) return <div style={{ height: H }} aria-hidden />
  const max = Math.max(...values, 0.001) * 1.15
  const pts = values.map((v, i) => [P + (i / (values.length - 1)) * (W - 2 * P), H - P - (v / max) * (H - 2 * P)] as [number, number])
  // Gładka krzywa (środki odcinków jako punkty kontrolne).
  const line = pts.map(([x, y], i) => {
    if (i === 0) return `M${x.toFixed(1)},${y.toFixed(1)}`
    const [px, py] = pts[i - 1]
    const cx = (px + x) / 2
    return `C${cx.toFixed(1)},${py.toFixed(1)} ${cx.toFixed(1)},${y.toFixed(1)} ${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${H - P} L${pts[0][0].toFixed(1)},${H - P} Z`
  const last = pts[pts.length - 1]
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="Wykres prędkości przetwarzania w czasie" style={{ display: 'block' }}>
      <defs>
        <linearGradient id={`${id}-a`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity=".55" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.33, 0.66].map((f) => <line key={f} x1={P} x2={W - P} y1={H - P - f * (H - 2 * P)} y2={H - P - f * (H - 2 * P)} stroke="var(--glass-line)" strokeDasharray="2 4" />)}
      <path d={area} fill={`url(#${id}-a)`} />
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="7" fill="var(--accent)" opacity=".18" className="pd-pulse" />
      <circle cx={last[0]} cy={last[1]} r="3.5" fill="var(--accent)" stroke="#fff" strokeWidth="1.5" />
    </svg>
  )
}

/** Zadania, które można wstrzymać i wznowić prosto z okienka postępu: rozpoznawanie twarzy i indeksowanie zdjęć po treści. */
const pausable = (j: Job) => j.kind === 'faces' || j.kind === 'clip'
const resumeJob = (k: Kind) => { (k === 'clip' ? clipStart() : facesStart()).catch(() => {}) }

function Card({ job, min, compact, onMin, onStop, onResume }: { job: Job; min: boolean; compact: boolean; onMin: () => void; onStop?: () => void; onResume?: () => void }) {
  const halted = job.finished && job.stopped
  const { title, unit, Icon } = META[job.kind]
  const pct = job.total > 0 ? Math.min(100, (job.done / job.total) * 100) : 0
  const left = job.total - job.done
  const sec = job.rate > 0 ? left / job.rate : Infinity
  const waiting = Date.now() - job.start < 2500 || job.pts.length < 3
  const staged = !!job.label && job.total > 0 && job.done >= job.total
  const indeterminate = job.grouping || job.total === 0 || staged
  const status = job.finished ? (halted ? 'Wstrzymano' : job.error ? 'Przerwano' : 'Gotowe') : job.stopping ? 'Wstrzymuję…' : job.grouping ? 'Grupowanie osób…' : staged ? job.label : null

  return (
    <div className={`glass pd-card${compact ? ' pd-compact' : ''}${halted || job.stopping ? ' pd-halt' : ''}`} role="group" aria-label={title}>
      <div className="pd-head">
        <span className="pd-ico" style={{ color: halted || job.stopping ? '#e0900f' : job.finished && !job.error ? 'var(--ok, #2e9d5b)' : 'var(--accent)' }}>{halted || job.stopping ? <Pause size={18} /> : job.finished && !job.error ? <Check size={18} /> : <Icon size={18} />}</span>
        <span className="pd-title">{title}</span>
        <button className="ico pd-btn" aria-label={min ? 'Rozwiń okno postępu' : 'Zwiń okno postępu'} title={min ? 'Rozwiń' : 'Zwiń'} onClick={onMin}>{min ? '▴' : '▾'}</button>
      </div>

      <div className="pd-bar" aria-hidden>
        <div className={`pd-fill${indeterminate && !job.finished && !job.stopping ? ' pd-indet' : ''}${halted || job.stopping ? ' pd-halted' : job.finished ? ' pd-done' : ''}`} style={{ width: indeterminate && !job.finished && !job.stopping ? '38%' : `${job.finished && !job.error && !halted ? 100 : pct}%` }} />
      </div>

      {!min && (
        <>
          <div className="pd-main">
            <span className="pd-pct">{job.finished && !job.error && !halted ? 100 : Math.floor(pct)}<small>%</small></span>
            <span className="pd-count">
              {job.total > 0 ? `${fmt(job.done)} z ${fmt(job.total)} ${pl(job.total, unit[0], unit[1], unit[2])}` : (job.label ?? (job.done > 0 ? fmt(job.done) : 'Przygotowuję…'))}
              {status && <b>{job.total > 0 ? ' · ' : ''}{status}</b>}
            </span>
          </div>

          {job.finished ? (
            <div className="pd-sum">
              {halted ? `Wstrzymano po ${dur((job.doneAt ?? Date.now()) - job.start)}. To, co policzono, zostało zapisane. Uruchom ponownie, żeby wznowić od tego miejsca.` : job.error ? job.error : `Zrobione w ${dur((job.doneAt ?? Date.now()) - job.start)}`}
              {job.kind === 'faces' && !job.error && !halted && ` · znaleziono ${fmt(job.faces)} ${pl(job.faces, 'twarz', 'twarze', 'twarzy')}`}
              {halted && onResume && <button className="wide pd-stop" style={{ marginTop: 8 }} onClick={onResume}><RefreshCw size={15} /> Wznów</button>}
              {job.skipped > 0 && ` Pominięto ${fmt(job.skipped)} ${pl(job.skipped, 'zdjęcie', 'zdjęcia', 'zdjęć')}, bo plik był niedostępny (np. odłączony dysk). Ich twarze zostają, a następna analiza spróbuje ponownie.`}
            </div>
          ) : (
            <>
              {!compact && <SpeedChart values={job.history} id={`pd-${job.kind}`} />}
              <div className="pd-stats">
                <div><span>Prędkość</span><b>{job.rate > 0 ? `${job.rate >= 10 ? Math.round(job.rate) : job.rate.toFixed(1).replace('.', ',')} / s` : '…'}</b></div>
                <div><span>Pozostało</span><b>{job.grouping ? 'chwila' : indeterminate ? '…' : waiting ? 'liczę…' : eta(sec)}</b></div>
                {job.kind === 'faces' ? <div><span>Twarze</span><b>{fmt(job.faces)}</b></div> : <div><span>Upłynęło</span><b>{dur(Date.now() - job.start)}</b></div>}
              </div>
              {onStop && <button className="wide pd-stop" disabled={job.stopping} onClick={onStop}><X size={15} /> {job.stopping ? 'Wstrzymuję, chwileczkę…' : 'Wstrzymaj (można wznowić)'}</button>}
            </>
          )}
        </>
      )}
    </div>
  )
}

/** Pływające okno postępu dla długich zadań w tle: dodawanie zdjęć do biblioteki i rozpoznawanie twarzy. Pokazuje się samo i znika po zakończeniu. */
export function ProgressDock() {
  const [jobs, setJobs] = useState<Partial<Record<Kind, Job>>>({})
  const [min, setMin] = useState(false)
  const [, tick] = useState(0)
  const timers = useRef<Partial<Record<Kind, number>>>({})

  useEffect(() => {
    if (!inTauri) return
    const touch = (kind: Kind, done: number, total: number, extra: Partial<Job> = {}) => {
      const now = Date.now()
      window.clearTimeout(timers.current[kind])
      setJobs((all) => {
        let j = all[kind]
        // Nowe zadanie (inny rozmiar albo licznik cofnięty) zaczyna pomiar od zera.
        if (!j || j.finished || total !== j.total || done < j.done) {
          j = { kind, done: 0, total, faces: 0, grouping: false, finished: false, error: null, stopping: false, stopped: false, skipped: 0, start: now, pts: [], rate: 0, history: [], doneAt: null, label: null }
        }
        const pts = [...j.pts, { t: now, d: done }].filter((p) => now - p.t <= 12000)
        let { rate, history } = j
        if (pts.length >= 2) {
          const a = pts[0]
          const dt = (now - a.t) / 1000
          if (dt > 0.4) {
            const inst = (done - a.d) / dt
            // Wygładzanie wykładnicze, żeby czas do końca nie skakał.
            rate = rate > 0 ? rate * 0.7 + inst * 0.3 : inst
            history = [...history, rate].slice(-60)
          }
        }
        return { ...all, [kind]: { ...j, ...extra, done, total, pts, rate, history } }
      })
    }
    const finish = (kind: Kind, extra: Partial<Job> = {}) => {
      setJobs((all) => {
        const j = all[kind]
        return j ? { ...all, [kind]: { ...j, ...extra, finished: true, grouping: false, stopping: false, doneAt: Date.now() } } : all
      })
      // Wstrzymane zadanie zostaje na ekranie dłużej, żeby było widać, że naprawdę stanęło.
      timers.current[kind] = window.setTimeout(() => setJobs((all) => { const { [kind]: _drop, ...rest } = all; return rest }), extra.stopped ? 20000 : 6000)
    }

    // Ogólne zadania z programu i z interfejsu: { kind, done, total, finished, label }.
    const onJob = (d: { kind: Kind; done: number; total: number; finished?: boolean; label?: string | null }) => {
      if (!(d.kind in META)) return
      if (d.finished) finish(d.kind)
      else touch(d.kind, d.done, d.total, { label: d.label ?? null })
    }
    const onWindowJob = (e: Event) => onJob((e as CustomEvent).detail)
    window.addEventListener('fibo-job', onWindowJob)
    const subs = [
      listen<{ kind: Kind; done: number; total: number; finished: boolean; label: string | null }>('job-progress', (e) => onJob(e.payload)),
      listen<[number, number]>('scan-stats', (e) => {
        const [done, total] = e.payload
        if (total === 0) return
        touch('scan', done, total)
        if (done >= total) finish('scan')
      }),
      listen<{ stopped: boolean; error: string | null }>('clip-done', (e) => finish('clip', { error: e.payload.error, stopped: !e.payload.error && !!e.payload.stopped })),
      listen<FacesProgress>('faces-progress', (e) => {
        const p = e.payload
        if (p.total === 0 && !p.finished) return
        touch('faces', p.done, p.total, { faces: p.faces, grouping: !!p.grouping })
        if (p.finished) finish('faces', { error: p.error, stopped: !p.error && !!p.stopped, skipped: p.skipped ?? 0 })
      }),
    ]
    const t = window.setInterval(() => tick((n) => n + 1), 1000)
    return () => { window.removeEventListener('fibo-job', onWindowJob); subs.forEach((s) => s.then((f) => f())); window.clearInterval(t); Object.values(timers.current).forEach((x) => window.clearTimeout(x)) }
  }, [])

  const stopJob = (k: Kind) => {
    setJobs((all) => (all[k] ? { ...all, [k]: { ...all[k]!, stopping: true } } : all))
    ;(k === 'clip' ? clipStop() : facesStop()).catch(() => {})
  }

  // Małe zadania (kilka zdjęć) nie migają oknem: pokazujemy je od 30 pozycji albo gdy trwają dłużej niż 1,5 s.
  const shown = (Object.keys(META) as Kind[]).map((k) => jobs[k]).filter((j): j is Job => !!j && (j.total >= 30 || Date.now() - j.start > 1500))
  if (!shown.length) return null
  return (
    <div className="pd-dock">
      {shown.map((j) => <Card key={j.kind} job={j} min={min} compact={shown.length > 1} onMin={() => setMin((m) => !m)} onResume={pausable(j) && j.finished && j.stopped ? () => { resumeJob(j.kind) } : undefined} onStop={pausable(j) && !j.finished ? () => { stopJob(j.kind) } : undefined} />)}
    </div>
  )
}
