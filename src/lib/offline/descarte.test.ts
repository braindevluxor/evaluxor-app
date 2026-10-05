import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { ErrorSubida } from '../subida'
import { guardarBorradorNube } from './sync'

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

const { fromMock, rpcMock } = vi.hoisted(() => ({ fromMock: vi.fn(), rpcMock: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { from: fromMock, rpc: rpcMock } }))

/** Respuesta de Supabase como promesa, con lo mínimo que usa el puente. */
function res(data: unknown, error: unknown = null) {
  return { then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data, error })) }
}

const FK_ITEM = {
  code: '23503',
  message: 'insert or update on table "respuestas" violates foreign key constraint "respuestas_item_id_fkey"',
  details: ''
}

const EV = 'ev-1'
const USUARIO = 'usr-1'

const respuesta = (item_id: string, valor: unknown = 'sí') => ({ item_id, instancia_id: null, valor })
const instancia = (id: string, item_id: string) => ({ id, item_id, etiqueta: `Fila ${id}`, orden: 1 })

/** El error con el que se cayó la subida, para poder mirarlo campo por campo. */
async function rechazoDe(p: Promise<unknown>): Promise<ErrorSubida> {
  const err = await p.then(
    () => null,
    (e: ErrorSubida) => e
  )
  expect(err, 'se esperaba que la subida fuera rechazada').not.toBeNull()
  return err as ErrorSubida
}

beforeEach(() => {
  fromMock.mockReset()
  rpcMock.mockReset()
})

/** Simula el catálogo: `vivos` son los ítems que siguen existiendo. */
function catalogo(vivos: string[]) {
  fromMock.mockImplementation((tabla: string) => {
    if (tabla === 'items') {
      return { select: () => ({ in: (_col: string, ids: string[]) => res(ids.filter((i) => vivos.includes(i)).map((id) => ({ id }))) }) }
    }
    if (tabla === 'instancias_grupo') {
      return { upsert: () => res(null, null) }
    }
    throw new Error(`tabla inesperada: ${tabla}`)
  })
}

/** Filas del ÚLTIMO intento: el que importa es el que el servidor aceptó. */
function filasEnviadas(): { item_id: string; valor: unknown }[] {
  const llamadas = rpcMock.mock.calls.filter(([nombre]) => nombre === 'upsert_respuestas')
  const ultima = llamadas[llamadas.length - 1]
  return (ultima?.[1] as { rows: { item_id: string; valor: unknown }[] }).rows
}

