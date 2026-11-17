import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { bloqueSql } from './supabaseSql'

/**
 * gran-cosecha-pagina.sql, ejecutado en un Postgres de verdad.
 *
 * POR QUÉ EXISTE ESTE TEST
 * ------------------------
 * El bloque carga reglas que sólo fallan cuando alguien consulta con el rol
 * equivocado o guarda un JSON con la forma equivocada:
 *
 *  1. La FILA ÚNICA y el `check` de forma de cada sección: una segunda fila
 *     o un `premios` que no son array no pueden pasar.
 *  2. RLS: sólo el LÍDER escribe (`es_lider()`, la misma cerradura del menú
 *     y del guard), cualquiera con sesión lee, y anon no llega ni a la tabla.
 *  3. La función pública: anon la ejecuta, `PUBLIC` no (queda revocada), y
 *     devuelve el contenido entero sin abrirle la tabla.
 *  4. El bucket de fotos: público para VER, y sólo el Líder para SUBIR.
 *
 * Acá se corre el bloque TAL CÓMO está en `supabase/schema.sql`, dos veces
 * para probar que es idempotente (el SQL Editor lo aplica entero).
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

  -- Supabase: storage, que es donde viven las políticas de las fotos.
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
      check (rol in ('SIN_ROL','LIDER','EVALUADOR','GERENTE_S','GERENTE_C','GERENTE_TH','JUEZ')),
    activo boolean not null default true
  );

  -- es_lider() vive en el bloque RAÍZ de schema.sql y el bloque la usa en
  -- sus políticas: sin ella, "create policy" no analiza la expresión y falla.
  create or replace function public.es_lider()
  returns boolean language sql stable security definer set search_path = public as $$
    select exists (select 1 from public.profiles p where p.id = auth.uid() and p.rol = 'LIDER' and p.activo);
  $$;
`

const LIDER = '00000000-0000-0000-0000-000000000002'
const EVALUADOR = '00000000-0000-0000-0000-000000000003'

const CONTENIDO = {
  hero: {
    lema: 'LEMA NUEVO',
    bajada: 'BAJADA NUEVA',
    fechaDesde: '1',
    fechaDesdeMes: 'OCT',
    fechaHasta: '5',
    fechaHastaMes: 'OCT',
    fondo: ''
  },
  premios: [{ puesto: '1° PUESTO', descripcion: 'Trofeo' }],
  equipos: [{ nombre: 'Equipo Frescura', sucursal: 'Luxor Central' }],
  imagenes: { round1: '', round2: '', round3: '' }
}

const INSERT_CONTENIDO = `
  insert into public.gran_cosecha_pagina (id, hero, premios, equipos, imagenes)
  values (true, $1, $2, $3, $4)
`

let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  await db.exec(DDL)
  await db.exec(`insert into auth.users (id) values ('${LIDER}'), ('${EVALUADOR}')`)
  await db.exec(
    `insert into public.profiles (id, nombre, rol) values
       ('${LIDER}', 'Ana Líder', 'LIDER'),
       ('${EVALUADOR}', 'Juan Trabajador', 'EVALUADOR')`
  )
  // Primera corrida… y la segunda: el bloque tiene que ser idempotente.
  await db.exec(bloqueSql('gran-cosecha-pagina.sql'))
  await db.exec(bloqueSql('gran-cosecha-pagina.sql'))

  // Un objeto en cada bucket, subido como DUEÑO (bypasea RLS): es el estado
  // que después tienen que filtrar las políticas para los demás roles.
  await db.exec(
    `insert into storage.objects (bucket_id, name) values
       ('gran-cosecha', 'pagina/round1.jpg'),
       ('evidencias', 'ev/abc/foto.jpg')`
  )

  // El Líder publica el primer contenido —con sesión y RLS de verdad, que es
  // como lo hace la consola—: el resto de los tests se apoya en esta fila.
  await guardarComoRol(LIDER)
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
 * `fn` en esa sesión. La conexión de pglite es `postgres`, que es el DUEÑO de
 * las tablas y bypasea RLS: sin este cambio un test de políticas leería todo
 * aunque la política estuviera mal. Siempre vuelve al rol original, también
 * cuando la prueba falla.
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

/** Baja al rol `anon`: la página pública lee sin sesión. */
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

async function guardarComoRol(usuario: string): Promise<void> {
  await conRol(usuario, async () => {
    await db.query(INSERT_CONTENIDO, [
      CONTENIDO.hero,
      CONTENIDO.premios,
      CONTENIDO.equipos,
      CONTENIDO.imagenes
    ])
  })
}

describe('gran-cosecha-pagina.sql · la tabla', () => {
  it('nace con una sola fila', async () => {
    // La fila ya la creó el Líder en el arranque; el segundo guardado no
    // puede crear otra —es la misma única fila—.
    await expect(guardarComoRol(LIDER)).rejects.toThrow(/duplicate|unique/i)

    // Y una fila con id=false la rechaza el check de fila única.
    await expect(db.query(`insert into public.gran_cosecha_pagina (id) values (false)`)).rejects.toThrow(
      /check/i
    )
  })

  it('cada sección nace con su forma', async () => {
    // Un objeto donde va el array de premios.
    await expect(
      db.query(
        `insert into public.gran_cosecha_pagina (id, hero, premios, equipos, imagenes)
         values (true, '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, '{}'::jsonb)`
      )
    ).rejects.toThrow(/check/i)

    // Un array donde va el objeto del hero.
    await expect(
      db.query(
        `insert into public.gran_cosecha_pagina (id, hero, premios, equipos, imagenes)
         values (true, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb)`
      )
    ).rejects.toThrow(/check/i)
  })

  it('lee con sesión y no sin ella', async () => {
    const anon = await contar(
      `select case when has_table_privilege('anon', 'public.gran_cosecha_pagina', 'select') then 1 else 0 end as n`
    )
    expect(anon).toBe(0)

    // Sin privilegio ni siquiera llega a evaluar políticas.
    await conAnon(async () => {
      await expect(db.query(`select id from public.gran_cosecha_pagina`)).rejects.toThrow(
        /permission denied/i
      )
    })

    // Con sesión se lee: el form de la consola tiene que mostrar lo guardado.
    await conRol(EVALUADOR, async () => {
      const n = await contar(`select count(*)::int as n from public.gran_cosecha_pagina`)
      expect(n).toBe(1)
    })
  })
})

