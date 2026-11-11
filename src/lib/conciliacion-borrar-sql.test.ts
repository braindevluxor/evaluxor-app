import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { bloqueSql } from './supabaseSql'

/**
 * `mergear_conciliacion`, ejecutada en un Postgres de verdad.
 *
 * POR QUÉ EXISTE ESTE TEST
 * ------------------------
 * Borrar un producto escaneado no se borraba, y no de vez en cuando: no se
 * borraba NUNCA. En producción `upsert_respuestas` no reemplaza el valor de una
 * conciliación, lo fusiona con el que ya está en la nube con esta función, y la
 * fusión era una unión por SKU de las dos listas. Se mandaba una lista sin el
 * producto, el servidor la unía con la anterior —que todavía lo traía—, agrupaba
 * por sku y el producto volvía. En esa misma escritura.
 *
 * Nadie lo veía en el cliente: en el editor la fila desaparecía, y sólo el
 * detalle decía la verdad. Un test de texto tampoco habría servido para nada:
 * esto es una regla de datos, y se prueba contra un motor.
 *
 * El archivo que se corre acá es el mismo que se le pega al SQL Editor.
 */

const DDL = `
  -- Roles de Supabase: sin ellos el revoke del archivo falla.
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  end $$;
`

let db: PGlite

async function mergear(
  previo: unknown,
  entrante: unknown,
  contraDato = 'SOH'
): Promise<Record<string, unknown>> {
  const { rows } = await db.query<{ r: Record<string, unknown> }>(
    'select public.mergear_conciliacion($1::jsonb, $2::jsonb, $3::text) as r',
    [JSON.stringify(previo ?? null), JSON.stringify(entrante ?? null), contraDato]
  )
  return rows[0].r
}

/** Los SKUs que quedaron en el valor, en el orden en que quedaron. */
function skus(v: Record<string, unknown>): string[] {
  return ((v.productos as { sku: string }[] | undefined) ?? []).map((p) => p.sku)
}

beforeAll(async () => {
  db = await PGlite.create()
  await db.exec(DDL)
  const sql = bloqueSql('conciliacion-borrar-productos.sql')
  await db.exec(sql)
}, 120_000)

afterAll(async () => {
  await db?.close()
})

