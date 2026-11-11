import { describe, expect, it } from 'vitest'
import type { Item, SucursalPermiso } from './types'
import { aplicarPermisosChecklist, etiquetaPermiso, opcionesDePermisos } from './permisosChecklist'
import { opcionCumplida, estaVacioItem, tieneRespuesta } from './scoring'

/**
 * La lista de un CHECKLIST que se arma desde los permisos de la sucursal.
 *
 * POR QUÉ SE PRUEBA ESTO
 * ----------------------
 * La lista es viva: no está guardada en la evaluación, se genera en cada
 * pantalla contra los permisos actuales y la fecha de hoy. Eso significa que
 * cualquier regla de este módulo cambia retroactivamente lo que muestran las
 * evaluaciones viejas, así que las reglas tienen que estar escritas en algún
 * lado que no sea la memoria de quien lo programó.
 */

const HOY = '2026-10-20'
const SUCURSAL = 's1'
const OTRA = 's2'

function permiso(sobrescritura: Partial<SucursalPermiso> & { id: string }): SucursalPermiso {
  return {
    sucursal_id: SUCURSAL,
    nombre: 'Bomberos',
    numero: null,
    vigente: true,
    emision: null,
    vence: null,
    observacion: null,
    created_at: '2026-01-01T00:00:00Z',
    ...sobrescritura
  }
}

function itemChecklist(permisos_sucursal: Item['permisos_sucursal']): Item {
  return {
    id: 'i1',
    modulo_id: 'm1',
    tipo: 'CHECKLIST',
    texto: 'Permisos de la tienda',
    // Lista manual que el origen debe reemplazar, no sumar.
    opciones: [{ id: 'manual', etiqueta: 'Escrita a mano' }],
    orden: 1,
    requerido: false,
    activo: true,
    permisos_sucursal,
    created_at: '2026-01-01T00:00:00Z'
  }
}

describe('opcionesDePermisos', () => {
  it('arma la lista sólo con los permisos ACTIVOS: un inactivo no aparece', () => {
    const opciones = opcionesDePermisos([
      permiso({ id: 'p1', nombre: 'Bomberos', vigente: true }),
      permiso({ id: 'p2', nombre: 'Municipal', vigente: false })
    ], 'TODOS', HOY)

    expect(opciones.map((o) => o.id)).toEqual(['p1'])
  })

  it('cada opción reparte el peso del ítem a partes iguales y es un check', () => {
    const opciones = opcionesDePermisos([
      permiso({ id: 'p1' }),
      permiso({ id: 'p2', nombre: 'Municipal' })
    ], 'TODOS', HOY)

    expect(opciones.every((o) => o.puntos === 1)).toBe(true)
    expect(opciones.every((o) => o.tipo_respuesta === 'CHECK')).toBe(true)
  })

  it('la etiqueta trae el número de expediente cuando lo tiene', () => {
    expect(etiquetaPermiso({ nombre: 'Bomberos', numero: 'RES-77' })).toBe('Bomberos · RES-77')
    expect(etiquetaPermiso({ nombre: 'Bomberos', numero: '  ' })).toBe('Bomberos')
    expect(etiquetaPermiso({ nombre: 'Bomberos', numero: null })).toBe('Bomberos')
  })

  it('el estado sale de la fecha contra el día de hoy, no de la marca', () => {
    const opciones = opcionesDePermisos([
      permiso({ id: 'vigente', vence: '2027-01-01' }),
      permiso({ id: 'porVencer', vence: '2026-11-01' }),
      permiso({ id: 'vencido', vence: '2026-10-01' }),
      permiso({ id: 'sinFecha', vence: null })
    ], 'TODOS', HOY)

    expect(opciones.map((o) => [o.id, o.estado_permiso])).toEqual([
      ['vencido', 'VENCIDO'],
      ['porVencer', 'POR_VENCER'],
      ['vigente', 'VIGENTE'],
      ['sinFecha', 'SIN_FECHA']
    ])
  })

  it('el filtro «sólo vencidos» deja únicamente los que ya pasaron su fecha', () => {
    const permisos = [
      permiso({ id: 'vigente', vence: '2027-01-01' }),
      permiso({ id: 'vencido', vence: '2026-10-01' }),
      permiso({ id: 'sinFecha', vence: null })
    ]

    expect(opcionesDePermisos(permisos, 'VENCIDOS', HOY).map((o) => o.id)).toEqual(['vencido'])
  })

  it('una tienda sin permisos queda con la lista vacía, no con la manual', () => {
    expect(opcionesDePermisos([], 'TODOS', HOY)).toEqual([])
  })
})

