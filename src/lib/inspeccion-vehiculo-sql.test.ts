import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { bloqueSql } from './supabaseSql'

/**
 * La semilla de la Inspección de Vehículo, ejecutada en un Postgres de verdad.
 *
 * POR QUÉ EXISTE ESTE TEST
 * ------------------------
 * El archivo se corrió contra la base real y murió en la primera línea:
 * `column "herramienta" does not exist`, porque esa columna (y la tabla
 * `revision_pre_entrega`) sólo las crea `revision-pre-entrega.sql`, que en esa
 * instalación nunca se aplicó. Es el mismo tipo de error que ninguna revisión a
 * ojo ni ningún test de texto detecta: sólo un motor lo encuentra.
 *
 * Acá se corre el archivo TAL CUAL se pega al SQL Editor, contra un PostgreSQL
 * en memoria (@electric-sql/pglite), partiendo del estado en que está la base
 * del cliente: `modulos` y `items` como en `schema.sql` y SIN el andamiaje de
 * la pre-entrega. Si el archivo no compila, este test falla antes de que
 * llegue a la base de nadie.
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

  -- Supabase: storage, que es donde viven las políticas de las fotos.
  create schema if not exists storage;
  create table if not exists storage.buckets (id text primary key, name text, public boolean default false);
  create table if not exists storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text,
    name text
  );

  -- Espejo mínimo de los objetos que la semilla toca, copiado de schema.sql.
  create table public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    nombre text,
    activo boolean not null default true,
    rol text not null default 'EVALUADOR'
  );

  create table public.sucursales (
    id uuid primary key, nombre text, shop_id text, branch_id text, direccion text
  );

  -- A PROPOSITO SIN la columna herramienta: es como esta la tabla real del
  -- cliente, y justamente por eso la semilla debe crearla ella misma.
  create table public.modulos (
    id uuid primary key default gen_random_uuid(),
    nombre text not null,
    descripcion text not null default '',
    icono text not null default 'clipboard-list',
    orden integer not null default 0,
    activo boolean not null default true,
    compartido boolean not null default false,
    created_at timestamptz not null default now()
  );

  create table public.items (
    id uuid primary key default gen_random_uuid(),
    modulo_id uuid not null references public.modulos(id) on delete cascade,
    tipo text not null check (tipo in (
      'CHECKLIST','CUMPLE_NO_CUMPLE','CONCILIACION','LISTA_COLABORADORES','UNIDAD_CHECKLIST','PLANO_XY','CONTENEDOR'
    )),
    texto text not null,
    opciones jsonb not null default '[]'::jsonb,
    responsables jsonb not null default '[]'::jsonb,
    orden integer not null default 0,
    requerido boolean not null default false,
    activo boolean not null default true,
    puntaje numeric not null default 0 check (puntaje >= 0 and puntaje <= 100),
    padre_id uuid references public.items(id) on delete cascade,
    created_at timestamptz not null default now()
  );
  create index if not exists idx_items_modulo on public.items(modulo_id, orden);
  alter table public.items add column if not exists api_campos jsonb not null default '[]'::jsonb;
  alter table public.items add column if not exists contra_dato text not null default 'SOH';

  create or replace function public.es_lider() returns boolean
  language sql stable as $$
    select exists (select 1 from public.profiles p where p.id = auth.uid() and p.rol = 'LIDER' and p.activo);
  $$;

  -- La regla de negocio real: secciones + ítems sueltos suman hasta 100.
  create or replace function public.validar_suma_puntaje_items() returns trigger
  language plpgsql set search_path = public as $$
  declare
    v_modulo uuid;
    v_suma_modulo numeric;
  begin
    if tg_op = 'DELETE' then
      v_modulo := old.modulo_id;
      v_suma_modulo := coalesce((
        select sum(puntaje) from public.items
         where modulo_id = v_modulo and id <> old.id
           and (tipo = 'CONTENEDOR' or padre_id is null)
      ), 0);
      if v_suma_modulo > 100 then raise exception 'suma > 100'; end if;
      return old;
    end if;
    v_modulo := new.modulo_id;
    v_suma_modulo := coalesce((
      select sum(puntaje) from public.items
       where modulo_id = v_modulo and (new.id is null or id <> new.id)
         and (tipo = 'CONTENEDOR' or padre_id is null)
    ), 0)
    + case
        when new.tipo = 'CONTENEDOR' then coalesce(new.puntaje, 0)
        when new.padre_id is null then coalesce(new.puntaje, 0)
        else 0
      end;
    if v_suma_modulo > 100 then raise exception 'suma > 100'; end if;
    return new;
  end;
  $$;
  create trigger trg_puntaje_items
    before insert or update or delete on public.items
    for each row execute function public.validar_suma_puntaje_items();
`

const SQL_INSP = bloqueSql('inspeccion-vehiculo.sql')
const SQL_PRE = bloqueSql('revision-pre-entrega.sql')

let db: PGlite

async function numero(k: string, sql: string): Promise<number> {
  const { rows } = await db.query<{ v: number }>(sql)
  expect(rows[0], `falta el resultado de ${k}`).toBeDefined()
  return rows[0].v
}

const ITEMS_MODULO = `
  select count(*)::int as v
    from public.items i
    join public.modulos m on m.id = i.modulo_id
   where m.herramienta = 'INSPECCION_VEHICULO'
`

beforeAll(async () => {
  db = await PGlite.create()
  await db.exec(DDL)
}, 120_000)

afterAll(async () => {
  await db?.close()
})

describe('inspeccion-vehiculo.sql · contra un Postgres real', () => {
  it('se aplica entera en una base que no tiene el andamiaje de la pre-entrega', async () => {
    // Si algo falla acá, falla también en el SQL Editor: es el mismo archivo.
    await db.exec(SQL_INSP)

    const { rows: mod } = await db.query<{ herramienta: string | null }>(
      `select herramienta from public.modulos where nombre = 'Inspección de vehículo'`
    )
    expect(mod).toHaveLength(1)
    expect(mod[0].herramienta).toBe('INSPECCION_VEHICULO')

    // Lo que faltaba en la base real y trae el archivo: la columna y la tabla.
    const { rows: col } = await db.query<{ existe: boolean }>(`
      select exists (
        select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'modulos' and column_name = 'herramienta'
      ) as existe
    `)
    expect(col[0].existe).toBe(true)
    expect(await numero('tabla', `select count(*)::int as v from pg_class where relname = 'revision_pre_entrega'`)).toBe(1)
  })

  it('deja el catálogo completo: 3 secciones, 12 preguntas colgadas y 1 dictamen', async () => {
    expect(await numero('secciones', `${ITEMS_MODULO} and i.tipo = 'CONTENEDOR'`)).toBe(3)
    expect(await numero('preguntas', `${ITEMS_MODULO} and i.tipo = 'CHECKLIST'`)).toBe(12)
    expect(await numero('colgadas', `${ITEMS_MODULO} and i.padre_id is not null`)).toBe(12)
    expect(await numero('dictamen', `${ITEMS_MODULO} and i.tipo = 'CUMPLE_NO_CUMPLE'`)).toBe(1)
    // Ninguna pregunta suelta fuera de su sección (sin contar las propias
    // secciones y el dictamen, que van sin padre a propósito).
    expect(
      await numero('sueltas', `${ITEMS_MODULO} and i.padre_id is null and i.tipo not in ('CUMPLE_NO_CUMPLE', 'CONTENEDOR')`)
    ).toBe(0)
  })

  it('protege la tabla y las fotos con las políticas de la pre-entrega', async () => {
    const { rows } = await db.query<{ rls: boolean; politicas: number }>(`
      select c.relrowsecurity as rls,
             (select count(*)::int from pg_policies pp
               where pp.schemaname = 'public' and pp.tablename = 'revision_pre_entrega') as politicas
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where c.relname = 'revision_pre_entrega' and n.nspname = 'public'
    `)
    expect(rows).toHaveLength(1)
    expect(rows[0].rls).toBe(true)
    expect(rows[0].politicas).toBe(4)

    expect(
      await numero('storage', `select count(*)::int as v from pg_policies where policyname like 'storage_pre_entrega%'`)
    ).toBe(4)
  })

  it('correrla otra vez no duplica ni pisa lo que se haya editado', async () => {
    const antes = await numero('items antes', ITEMS_MODULO)
    await db.exec(SQL_INSP)
    expect(await numero('módulos', `select count(*)::int as v from public.modulos where herramienta = 'INSPECCION_VEHICULO'`)).toBe(1)
    expect(await numero('items después', ITEMS_MODULO)).toBe(antes)
  })

  it('corre también después de la semilla de la pre-entrega, en base aparte', async () => {
    // La promesa del archivo es «cualquier orden»: se comprueba en otra base
    // para no ensuciar la secuencia de arriba.
    const otra = await PGlite.create()
    try {
      await otra.exec(DDL)
      await otra.exec(SQL_PRE)
      await otra.exec(SQL_INSP)
      const { rows } = await otra.query<{ herramientas: number }>(`
        select count(*)::int as herramientas from public.modulos where herramienta is not null
      `)
      expect(rows[0].herramientas).toBe(2)
    } finally {
      await otra.close()
    }
  }, 120_000)
})
