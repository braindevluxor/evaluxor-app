import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

/**
 * Regresión del tope de filas en `consultarEvaluaciones`.
 *
 * POR QUÉ SE PRUEBA ESTO
 * ----------------------
 * PostgREST devuelve como máximo el `max-rows` del proyecto (1000 por defecto en
 * Supabase) y **corta en silencio**: no hay error, sólo menos filas de las que
 * pediste. El historial junta las respuestas de TODO el rango en una sola
 * consulta `.in('evaluacion_id', ids)`, así que con varios meses de evaluaciones
 * se pasa del tope y el puntaje en curso se calcula con un subconjunto.
 *
 * El detalle no se cortaba porque pide una evaluación cada vez (`.eq`), y por eso
 * los dos números no coincidían: el historial marcaba 58,01% con 42 ítems
 * puntuables mientras el detalle marcaba 51,88% con 159. Como la consulta no
 * tenía `.order()`, además el subconjunto que sobrevivía cambiaba en cada
 * recarga y el número "bailaba".
 *
 * El cliente falso de acá IMITA ese tope: sin `.range()` devuelve a lo sumo
 * `MAX_FILAS` filas, como hace PostgREST en producción.
 */

/** El máximo de filas que PostgREST devuelve por petición. */
const MAX_FILAS = 1000

const datos = vi.hoisted(() => ({
  tablas: {} as Record<string, Record<string, unknown>[]>
}))

vi.mock('../supabase', () => {
  /** Constructor encadenable y "awaitable", como los de PostgREST. */
  function crearBuilder(tabla: string) {
    const filtros: { columna: string; valor: unknown; tipo: 'eq' | 'in' }[] = []
    const ordenes: { columna: string; ascendente: boolean }[] = []
    let rango: [number, number] | null = null

    const resolver = () => {
      let filas = [...(datos.tablas[tabla] ?? [])]
      for (const f of filtros) {
        filas =
          f.tipo === 'eq'
            ? filas.filter((fila) => fila[f.columna] === f.valor)
            : filas.filter((fila) => (f.valor as unknown[]).includes(fila[f.columna]))
      }
      for (const { columna, ascendente } of [...ordenes].reverse()) {
        filas.sort((a, b) => {
          const x = a[columna]
          const y = b[columna]
          const cmp = x === y ? 0 : (x as number) < (y as number) ? -1 : 1
          return ascendente ? cmp : -cmp
        })
      }
      // Este es el corte: PostgREST limita el resultado aunque se pidan más filas.
      const desde = rango ? rango[0] : 0
      const hasta = rango ? rango[1] : MAX_FILAS - 1
      return { data: filas.slice(desde, hasta + 1), error: null }
    }

    const builder = {
      select: () => builder,
      eq: (columna: string, valor: unknown) => {
        filtros.push({ columna, valor, tipo: 'eq' })
        return builder
      },
      in: (columna: string, valores: unknown[]) => {
        filtros.push({ columna, valor: valores, tipo: 'in' })
        return builder
      },
      order: (columna: string, opciones?: { ascending?: boolean }) => {
        ordenes.push({ columna, ascendente: opciones?.ascending !== false })
        return builder
      },
      range: (desde: number, hasta: number) => {
        rango = [desde, hasta]
        return builder
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

import { consultarEvaluaciones, puntajeEnCurso } from './indicadores'

/** Un ítem compartido por todas las evaluaciones del rango. */
const modulo = { id: 'm1', nombre: 'Operación', descripcion: '', orden: 0, activo: true, created_at: '' }

const item = {
  id: 'i1',
  modulo_id: 'm1',
  tipo: 'CUMPLE_NO_CUMPLE',
  texto: 'La caja está operativa',
  opciones: [],
  orden: 0,
  requerido: false,
  activo: true,
  puntaje: 100,
  padre_id: null,
  created_at: ''
}

/** Respuestas por evaluación: 8 × 150 = 1200, por encima del tope de 1000. */
const EVALUACIONES = 8
const RESPUESTAS_POR_EVALUACION = 150

function armarBase() {
  const evaluaciones: Record<string, unknown>[] = []
  const respuestas: Record<string, unknown>[] = []
  for (let e = 0; e < EVALUACIONES; e++) {
    const evId = `ev${e}`
    evaluaciones.push({
      id: evId,
      offline_uuid: evId,
      sucursal_id: 's1',
      departamento_id: null,
      aperturada_por: null,
      fecha: `2026-10-${String(e + 1).padStart(2, '0')}`,
      estado: 'ACTIVA',
      puntuacion: null,
      comentario_general: null,
      abierta_en: null,
      cerrada_en: null,
      created_at: '',
      sucursal: { id: 's1', nombre: 'Sucursal Norte', shop_id: null, branch_id: null, direccion: null },
      aperturador: null
    })
    for (let r = 0; r < RESPUESTAS_POR_EVALUACION; r++) {
      respuestas.push({
        id: `r${e}-${r}`,
        evaluacion_id: evId,
        item_id: 'i1',
        instancia_id: null,
        // La mitad cumple y la mitad no: el puntaje esperado es 50.
        valor: { value: r % 2 === 0 },
        respondido_por: 'u1',
        created_at: ''
      })
    }
  }
  datos.tablas = {
    evaluaciones,
    respuestas,
    items: [item],
    modulos: [modulo],
    fotos: [],
    sucursal_opciones: [],
    departamento_opciones: [],
    sucursal_permisos: [],
    instancias_grupo: []
  }
  return { evaluaciones, respuestas }
}

describe('consultarEvaluaciones · tope de filas de PostgREST', () => {
  it('no pierde respuestas cuando el rango pasa del máximo de filas', async () => {
    const { respuestas } = armarBase()
    expect(respuestas.length).toBeGreaterThan(MAX_FILAS)

    const datosCargados = await consultarEvaluaciones({ sucursal_ids: null })

    // Antes del arreglo la consulta única devolvía a lo sumo 1000 filas.
    expect(datosCargados.respuestas).toHaveLength(EVALUACIONES * RESPUESTAS_POR_EVALUACION)
  })

  it('da el mismo puntaje en curso que el detalle para cada evaluación', async () => {
    armarBase()

    const datosCargados = await consultarEvaluaciones({ sucursal_ids: null })

    for (const ev of datosCargados.evaluaciones) {
      const enCurso = puntajeEnCurso(
        ev as never,
        datosCargados.respuestas,
        datosCargados.items,
        datosCargados.sucursalOpciones,
        datosCargados.sucursalPermisos
      )
      // 150 puntuables, la mitad cumplen: 50% y los 150 contados.
      expect(enCurso.respondidos).toBe(RESPUESTAS_POR_EVALUACION)
      expect(enCurso.puntaje).toBe(50)
    }
  })

  it('paginiza con `.range()` y ordena para que el corte no cambie entre recargas', () => {
    const codigo = readFileSync(fileURLToPath(new URL('./indicadores.ts', import.meta.url)), 'utf8')
    const cuerpo = codigo.slice(codigo.indexOf('export async function consultarEvaluaciones'))
    // Sin orden, PostgREST devuelve un subconjunto distinto en cada recarga.
    expect(cuerpo).toContain(".order('id').range(")
    expect(cuerpo).toContain('.range(desde, hasta)')
  })
})
