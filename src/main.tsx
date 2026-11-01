import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App'
import { aplicarTema, temaInicial } from './lib/tema'

// ANTES de la primera pintura: si la persona eligió oscuro, la pantalla ya
// sale oscura. El efecto radial es para el cambio, no para el arranque.
aplicarTema(temaInicial())

registerSW({ immediate: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)