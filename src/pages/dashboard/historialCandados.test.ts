import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

/** El renglón condicional de una acción de la tabla y su cuerpo, hasta el `) : null}`. */
function accionDe(codigo: string, estado: string): string {
  // Ancla en `esLider &&`: antes de la tabla ya hay un `filter` y un contador
  // que miran el mismo estado, y `indexOf` sin más contexto agarraba esos.
  const desde = codigo.indexOf(`esLider && ev.estado === '${estado}'`)
  expect(desde, `no hay acción para ${estado}`).toBeGreaterThan(-1)
  const hasta = codigo.indexOf(') : null}', desde)
  return codigo.slice(desde, hasta === -1 ? undefined : hasta)
}

describe('Historial · el candado refleja el estado de la evaluación', () => {
  const codigo = fuente('./Historial.tsx')

  it('una evaluación abierta sale con el candado abierto', () => {
    const bloque = accionDe(codigo, 'ACTIVA')
    expect(bloque).toContain('title="Cerrar evaluación"')
    expect(bloque).toContain('<Unlock')
    expect(bloque).not.toContain('<Lock')
  })

  it('una evaluación cerrada sale con el candado cerrado', () => {
    const bloque = accionDe(codigo, 'CERRADA')
    expect(bloque).toContain('title="Reabrir evaluación"')
    expect(bloque).toContain('<Lock')
    expect(bloque).not.toContain('<Unlock')
  })

  it('el candado cerrado no puede aparecerle a una evaluación que sigue abierta', () => {
    // La regla completa: cerrado = cerrada, abierto = abierta. Si mañana alguien
    // mete un tercer estado, que tenga que decidirlo explícitamente en vez de
    // heredar un candado por accidente.
    expect(accionDe(codigo, 'ACTIVA')).not.toContain('<Lock')
    expect(accionDe(codigo, 'CERRADA')).not.toContain('<Unlock')
  })
})
