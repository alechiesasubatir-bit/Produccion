import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './ui/tokens.css'
import App from './App.tsx'

// El código cargó: se rearma la recarga automática de index.html para el próximo deploy y se quita
// el ?v= que usó para saltear la caché.
try {
  sessionStorage.removeItem('prodcontrol_recarga')
} catch {
  // sin sessionStorage (modo privado estricto): no pasa nada
}
const url = new URL(window.location.href)
if (url.searchParams.has('v')) {
  url.searchParams.delete('v')
  history.replaceState(history.state, '', url.pathname + url.search + url.hash)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