describe('subida con ítems borrados del catálogo', () => {
  it('sube todo y no descarta nada cuando el catálogo está completo', async () => {
    catalogo(['i1', 'i2'])
    rpcMock.mockResolvedValue({ data: null, error: null })

    const r = await guardarBorradorNube(EV, USUARIO, [respuesta('i1'), respuesta('i2')])

    expect(r.item_ids).toEqual([])
    expect(filasEnviadas().map((f) => f.item_id)).toEqual(['i1', 'i2'])
  })

  it('el 23503 de respuestas no bloquea el resto del avance', async () => {
    // i1 sigue en la plantilla; i2 se borró al editar el cuestionario.
    catalogo(['i1'])
    rpcMock.mockResolvedValueOnce({ data: null, error: FK_ITEM }).mockResolvedValueOnce({ data: null, error: null })

    const r = await guardarBorradorNube(EV, USUARIO, [respuesta('i1'), respuesta('i2')])

    expect(r.item_ids).toEqual(['i2'])
    // El reintento lleva solo lo vigente: es lo que antes se quedaba trabado.
    expect(rpcMock.mock.calls.filter(([n]) => n === 'upsert_respuestas')).toHaveLength(2)
    expect(filasEnviadas().map((f) => f.item_id)).toEqual(['i1'])
    expect(filasEnviadas()[0].valor).toBe('sí')
  })

  it('filtra también los registros del ítem borrado, que fallan antes que las respuestas', async () => {
    // Las instancias se suben primero (FK): si no se filtraran, el lote moría
    // ahí y la recuperación de respuestas nunca llegaba a correr.
    catalogo(['i1'])
    const subida: string[][] = []
    fromMock.mockImplementation((tabla: string) => {
      if (tabla === 'items') return { select: () => ({ in: (_c: string, ids: string[]) => res(ids.filter((i) => i === 'i1').map((id) => ({ id }))) }) }
      if (tabla === 'instancias_grupo') {
        return {
          upsert: (filas: { item_id: string }[]) => {
            if (filas.some((f) => f.item_id === 'i2')) {
              return res(null, { code: '23503', message: 'violates foreign key constraint "instancias_grupo_item_id_fkey"' })
            }
            subida.push(filas.map((f) => f.item_id))
            return res(null, null)
          }
        }
      }
      throw new Error(`tabla inesperada: ${tabla}`)
    })
    rpcMock.mockResolvedValue({ data: null, error: null })

    const r = await guardarBorradorNube(EV, USUARIO, [respuesta('i1'), respuesta('i2')], [instancia('a', 'i1'), instancia('b', 'i2')])

    expect(r.item_ids).toEqual(['i2'])
    expect(subida).toEqual([['i1']])
  })

  it('propaga el error si no se puede consultar el catálogo, antes que descartar de más', async () => {
    fromMock.mockImplementation((tabla: string) => {
      if (tabla === 'items') return { select: () => ({ in: () => res(null, { message: 'timeout' }) }) }
      if (tabla === 'instancias_grupo') return { upsert: () => res(null, null) }
      throw new Error(`tabla inesperada: ${tabla}`)
    })
    rpcMock.mockResolvedValue({ data: null, error: FK_ITEM })

    await expect(guardarBorradorNube(EV, USUARIO, [respuesta('i1'), respuesta('i2')])).rejects.toThrow(/violates foreign key/i)
    expect(rpcMock.mock.calls.filter(([n]) => n === 'upsert_respuestas')).toHaveLength(1)
  })

  it('no reintenta en loop si el 23503 no venía de un ítem', async () => {
    // Todos los ítems existen: la FK rota es otra (evaluación o registro). El
    // filtro no saca nada, así que el error se propaga tal cual.
    catalogo(['i1', 'i2'])
    rpcMock.mockResolvedValue({ data: null, error: FK_ITEM })

    await expect(guardarBorradorNube(EV, USUARIO, [respuesta('i1'), respuesta('i2')])).rejects.toThrow(/violates foreign key/i)
    expect(rpcMock.mock.calls.filter(([n]) => n === 'upsert_respuestas')).toHaveLength(1)
  })

  it('el error que propaga queda clasificado como ítem borrado, no como conexión', async () => {
    catalogo(['i1', 'i2'])
    rpcMock.mockResolvedValue({ data: null, error: FK_ITEM })

    await expect(guardarBorradorNube(EV, USUARIO, [respuesta('i1')])).rejects.toMatchObject({ causa: 'item_borrado' })
  })
})

