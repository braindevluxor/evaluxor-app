import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { puedeCorregirConciliacion } from '../lib/roles'
import { claveRespuesta } from '../lib/pasos'

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

/**
 * El segundo motivo por el que "no se borraba del todo": el editor trabajaba por
 * ÍTEM y una respuesta vive por PAR (ítem, registro). Con una sección de
 * registros, la última fila del arreglo pisaba a las demás —el editor mostraba
 * los productos de un registro arbitrario— y lo que escribía iba a una fila sin
 * registro que el detalle ni siquiera mira. Borrar ahí era borrar en el aire.
 */
describe('la conciliación se edita por par (ítem, registro)', () => {
  it('dos registros del mismo ítem son dos casilleros', () => {
    expect(claveRespuesta('item-1', 'reg-a')).not.toBe(claveRespuesta('item-1', 'reg-b'))
    // Y el ítem sin registro tiene el suyo, que es el que lee el detalle cuando
    // no hay sección. Es la MISMA clave que usa el borrador del evaluador: si
    // difiriera, el editor tocaría un casillero que el teléfono no lee.
    expect(claveRespuesta('item-1', null)).toBe('item-1::')
    expect(claveRespuesta('item-2', null)).toBe('item-2::')
    expect(claveRespuesta('item-1', null)).not.toBe(claveRespuesta('item-2', null))
  })

  it('lee una respuesta por casillero, no la última por ítem', () => {
    const codigo = fuente('./EditarConciliacion.tsx')
    expect(codigo).toContain('claveRespuesta(r.item_id, r.instancia_id)')
    expect(codigo).not.toContain('v[r.item_id] = r.valor')
  })

  it('escribe con el registro del bloque que se está mirando', () => {
    const codigo = fuente('./EditarConciliacion.tsx')
    // El `null` fijo era el que creaba la fila fantasma al lado de la real.
    expect(codigo).toContain('instancia_id: instanciaId')
    expect(codigo).not.toContain('instancia_id: null')
  })

  it('pinta un editor por registro y no uno solo por ítem', () => {
    const codigo = fuente('./EditarConciliacion.tsx')
    expect(codigo).toContain('bloquesDe(item).map(')
    expect(codigo).toContain('Registro · {b.etiqueta}')
  })
})

/**
 * Borrar durante la evaluación: el gesto de deslizar existía, pero en el
 * teléfono era imposible de encontrar, así que el evaluador no tenía forma de
 * sacarse un escaneo equivocado de encima.
 */
describe('la papelera de un producto escaneado', () => {
  it('está a la vista en la fila, no sólo detrás del deslizamiento', () => {
    const codigo = fuente('../components/ItemRenderer.tsx')
    // Se ancla en el propio botón y no en la barra: `rounded-b-xl bg-white px-3
    // py-1.5` aparece antes en el archivo, en otra barra que no es ésta.
    const i = codigo.indexOf('aria-label={`Eliminar ${p.sku}`}')
    expect(i, 'no encontré la papelera de la fila').toBeGreaterThan(-1)
    expect(codigo.slice(i - 500, i)).toContain('setAEliminar({ producto: p, index: i })')
    // Y el texto de ayuda ya no manda a deslizar para las dos cosas.
    expect(codigo).toContain('toca la papelera para eliminarlo')
  })
})
