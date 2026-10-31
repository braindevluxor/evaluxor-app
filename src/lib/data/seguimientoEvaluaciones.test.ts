import { describe, expect, it } from 'vitest'
import type { Item, Modulo, Respuesta, VistaEvaluacion } from '../types'
import type { ConjuntoDatos } from './indicadores'
import { puntosFalladosDeCargo, seguimientoPorEvaluacion } from './seguimientoEvaluaciones'

const MODULO: Modulo = { id: 'm-seg', nombre: 'Higiene', descripcion: '', orden: 0, activo: true, created_at: '' }

function evSeg(id: string, sucursalId: string | null, departamentoId: string | null, nombre: string, fecha: string): VistaEvaluacion {
  return {
    id,
    offline_uuid: id,
    sucursal_id: sucursalId,
    departamento_id: departamentoId,
    aperturada_por: 'u1',
    fecha,
    estado: 'CERRADA',
    puntuacion: null,
    comentario_general: null,
    abierta_en: null,
    cerrada_en: null,
    created_at: '',
    sucursal: sucursalId ? { id: sucursalId, nombre, shop_id: null, branch_id: null, direccion: null } : null,
    departamento: departamentoId ? { id: departamentoId, nombre } : null,
    aperturador: null
  }
}

function itemSeg(id: string, texto: string, puntaje: number, responsables: string[]): Item {
  return {
    id,
    modulo_id: 'm-seg',
    tipo: 'CUMPLE_NO_CUMPLE',
    texto,
    opciones: [],
    orden: 0,
    requerido: false,
    activo: true,
    puntaje,
    responsables,
    created_at: ''
  }
}

function respuestaSeg(evaluacionId: string, itemId: string, cumple: boolean, responsables: string[]): Respuesta {
  return {
    id: `${evaluacionId}-${itemId}`,
    evaluacion_id: evaluacionId,
    item_id: itemId,
    instancia_id: null,
    valor: { value: cumple, responsables },
    respondido_por: null,
    created_at: ''
  }
}

/**
 * Una sucursal visitada seis veces. El cargo «Encargado de turno» tiene dos
 * ítems: uno que cae en casi todas las visitas (60 pts) y otro que siempre
 * aprueba (40 pts), así la nota de cada visita es 40% y no 0.
 */
function conjunto(): ConjuntoDatos {
  const items: Item[] = [
    itemSeg('i-cae', 'Refrigeración en condiciones', 60, ['Encargado de turno']),
    itemSeg('i-pasa', 'Plan de limpieza a la vista', 40, ['Encargado de turno'])
  ]
  const evaluaciones: VistaEvaluacion[] = [
    evSeg('ev1', 'sN', null, 'Sucursal Norte', '2026-03-01'),
    evSeg('ev2', 'sN', null, 'Sucursal Norte', '2026-03-15'),
    evSeg('ev3', 'sN', null, 'Sucursal Norte', '2026-04-01'),
    evSeg('ev4', 'sN', null, 'Sucursal Norte', '2026-04-15'),
    evSeg('ev5', 'sN', null, 'Sucursal Norte', '2026-05-01'),
    evSeg('ev6', 'sN', null, 'Sucursal Norte', '2026-05-15'),
    // Otra unidad: no se mezcla en el historial del cargo.
    evSeg('evOtra', 'sS', null, 'Sucursal Sur', '2026-05-20')
  ]
  const respuestas: Respuesta[] = [
    ...['ev1', 'ev2', 'ev4', 'ev5', 'ev6'].flatMap((ev) => [
      respuestaSeg(ev, 'i-cae', false, ['Encargado de turno']),
      respuestaSeg(ev, 'i-pasa', true, ['Encargado de turno'])
    ]),
    respuestaSeg('ev3', 'i-cae', true, ['Encargado de turno']),
    respuestaSeg('ev3', 'i-pasa', true, ['Encargado de turno']),
    respuestaSeg('evOtra', 'i-cae', false, ['Encargado de turno'])
  ]
  return { evaluaciones, respuestas, items, modulos: [MODULO], fotos: [], sucursalOpciones: [], instancias: [] }
}