describe('subida con un ítem que el servidor ya no deja escribir', () => {
  // 42501: el lote entero se rechaza por RLS. Es el caso de la sección repetible
  // que quedó desactivada o de un módulo que le dieron de baja al evaluador: una
  // sola fila sin permiso bloqueaba TODO el avance, para siempre.
  const RLS = {
    code: '42501',
    message: 'new row violates row-level security policy for table "instancias_grupo"',
    details: ''
  }

  /** `instancias_grupo` acepta todo salvo lo de `sinPermiso` (y salvo `todo`). */
  function instancias(sinPermiso: string[], todo = false) {
    return {
      upsert: (filas: { item_id: string }[]) => {
        const mala = todo || filas.some((f) => sinPermiso.includes(f.item_id))
        return res(null, mala ? RLS : null)
      }
    }
  }

  function con(tablas: Record<string, unknown>) {
    fromMock.mockImplementation((tabla: string) => {
      if (tabla === 'items') return { select: () => ({ in: () => res(null, { message: 'no se usa' }) }) }
      if (tabla === 'evaluaciones') return { select: () => ({ eq: () => ({ maybeSingle: () => res({ estado: 'ACTIVA' }) }) }) }
      const t = tablas[tabla]
      if (!t) throw new Error(`tabla inesperada: ${tabla}`)
      return t
    })
    rpcMock.mockResolvedValue({ data: null, error: null })
  }

  it('sube los registros que sí tienen permiso y descarta solo el que no', async () => {
    const subida: string[][] = []
    con({
      instancias_grupo: {
        upsert: (filas: { item_id: string }[]) => {
          if (filas.some((f) => f.item_id === 'i2')) return res(null, RLS)
          subida.push(filas.map((f) => f.item_id))
          return res(null, null)
        }
      }
    })

    const r = await guardarBorradorNube(
      EV,
      USUARIO,
      [respuesta('i1'), respuesta('i2')],
      [instancia('a', 'i1'), instancia('b', 'i2')]
    )

    expect(r.item_ids).toEqual(['i2'])
    expect(r.motivos).toEqual(['sin_permiso'])
    expect(subida).toEqual([['i1']])
  })

  it('el camino rápido sigue siendo una sola llamada cuando todo tiene permiso', async () => {
    let llamadas = 0
    con({ instancias_grupo: { upsert: () => { llamadas++; return res(null, null) } } })

    const r = await guardarBorradorNube(EV, USUARIO, [respuesta('i1')], [instancia('a', 'i1')])

    expect(r.item_ids).toEqual([])
    expect(llamadas).toBe(1)
  })

  it('si no pasa ningún ítem, el problema no es de una fila y se propaga el error', async () => {
    // Evaluación cerrada o módulo dado de baja para todo: aislar no sirve de nada
    // y se pierde el error del lote, que explica más.
    con({ instancias_grupo: instancias(['i1', 'i2'], true) })

    await expect(
      guardarBorradorNube(EV, USUARIO, [respuesta('i1')], [instancia('a', 'i1')])
    ).rejects.toThrow(/row-level security/i)
  })

  it('el aislamiento no toca los otros errores: sin conexión se propaga', async () => {
    con({ instancias_grupo: { upsert: () => res(null, { message: 'Failed to fetch' }) } })

    await expect(
      guardarBorradorNube(EV, USUARIO, [respuesta('i1')], [instancia('a', 'i1')])
    ).rejects.toMatchObject({ causa: 'sin_conexion' })
  })
})

describe('el rechazo por permiso se nombra, no se adivina', () => {
  const RLS = {
    code: '42501',
    message: 'new row violates row-level security policy for table "instancias_grupo"',
    details: ''
  }

  /** RLS en todo, y la evaluación en el estado que se le pase. */
  function conEvaluacion(estado: string) {
    fromMock.mockImplementation((tabla: string) => {
      if (tabla === 'instancias_grupo') return { upsert: () => res(null, RLS) }
      if (tabla === 'evaluaciones') {
        return { select: () => ({ eq: () => ({ maybeSingle: () => res({ estado }) }) }) }
      }
      if (tabla === 'items') return { select: () => ({ in: () => res(null, { message: 'no se usa' }) }) }
      throw new Error(`tabla inesperada: ${tabla}`)
    })
    rpcMock.mockResolvedValue({ data: null, error: null })
  }

  it('si la evaluación ya no está activa, lo dice en vez de seguir probando', async () => {
    conEvaluacion('CERRADA')

    await expect(
      guardarBorradorNube(EV, USUARIO, [respuesta('i1')], [instancia('a', 'i1')])
    ).rejects.toMatchObject({ causa: 'evaluacion_cerrada' })
  })

  it('si sigue abierta, sigue siendo un rechazo genérico', async () => {
    conEvaluacion('ACTIVA')

    await expect(
      guardarBorradorNube(EV, USUARIO, [respuesta('i1')], [instancia('a', 'i1')])
    ).rejects.toMatchObject({ causa: 'rechazada' })
  })

  it('si no se puede leer el estado, no se inventa la causa', async () => {
    fromMock.mockImplementation((tabla: string) => {
      if (tabla === 'instancias_grupo') return { upsert: () => res(null, RLS) }
      if (tabla === 'evaluaciones') return { select: () => ({ eq: () => ({ maybeSingle: () => res(null, null) }) }) }
      throw new Error(`tabla inesperada: ${tabla}`)
    })

    await expect(
      guardarBorradorNube(EV, USUARIO, [respuesta('i1')], [instancia('a', 'i1')])
    ).rejects.toMatchObject({ causa: 'rechazada' })
  })
})

