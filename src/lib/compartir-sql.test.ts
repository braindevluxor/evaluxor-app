import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { bloqueSql } from './supabaseSql'

/**
 * La función del enlace público, ejecutada en un Postgres de verdad.
 *
 * POR QUÉ EXISTE ESTE TEST
 * ------------------------
 * Este archivo de SQL falló dos veces en la base real: primero nombrando una
 * columna que la tabla no tiene (`evaluaciones.created_at`), y después
 * olvidando el alias de un CTE (`from ev` no crea el alias `e`). Las dos
 * eran errores que ninguna revisión a ojo ni ningún test de texto detectaban:
 * sólo un motor los encuentra.
 *
 * Acá se corre el archivo TAL CUAL se le pega al SQL Editor, contra un
 * PostgreSQL 18 en memoria (@electric-sql/pglite). Si el archivo no compila,
 * este test falla antes de que llegue a la base de nadie.
 *
 * El esquema de abajo es un espejo mínimo de `schema.sql`, y una de las
 * decisiones es NO ponerle `created_at` a `evaluaciones`: es como está la
 * tabla real del cliente, y justamente por eso el RPC no debe nombrarla.
 */

const DDL = `
  -- Roles de Supabase: sin ellos el revoke del archivo falla.
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  end $$;

  create table public.profiles (id uuid primary key, nombre text);

  create table public.sucursales (
    id uuid primary key, nombre text, shop_id text, branch_id text, direccion text
  );

  create table public.departamentos_centralizados (id uuid primary key, nombre text);

  create table public.modulos (id uuid primary key, nombre text, orden int, activo boolean);

  create table public.items (
    id uuid primary key,
    modulo_id uuid,
    tipo text,
    texto text,
    orden int,
    padre_id uuid,
    contra_dato text
  );

  -- A PROPOSITO SIN created_at: es como esta la tabla real del cliente.
  create table public.evaluaciones (
    id uuid primary key,
    sucursal_id uuid,
    departamento_id uuid,
    aperturada_por uuid,
    fecha date,
    estado text,
    puntuacion numeric,
    comentario_general text,
    cerrada_en timestamptz
  );

  create table public.respuestas (
    evaluacion_id uuid,
    item_id uuid,
    instancia_id uuid,
    valor jsonb,
    respondido_por uuid
  );

  create table public.sucursal_opciones (
    sucursal_id uuid, item_id uuid, opcion_id text, activa boolean
  );

  create table public.departamento_opciones (
    departamento_id uuid, item_id uuid, opcion_id text, activa boolean
  );

  create function public.es_lider() returns boolean
  language sql stable as $$ select true $$;

  create function public.puede_ver_evaluacion(e public.evaluaciones) returns boolean
  language sql stable as $$ select true $$;
`

const EV = '11111111-1111-1111-1111-111111111111'
const TOKEN = 'a'.repeat(64)
const SUCURSAL = '22222222-2222-2222-2222-222222222222'
const MODULO = '33333333-3333-3333-3333-333333333333'
const SECCION = '44444444-4444-4444-4444-444444444444'
const CONCILIACION = '55555555-5555-5555-5555-555555555555'

const DATOS = `
  insert into public.sucursales values ('${SUCURSAL}', 'Sucursal Norte', null, null, null);
  insert into public.modulos values ('${MODULO}', 'Inventario', 1, true);
  insert into public.items values ('${SECCION}', '${MODULO}', 'CONTENEDOR', 'Pasillo limpieza', 1, null, null);
  insert into public.items values ('${CONCILIACION}', '${MODULO}', 'CONCILIACION', 'Conciliacion por SKU', 2, '${SECCION}', 'SOH');
  insert into public.evaluaciones
    values ('${EV}', '${SUCURSAL}', null, null, '2026-10-12', 'ACTIVA', 80, null, null);
  insert into public.respuestas
    values ('${EV}', '${CONCILIACION}', null,
            '{"productos":[{"sku":"7591002000011","nombre":"Aceite 1L","teorica":10,"fisica":10,"departamento":"LIMPIEZA"}]}'::jsonb,
            null);
  insert into public.evaluaciones_compartidas values ('${EV}', '${TOKEN}', true, null);
`

let db: PGlite

/** Llama al RPC y devuelve el objeto jsonb que sale. */
async function llamar(token: string): Promise<Record<string, unknown>> {
  const { rows } = await db.query<{ r: Record<string, unknown> }>(
    'select public.ver_conciliacion_compartida($1) as r',
    [token]
  )
  return rows[0].r
}

