import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { bloqueSql } from './supabaseSql'

/**
 * menu-sucursal.sql, ejecutado en un Postgres de verdad.
 *
 * POR QUÉ EXISTE ESTE TEST
 * ------------------------
 * El bloque carga reglas que sólo fallan cuando alguien consulta con el rol
 * equivocado o intenta tocar la sucursal de otro:
 *
 *  1. RLS: el encargado (Gerente de Sucursal) escribe SÓLO en la suya; el
 *     Líder en cualquier una; los demás no escriben ni ven filas ajenas.
 *  2. La función pública: `anon` la ejecuta, `PUBLIC` no (queda revocada),
 *     devuelve una sucursal con sus productos y NO abre la tabla.
 *  3. El bucket de fotos: público para VER, y sólo sube el encargado —
 *     además acotado a la carpeta de SU sucursal por la propia ruta.
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
    alter default privileges in schema public grant all on tables to anon, authenticated;
  end $$;
  grant select, insert, update, delete on storage.objects to anon, authenticated;
  grant select on storage.buckets to anon, authenticated;

  -- Espejo mínimo de profiles: el bloque no lo toca, pero es_encargado_menu()
  -- lo lee. Trae sucursal_id porque esa ES la relación "mi sucursal".
  create table public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    nombre text not null default '',
    rol text not null default 'SIN_ROL'
      check (rol in ('SIN_ROL','LIDER','EVALUADOR','GERENTE_S','GERENTE_C','GERENTE_TH','JUEZ')),
    sucursal_id uuid,
    activo boolean not null default true
  );

  -- Espejo de sucursales: la tabla nueva tiene la FK y la RPC lee nombre/activa.
  create table public.sucursales (
    id uuid primary key,
    nombre text not null,
    activa boolean not null default true
  );

  -- es_lider() vive en el bloque RAÍZ de schema.sql y el bloque la usa.
  create or replace function public.es_lider()
  returns boolean language sql stable security definer set search_path = public as $$
    select exists (select 1 from public.profiles p where p.id = auth.uid() and p.rol = 'LIDER' and p.activo);
  $$;
`

const LIDER = '00000000-0000-0000-0000-000000000002'
const EVALUADOR = '00000000-0000-0000-0000-000000000003'
const GERENTE_A = '00000000-0000-0000-0000-000000000004'
const GERENTE_B = '00000000-0000-0000-0000-000000000005'
const SUC_A = '00000000-0000-0000-0000-0000000000a1'
const SUC_B = '00000000-0000-0000-0000-0000000000a2'
const SUC_CERRADA = '00000000-0000-0000-0000-0000000000a3'

let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  await db.exec(DDL)
  await db.exec(
    `insert into auth.users (id) values
       ('${LIDER}'), ('${EVALUADOR}'), ('${GERENTE_A}'), ('${GERENTE_B}')`
  )
  await db.exec(
    `insert into public.sucursales (id, nombre, activa) values
       ('${SUC_A}', 'Luxor Central', true),
       ('${SUC_B}', 'Luxor Norte', true),
       ('${SUC_CERRADA}', 'Luxor Cerrada', false)`
  )
  await db.exec(
    `insert into public.profiles (id, nombre, rol, sucursal_id) values
       ('${LIDER}', 'Ana Líder', 'LIDER', null),
       ('${EVALUADOR}', 'Juan Trabajador', 'EVALUADOR', null),
       ('${GERENTE_A}', 'Carla Encargada', 'GERENTE_S', '${SUC_A}'),
       ('${GERENTE_B}', 'Beto Encargado', 'GERENTE_S', '${SUC_B}')`
  )
  // Primera corrida… y la segunda: el bloque tiene que ser idempotente.
  await db.exec(bloqueSql('menu-sucursal.sql'))
  await db.exec(bloqueSql('menu-sucursal.sql'))

  // Un objeto en el bucket, subido como DUEÑO (bypasea RLS): es el estado
  // que después tienen que filtrar las políticas para los demás roles.
  await db.exec(
    `insert into storage.objects (bucket_id, name) values
       ('menu-fotos', 'menu/${SUC_A}/779.jpg')`
  )
})

afterAll(async () => {
  await db.close()
})

/** La sesión se hace pasar por este usuario: es lo que `auth.uid()` devuelve. */
async function como(usuario: string | null): Promise<void> {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [usuario ?? ''])
}

