import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { bloqueSql } from './supabaseSql'

/**
 * El origen de la lista de un CHECKLIST, ejecutado en un Postgres de verdad.
 *
 * POR QUÉ EXISTE ESTE TEST
 * ------------------------
 * El bloque es chico pero hace dos cosas que sólo fallan en la base: agrega una
 * columna a una tabla que ya existe y le pone un `check` de valores. El `check`
 * es el que impide que un origen tipeado mal quede guardado y silenciosamente
 * deje al ítem con la lista manual; un `add column` mal escrito, en cambio, no
 * avisa: crea una columna con otro nombre y la app empieza a leer `undefined`.
 *
 * Acá se corre el bloque TAL CUAL se pega al SQL Editor, contra un PostgreSQL en
 * memoria, partiendo del estado en que está la base del cliente: `items` sin la
 * columna. Si el bloque no compila, este test falla antes de la base de nadie.
 */

const DDL = `
  -- Espejo mínimo de la tabla items: el bloque sólo le agrega una columna.
  create table public.items (
    id uuid primary key default gen_random_uuid(),
    modulo_id uuid,
    tipo text not null,
    texto text not null,
    opciones jsonb,
    orden integer not null default 0,
    requerido boolean not null default false,
    activo boolean not null default true,
    puntaje numeric,
    created_at timestamptz not null default now()
  );
`

const ITEM = '00000000-0000-0000-0000-00000000000a'

let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  await db.exec(DDL)
  await db.exec(bloqueSql('permisos-checklist.sql'))
  // Segunda corrida: tiene que seguir limpio, el bloque es idempotente.
  await db.exec(bloqueSql('permisos-checklist.sql'))
  await db.exec(`insert into public.items (id, tipo, texto) values ('${ITEM}', 'CHECKLIST', 'Permisos de la tienda')`)
})

afterAll(async () => {
  await db.close()
})

async function filas(sql: string): Promise<Record<string, unknown>[]> {
  const r = await db.query(sql)
  return r.rows as Record<string, unknown>[]
}

describe('permisos-checklist.sql · corre limpio', () => {
  it('agrega la columna de origen a items, sin nulos y sin valor por defecto', async () => {
    const [col] = await filas(`
      select data_type, is_nullable, column_default
      from information_schema.columns
      where table_schema = 'public' and table_name = 'items' and column_name = 'permisos_sucursal'
    `)
    // Sin default: un ítem nuevo nace con lista manual, no con permisos.
    expect(col).toEqual({ data_type: 'text', is_nullable: 'YES', column_default: null })
  })

  it('acepta los dos orígenes y el nulo de la lista manual', async () => {
    await db.exec(`update public.items set permisos_sucursal = 'TODOS' where id = '${ITEM}'`)
    await db.exec(`update public.items set permisos_sucursal = 'VENCIDOS' where id = '${ITEM}'`)
    await db.exec(`update public.items set permisos_sucursal = null where id = '${ITEM}'`)
    const [fila] = await filas(`select permisos_sucursal from public.items where id = '${ITEM}'`)
    expect(fila).toEqual({ permisos_sucursal: null })
  })

  it('la base rechaza un origen que no existe, no sólo la pantalla', async () => {
    await expect(db.exec(`update public.items set permisos_sucursal = 'VENCIDOS ' where id = '${ITEM}'`)).rejects.toThrow(/items_permisos_sucursal_valido/)
    await expect(db.exec(`update public.items set permisos_sucursal = 'MANUAL' where id = '${ITEM}'`)).rejects.toThrow(/items_permisos_sucursal_valido/)
    // El rechazo no deja el ítem a medias.
    const [fila] = await filas(`select permisos_sucursal from public.items where id = '${ITEM}'`)
    expect(fila).toEqual({ permisos_sucursal: null })
  })
})
