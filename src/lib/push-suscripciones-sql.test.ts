import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { bloqueSql } from './supabaseSql'

/**
 * push-suscripciones.sql, ejecutado en un Postgres de verdad.
 *
 * POR QUÉ EXISTE ESTE TEST
 * ------------------------
 * El bloque es corto pero carga la política que sostiene toda la función de
 * notificaciones, y dos de esas reglas sólo fallan cuando alguien consulta
 * con otro rol o intenta escribir una fila ajena:
 *
 *  1. **El `endpoint` es único.** Es la clave natural de la fila: si se
 *     permitieran dos filas con el mismo endpoint, el envío mandaría dos
 *     veces la misma notificación.
 *  2. **RLS por dueño.** Sólo el dueño ve y gestiona sus suscripciones.
 *     Si la política fuera `using (true)`, cualquier usuario autenticado
 *     podría leer los endpoints de todos los demás —que son direcciones
 *     de entrega con claves de cifrado.
 *  3. **anon queda sin nada.** El grant por defecto de Supabase le da
 *     acceso a las tablas nuevas; el revoke es lo que cierra esa puerta.
 *
 * Se corre DOS VECES para probar la idempotencia, como todos los bloques
 * del repo.
 */

const DDL = `
  -- Roles de Supabase: sin ellos el "to authenticated" de las políticas falla.
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  end $$;

  create schema if not exists auth;
  create table if not exists auth.users (id uuid primary key);
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;

  do $$ begin
    grant usage on schema public to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
  end $$;
`

const USUARIO_A = '00000000-0000-0000-0000-000000000a01'
const USUARIO_B = '00000000-0000-0000-0000-000000000b02'
const ENDPOINT_A = 'https://fcm.googleapis.com/fcm/send/endpoint-uno'
const ENDPOINT_B = 'https://fcm.googleapis.com/fcm/send/endpoint-dos'

let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  await db.exec(DDL)
  await db.exec(`insert into auth.users (id) values ('${USUARIO_A}'), ('${USUARIO_B}')`)
  await db.exec(bloqueSql('push-suscripciones.sql'))
  // Segunda corrida: tiene que seguir limpio, el bloque es idempotente.
  await db.exec(bloqueSql('push-suscripciones.sql'))
})

afterAll(async () => {
  await db.close()
})

/** La sesión se hace pasar por este usuario: es lo que `auth.uid()` devuelve. */
async function como(usuario: string | null): Promise<void> {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [usuario ?? ''])
}

/**
 * Baja al rol `authenticated` para que el RLS se aplique de verdad.
 *
 * La conexión de pglite es `postgres`, que es el DUEÑO de las tablas, y el
 * dueño bypasea RLS salvo `FORCE ROW LEVEL SECURITY`. Sin este cambio, los
 * tests de políticas leerían y escribirían todo aunque la política estuviera
 * mal — que es el falso positivo exacto que obligó a escribirlo acá.
 */
async function comoRolNormal(): Promise<void> {
  await db.exec('set role authenticated')
}

/** Vuelve al rol de la conexión para poder seguir escribiendo el espejo. */
async function volverAlRolOriginal(): Promise<void> {
  await db.exec('reset role')
}

async function filas(sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
  const r = await db.query(sql, params)
  return r.rows as Record<string, unknown>[]
}

async function contar(sql: string, params: unknown[] = []): Promise<number> {
  const [f] = await filas(sql, params)
  return Number(f.n)
}

/** Suscribe un endpoint para un usuario, como lo hace la app. */
async function suscribir(usuario: string, endpoint: string): Promise<void> {
  await db.query(
    `insert into public.push_suscripciones (user_id, endpoint, p256dh, auth)
     values ($1, $2, 'clave-p256dh', 'clave-auth')`,
    [usuario, endpoint]
  )
}

