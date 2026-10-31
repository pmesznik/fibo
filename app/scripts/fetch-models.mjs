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
  // Rozpoznawanie tekstu na zdjęciach: PaddleOCR PP-OCRv5 (Apache-2.0), oficjalne modele ONNX z Hugging Face przypięte do wersji. Wykrywanie linii tekstu i rozpoznawanie alfabetu łacińskiego (z polskimi znakami).
  { file: 'ocr_det.onnx', url: 'https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_det_onnx/resolve/e6f4fa85f00e168c862bc462aebca69eef9b3d3d/inference.onnx', sha256: 'a431985659dc921974177a95adcfbb90fd9e51989a5e04d70d0b75f597b6e61d', license: 'Apache-2.0' },
  { file: 'ocr_rec.onnx', url: 'https://huggingface.co/PaddlePaddle/latin_PP-OCRv5_mobile_rec_onnx/resolve/89d3a50e2c27e2e7cceeab0e944c25c807d5db4f/inference.onnx', sha256: '7888113072263cb471b93f66dd5e2ad70548dc526fa1ace760d0d973dd121498', license: 'Apache-2.0' },
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