describe('gran-cosecha-pagina.sql · RLS', () => {
  it('sólo el Líder escribe', async () => {
    await conRol(EVALUADOR, async () => {
      // El UPDATE devuelve 0 filas: el `using` filtra la única fila.
      const r = await db.query(
        `update public.gran_cosecha_pagina set hero = '{"lema":"TROPELO"}'::jsonb where id`
      )
      expect(Number((r as { affectedRows?: number }).affectedRows ?? -1)).toBe(0)

      // El INSERT se RECHAZA (with check), no devuelve 0 filas.
      await expect(
        db.query(INSERT_CONTENIDO, [
          CONTENIDO.hero,
          CONTENIDO.premios,
          CONTENIDO.equipos,
          CONTENIDO.imagenes
        ])
      ).rejects.toThrow(/row-level security/i)
    })

    // El contenido sigue siendo el del Líder.
    const hero = await db.query<{ hero: { lema: string } }>(
      `select hero from public.gran_cosecha_pagina where id`
    )
    expect(hero.rows[0].hero.lema).toBe('LEMA NUEVO')
  })

  it('la lectura es `to authenticated` y el resto es del Líder', async () => {
    const filas = await db.query<{ policyname: string; cmd: string; roles: string[] }>(
      `select policyname, cmd, roles from pg_policies
        where schemaname = 'public' and tablename = 'gran_cosecha_pagina' order by policyname`
    )
    const comandos = filas.rows.map((f) => `${f.policyname}:${f.cmd.toLowerCase()}`)
    expect(comandos).toEqual(['gran_cosecha_pagina_lider:all', 'gran_cosecha_pagina_select:select'])
    const lectura = filas.rows.find((f) => f.cmd.toLowerCase() === 'select')
    expect(lectura?.roles).toEqual(['authenticated'])
  })
})

describe('gran-cosecha-pagina.sql · la función pública', () => {
  it('anon la ejecuta, PUBLIC no (queda revocada)', async () => {
    const anon = await contar(
      `select case when has_function_privilege('anon', 'public.ver_contenido_gran_cosecha()', 'execute') then 1 else 0 end as n`
    )
    expect(anon).toBe(1)
    const publico = await contar(
      `select case when has_function_privilege('public', 'public.ver_contenido_gran_cosecha()', 'execute') then 1 else 0 end as n`
    )
    expect(publico).toBe(0)
  })

  it('devuelve el contenido entero sin abrirle la tabla a nadie', async () => {
    await conAnon(async () => {
      const r = await db.query<{ r: Record<string, unknown> | null }>(
        `select public.ver_contenido_gran_cosecha() as r`
      )
      const contenido = r.rows[0].r
      expect(contenido).not.toBeNull()
      expect(Object.keys(contenido ?? {}).sort()).toEqual(['equipos', 'hero', 'imagenes', 'premios'])
      expect((contenido?.hero as { lema: string }).lema).toBe('LEMA NUEVO')

      // La función no es una puerta atrás a la tabla.
      await expect(db.query(`select id from public.gran_cosecha_pagina`)).rejects.toThrow(
        /permission denied/i
      )
    })
  })

  it('es security definer con search_path fijo', async () => {
    const n = await contar(
      `select case when exists (
         select 1 from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'ver_contenido_gran_cosecha'
           and p.prosecdef
           and p.proconfig::text like '%search_path%'
       ) then 1 else 0 end as n`
    )
    expect(n).toBe(1)
  })
})

describe('gran-cosecha-pagina.sql · las fotos', () => {
  it('el bucket nace público: es lo que significa poder verlo sin sesión', async () => {
    const n = await contar(
      `select case when b."public" then 1 else 0 end as n from storage.buckets b where b.id = 'gran-cosecha'`
    )
    expect(n).toBe(1)
  })

  it('cualquiera ve las fotos de la página y nadie las de evidencias', async () => {
    await conAnon(async () => {
      const propias = await contar(
        `select count(*)::int as n from storage.objects where bucket_id = 'gran-cosecha'`
      )
      expect(propias).toBe(1)
      const ajenas = await contar(
        `select count(*)::int as n from storage.objects where bucket_id = 'evidencias'`
      )
      expect(ajenas).toBe(0)
    })
  })

  it('sube al bucket de la página sólo el Líder', async () => {
    await conRol(LIDER, async () => {
      await db.query(
        `insert into storage.objects (bucket_id, name) values ('gran-cosecha', 'pagina/fondo.jpg')`
      )
    })
    await conRol(EVALUADOR, async () => {
      await expect(
        db.query(`insert into storage.objects (bucket_id, name) values ('gran-cosecha', 'pagina/hack.jpg')`)
      ).rejects.toThrow(/row-level security/i)
    })
  })
})
