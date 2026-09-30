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
  it('siempre esta a la vista en la evaluacion', () => {
    mocks.offline.incidentesPendientes = 0
    const html = boton()
    expect(html).toContain('aria-label="Reportar incidencia"')
    expect(html).toMatch(/fixed bottom-5 right-5/)
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
