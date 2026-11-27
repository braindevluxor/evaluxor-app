import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { schemaSql } from './supabaseSql'

/**
 * `upsert_respuestas` con GUARDA de cambios, ejecutada en un Postgres de verdad.
 *
 * POR QUÉ EXISTE ESTE TEST
 * ------------------------
 * El consumo excesivo de Realtime (millones de mensajes) salía de acá: cada
 * guardado del borrador manda el lote COMPLETO de respuestas y, sin la
 * guarda, el `do update` reescribía TODAS las filas aunque sólo una hubiera
 * cambiado — y cada re-escritura es UN EVENTO de realtime por fila por
 * suscriptor (el canal `ev-vivo-` de la evaluación).
 *
 * Lo que se prueba es el observable: una fila que llega IGUAL no cambia de
 * versión (su `xmin` queda intacto — no hubo UPDATE, no hubo evento), y una
 * que llega distinta sí se actualiza, en las DOS ramas (directa y por
 * instancia). La función se corre dos veces: tiene que ser idempotente.
 */

/** La función tal como está en schema.sql (está en la raíz, sin marca de bloque). */
function fnUpsert(): string {
  const m = schemaSql().match(
    /create or replace function public\.upsert_respuestas[\s\S]*?\$\$;/
  )
  if (!m) throw new Error('upsert_respuestas no se encontró en schema.sql')
  return m[0]
}

const DDL = `
  -- Espejo mínimo: sólo lo que la función toca —la tabla y los DOS índices
  -- parciales que el "on conflict ... where" tiene que inferir—. Sin RLS:
  -- la guarda es de datos, no de permisos (eso lo cubre permisos-sql).
  create table public.respuestas (
    id uuid primary key default gen_random_uuid(),
    evaluacion_id uuid not null,
    item_id uuid not null,
    instancia_id uuid,
    valor jsonb not null default 'null'::jsonb,
    respondido_por uuid,
    created_at timestamptz not null default now()
  );
  create unique index uniq_respuestas_directas
    on public.respuestas(evaluacion_id, item_id) where instancia_id is null;
  create unique index uniq_respuestas_instancia
    on public.respuestas(evaluacion_id, item_id, instancia_id) where instancia_id is not null;
`

const EVAL = '11111111-1111-1111-1111-111111111111'
const ITEM = '22222222-2222-2222-2222-222222222222'
const INSTANCIA = '33333333-3333-3333-3333-333333333333'
const USER_A = '44444444-4444-4444-4444-444444444444'
const USER_B = '55555555-5555-5555-5555-555555555555'

let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  await db.exec(DDL)
  await db.exec(fnUpsert())
  await db.exec(fnUpsert())
})

afterAll(async () => {
  await db.close()
})

/** La versión de la fila: si no cambia, no hubo UPDATE (no hubo evento). */
async function xminDe(instancia: string | null): Promise<string> {
  const r = await db.query<{ x: string }>(
    `select xmin::text as x from public.respuestas
      where evaluacion_id = '${EVAL}' and item_id = '${ITEM}'
        and instancia_id ${instancia ? `= '${instancia}'` : 'is null'}`
  )
  return r.rows[0]?.x ?? ''
}

async function upsert(fila: Record<string, unknown>): Promise<void> {
  await db.query(`select public.upsert_respuestas($1::jsonb)`, [JSON.stringify([fila])])
}

const directa = (valor: unknown, respondido = USER_A) => ({
  evaluacion_id: EVAL,
  item_id: ITEM,
  instancia_id: null,
  valor,
  respondido_por: respondido
})

describe('upsert_respuestas · la guarda de cambios', () => {
  it('inserta la respuesta nueva', async () => {
    await upsert(directa({ v: 1 }))
    const r = await db.query<{ valor: unknown }>(
      `select valor from public.respuestas where evaluacion_id = '${EVAL}' and item_id = '${ITEM}'`
    )
    expect(r.rows[0]?.valor).toEqual({ v: 1 })
    expect(await xminDe(null)).not.toBe('')
  })

  it('con el MISMO valor no re-escribe la fila: su xmin queda intacto', async () => {
    const antes = await xminDe(null)
    await upsert(directa({ v: 1 }))
    // Sin guarda, esto era un UPDATE por fila aunque nada hubiera cambiado
    // —y el UPDATE era el evento de realtime que inflaba el consumo.
    expect(await xminDe(null)).toBe(antes)
  })

  it('con valor distinto sí re-escribe', async () => {
    const antes = await xminDe(null)
    await upsert(directa({ v: 2 }))
    expect(await xminDe(null)).not.toBe(antes)
    const r = await db.query<{ valor: unknown }>(
      `select valor from public.respuestas where evaluacion_id = '${EVAL}' and item_id = '${ITEM}'`
    )
    expect(r.rows[0]?.valor).toEqual({ v: 2 })
  })

  it('con el mismo valor pero OTRO evaluador sí re-escribe (cambia quién respondió)', async () => {
    const antes = await xminDe(null)
    await upsert(directa({ v: 2 }, USER_B))
    expect(await xminDe(null)).not.toBe(antes)
  })

  it('la rama por instancia respeta la misma guarda', async () => {
    const conInstancia = { ...directa({ p: 1 }), instancia_id: INSTANCIA }
    await upsert(conInstancia)
    const antes = await xminDe(INSTANCIA)
    await upsert(conInstancia)
    expect(await xminDe(INSTANCIA)).toBe(antes)
    await upsert({ ...conInstancia, valor: { p: 2 } })
    expect(await xminDe(INSTANCIA)).not.toBe(antes)
  })
})