/** Baja al rol `authenticated` para que el RLS se aplique de verdad. */
async function conRol(usuario: string, fn: () => Promise<void>): Promise<void> {
  await como(usuario)
  await db.exec('set role authenticated')
  try {
    await fn()
  } finally {
    await db.exec('reset role')
  }
}

/** Baja al rol `anon`: la página del menú lee sin sesión. */
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

/** El encargado agrega un producto a SU sucursal, con sesión y RLS de verdad. */
async function agregar(usuario: string, sucursal: string, sku: string, nombre: string, orden: number): Promise<void> {
  await conRol(usuario, async () => {
    await db.query(
      `insert into public.menu_productos (sucursal_id, sku, nombre, orden)
       values ($1, $2, $3, $4)`,
      [sucursal, sku, nombre, orden]
    )
  })
}

describe('menu-sucursal.sql · la tabla', () => {
  it('anon no llega ni a la tabla', async () => {
    const anon = await contar(
      `select case when has_table_privilege('anon', 'public.menu_productos', 'select') then 1 else 0 end as n`
    )
    expect(anon).toBe(0)

    await conAnon(async () => {
      await expect(db.query(`select id from public.menu_productos`)).rejects.toThrow(/permission denied/i)
    })
  })

  it('con sesión se lee lo que la política deja ver', async () => {
    await agregar(GERENTE_A, SUC_A, '7790001', 'Papel higiénico', 1)
    await agregar(GERENTE_B, SUC_B, '7790002', 'Detergente', 1)

    // El encargado de A ve lo suyo y nada de la otra tienda.
    await conRol(GERENTE_A, async () => {
      const n = await contar(`select count(*)::int as n from public.menu_productos`)
      expect(n).toBe(1)
      const nombre = await db.query<{ nombre: string }>(
        `select nombre from public.menu_productos where sucursal_id = '${SUC_A}'`
      )
      expect(nombre.rows[0].nombre).toBe('Papel higiénico')
    })

    // El evaluador no es encargado de ninguna: no ve filas.
    await conRol(EVALUADOR, async () => {
      const n = await contar(`select count(*)::int as n from public.menu_productos`)
      expect(n).toBe(0)
    })
  })
})

describe('menu-sucursal.sql · RLS', () => {
  it('el encargado escribe sólo en su sucursal', async () => {
    // En la suya: pasa.
    await agregar(GERENTE_A, SUC_A, '7790003', 'Arroz', 2)

    // En la ajena: el `with check` lo rechaza.
    await conRol(GERENTE_A, async () => {
      await expect(
        db.query(
          `insert into public.menu_productos (sucursal_id, sku, nombre)
           values ('${SUC_B}', 'hack', 'Colado')`
        )
      ).rejects.toThrow(/row-level security/i)

      // Y un update contra la sucursal de otro no toca nada: el `using`
      // filtra todas las filas y la sentencia sigue sin error.
      await db.query(
        `update public.menu_productos set nombre = 'PISADO' where sucursal_id = '${SUC_B}'`
      )
    })

    const nombre = await db.query<{ nombre: string }>(
      `select nombre from public.menu_productos where sucursal_id = '${SUC_B}'`
    )
    expect(nombre.rows[0].nombre).toBe('Detergente')
  })

  it('el evaluador no escribe y el Líder sí (en cualquier sucursal)', async () => {
    await conRol(EVALUADOR, async () => {
      await expect(
        db.query(
          `insert into public.menu_productos (sucursal_id, sku, nombre)
           values ('${SUC_A}', '999', 'Sin permiso')`
        )
      ).rejects.toThrow(/row-level security/i)
    })

    await agregar(LIDER, SUC_A, '8888888', 'Del Líder', 9)

    // El Líder también borra de cualquier sucursal.
    await conRol(LIDER, async () => {
      await db.query(`delete from public.menu_productos where sku = '8888888'`)
    })
    const sigue = await contar(
      `select count(*)::int as n from public.menu_productos where sku = '8888888'`
    )
    expect(sigue).toBe(0)
  })

  it('un solo renglón de política cubre los cuatro verbos', async () => {
    const filas = await db.query<{ policyname: string; cmd: string; roles: string[] }>(
      `select policyname, cmd, roles from pg_policies
        where schemaname = 'public' and tablename = 'menu_productos'`
    )
    expect(filas.rows.map((f) => `${f.policyname}:${f.cmd.toLowerCase()}`)).toEqual([
      'menu_productos_encargado:all'
    ])
    expect(filas.rows[0].roles).toEqual(['authenticated'])
  })
})

