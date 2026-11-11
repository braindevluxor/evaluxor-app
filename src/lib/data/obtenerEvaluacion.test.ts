import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Regresión del orden de las consultas de `obtenerEvaluacion`.
 *
 * El `Promise.all` pide `sucursal_permisos` antes que `instancias_grupo`. Si el
 * destructuring los nombra al revés, `detalle.instancias` queda con filas de
 * permisos: ninguna sección encuentra sus registros y el detalle las oculta
 * enteras (los 31 registros de una sección desaparecen aunque estén cargados).
 * Además `sucursalPermisos` queda con registros sin `sucursal_id`, así que los
 * CHECKLIST de permisos se recortan a vacío.
 *
 * Se prueba con un cliente Supabase falso que devuelve datos distintos por tabla
 * y respeta `eq`, `in` y `order`: así el test falla si el orden vuelve a
 * invertirse, sin depender de una base real.
 */
const datos = vi.hoisted(() => ({
  tablas: {} as Record<string, Record<string, unknown>[]>
}))

vi.mock('../supabase', () => {
  /** Constructor encadenable y "awaitable", como los de PostgREST. */
  function crearBuilder(tabla: string) {
    const eqs: [string, unknown][] = []
    const ins: [string, unknown[]][] = []
    const ordenes: { columna: string; ascendente: boolean }[] = []

    const resolver = () => {
      let filas = [...(datos.tablas[tabla] ?? [])]
      for (const [columna, valor] of eqs) filas = filas.filter((fila) => fila[columna] === valor)
      for (const [columna, valores] of ins) filas = filas.filter((fila) => valores.includes(fila[columna]))
      for (const { columna, ascendente } of [...ordenes].reverse()) {
        filas.sort((a, b) => {
          const x = a[columna]
          const y = b[columna]
          const cmp = x === y ? 0 : (x as number) < (y as number) ? -1 : 1
          return ascendente ? cmp : -cmp
        })
      }
      return { data: filas, error: null }
    }

    const builder = {
      select: () => builder,
      eq: (columna: string, valor: unknown) => {
        eqs.push([columna, valor])
        return builder
      },
      in: (columna: string, valores: unknown[]) => {
        ins.push([columna, valores])
        return builder
      },
      order: (columna: string, opciones?: { ascending?: boolean }) => {
        ordenes.push({ columna, ascendente: opciones?.ascending !== false })
        return builder
      },
      maybeSingle: () => {
        const { data } = resolver()
        return Promise.resolve({ data: data[0] ?? null, error: null })
      },
      then: (
        alCumplir: (valor: { data: Record<string, unknown>[]; error: null }) => unknown,
        alFallar?: (motivo: unknown) => unknown
      ) => Promise.resolve(resolver()).then(alCumplir, alFallar)
    }
    return builder
  }

  return { supabase: { from: (tabla: string) => crearBuilder(tabla) } }
})

import { obtenerEvaluacion, resumirEvaluacion } from './indicadores'
import type { Evaluacion, Item, Respuesta, SucursalPermiso } from '../types'

const evaluacion = {
  id: 'ev1',
  offline_uuid: 'ev1',
  sucursal_id: 's1',
  departamento_id: null,
  aperturada_por: null,
  fecha: '2026-10-22',
  estado: 'ACTIVA',
  puntuacion: null,
  comentario_general: null,
  abierta_en: null,
  cerrada_en: null,
  created_at: '',
  sucursal: { id: 's1', nombre: 'Sucursal Norte', shop_id: null, branch_id: null, direccion: null },
  aperturador: null
}

const modulo = { id: 'm1', nombre: 'Operación', descripcion: '', orden: 0, activo: true, created_at: '' }

const seccion = {
  id: 'sec1',
  modulo_id: 'm1',
  tipo: 'CONTENEDOR',
  texto: 'Cajas',
  opciones: [],
  orden: 0,
  requerido: false,
  activo: true,
  puntaje: 100,
  padre_id: null,
  created_at: ''
}

const hijo = {
  id: 'h1',
  modulo_id: 'm1',
  tipo: 'CUMPLE_NO_CUMPLE',
  texto: 'La caja está operativa',
  opciones: [],
  orden: 1,
  requerido: false,
  activo: true,
  puntaje: 100,
  padre_id: 'sec1',
  created_at: ''
}

const instancia = {
  id: 'ins1',
  evaluacion_id: 'ev1',
  item_id: 'sec1',
  etiqueta: 'CAJA-01',
  orden: 0,
  api_id: null,
  datos: null,
  created_at: ''
}

