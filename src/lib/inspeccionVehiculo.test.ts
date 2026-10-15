import { describe, expect, it } from 'vitest'
import { evidenciasDe, evidenciasDeRespuestas, seccionarItems } from './inspeccionVehiculo'
import type { Item, Opcion } from './types'

function item(parcial: Partial<Item> & Pick<Item, 'tipo' | 'texto'>): Item {
  return {
    id: 'i1',
    modulo_id: 'm1',
    opciones: null,
    orden: 0,
    requerido: false,
    activo: true,
    created_at: '',
    ...parcial
  }
}

const opciones: Opcion[] = [
  { id: 'o1', etiqueta: 'Sin abolladuras' },
  { id: 'o2', etiqueta: 'Pintura uniforme' }
]

describe('seccionarItems', () => {
  const estetica = item({ id: 's1', tipo: 'CONTENEDOR', texto: 'Estética' })
  const mecanica = item({ id: 's2', tipo: 'CONTENEDOR', texto: 'Mecánica' })
  const carroceria = item({ id: 'c1', tipo: 'CHECKLIST', texto: 'Carrocería', padre_id: 's1' })
  const frenos = item({ id: 'c2', tipo: 'CHECKLIST', texto: 'Frenos', padre_id: 's2' })
  const dictamen = item({ id: 'd1', tipo: 'CUMPLE_NO_CUMPLE', texto: '¿Queda en condiciones?' })

  it('agrupa por sección y deja el dictamen al final', () => {
    const grupos = seccionarItems([estetica, carroceria, mecanica, frenos, dictamen])
    expect(grupos.map((g) => g.seccion)).toEqual(['Estética', 'Mecánica', null])
    expect(grupos[0].items.map((i) => i.id)).toEqual(['c1'])
    expect(grupos[1].items.map((i) => i.id)).toEqual(['c2'])
    // Los sueltos cierran: el dictamen se llena después de las revisiones.
    expect(grupos[2].items.map((i) => i.id)).toEqual(['d1'])
  })

  it('no imprime secciones que quedaron sin hijos activos', () => {
    const vacia = item({ id: 's3', tipo: 'CONTENEDOR', texto: 'Documentación' })
    const grupos = seccionarItems([estetica, carroceria, vacia])
    expect(grupos.map((g) => g.seccion)).toEqual(['Estética'])
  })

  it('un hijo cuya sección ya no existe se imprime igual, con los sueltos', () => {
    // Perder una pregunta de inspección sería mentirle al que firma el PDF.
    const huérfano = item({ id: 'c9', tipo: 'CHECKLIST', texto: 'Perdido', padre_id: 'borrada' })
    const grupos = seccionarItems([estetica, carroceria, huérfano, dictamen])
    expect(grupos.map((g) => g.seccion)).toEqual(['Estética', null])
    expect(grupos[1].items.map((i) => i.id)).toEqual(['c9', 'd1'])
  })
})

describe('evidenciasDe', () => {
  const itemChecklist = item({ tipo: 'CHECKLIST', texto: 'Carrocería', opciones })

  it('en un checklist el pie nombra el ítem y la opción marcada', () => {
    const evs = evidenciasDe(itemChecklist, { evidencias: { o2: { photoIds: ['f1', 'f2'] } } })
    expect(evs).toEqual([{ pie: 'Carrocería · Pintura uniforme', photoIds: ['f1', 'f2'], paths: [] }])
  })

  it('una incidencia escrita se suma al pie', () => {
    const evs = evidenciasDe(itemChecklist, {
      evidencias: { o1: { photoIds: ['f1'], comentario: 'Golpe en el guardabarros' } }
    })
    expect(evs[0].pie).toBe('Carrocería · Sin abolladuras · Golpe en el guardabarros')
  })

  it('en un CUMPLE_NO_CUMPLE la evidencia viene como lista y lleva su comentario', () => {
    const itemCumple = item({ tipo: 'CUMPLE_NO_CUMPLE', texto: '¿Queda en condiciones?' })
    const evs = evidenciasDe(itemCumple, {
      evidencias: [{ photoIds: [], paths: ['pre-entrega/r1/f9.jpg'], comentario: 'Ruido al frenar' }]
    })
    expect(evs).toEqual([{ pie: '¿Queda en condiciones? · Ruido al frenar', photoIds: [], paths: ['pre-entrega/r1/f9.jpg'] }])
  })

  it('descarta las fotos que sólo dicen que están en el equipo (no son del bucket)', () => {
    // `.local/<id>` es el marcador con el que transform.ts nombra una foto que
    // nunca subió: pedirle una URL firmada a eso da 404 en el PDF.
    const evs = evidenciasDe(itemChecklist, { evidencias: { o1: { paths: ['.local/f1'] } } })
    expect(evs).toEqual([])
  })

  it('sin evidencias no devuelve nada', () => {
    expect(evidenciasDe(itemChecklist, { selected: ['o1'] })).toEqual([])
    expect(evidenciasDe(itemChecklist, undefined)).toEqual([])
  })
})

describe('evidenciasDeRespuestas', () => {
  it('recorre sólo los ítems respondibles, nunca los CONTENEDOR', () => {
    const seccion = item({ id: 's1', tipo: 'CONTENEDOR', texto: 'Estética' })
    const conFoto = item({ id: 'c1', tipo: 'CHECKLIST', texto: 'Carrocería', opciones, padre_id: 's1' })
    const sinFoto = item({ id: 'c2', tipo: 'CHECKLIST', texto: 'Frenos', padre_id: 's1' })

    const evs = evidenciasDeRespuestas([seccion, conFoto, sinFoto], {
      c1: { evidencias: { o1: { photoIds: ['f1'] } } },
      c2: { selected: ['x'] }
    })
    expect(evs).toHaveLength(1)
    expect(evs[0].pie).toBe('Carrocería · Sin abolladuras')
  })
})