describe('aplicarPermisosChecklist', () => {
  it('reemplaza la lista manual por la que se genera desde los permisos', () => {
    const item = aplicarPermisosChecklist(itemChecklist('TODOS'), SUCURSAL, {
      sucursalPermisos: [permiso({ id: 'p1', nombre: 'Bomberos' })]
    }, HOY)

    expect(item.opciones?.map((o) => o.id)).toEqual(['p1'])
    expect(item.opciones?.[0].etiqueta).toBe('Bomberos')
  })

  it('un ítem sin origen en permisos vuelve igual, hasta por referencia', () => {
    const item = itemChecklist(null)
    const resultado = aplicarPermisosChecklist(item, SUCURSAL, { sucursalPermisos: [permiso({ id: 'p1' })] }, HOY)
    expect(resultado).toBe(item)
    expect(resultado.opciones?.[0].etiqueta).toBe('Escrita a mano')
  })

  it('no mezcla los permisos de otra sucursal', () => {
    const item = aplicarPermisosChecklist(itemChecklist('TODOS'), SUCURSAL, {
      sucursalPermisos: [
        permiso({ id: 'propio' }),
        permiso({ id: 'ajeno', sucursal_id: OTRA })
      ]
    }, HOY)

    expect(item.opciones?.map((o) => o.id)).toEqual(['propio'])
  })

  it('una evaluación de departamento no tiene permisos: la lista queda vacía', () => {
    const item = aplicarPermisosChecklist(itemChecklist('TODOS'), 'departamento-1', {
      sucursalPermisos: [permiso({ id: 'p1' })]
    }, HOY)

    expect(item.opciones).toEqual([])
  })

  it('una sucursal cuyos permisos se borraron tampoco cae a la lista manual', () => {
    const item = aplicarPermisosChecklist(itemChecklist('TODOS'), SUCURSAL, { sucursalPermisos: [] }, HOY)
    expect(item.opciones).toEqual([])
  })
})

describe('un permiso VENCIDO nunca cuenta como cumplido', () => {
  it('aunque el evaluador marque la presencia del documento', () => {
    const opciones = opcionesDePermisos([
      permiso({ id: 'a-vigente', vence: '2027-01-01' }),
      permiso({ id: 'b-vencida', vence: '2026-10-01' })
    ], 'TODOS', HOY)
    const valor = { selected: opciones.map((o) => o.id), informativos: [], evidencias: {} }

    expect(opciones.map((o) => [o.id, opcionCumplida(o, valor, o.id)])).toEqual([
      ['b-vencida', false],
      ['a-vigente', true]
    ])
  })

  it('una opción escrita a mano, sin estado, sigue comportándose igual', () => {
    const valor = { selected: ['o1'], informativos: [], evidencias: {} }
    expect(opcionCumplida({ tipo_respuesta: 'CHECK' }, valor, 'o1')).toBe(true)
    expect(opcionCumplida({ tipo_respuesta: 'CHECK' }, valor, 'otra')).toBe(false)
  })
})

describe('una tienda sin permisos no clava la evaluación', () => {
  // El caso que rompe: un ítem OBLIGATORIO cuya lista sale de los permisos y la
  // tienda no tiene ninguno activo. No hay nada que tildar, así que el aviso de
  // "obligatorio para enviar" y el contador de pendientes tendrían que dejarlo
  // pasar o la evaluación quedaría sin salida.
  const sinLista = { ...itemChecklist('TODOS'), opciones: [] }

  it('estaVacioItem lo da por respondido: no queda bloqueado', () => {
    expect(estaVacioItem(sinLista, null)).toBe(false)
    expect(estaVacioItem(sinLista, { selected: [] })).toBe(false)
    expect(tieneRespuesta(sinLista, null)).toBe(true)
  })

  it('pero si la lista SÍ existe, el obligatorio sigue pidiendo marcar', () => {
    const conLista = { ...sinLista, opciones: [{ id: 'p1', etiqueta: 'Bomberos', puntos: 1 }] }
    expect(estaVacioItem(conLista, null)).toBe(true)
    expect(estaVacioItem(conLista, { selected: [] })).toBe(true)
    expect(tieneRespuesta(conLista, null)).toBe(false)
    expect(tieneRespuesta(conLista, { selected: ['p1'] })).toBe(true)
  })

  it('un CHECKLIST común, sin permisos, no cambia de comportamiento', () => {
    const manual = itemChecklist(null)
    expect(estaVacioItem(manual, { selected: [] })).toBe(true)
    expect(tieneRespuesta(manual, null)).toBe(false)
    expect(tieneRespuesta(manual, { selected: ['manual'] })).toBe(true)
  })
})