/**
 * Permiso ACTIVO de la sucursal: es el que genera la opción del CHECKLIST de
 * permisos y por eso tiene que llegar a `sucursalPermisos` entero.
 */
const permiso = {
  id: 'perm1',
  sucursal_id: 's1',
  nombre: 'Bomberos',
  numero: null,
  vigente: true,
  emision: null,
  vence: null,
  observacion: null,
  created_at: ''
}

/**
 * CHECKLIST cuyo origen son los permisos de la sucursal: sus opciones no están
 * guardadas, se generan con `sucursalPermisos` en cada pantalla.
 */
const checklistPermisos = {
  id: 'h2',
  modulo_id: 'm1',
  tipo: 'CHECKLIST',
  texto: 'Permisos de la tienda',
  opciones: [],
  permisos_sucursal: 'TODOS',
  orden: 2,
  requerido: false,
  activo: true,
  puntaje: 100,
  padre_id: null,
  created_at: ''
}

/** La opción de `checklistPermisos` marcada por el evaluador. */
const respuestaPermisos = {
  id: 'r2',
  evaluacion_id: 'ev1',
  item_id: 'h2',
  instancia_id: null,
  valor: { selected: ['perm1'] },
  respondido_por: 'u1',
  created_at: ''
}

/** El hijo de la sección está sin cumplir: así el CHECKLIST de permisos (que sí
 * cumple) es el que sostiene el puntaje y se nota si desaparece del cálculo. */
const respuesta = {
  id: 'r1',
  evaluacion_id: 'ev1',
  item_id: 'h1',
  instancia_id: 'ins1',
  valor: { value: false },
  respondido_por: 'u1',
  created_at: ''
}

beforeEach(() => {
  datos.tablas = {
    evaluaciones: [evaluacion],
    respuestas: [respuesta, respuestaPermisos],
    items: [seccion, hijo, checklistPermisos],
    modulos: [modulo],
    fotos: [],
    sucursal_opciones: [],
    departamento_opciones: [],
    sucursal_permisos: [permiso],
    instancias_grupo: [instancia]
  }
})

describe('obtenerEvaluacion · orden de las consultas', () => {
  it('deja los registros de sección en `instancias` y los permisos en `sucursalPermisos`', async () => {
    const detalle = await obtenerEvaluacion('ev1')

    expect(detalle?.instancias).toEqual([instancia])
    expect(detalle?.sucursalPermisos).toEqual([permiso])
  })

  it('trae la sección contenedora junto al ítem respondido de su registro', async () => {
    const detalle = await obtenerEvaluacion('ev1')

    expect(detalle?.items.map((i) => i.id).sort()).toEqual(['h1', 'h2', 'sec1'])
    expect(detalle?.modulos.map((m) => m.id)).toEqual(['m1'])
    expect(detalle?.respuestas).toHaveLength(2)
  })
})

describe('obtenerEvaluacion · el puntaje del detalle', () => {
  /**
   * El historial calcula el puntaje con `consultarEvaluaciones` (que sí trae los
   * permisos reales) y el detalle con `obtenerEvaluacion`. Si `sucursalPermisos`
   * llega con las filas de `instancias_grupo` (el bug del destructuring), el
   * CHECKLIST de permisos queda sin opciones y desaparece del cálculo: el
   * historial marcaba 82.01% y el detalle 44.44%.
   */
  it('da distinto el puntaje si los permisos no llegan', async () => {
    const detalle = await obtenerEvaluacion('ev1')

    // Con la lista de permisos intacta el ítem de permisos puntúa (50%: el hijo
    // de la sección está sin cumplir y el de permisos sí).
    const conPermisoReal = resumirEvaluacion(
      detalle!.evaluacion as Evaluacion,
      detalle!.respuestas as Respuesta[],
      detalle!.items as Item[],
      [],
      detalle!.sucursalPermisos as SucursalPermiso[]
    )
    expect(conPermisoReal.puntaje).not.toBeNull()

    // Con la lista "basura" que devolvía el bug (instancias en vez de permisos)
    // el ítem de permisos queda sin opciones y se cae del cálculo: sólo queda
    // el hijo de la sección, que no cumple.
    const conBasura = resumirEvaluacion(
      detalle!.evaluacion as Evaluacion,
      detalle!.respuestas as Respuesta[],
      detalle!.items as Item[],
      [],
      detalle!.instancias as unknown as SucursalPermiso[]
    )
    expect(conBasura.puntaje).not.toBe(conPermisoReal.puntaje)
  })
})
