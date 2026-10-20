import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { bloqueSql } from './supabaseSql'

/**
 * Los parámetros operativos de la sucursal, ejecutados en un Postgres de verdad.
 *
 * POR QUÉ EXISTE ESTE TEST
 * ------------------------
 * El bloque toca tres cosas distintas que se pueden romper sin que se note:
 * agrega cinco columnas a una tabla que ya existe (si una se llama distinto,
 * el `add column if not exists` no avisa: crea una sexta), crea dos tablas con
 * `check` que sólo fallan cuando alguien escribe un dato inválido, y monta
 * políticas RLS que sólo se pueden leer desde `pg_policies`.
 *
 * Acá se corre el bloque TAL CUAL se pega al SQL Editor, contra un PostgreSQL en
 * memoria (@electric-sql/pglite), partiendo del estado en que está la base del
 * cliente: `sucursales` como en `schema.sql` (sin los contadores) y con
 * `es_lider()`. Si el bloque no compila, este test falla antes de que llegue a
 * la base de nadie.
 */

const DDL = `
  -- Roles de Supabase: sin ellos el "to authenticated" de las políticas falla.
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  end $$;

  -- Supabase: esquema auth con su uid() (session en Supabase, settings acá).
  create schema if not exists auth;
  create table if not exists auth.users (id uuid primary key);
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;

  -- Como Supabase: todo autenticado nace con permiso de tabla; el trabajo de
  -- cerrarle la puerta a anon lo hace el revoke del propio bloque.
  do $$ begin
    grant usage on schema public to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
  end $$;

  -- Espejo mínimo de lo que el bloque toca, copiado de schema.sql. A propósito
  -- SIN los contadores: ése es justamente lo que el bloque agrega.
  create table public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    nombre text,
    rol text not null default 'EVALUADOR',
    activo boolean not null default true
  );

  create table public.sucursales (
    id uuid primary key default gen_random_uuid(),
    nombre text not null,
    shop_id text,
    direccion text,
    gerente_id uuid references public.profiles(id) on delete set null,
    activa boolean not null default true,
    created_at timestamptz not null default now()
  );

  create or replace function public.es_lider()
  returns boolean language sql stable security definer set search_path = public as $$
    select exists (select 1 from public.profiles p where p.id = auth.uid() and p.rol = 'LIDER' and p.activo);
  $$;
`

const SUCURSAL = '00000000-0000-0000-0000-000000000001'

let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  await db.exec(DDL)
  await db.exec(bloqueSql('parametros-sucursal.sql'))
  // Segunda corrida: tiene que seguir limpio, el bloque es idempotente.
  await db.exec(bloqueSql('parametros-sucursal.sql'))
  await db.exec(`insert into public.sucursales (id, nombre) values ('${SUCURSAL}', 'Eva Luxor Centro')`)
})

afterAll(async () => {
  await db.close()
})

async function filas(sql: string): Promise<Record<string, unknown>[]> {
  const r = await db.query(sql)
  return r.rows as Record<string, unknown>[]
}

