import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { bloqueSql } from './supabaseSql'

/**
 * modulos-fotos.sql, ejecutado en un Postgres de verdad.
 *
 * POR QUÉ EXISTE ESTE TEST
 * ------------------------
 * Es el bucket de las FOTOS REFERENCIALES de los puntos de un CHECKLIST, y
 * las reglas que sólo fallan cuando alguien consulta con el rol equivocado:
 *
 *  1. El bucket nace PÚBLICO (la evaluación pinta la URL directo) y esa
 *     lectura está también en la política `to public`.
 *  2. Escribe SÓLO el Líder (`es_lider()`, la misma cerradura que Config →
 *     Ítems): un EVALUADOR —que sí lee la foto en la evaluación— no puede
 *     subir ni borrar nada, y `anon` ni siquiera inserta.
 *  3. La escritura se limita a ESTE bucket: un Líder no por serlo mete
 *     manos en `evidencias`.
 *
 * Acá se corre el bloque TAL CÓMO se pega al SQL Editor, dos veces (tiene
 * que ser idempotente), sobre un espejo mínimo de storage, profiles y la
 * función `es_lider()`.
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

  -- Supabase: storage, que es donde vive el bucket.
  create schema if not exists storage;
  create table if not exists storage.buckets (id text primary key, name text, public boolean default false);
  create table if not exists storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text,
    name text
  );
  alter table storage.objects enable row level security;

  do $$ begin
    grant usage on schema public to anon, authenticated;
    grant usage on schema storage to anon, authenticated;
    -- Mismo default que Supabase: todo lo que se cree en storage es usable
    -- por los dos roles; las POLÍTICAS son las que filtran qué se ve.
    alter default privileges in schema public grant all on tables to anon, authenticated;
  end $$;
  grant select, insert, update, delete on storage.objects to anon, authenticated;
  grant select on storage.buckets to anon, authenticated;

  -- Espejo mínimo de profiles: el bloque no lo toca, pero es_lider() lo lee.
  create table public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    nombre text not null default '',
    rol text not null default 'SIN_ROL'
      check (rol in ('SIN_ROL','LIDER','EVALUADOR','GERENTE_S','GERENTE_C','GERENTE_TH','JUEZ','GERENTE_TI','TECNICO_TI')),
    activo boolean not null default true
  );

  -- es_lider() vive en el bloque RAÍZ de schema.sql y este bloque la usa en
  -- sus políticas.
  create or replace function public.es_lider()
  returns boolean language sql stable security definer set search_path = public as $$
    select exists (select 1 from public.profiles p where p.id = auth.uid() and p.rol = 'LIDER' and p.activo);
  $$;
`

const LIDER = '00000000-0000-0000-0000-000000000f01'
const EVALUADOR = '00000000-0000-0000-0000-000000000f03'

let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  await db.exec(DDL)
  await db.exec(`insert into auth.users (id) values ('${LIDER}'), ('${EVALUADOR}')`)
  await db.exec(
    `insert into public.profiles (id, nombre, rol) values
       ('${LIDER}', 'Ana Líder', 'LIDER'),
       ('${EVALUADOR}', 'Juan Evaluador', 'EVALUADOR')`
  )
  // Primera corrida… y la segunda: el bloque tiene que ser idempotente.
  await db.exec(bloqueSql('modulos-fotos.sql'))
  await db.exec(bloqueSql('modulos-fotos.sql'))
})

afterAll(async () => {
  await db.close()
})

/** La sesión se hace pasar por este usuario: es lo que `auth.uid()` devuelve. */
async function como(usuario: string | null): Promise<void> {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [usuario ?? ''])
}

/**
 * Baja al rol `authenticated` para que el RLS se aplique de verdad y corre
 * `fn` en esa sesión. Siempre vuelve al rol original.
 */
async function conRol(usuario: string, fn: () => Promise<void>): Promise<void> {
  await como(usuario)
  await db.exec('set role authenticated')
  try {
    await fn()
  } finally {
    await db.exec('reset role')
  }
}

/** Baja al rol `anon`: la evaluación pública de imágenes no escribe. */
async function conAnon(fn: () => Promise<void>): Promise<void> {
  await como(null)
  await db.exec('set role anon')
  try {
    await fn()
  } finally {
    await db.exec('reset role')
  }
}

async function contar(sql: string): Promise<number> {
  const r = await db.query(sql)
  return Number((r.rows[0] as { n: string | number }).n)
}

describe('modulos-fotos.sql · el bucket', () => {
  it('nace PÚBLICO: la evaluación pinta la URL directo', async () => {
    const n = await contar(
      `select case when b."public" then 1 else 0 end as n from storage.buckets b where b.id = 'modulos-fotos'`
    )
    expect(n).toBe(1)
  })

  it('cualquiera (hasta anon) lo lee; nadie sin política lo escribe', async () => {
    await conAnon(async () => {
      const leido = await contar(
        `select count(*)::int as n from storage.objects where bucket_id = 'modulos-fotos'`
      )
      expect(leido).toBe(0)
      // Sin política de insert para anon: el intento muere en RLS.
      await expect(
        db.query(`insert into storage.objects (bucket_id, name) values ('modulos-fotos', 'items/x.webp')`)
      ).rejects.toThrow(/row-level security/i)
    })
  })

  it('sube y borra SÓLO el Líder, y sólo en ESTE bucket', async () => {
    await conRol(LIDER, async () => {
      await expect(
        db.query(`insert into storage.objects (bucket_id, name) values ('modulos-fotos', 'items/a.webp')`)
      ).resolves.toBeDefined()
      // Por ser Líder no mete manos en otros buckets: la política cubre éste.
      await expect(
        db.query(`insert into storage.objects (bucket_id, name) values ('evidencias', 'ev/1/f.jpg')`)
      ).rejects.toThrow(/row-level security/i)
    })
    // El EVALUADOR ve las fotos en su evaluación pero no configura nada.
    await conRol(EVALUADOR, async () => {
      await expect(
        db.query(`insert into storage.objects (bucket_id, name) values ('modulos-fotos', 'items/y.webp')`)
      ).rejects.toThrow(/row-level security/i)
    })
  })
})