describe('seguimientoPorEvaluacion · una fila por visita, no un promedio', () => {
  it('da la nota de CADA evaluación: no promedia el histórico', () => {
    const celdas = seguimientoPorEvaluacion(conjunto())

    // Las cinco visitas donde cayó el ítem pesado quedan en 40% (40 de 100):
    // el mismo 40% que vería el Líder en el detalle de ESA evaluación.
    const deNorte = celdas.filter((c) => c.unidad.id === 'sN')
    expect(deNorte).toHaveLength(5)
    expect(new Set(deNorte.map((c) => c.nota))).toEqual(new Set([40]))
    // La visita 3 aprueba todo: no está en nivel, no entra al seguimiento.
    expect(deNorte.some((c) => c.evaluacion_id === 'ev3')).toBe(false)
  })

  it('sólo entra lo que está por debajo del umbral, peor primero', () => {
    const celdas = seguimientoPorEvaluacion(conjunto()).filter((c) => c.unidad.id === 'sN')
    // 40% < 80% → amonestación; nada queda fuera por ser buena.
    expect(celdas.every((c) => (c.nota ?? 100) < 80)).toBe(true)
    expect(celdas[0].nota).toBe(40)
  })

  it('cada celda lleva su evaluación y su unidad, para poder cruzarla con la alerta', () => {
    const celda = seguimientoPorEvaluacion(conjunto()).find((c) => c.unidad.id === 'sN')
    expect(celda).toMatchObject({
      evaluacion_id: expect.any(String),
      fecha: expect.any(String),
      clave: 'encargadodeturno',
      cargo: 'Encargado de turno',
      unidad: { id: 'sN', nombre: 'Sucursal Norte', tipo: 'sucursal' }
    })
  })

  it('una evaluación de departamento entra como unidad de departamento', () => {
    const datos = conjunto()
    datos.evaluaciones.push(evSeg('evDep', null, 'dC', 'Contabilidad', '2026-06-01'))
    datos.respuestas.push(respuestaSeg('evDep', 'i-cae', false, ['Encargado de turno']))
    const celda = seguimientoPorEvaluacion(datos).find((c) => c.evaluacion_id === 'evDep')
    expect(celda?.unidad).toEqual({ id: 'dC', nombre: 'Contabilidad', tipo: 'departamento' })
  })
})

/**
 * El checklist con el que se prueba la reincidencia: tres puntos, uno que
 * nunca falla —porque un checklist sin nada tildado es «sin respuesta» y no
 * computa para nadie— y dos con historial distinto, para que un punto no
 * herede el conteo del otro.
 *
 *   ev1 · ev2  → cae sólo «Piso lavado»
 *   ev3 · ev4  → no cae nada (la racha se corta acá)
 *   ev5 · ev6  → caen los dos
 */
function conjuntoChecklist(): ConjuntoDatos {
  const item: Item = {
    id: 'i-chk',
    modulo_id: 'm-seg',
    tipo: 'CHECKLIST',
    texto: 'Puntos de limpieza',
    opciones: [
      { id: 'op-1', etiqueta: 'Piso lavado', responsable: 'Encargado de turno' },
      { id: 'op-2', etiqueta: 'Góndolas sin polvo', responsable: 'Encargado de turno' },
      { id: 'op-3', etiqueta: 'Salidas señalizadas', responsable: 'Encargado de turno' }
    ],
    orden: 0,
    requerido: false,
    activo: true,
    puntaje: 100,
    created_at: ''
  }
  const evaluaciones = ['ev1', 'ev2', 'ev3', 'ev4', 'ev5', 'ev6'].map((id, i) =>
    evSeg(id, 'sN', null, 'Sucursal Norte', `2026-0${i + 1}-01`)
  )
  const seleccion: Record<string, string[]> = {
    ev1: ['op-2', 'op-3'],
    ev2: ['op-2', 'op-3'],
    ev3: ['op-1', 'op-2', 'op-3'],
    ev4: ['op-1', 'op-2', 'op-3'],
    ev5: ['op-3'],
    ev6: ['op-3']
  }
  const respuestas: Respuesta[] = Object.entries(seleccion).map(([ev, selected]) => ({
    id: `${ev}-i-chk`,
    evaluacion_id: ev,
    item_id: 'i-chk',
    instancia_id: null,
    valor: { selected },
    respondido_por: null,
    created_at: ''
  }))
  return { evaluaciones, respuestas, items: [item], modulos: [MODULO], fotos: [], sucursalOpciones: [], instancias: [] }
}

