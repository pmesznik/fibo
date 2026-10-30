// Pobiera modele rozpoznawania twarzy (raz, podczas budowania) i sprawdza ich sumy SHA256.
// Gotowy program nie pobiera niczego z internetu: modele są dołączone do instalatora.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src-tauri', 'models')
const BASE = 'https://github.com/opencv/opencv_zoo/raw/main/models'
// Przypięte sumy. Zmiana pliku w repozytorium źródłowym przerwie budowanie zamiast po cichu zmienić program.
export const MODELS = [
  { file: 'yunet.onnx', url: `${BASE}/face_detection_yunet/face_detection_yunet_2023mar.onnx`, sha256: '8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4', license: 'MIT' },
  { file: 'aura.onnx', url: 'https://huggingface.co/fal/AuraFace-v1/resolve/main/glintr100.onnx', sha256: 'a7933ea5330113b01c9b60351d8f4c33003f145d8470ac5f0e52ee2effe25c60', license: 'Apache-2.0' },
]

const sha = (b) => createHash('sha256').update(b).digest('hex')
mkdirSync(dir, { recursive: true })
for (const m of MODELS) {
  const path = join(dir, m.file)
  if (existsSync(path) && sha(readFileSync(path)) === m.sha256) { console.log(`ok   ${m.file}`); continue }
  console.log(`pobieram ${m.file}`)
  const res = await fetch(m.url)
  if (!res.ok) throw new Error(`${m.url}: ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (sha(buf) !== m.sha256) throw new Error(`${m.file}: zła suma SHA256 (${sha(buf)}), przerywam`)
  writeFileSync(path, buf)
  console.log(`ok   ${m.file}`)
}
