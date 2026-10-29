import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

async function start() {
  // Podgląd wyglądu w przeglądarce z przykładowymi danymi (tylko `npm run dev`, adres z ?mock); w wersji produkcyjnej ten kod znika.
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('mock')) await import('./devMock')
  const { default: App } = await import('./App.tsx')
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
start()
