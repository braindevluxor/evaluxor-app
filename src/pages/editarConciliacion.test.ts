import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { puedeCorregirConciliacion } from '../lib/roles'

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

/**
 * Borrar un producto escaneado desde el historial no se borraba: el lápiz abre
 * el editor sin mirar el estado, pero `guardar` devolvía en cuanto la
 * evaluación no estaba ACTIVA, y devolvía sin avisar. El Líder confirmaba el
 * borrado, la fila no se movía y el producto seguía en el detalle.
 *
 * El servidor nunca estuvo de acuerdo con ese bloqueo: `puede_responder` arranca
 * con `select public.es_lider() or …`, sin tocar el estado. Lo único que
 * impedía corregir la conciliación de una evaluación cerrada era esta pantalla.
 */
describe('corregir conciliación en una evaluación cerrada', () => {
  it('mientras está ACTIVA puede cualquiera que pueda responder', () => {
    expect(puedeCorregirConciliacion('EVALUADOR', 'ACTIVA')).toBe(true)
    expect(puedeCorregirConciliacion('LIDER', 'ACTIVA')).toBe(true)
  })

  it('cerrada, solo el Líder', () => {
    expect(puedeCorregirConciliacion('LIDER', 'CERRADA')).toBe(true)
    expect(puedeCorregirConciliacion('EVALUADOR', 'CERRADA')).toBe(false)
    expect(puedeCorregirConciliacion('GERENTE_S', 'CERRADA')).toBe(false)
  })

  it('programada se trata como cerrada: no se corrige inventario que no existe', () => {
    expect(puedeCorregirConciliacion('LIDER', 'PROGRAMADA')).toBe(true)
    expect(puedeCorregirConciliacion('EVALUADOR', 'PROGRAMADA')).toBe(false)
  })

  it('el editor decide con esa función y no con una condición propia', () => {
    const codigo = fuente('./EditarConciliacion.tsx')
    expect(codigo).toContain('puedeCorregirConciliacion(profile.rol, estadoEval)')
    // El `if` que se tragaba el guardado sin avisar ya no mira el estado.
    expect(codigo).not.toContain("detalle?.evaluacion.estado !== 'ACTIVA'")
  })

  it('y dice que puede, en vez de avisar que no', () => {
    const codigo = fuente('./EditarConciliacion.tsx')
    expect(codigo).toContain('pero puedes corregir los productos escaneados')
    expect(codigo).toContain('el puntaje ya registrado no cambia')
    // Texto viejo: mandaba al Líder a esperar a que la evaluación volviera a
    // estar activa, que no vuelve a pasar.
    expect(codigo).not.toContain('Solo se pueden editar los productos de conciliación')
  })

  it('el lápiz que abre el editor tampoco mira el estado', () => {
    // Si el lápiz sólo saliera para evaluaciones activas, el editor cerrado no se
    // alcanza y el problema no existiría. Existen las dos puertas y ninguna
    // mira el estado, así que el permiso tiene que estar del otro lado.
    const detalle = fuente('./EvaluacionDetalle.tsx')
    const lapiz = detalle.slice(detalle.indexOf("profile?.rol === 'LIDER' && hayConciliacion"))
    expect(lapiz.slice(0, 600)).not.toContain("estado === 'ACTIVA'")
  })
})
