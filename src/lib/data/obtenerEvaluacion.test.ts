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

import { obtenerEvaluacion } from './indicadores'

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

const permiso = { id: 'perm1', sucursal_id: 's1', nombre: 'Bomberos', vence: null, created_at: '' }

const respuesta = {
  id: 'r1',
  evaluacion_id: 'ev1',
  item_id: 'h1',
  instancia_id: 'ins1',
  valor: { value: true },
  respondido_por: 'u1',
  created_at: ''
}

beforeEach(() => {
  datos.tablas = {
    evaluaciones: [evaluacion],
    respuestas: [respuesta],
    items: [seccion, hijo],
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

    expect(detalle?.items.map((i) => i.id).sort()).toEqual(['h1', 'sec1'])
    expect(detalle?.modulos.map((m) => m.id)).toEqual(['m1'])
    expect(detalle?.respuestas).toHaveLength(1)
  })
})
