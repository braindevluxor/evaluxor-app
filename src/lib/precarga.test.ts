import { describe, expect, it } from 'vitest'
import { precargarSeccionesDe } from './precarga'
import type { DraftInstancia } from './offline/db'
import type { RegistroPrevio, RespuestaPrevia } from './data/precarga'

/** Catálogo de prueba: una sección con dos hijos y un ítem directo suelto. */
const items = [
  { id: 'sec-tec', tipo: 'CONTENEDOR', padre_id: null },
  { id: 'it-comp', tipo: 'CHECKLIST', padre_id: 'sec-tec' },
  { id: 'it-limp', tipo: 'CHECKLIST', padre_id: 'sec-tec' },
  { id: 'it-suelto', tipo: 'CHECKLIST', padre_id: null }
]

function idsFrescos(): () => string {
  let n = 0
  return () => `nuevo-${++n}`
}

function registro(id: string, item_id: string, etiqueta: string, orden: number): RegistroPrevio {
  return { id, item_id, etiqueta, orden, api_id: null, datos: null }
}

describe('precargarSeccionesDe', () => {
  it('copia los registros de la sección con ids nuevos y orden de la visita previa', () => {
    const previa = {
      instancias: [registro('viejo-b', 'sec-tec', 'CAJA 02', 1), registro('viejo-a', 'sec-tec', 'CAJA 01', 0)],
      respuestas: []
    }

    const out = precargarSeccionesDe(previa, items, {}, idsFrescos())

    expect(out.instancias['sec-tec']).toHaveLength(2)
    // Orden por `orden` de la visita anterior, no por el orden del array.
    expect(out.instancias['sec-tec'].map((i) => i.etiqueta)).toEqual(['CAJA 01', 'CAJA 02'])
    // Ids NUEVOS: reusar los viejos re-apuntaría las filas de la evaluación
    // anterior a esta al subir (el upsert de instancias_grupo es por id).
    expect(out.instancias['sec-tec'].map((i) => i.id)).toEqual(['nuevo-1', 'nuevo-2'])
    expect(out.instancias['sec-tec'].map((i) => i.id)).not.toContain('viejo-a')
  })

  it('re-clava las respuestas de los hijos contra el id nuevo del registro', () => {
    const previa = {
      instancias: [registro('viejo-a', 'sec-tec', 'CAJA 01', 0)],
      respuestas: [
        { item_id: 'it-comp', instancia_id: 'viejo-a', valor: { selected: ['o1', 'o2'] } },
        { item_id: 'it-limp', instancia_id: 'viejo-a', valor: { selected: [] } }
      ] as RespuestaPrevia[]
    }

    const out = precargarSeccionesDe(previa, items, {}, idsFrescos())

    expect(out.respuestas['it-comp::nuevo-1']).toEqual({ valor: { selected: ['o1', 'o2'] }, por: 'yo' })
    expect(out.respuestas['it-limp::nuevo-1']).toEqual({ valor: { selected: [] }, por: 'yo' })
    expect(out.respuestas['it-comp::viejo-a']).toBeUndefined()
  })

  it('no copia registros que ya existen en la evaluación nueva ni sus respuestas', () => {
    const existentes: Record<string, DraftInstancia[]> = {
      'sec-tec': [{ id: 'ya-esta', etiqueta: 'caja 01', orden: 0 }]
    }
    const previa = {
      instancias: [registro('viejo-a', 'sec-tec', 'CAJA 01', 0), registro('viejo-b', 'sec-tec', 'CAJA 02', 1)],
      respuestas: [
        { item_id: 'it-comp', instancia_id: 'viejo-a', valor: { selected: ['x'] } },
        { item_id: 'it-comp', instancia_id: 'viejo-b', valor: { selected: ['y'] } }
      ] as RespuestaPrevia[]
    }

    const out = precargarSeccionesDe(previa, items, existentes, idsFrescos())

    // La etiqueta duplicada se salta (con la misma normalización que la UI).
    expect(out.instancias['sec-tec'].map((i) => i.etiqueta)).toEqual(['CAJA 02'])
    // Sin registro copiado no entra su respuesta: quedaría huérfana.
    expect(Object.keys(out.respuestas)).toEqual(['it-comp::nuevo-1'])
    expect(out.respuestas['it-comp::nuevo-1'].valor).toEqual({ selected: ['y'] })
  })

  it('ignora registros de secciones que ya no están en el catálogo y respuestas sueltas', () => {
    const previa = {
      instancias: [registro('v1', 'sec-borrada', 'X', 0), registro('v2', 'sec-tec', 'CAJA 01', 0)],
      respuestas: [
        // Ítem directo (fuera de sección), sin instancia y de sección borrada.
        { item_id: 'it-suelto', instancia_id: null, valor: { selected: ['a'] } },
        { item_id: 'it-comp', instancia_id: null, valor: { selected: ['b'] } },
        { item_id: 'it-comp', instancia_id: 'v1', valor: { selected: ['c'] } }
      ] as RespuestaPrevia[]
    }

    const out = precargarSeccionesDe(previa, items, {}, idsFrescos())

    expect(Object.keys(out.instancias)).toEqual(['sec-tec'])
    expect(out.respuestas).toEqual({})
  })

  it('copia las respuestas sin las fotos de la visita anterior', () => {
    const previa = {
      instancias: [registro('viejo-a', 'sec-tec', 'CAJA 01', 0)],
      respuestas: [
        // Formato nube de un checklist: evidencias con `paths`.
        {
          item_id: 'it-comp',
          instancia_id: 'viejo-a',
          valor: { selected: ['o1'], evidencias: { o1: { paths: ['ev/vieja/o1.jpg'] } }, comentarios: { o1: 'ok' } }
        },
        // Foto suelta: valor `{ paths }`.
        { item_id: 'it-limp', instancia_id: 'viejo-a', valor: { paths: ['ev/vieja/foto.jpg'] } }
      ] as RespuestaPrevia[]
    }

    const out = precargarSeccionesDe(previa, items, {}, idsFrescos())

    const comp = out.respuestas['it-comp::nuevo-1'].valor as Record<string, unknown>
    expect(comp.selected).toEqual(['o1'])
    expect(comp.comentarios).toEqual({ o1: 'ok' })
    expect(comp.evidencias).toBeUndefined()
    expect(JSON.stringify(out.respuestas)).not.toContain('ev/vieja')
  })

  it('conserva api_id y datos del registro copiado', () => {
    const previa = {
      instancias: [{ ...registro('v1', 'sec-tec', 'ABC123', 0), api_id: 'vehiculos', datos: { placa: 'ABC123' } }],
      respuestas: []
    }

    const out = precargarSeccionesDe(previa, items, {}, idsFrescos())

    expect(out.instancias['sec-tec'][0]).toMatchObject({
      id: 'nuevo-1',
      api_id: 'vehiculos',
      datos: { placa: 'ABC123' }
    })
  })
})