describe('el rechazo nombra el módulo que lo causa', () => {
  const RLS = {
    code: '42501',
    message: 'new row violates row-level security policy for table "instancias_grupo"',
    details: ''
  }

  /**
   * El catálogo tal como lo puede leer un evaluador: `items` y `modulos` están
   * abiertos a autenticados, y de `asignaciones_modulos` solo ve las suyas, que
   * es lo que replica `puede_manejar_instancia`.
   */
  function catalogoDelEvaluador(activo: string[], sucursal: string[], alConsultarItems?: () => void) {
    fromMock.mockImplementation((tabla: string) => {
      if (tabla === 'instancias_grupo') return { upsert: () => res(null, RLS) }
      if (tabla === 'evaluaciones') {
        return { select: () => ({ eq: () => ({ maybeSingle: () => res({ estado: 'ACTIVA', sucursal_id: 'suc-1' }) }) }) }
      }
      if (tabla === 'items') {
        return {
          select: () => ({
            in: (_c: string, ids: string[]) => {
              alConsultarItems?.()
              return res(ids.map((id) => ({ id, modulo_id: 'mod-1' })))
            }
          })
        }
      }
      if (tabla === 'asignaciones_modulos') {
        return { select: () => ({ eq: () => res(activo.map((modulo_id) => ({ modulo_id }))) }) }
      }
      if (tabla === 'sucursal_modulos') {
        return { select: () => ({ eq: () => ({ eq: () => res(sucursal.map((modulo_id) => ({ modulo_id }))) }) }) }
      }
      if (tabla === 'modulos') {
        return { select: () => ({ in: () => res([{ id: 'mod-1', nombre: 'Almacén' }]) }) }
      }
      throw new Error(`tabla inesperada: ${tabla}`)
    })
    rpcMock.mockResolvedValue({ data: null, error: null })
  }

  it('el módulo dado de baja viene con su nombre, no con el error de Postgres', async () => {
    // Es el caso que reportan los evaluadores: la interna de RLS no dice qué pasó,
    // y sin esto el único texto que veían era `42501 · new row violates
    // row-level security policy for table "instancias_grupo"`.
    catalogoDelEvaluador([], ['mod-1'])

    await expect(
      guardarBorradorNube(EV, USUARIO, [respuesta('i1')], [instancia('a', 'i1')])
    ).rejects.toMatchObject({
      causa: 'rechazada',
      explicacion: expect.stringContaining('«Almacén» ya no lo tenés asignado')
    })
  })

  it('también nombra el módulo que no está habilitado en la sucursal', async () => {
    // Asignado y activo, pero la sucursal tiene otros módulos activos y este no
    // está: el `exists` de `puede_manejar_instancia` no lo encuentra.
    catalogoDelEvaluador(['mod-1'], ['mod-otro'])

    await expect(
      guardarBorradorNube(EV, USUARIO, [respuesta('i1')], [instancia('a', 'i1')])
    ).rejects.toMatchObject({
      explicacion: expect.stringContaining('«Almacén» no está habilitado en esta sucursal')
    })
  })

  it('con el módulo en regla no se inventa un motivo', async () => {
    catalogoDelEvaluador(['mod-1'], ['mod-1'])

    const err = await rechazoDe(guardarBorradorNube(EV, USUARIO, [respuesta('i1')], [instancia('a', 'i1')]))
    expect(err.causa).toBe('rechazada')
    expect(err.explicacion).toBeUndefined()
  })

  it('los ids van en tandas: el diagnóstico no se cae con un avance largo', async () => {
    // Los ids viajan en la URL del POST. Mandarlos todos en un `in` con una
    // evaluación larga cortaría la petición y el diagnóstico se perdería justo
    // en el caso donde más ítems pueden estar bloqueados.
    let consultas = 0
    catalogoDelEvaluador([], ['mod-1'], () => consultas++)

    const muchas = Array.from({ length: 250 }, (_, i) => respuesta(`i${i}`))
    const err = await rechazoDe(guardarBorradorNube(EV, USUARIO, muchas, [instancia('a', 'i249')]))

    expect(consultas).toBe(3) // 250 ids en tandas de 100
    expect(err.explicacion).toContain('«Almacén» ya no lo tenés asignado')
  })

  it('si el catálogo no responde, el error sale igual y sin explicación', async () => {
    // Un diagnóstico que no se puede hacer no puede tapar el error que sí se sabe.
    fromMock.mockImplementation((tabla: string) => {
      if (tabla === 'instancias_grupo') return { upsert: () => res(null, RLS) }
      if (tabla === 'evaluaciones') {
        return { select: () => ({ eq: () => ({ maybeSingle: () => res({ estado: 'ACTIVA', sucursal_id: 'suc-1' }) }) }) }
      }
      throw new Error(`tabla inesperada: ${tabla}`)
    })

    const err = await rechazoDe(guardarBorradorNube(EV, USUARIO, [respuesta('i1')], [instancia('a', 'i1')]))
    expect(err.causa).toBe('rechazada')
    expect(err.explicacion).toBeUndefined()
  })

  it('la evaluación cerrada manda sobre el módulo: es lo primero que se corrige', async () => {
    fromMock.mockImplementation((tabla: string) => {
      if (tabla === 'instancias_grupo') return { upsert: () => res(null, RLS) }
      if (tabla === 'evaluaciones') {
        return { select: () => ({ eq: () => ({ maybeSingle: () => res({ estado: 'CERRADA', sucursal_id: 'suc-1' }) }) }) }
      }
      throw new Error(`tabla inesperada: ${tabla}`)
    })

    const err = await rechazoDe(guardarBorradorNube(EV, USUARIO, [respuesta('i1')], [instancia('a', 'i1')]))
    expect(err.causa).toBe('evaluacion_cerrada')
    expect(err.explicacion).toBeUndefined()
  })
})