describe('parametros-sucursal.sql · corre limpio', () => {
  it('los cinco contadores quedaron en sucursales, enteros y sin nulos', async () => {
    const columnas = await filas(`
      select column_name, data_type, is_nullable, column_default
      from information_schema.columns
      where table_schema = 'public' and table_name = 'sucursales'
        and column_name in ('equipos_pos','verificadores_precio','pantallas_publicitarias','cabezales','pda')
      order by column_name
    `)

    expect(columnas).toHaveLength(5)
    for (const c of columnas) {
      expect(c.data_type).toBe('integer')
      expect(c.is_nullable).toBe('NO')
      expect(String(c.column_default)).toContain('0')
    }
  })

  it('una sucursal sin cargar nace con todo en cero', async () => {
    const [fila] = await filas(`
      select equipos_pos, verificadores_precio, pantallas_publicitarias, cabezales, pda
      from public.sucursales where id = '${SUCURSAL}'
    `)
    expect(fila).toEqual({ equipos_pos: 0, verificadores_precio: 0, pantallas_publicitarias: 0, cabezales: 0, pda: 0 })
  })

  it('la base rechaza un contador negativo, no sólo la pantalla', async () => {
    await expect(db.exec(`update public.sucursales set equipos_pos = -1 where id = '${SUCURSAL}'`)).rejects.toThrow(/sucursales_contadores_no_negativos/)
    // Y el rechazo no deja la fila a medias.
    const [fila] = await filas(`select equipos_pos from public.sucursales where id = '${SUCURSAL}'`)
    expect(fila).toEqual({ equipos_pos: 0 })
  })

  it('el computador es administrativo u operativo y no acepta cantidad negativa', async () => {
    await db.exec(`
      insert into public.sucursal_computadores (sucursal_id, nombre, tipo, cantidad)
      values ('${SUCURSAL}', 'RRHH', 'ADMINISTRATIVO', 2)
    `)
    const [fila] = await filas(`select nombre, tipo, cantidad from public.sucursal_computadores`)
    expect(fila).toEqual({ nombre: 'RRHH', tipo: 'ADMINISTRATIVO', cantidad: 2 })

    await expect(db.exec(`insert into public.sucursal_computadores (sucursal_id, nombre, tipo) values ('${SUCURSAL}', 'X', 'JARDINERO')`)).rejects.toThrow()
    await expect(db.exec(`insert into public.sucursal_computadores (sucursal_id, nombre, cantidad) values ('${SUCURSAL}', 'Y', -1)`)).rejects.toThrow()

    // El tipo por defecto es operativo, que es lo más común en tienda.
    await db.exec(`insert into public.sucursal_computadores (sucursal_id, nombre) values ('${SUCURSAL}', 'Recibidor')`)
    const [porDefecto] = await filas(`select tipo, cantidad from public.sucursal_computadores where nombre = 'Recibidor'`)
    expect(porDefecto).toEqual({ tipo: 'OPERATIVO', cantidad: 1 })
  })

  it('el permiso guarda número, vigencia y las dos fechas', async () => {
    await db.exec(`
      insert into public.sucursal_permisos (sucursal_id, nombre, numero, emision, vence, observacion)
      values ('${SUCURSAL}', 'Bomberos', 'RES-77', '2026-01-01', '2027-01-01', 'Renovar en oficina')
    `)
    const [fila] = await filas(`
      select nombre, numero, vigente, emision::text as emision, vence::text as vence, observacion
      from public.sucursal_permisos
    `)
    expect(fila).toEqual({
      nombre: 'Bomberos',
      numero: 'RES-77',
      vigente: true,
      emision: '2026-01-01',
      vence: '2027-01-01',
      observacion: 'Renovar en oficina'
    })

    // `vigente` nace marcado y el número es opcional: no todo permiso trae uno.
    await db.exec(`insert into public.sucursal_permisos (sucursal_id, nombre) values ('${SUCURSAL}', 'Sanitario')`)
    const [porDefecto] = await filas(`select vigente, numero from public.sucursal_permisos where nombre = 'Sanitario'`)
    expect(porDefecto).toEqual({ vigente: true, numero: null })
  })

  it('al borrar la sucursal se llevan sus equipos y sus permisos', async () => {
    const antes = (await filas(`select count(*) as n from public.sucursal_computadores`))[0].n
    expect(Number(antes)).toBeGreaterThan(0)

    await db.exec(`delete from public.sucursales where id = '${SUCURSAL}'`)

    expect(await filas(`select * from public.sucursal_computadores`)).toHaveLength(0)
    expect(await filas(`select * from public.sucursal_permisos`)).toHaveLength(0)
  })
})

describe('parametros-sucursal.sql · permisos', () => {
  it('las dos tablas quedaron con RLS encendido y las mismas dos políticas que el resto de la configuración por sucursal', async () => {
    const rls = await filas(`
      select relname, relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and relname in ('sucursal_computadores','sucursal_permisos')
      order by relname
    `)
    expect(rls).toEqual([
      { relname: 'sucursal_computadores', relrowsecurity: true },
      { relname: 'sucursal_permisos', relrowsecurity: true }
    ])

    const politicas = await filas(`
      select tablename, policyname, cmd, coalesce(array_to_string(roles, ','), '') as roles,
             coalesce(qual, '') as condicion
      from pg_policies
      where schemaname = 'public' and tablename in ('sucursal_computadores','sucursal_permisos')
      order by tablename, policyname
    `)
    // OJO con `roles`: las dos `..._lider` no llevan cláusula `to`, así que
    // Postgres las registra como PUBLIC —igual que las `sucursal_modulos_lider`
    // y `sucursal_items_lider` que ya estaban. No es un hueco: lo que filtra es
    // el `using (public.es_lider())`, que mira el rol real de la sesión.
    expect(politicas.map((p) => `${p.tablename}.${p.policyname} ${String(p.cmd).toLowerCase()} ${p.roles}`)).toEqual([
      'sucursal_computadores.sucursal_computadores_lider all public',
      'sucursal_computadores.sucursal_computadores_select select authenticated',
      'sucursal_permisos.sucursal_permisos_lider all public',
      'sucursal_permisos.sucursal_permisos_select select authenticated'
    ])
    for (const p of politicas) {
      if (String(p.policyname).endsWith('_lider')) expect(String(p.condicion)).toContain('es_lider()')
    }
  })

  it('anon no lee ninguna de las dos; con sesión sí se puede leer', async () => {
    const permisos = await filas(`
      select c.relname,
             has_table_privilege('anon', c.oid, 'select') as anon_lee,
             has_table_privilege('authenticated', c.oid, 'select') as sesion_lee
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname in ('sucursal_computadores','sucursal_permisos')
      order by c.relname
    `)
    expect(permisos).toEqual([
      { relname: 'sucursal_computadores', anon_lee: false, sesion_lee: true },
      { relname: 'sucursal_permisos', anon_lee: false, sesion_lee: true }
    ])
  })
})