beforeAll(async () => {
  db = await PGlite.create()
  await db.exec(DDL)
  // El archivo completo, con sus begin/commit y sus tres consultas de
  // verificación del final: si alguna falla, esto explota acá.
  const sql = bloqueSql('compartir-evaluacion.sql')
  await db.exec(sql)
  await db.exec(DATOS)
}, 120_000)

afterAll(async () => {
  await db?.close()
})

describe('ver_conciliacion_compartida · contra un Postgres real', () => {
  it('crea la tabla cerrada: anon sin permiso, RLS encendido', async () => {
    const { rows } = await db.query<{ anon_select: boolean; rls: boolean; politicas: number }>(`
      select
        has_table_privilege('anon', c.oid, 'select') as anon_select,
        c.relrowsecurity as rls,
        (select count(*)::int from pg_policies pp
          where pp.schemaname = 'public' and pp.tablename = c.relname) as politicas
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'evaluaciones_compartidas'
    `)
    expect(rows[0].anon_select).toBe(false)
    expect(rows[0].rls).toBe(true)
    expect(rows[0].politicas).toBe(2)
  })

  it('con el token correcto devuelve la conciliación', async () => {
    const r = await llamar(TOKEN)
    const ev = r.evaluacion as Record<string, unknown>
    expect(ev.id).toBe(EV)
    expect(ev.estado).toBe('ACTIVA')
    expect(ev.fecha).toBe('2026-10-12')
    expect((ev.sucursal as Record<string, unknown>).nombre).toBe('Sucursal Norte')
    // Sin departamento: la evaluación es de sucursal y la otra mitad queda vacía.
    expect(ev.departamento).toBeNull()

    // Los ítems de conciliación y SU contenedor: sin el padre no se sabe en qué
    // módulo está cada uno.
    const items = r.items as { id: string; tipo: string }[]
    expect(items.map((i) => i.id).sort()).toEqual([CONCILIACION, SECCION].sort())

    const respuestas = r.respuestas as { item_id: string }[]
    expect(respuestas).toHaveLength(1)
    expect(respuestas[0].item_id).toBe(CONCILIACION)

    expect((r.modulos as unknown[]).length).toBe(1)
  })

  it('no expone al evaluador ni el resto de la evaluación', async () => {
    const r = await llamar(TOKEN)
    const ev = r.evaluacion as Record<string, unknown>
    // La promesa del enlace: no se ve quién evaluó.
    expect(ev.aperturada_por).toBeUndefined()
    // Ni el id del dispositivo, ni nada que no pinte la pantalla.
    expect(ev.offline_uuid).toBeUndefined()
    expect(ev.abierta_en).toBeUndefined()
    // Y sólo salen estos ocho campos: si mañana se agrega una columna a
    // `evaluaciones` no se filtra sola por `select *`. (`sort()` de JS compara
    // por código UTF-16, así que el orden esperado se ordena también en el
    // test en vez de escribirlo a mano.)
    expect(Object.keys(ev).filter((k) => k !== 'sucursal' && k !== 'departamento').sort()).toEqual(
      [
        'id',
        'sucursal_id',
        'departamento_id',
        'fecha',
        'estado',
        'puntuacion',
        'comentario_general',
        'cerrada_en'
      ].sort()
    )
  })

  it('un token inventado devuelve todo vacío, igual que uno apagado', async () => {
    const malo = await llamar('b'.repeat(64))
    expect(malo.evaluacion).toBeNull()
    expect(malo.respuestas).toEqual([])
    expect(malo.items).toEqual([])

    // Apagar el enlace deja de servir sin tocar la evaluación.
    await db.exec('update public.evaluaciones_compartidas set activo = false')
    const apagado = await llamar(TOKEN)
    expect(apagado.evaluacion).toBeNull()
    expect(apagado.respuestas).toEqual([])

    await db.exec('update public.evaluaciones_compartidas set activo = true')
  })

  it('sin conciliación cargada devuelve la evaluación y la lista vacía', async () => {
    const vacia = '99999999-9999-9999-9999-999999999999'
    const token = 'c'.repeat(64)
    await db.exec(`
      insert into public.evaluaciones
        values ('${vacia}', '${SUCURSAL}', null, null, '2026-10-13', 'ACTIVA', null, null, null);
      insert into public.evaluaciones_compartidas values ('${vacia}', '${token}', true, null);
    `)
    const r = await llamar(token)
    expect((r.evaluacion as Record<string, unknown>).id).toBe(vacia)
    // Ítems vacíos y no un error: la pantalla puede mostrar "todavía no tiene
    // conciliación cargada" mientras el evaluador arranca.
    expect(r.items).toEqual([])
    expect(r.respuestas).toEqual([])
    expect((r.evaluacion as Record<string, unknown>).puntuacion).toBeNull()
  })
})