describe('la pantalla no promete lo que un ítem borrado no puede dar', () => {
  const pagina = () => fuente('../../pages/evaluar/EvaluarSucursal.tsx')

  it('no arma el intervalo de reintento cuando la causa no se reintenta', () => {
    // `cadaMs` es 0 para `item_borrado`: sin este guardia el `setInterval`
    // disparaba sin pausa contra un rechazo que nunca va a pasar.
    expect(pagina()).toMatch(/if \(!mensajeSubida\(fallaSubida\.causa\)\.reintentar\) return/)
  })

  it('esconde el botón de reintentar y el "se reintenta cada X s" cuando no aplica', () => {
    const p = pagina()
    const reintenta = p.match(/mensajeSubida\(fallaSubida\.causa\)\.reintentar \? \(([\s\S]{0,600}?)\) : null/g) ?? []
    expect(reintenta.length).toBeGreaterThanOrEqual(2)
  })

  it('avisa qué respuestas no subiendo, con la etiqueta del ítem y no el UUID', () => {
    const p = pagina()
    expect(p).toContain('no se pudo subir')
    expect(p).toContain('etiquetaDeItem.get(id)')
  })

  it('distingue el descarte por permiso del descarte por ítem borrado', () => {
    // Mismo banner, dos problemas distintos: contra el ítem borrado avisarle al
    // Líder que editó la plantilla; contra el permiso, que revise la asignación.
    const p = pagina()
    expect(p).toContain("descarte.motivos.includes('sin_permiso')")
    expect(p).toContain('no te da permiso')
  })
})