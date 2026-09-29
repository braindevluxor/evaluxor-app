import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import { EnLinea } from './EnLinea'
import type { Conectado } from '../context/PresenciaContext'

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

const conectado = (over: Partial<Conectado> = {}): Conectado => ({
  id: 'u1',
  nombre: 'Ana',
  usuario: 'ana',
  rol: 'EVALUADOR',
  ruta: '/evaluar/s1',
  pantalla: 'Evaluando · Sucursal Norte',
  dispositivo: 'Celular',
  sucursal_id: 's1',
  visto: Date.now(),
  dispositivos: 1,
  ...over
})

describe('presencia · punto en línea', () => {
  it('muestra el punto verde y la pantalla donde está', () => {
    const html = renderToStaticMarkup(<EnLinea conectado={conectado()} />)
    expect(html).toContain('bg-green-600')
    expect(html).toContain('En línea')
    expect(html).toContain('Evaluando · Sucursal Norte')
    expect(html).toContain('Celular')
  })

  it('avisa cuando la persona tiene la app abierta en varios dispositivos', () => {
    const html = renderToStaticMarkup(<EnLinea conectado={conectado({ dispositivos: 2, dispositivo: 'Notebook' })} />)
    expect(html).toContain('2 dispositivos')
  })

  it('distingue desconectado de alguien que nunca se conectó', () => {
    const html = renderToStaticMarkup(<EnLinea conectado={null} />)
    expect(html).toContain('Desconectado')
    expect(html).toContain('bg-slate-300')
    expect(html).not.toContain('En línea')
  })
})

describe('presencia · integración', () => {
  it('la app monta el proveedor de presencia dentro de sesión y catálogo', () => {
    const app = fuente('../App.tsx')
    expect(app).toContain('PresenciaProvider')
    // Tiene que quedar dentro de AuthProvider y CatalogProvider (usa la sesión y
    // los nombres de sucursal/módulo del catálogo).
    expect(app.indexOf('AuthProvider')).toBeLessThan(app.indexOf('PresenciaProvider'))
    expect(app.indexOf('CatalogProvider')).toBeLessThan(app.indexOf('PresenciaProvider'))
  })

  it('usuarios muestra la columna en línea con quién está conectado', () => {
    const src = fuente('../pages/config/Usuarios.tsx')
    expect(src).toContain('En línea')
    expect(src).toContain('usePresencia()')
    expect(src).toContain('<EnLinea conectado={conectados[u.id]} />')
    expect(src).toContain('Conectados ahora:')
  })

  it('el canal se anuncia, se re-anuncia al cambiar de pantalla y avisa al perder señal', () => {
    const src = fuente('../context/PresenciaContext.tsx')
    // Un solo canal con clave por usuario+dispositivo.
    expect(src).toContain("supabase\n      .channel(CANAL, { config: { presence: { key: `${perfilId}:${idDispositivo()}` } } })")
    // Se suscribe a los tres eventos de presencia.
    for (const ev of ['sync', 'join', 'leave']) {
      expect(src).toContain(`.on('presence', { event: '${ev}' }`)
    }
    // Re-anuncia al cambiar de pantalla, y sale/vuelve con la señal.
    expect(src).toMatch(/anuncioRef\.current = miAnuncio\s*\n\s*anunciar\(canalRef\.current\)/)
    expect(src).toContain("window.addEventListener('offline', salir)")
    expect(src).toContain("window.addEventListener('online', volver)")
    // Si el canal falla, se marca no disponible en vez de romper la pantalla.
    expect(src).toContain('setDisponible(false)')
  })
})