describe('borrar un producto escaneado', () => {
  it('lo mata aunque el valor que ya está en la nube lo traiga', () => {
    // Este era el caso del bug, y ocurría en la MISMA escritura: la lista que
    // sube ya venía sin B, y aun así B volvía porque `previo` lo traía.
    return mergear(
      { productos: [{ sku: 'A', teorica: 2, fisica: 1 }, { sku: 'B' }] },
      { productos: [{ sku: 'A', teorica: 2, fisica: 1 }], borrados: ['B'] }
    ).then((r) => {
      expect(skus(r)).toEqual(['A'])
      // Y la marca queda guardada: es la que mata al sku en la próxima subida
      // de un equipo que no se enteró.
      expect(r.borrados).toEqual(['B'])
    })
  })

  it('aguanta que otro teléfono mande el producto borrado sin saber nada', () => {
    // El evaluador sigue con la lista vieja en el teléfono y la sube entera. La
    // marca que quedó guardada la vuelve a matar: sin persistirla, el borrado
    // dependía de que nadie más subiera después.
    return mergear(
      { productos: [{ sku: 'A' }], borrados: ['B'] },
      { productos: [{ sku: 'A' }, { sku: 'B' }] }
    ).then((r) => {
      expect(skus(r)).toEqual(['A'])
      expect(r.borrados).toEqual(['B'])
    })
  })

  it('y el mismo equipo puede volver a escanearlo a propósito', () => {
    // Es lo único que distingue "lo re-escaneé porque lo quiero" de "este
    // equipo no se enteró del borrado": los dos suben el mismo SKU, y sólo uno
    // lo hace con la marca en la mano.
    return mergear(
      { productos: [{ sku: 'A' }], borrados: ['B'] },
      { productos: [{ sku: 'A' }, { sku: 'B' }], reabrir: ['B'] }
    ).then((r) => {
      expect(skus(r)).toEqual(['A', 'B'])
      // La marca se levantó y no queda pegada al valor.
      expect(r.borrados).toBeUndefined()
      // `reabrir` es de una sola pasada: no se guarda.
      expect(r.reabrir).toBeUndefined()
    })
  })

  it('dos borrados y uno reabierto', () => {
    return mergear(
      { productos: [{ sku: 'A' }, { sku: 'B' }, { sku: 'C' }] },
      { productos: [{ sku: 'A' }, { sku: 'C' }], borrados: ['B'], reabrir: ['C'] }
    ).then((r) => {
      expect(skus(r)).toEqual(['A', 'C'])
      expect(r.borrados).toEqual(['B'])
    })
  })

  it('el producto borrado se lleva su evidencia', () => {
    // Las `paths` del producto viven dentro del producto: si el producto no
    // está, sus fotos tampoco. Si no, el detalle seguía pintando fotos de una
    // fila que ya no existía.
    return mergear(
      { productos: [{ sku: 'A', paths: ['ev/a.jpg'] }, { sku: 'B', paths: ['ev/b.jpg'] }] },
      { productos: [{ sku: 'A', paths: ['ev/a.jpg'] }], borrados: ['B'] }
    ).then((r) => {
      const ps = (r.productos as { sku: string; paths: string[] }[]) ?? []
      expect(ps.map((p) => p.sku)).toEqual(['A'])
      expect(ps[0].paths).toEqual(['ev/a.jpg'])
    })
  })

  it('un valor sin nada que borrar se queda limpio', () => {
    // Sin marcas no se deja la clave: el valor guardado no debe ir lleno de
    // listas muertas.
    return mergear({ productos: [{ sku: 'A' }] }, { productos: [{ sku: 'A' }, { sku: 'B' }] }).then((r) => {
      expect(skus(r)).toEqual(['A', 'B'])
      expect(r.borrados).toBeUndefined()
      expect(r.reabrir).toBeUndefined()
    })
  })

  it('un SKU borrado viejo en el valor previo no mata a uno re-escaneado', () => {
    // Doble red: la marca vieja está en `previo` y alguien la levanta desde
    // `entrante`. Lo que manda es la levantada.
    return mergear(
      { productos: [{ sku: 'A' }], borrados: ['B', 'C'] },
      { productos: [{ sku: 'A' }, { sku: 'B' }], reabrir: ['B'] }
    ).then((r) => {
      expect(skus(r)).toEqual(['A', 'B'])
      expect(r.borrados).toEqual(['C'])
    })
  })
})

describe('lo que ya funcionaba sigue funcionando', () => {
  it('conserva la evidencia de la nube aunque el que sube no traiga ninguna', () => {
    return mergear(
      { productos: [{ sku: 'A', teorica: 2, fisica: 1, paths: ['ev/e/i/f1.jpg'] }] },
      { productos: [{ sku: 'A', teorica: 2, fisica: 1, informativo: false }] }
    ).then((r) => {
      const a = (r.productos as { sku: string; paths: string[] }[])[0]
      expect(a.paths).toEqual(['ev/e/i/f1.jpg'])
    })
  })

  it('conserva apiId y escaneadoPor, que jsonb_build_object tiraría', () => {
    return mergear(
      { productos: [{ sku: 'A', nombre: 'Pan', apiId: 100006130, escaneadoPor: 'María' }] },
      { productos: [{ sku: 'A', teorica: 2, fisica: 2 }] }
    ).then((r) => {
      const a = (r.productos as { sku: string; apiId: number; escaneadoPor: string }[])[0]
      expect(a.apiId).toBe(100006130)
      expect(a.escaneadoPor).toBe('María')
    })
  })

  it('une los paths de arriba, del formato viejo', () => {
    return mergear(
      { paths: ['ev/vieja.jpg'], productos: [{ sku: 'A', paths: ['ev/a.jpg'] }] },
      { paths: ['ev/nueva.jpg'], productos: [{ sku: 'A' }] }
    ).then((r) => {
      expect(r.paths).toEqual(['ev/nueva.jpg', 'ev/vieja.jpg'])
    })
  })
})