describe('puntosFalladosDeCargo · el mismo punto caído seguido es reincidencia', () => {
  it('corta la racha cuando una evaluación no falló (5 faltas, 3 reincidencias)', () => {
    // El ejemplo de negocio: cae en 1 y 2, se arregla en la 3 y vuelve a caer
    // en 4, 5 y 6. Son 5 faltas y 3 reincidencias — las de 2, 5 y 6.
    const datos = conjuntoChecklist()
    const enSeis = puntosFalladosDeCargo(datos, 'Encargado de turno', 'sN', 'ev6')
    const piso = enSeis.find((p) => p.check === 'Piso lavado')!
    expect(piso).toMatchObject({
      item_id: 'i-chk',
      item: 'Puntos de limpieza',
      check: 'Piso lavado',
      faltas: 4,
      reincidencias: 2,
      esReincidente: true
    })
  })

  it('la primera falta de una racha no es reincidencia', () => {
    const datos = conjuntoChecklist()
    // La 5 empieza racha nueva: la 4 no falló.
    const enCinco = puntosFalladosDeCargo(datos, 'Encargado de turno', 'sN', 'ev5')
    expect(enCinco).toHaveLength(2)
    expect(enCinco.every((p) => !p.esReincidente)).toBe(true)
    expect(enCinco.map((p) => p.check)).toEqual(['Piso lavado', 'Góndolas sin polvo'])
  })

  it('cada punto lleva su propio historial: no hereda el conteo del otro', () => {
    const datos = conjuntoChecklist()
    const enSeis = puntosFalladosDeCargo(datos, 'Encargado de turno', 'sN', 'ev6')
    const piso = enSeis.find((p) => p.check === 'Piso lavado')!
    const gondolas = enSeis.find((p) => p.check === 'Góndolas sin polvo')!
    // Piso cayó en 1, 2, 5 y 6; Góndolas sólo en 5 y 6.
    expect([piso.faltas, piso.reincidencias]).toEqual([4, 2])
    expect([gondolas.faltas, gondolas.reincidencias]).toEqual([2, 1])
  })

  it('la revisión se hace contra la evaluación de ESA unidad, no de otra', () => {
    const datos = conjuntoChecklist()
    datos.evaluaciones.push(evSeg('evOtra', 'sS', null, 'Sucursal Sur', '2026-07-01'))
    datos.respuestas.push({
      id: 'evOtra-i-chk',
      evaluacion_id: 'evOtra',
      item_id: 'i-chk',
      instancia_id: null,
      valor: { selected: ['op-3'] },
      respondido_por: null,
      created_at: ''
    })
    // Sur cae en su única visita: una falla, sin anterior en la unidad.
    const sur = puntosFalladosDeCargo(datos, 'Encargado de turno', 'sS', 'evOtra')
    expect(sur.map((p) => [p.check, p.faltas, p.reincidencias])).toEqual([
      ['Góndolas sin polvo', 1, 0],
      ['Piso lavado', 1, 0]
    ])
  })

  it('un cargo sin caídas en la unidad sale vacío', () => {
    expect(puntosFalladosDeCargo(conjuntoChecklist(), 'Cajero', 'sN', 'ev6')).toEqual([])
    expect(puntosFalladosDeCargo(conjuntoChecklist(), 'Encargado de turno', 'sZ', 'ev6')).toEqual([])
  })
})