describe('menu-sucursal.sql · la función pública', () => {
  it('anon la ejecuta, PUBLIC no (queda revocada)', async () => {
    const anon = await contar(
      `select case when has_function_privilege('anon', 'public.ver_menu_publico(uuid)', 'execute') then 1 else 0 end as n`
    )
    expect(anon).toBe(1)
    const publico = await contar(
      `select case when has_function_privilege('public', 'public.ver_menu_publico(uuid)', 'execute') then 1 else 0 end as n`
    )
    expect(publico).toBe(0)
  })

  it('devuelve la sucursal con sus productos activos y en orden', async () => {
    await conAnon(async () => {
      const r = await db.query<{ r: { sucursal: { nombre: string } | null; productos: unknown[] } }>(
        `select public.ver_menu_publico('${SUC_A}') as r`
      )
      const menu = r.rows[0].r
      expect(menu.sucursal?.nombre).toBe('Luxor Central')
      expect(menu.productos.length).toBe(2)
      const nombres = menu.productos.map((p) => (p as { nombre: string }).nombre)
      expect(nombres).toEqual(['Papel higiénico', 'Arroz'])

      // La tabla sigue cerrada: la función no es una puerta atrás.
      await expect(db.query(`select id from public.menu_productos`)).rejects.toThrow(
        /permission denied/i
      )
    })
  })

  it('sin sucursal válida devuelve null, indistinguible de "no existe"', async () => {
    await conAnon(async () => {
      const r = await db.query<{ r: { sucursal: unknown; productos: unknown[] } }>(
        `select public.ver_menu_publico('00000000-0000-0000-0000-0000000000ff') as r`
      )
      expect(r.rows[0].r.sucursal).toBeNull()

      // Una sucursal inactiva tampoco se muestra.
      const cerrada = await db.query<{ r: { sucursal: unknown } }>(
        `select public.ver_menu_publico('${SUC_CERRADA}') as r`
      )
      expect(cerrada.rows[0].r.sucursal).toBeNull()
    })
  })

  it('es security definer con search_path fijo', async () => {
    const n = await contar(
      `select case when exists (
         select 1 from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'ver_menu_publico'
            and p.prosecdef
            and p.proconfig::text like '%search_path%'
       ) then 1 else 0 end as n`
    )
    expect(n).toBe(1)
  })
})

describe('menu-sucursal.sql · las fotos', () => {
  it('el bucket nace público: es lo que significa poder verlo sin sesión', async () => {
    const n = await contar(
      `select case when b."public" then 1 else 0 end as n from storage.buckets b where b.id = 'menu-fotos'`
    )
    expect(n).toBe(1)
  })

  it('cualquiera ve las fotos del menú sin sesión', async () => {
    await conAnon(async () => {
      const n = await contar(
        `select count(*)::int as n from storage.objects where bucket_id = 'menu-fotos'`
      )
      expect(n).toBe(1)
    })
  })

  it('sube el encargado… sólo en la carpeta de su sucursal', async () => {
    await conRol(GERENTE_A, async () => {
      await db.query(
        `insert into storage.objects (bucket_id, name) values ('menu-fotos', 'menu/${SUC_A}/nuevo.webp')`
      )
      // La carpita de la otra tienda: el `with check` la rechaza.
      await expect(
        db.query(
          `insert into storage.objects (bucket_id, name) values ('menu-fotos', 'menu/${SUC_B}/hack.webp')`
        )
      ).rejects.toThrow(/row-level security/i)
    })

    await conRol(EVALUADOR, async () => {
      await expect(
        db.query(
          `insert into storage.objects (bucket_id, name) values ('menu-fotos', 'menu/${SUC_A}/sin-permiso.webp')`
        )
      ).rejects.toThrow(/row-level security/i)
    })

    // El Líder sube en cualquier carpeta.
    await conRol(LIDER, async () => {
      await db.query(
        `insert into storage.objects (bucket_id, name) values ('menu-fotos', 'menu/${SUC_B}/lider.webp')`
      )
    })
  })
})
