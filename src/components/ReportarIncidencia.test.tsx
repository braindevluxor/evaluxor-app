import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ReportarIncidencia } from './ReportarIncidencia'

const mocks = vi.hoisted(() => ({
  offline: {
    online: true,
    pendientes: 0,
    incidentesPendientes: 0,
    sincronizando: false,
    ultimoResultado: null,
    sync: async () => ({ ok: 0, fail: 0 })
  }
}))

vi.mock('../context/OfflineContext', () => ({ useOffline: () => mocks.offline }))

function boton(): string {
  return renderToStaticMarkup(
    <ReportarIncidencia
      sucursalId="s1"
      fecha="2026-09-30"
      moduloId="m1"
      moduloNombre="Heladera"
      evaluadorId="e1"
    />
  )
}

describe('boton de reportar incidencia', () => {
  it('ocupa una fila entera de la barra de controles', () => {
    mocks.offline.incidentesPendientes = 0
    const html = boton()
    expect(html).toContain('aria-label="Reportar incidencia"')
    expect(html).toMatch(/flex w-full items-center/)
  })

  it('no queda flotando suelto: la barra de abajo lo tapaba', () => {
    // Regresión: como botón suelto con `fixed bottom-5` quedaba detrás de la barra
    // fija de navegación, tiene que ser una fila más de esa misma barra.
    const html = boton()
    expect(html).not.toContain('fixed')
    expect(html).not.toContain('bottom-5 right-5')
  })

  it('avisa cuantas incidencias quedan sin subir', () => {
    mocks.offline.incidentesPendientes = 2
    const html = boton()
    expect(html).toContain('2 incidencia(s) esperando subir')
    expect(html).toMatch(/>2</)
    mocks.offline.incidentesPendientes = 0
  })

  it('no muestra contador cuando no hay nada pendiente', () => {
    mocks.offline.incidentesPendientes = 0
    expect(boton()).not.toContain('esperando subir')
  })

  it('el formulario esta cerrado hasta que se toca el boton', () => {
    expect(boton()).not.toContain('Reportar incidencia</h3>')
  })
})
