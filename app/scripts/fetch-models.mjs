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
  { file: 'sface.onnx', url: `${BASE}/face_recognition_sface/face_recognition_sface_2021dec.onnx`, sha256: '0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79', license: 'Apache-2.0' },
  // CLIP ViT-B/32 (OpenAI, licencja MIT) w wersji ONNX od Xenova: tylko koder obrazu. Wektory pojęć tekstowych są już w repozytorium (data/clip_concepts.bin).
  { file: 'clip_vision.onnx', url: 'https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/onnx/vision_model.onnx', sha256: 'fd6e1402a588279d1723c7534d4bcba5bc0b14b47dfab0e46f8c47b8270d7d40', license: 'MIT' },
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