describe('push-suscripciones.sql · la tabla', () => {
  it('crea la tabla con el endpoint único y las claves de cifrado', async () => {
    const columnas = await filas(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'push_suscripciones'
       order by column_name`
    )
    expect(columnas.map((c) => c.column_name)).toEqual([
      'activa',
      'auth',
      'created_at',
      'endpoint',
      'id',
      'p256dh',
      'updated_at',
      'user_id'
    ])

    const unico = await filas(
      `select count(*)::int as n from pg_indexes
       where schemaname = 'public' and tablename = 'push_suscripciones'
         and indexdef like '%UNIQUE%' and indexdef like '%endpoint%'`
    )
    expect(unico[0].n).toBe(1)
  })

  it('el mismo endpoint no se puede suscribir dos veces', async () => {
    await suscribir(USUARIO_A, ENDPOINT_A)
    await expect(suscribir(USUARIO_B, ENDPOINT_A)).rejects.toThrow()
    // Y la fila que ya estaba sigue ahí, no se pisó.
    const n = await contar(
      `select count(*)::int as n from public.push_suscripciones where endpoint = $1`,
      [ENDPOINT_A]
    )
    expect(n).toBe(1)
  })

  it('borrar al usuario se lleva sus suscripciones (sin filas huérfanas)', async () => {
    await db.exec(`insert into auth.users (id) values ('00000000-0000-0000-0000-000000000c03')`)
    await suscribir('00000000-0000-0000-0000-000000000c03', 'https://fcm.googleapis.com/fcm/send/tercero')
    await db.exec(`delete from auth.users where id = '00000000-0000-0000-0000-000000000c03'`)

    const n = await contar(
      `select count(*)::int as n from public.push_suscripciones where endpoint = 'https://fcm.googleapis.com/fcm/send/tercero'`
    )
    expect(n).toBe(0)
  })
})

describe('push-suscripciones.sql · RLS: cada uno con las suyas', () => {
  it('cada usuario sólo ve sus propias suscripciones', async () => {
    await suscribir(USUARIO_B, ENDPOINT_B)
    // Sin bajar de rol el owner bypasea RLS y los dos verían todo.
    await comoRolNormal()

    await como(USUARIO_A)
    const mias = await filas(
      `select endpoint from public.push_suscripciones order by endpoint`
    )
    expect(mias.map((m) => m.endpoint)).toEqual([ENDPOINT_A])

    await como(USUARIO_B)
    const lasSuyas = await filas(
      `select endpoint from public.push_suscripciones order by endpoint`
    )
    // B ve la SUYA y no la de A.
    expect(lasSuyas.some((m) => m.endpoint === ENDPOINT_B)).toBe(true)
    expect(lasSuyas.some((m) => m.endpoint === ENDPOINT_A)).toBe(false)

    await volverAlRolOriginal()
  })

  it('nadie puede escribir una suscripción ajena', async () => {
    await comoRolNormal()
    await como(USUARIO_A)
    await expect(suscribir(USUARIO_B, 'https://fcm.googleapis.com/fcm/send/ajeno')).rejects.toThrow()
    await volverAlRolOriginal()
  })

  it('nadie puede apagar la suscripción de otro', async () => {
    await comoRolNormal()
    await como(USUARIO_A)
    const afectadas = await db.query(
      `update public.push_suscripciones set activa = false where endpoint = $1`,
      [ENDPOINT_B]
    )
    // RLS del update: la fila de B no se toca.
    expect(Number((afectadas as { affectedRows?: number }).affectedRows ?? 0)).toBe(0)
    await volverAlRolOriginal()

    await como(USUARIO_B)
    const sigueActiva = await contar(
      `select count(*)::int as n from public.push_suscripciones where endpoint = $1 and activa`,
      [ENDPOINT_B]
    )
    expect(sigueActiva).toBe(1)
  })

  it('anon no tiene acceso a nada de la tabla', async () => {
    // El revoke es del bloque y aplica a la conexión; no hace falta cambiar
    // de rol para comprobarlo, `has_table_privilege` mira el catálogo.
    for (const permiso of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
      const acceso = await filas(
        `select has_table_privilege('anon', 'public.push_suscripciones', '${permiso}') as puede`
      )
      expect(acceso[0].puede, `anon con ${permiso}`).toBe(false)
    }
  })
})

describe('push-suscripciones.sql · las cuatro políticas están', () => {
  it('hay una política por operación y ninguna para anon', async () => {
    const politicas = await filas(
      `select cmd from pg_policies
       where schemaname = 'public' and tablename = 'push_suscripciones'
       order by cmd`
    )
    expect(politicas.map((p) => p.cmd)).toEqual(['DELETE', 'INSERT', 'SELECT', 'UPDATE'])

    // `pg_policies.roles` es `name[]`: hay que castearlo para comparar con
    // `array['anon']::text[]`, si no Postgres no encuentra el operador.
    const paraAnon = await filas(
      `select count(*)::int as n from pg_policies
       where schemaname = 'public' and tablename = 'push_suscripciones'
         and roles::text[] && array['anon']::text[]`
    )
    expect(paraAnon[0].n).toBe(0)
  })

  it('todas apuntan a auth.uid(), no a un valor abierto', async () => {
    const politicas = await filas(
      `select cmd, qual, with_check from pg_policies
       where schemaname = 'public' and tablename = 'push_suscripciones'`
    )
    expect(politicas).toHaveLength(4)
    for (const p of politicas) {
      // La condición vive en `qual` (SELECT/UPDATE/DELETE) o en `with_check`
      // (INSERT/UPDATE). Una política INSERT no tiene `qual`, así que se
      // mira la que exista: lo importante es que ninguna quede `true`.
      const condicion = String(p.qual ?? p.with_check ?? '')
      expect(condicion, `${p.cmd} sin auth.uid()`).toContain('auth.uid()')
      expect(condicion).not.toBe('true')
    }
  })
})
