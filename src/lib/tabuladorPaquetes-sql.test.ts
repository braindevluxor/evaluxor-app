import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { bloqueSql } from './supabaseSql'

/**
 * bono-tabulador.sql, ejecutado en un Postgres de verdad.
 *
 * POR QUÉ EXISTE ESTE TEST
 * ------------------------
 * El tabulador es una foto del Excel de Talento Humano y las reglas que
 * sólo fallan cuando alguien consulta con el rol equivocado o intenta
 * tocar una cifra de sueldo:
 *
 *  1. La FORMA: sólo dos hojas (OFICINA/SUCURSALES), los componentes como
 *     objeto y UNA fila de config —el mismo `check` de fila única que el
 *     resto de las configuraciones de una sola fila.
 *  2. SÓLO LECTURA: no hay política de escritura, así que NI el Líder
 *     inserta desde la app —el tabulador cambia pegando el SQL del
 *     import—. Ése es el invariant que protege este archivo.
 *  3. RLS con `puede_bonos`: LÍDER y GERENTE TH leen, un EVALUADOR no ve
 *     una cifra de sueldo, y `anon` ni privilegio de tabla.
 *
 * Acá se corre el bloque TAL CÓMO se pega al SQL Editor, dos veces (tiene
 * que ser idempotente), sobre `bonos.sql` —del que sale `puede_bonos`— y un
 * espejo mínimo de las tablas que toca.
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

  -- Espejo mínimo: las FK de bonos miran profiles, sucursales y módulos.
  create table public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    nombre text,
    rol text not null default 'EVALUADOR',
    activo boolean not null default true
  );

  create table public.sucursales (
    id uuid primary key default gen_random_uuid(),
    nombre text not null,
    activa boolean not null default true,
    created_at timestamptz not null default now()
  );

  create table public.modulos (
    id uuid primary key default gen_random_uuid(),
    nombre text not null,
    activo boolean not null default true
  );
`

const LIDER = '00000000-0000-0000-0000-000000000f01'
const GERENTE_TH = '00000000-0000-0000-0000-000000000f02'
const EVALUADOR = '00000000-0000-0000-0000-000000000f03'

let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  await db.exec(DDL)
  await db.exec(
    `insert into auth.users (id) values ('${LIDER}'), ('${GERENTE_TH}'), ('${EVALUADOR}')`
  )
  await db.exec(
    `insert into public.profiles (id, nombre, rol) values
       ('${LIDER}', 'Ana Líder', 'LIDER'),
       ('${GERENTE_TH}', 'Tomás Talento Humano', 'GERENTE_TH'),
       ('${EVALUADOR}', 'Juan Evaluador', 'EVALUADOR')`
  )
  // El bloque de bonos define `puede_bonos`, que éste usa en sus
  // políticas… y las dos corridas prueban que el import es idempotente.
  await db.exec(bloqueSql('bonos.sql'))
  await db.exec(bloqueSql('bonos.sql'))
  await db.exec(bloqueSql('bono-tabulador.sql'))
  await db.exec(bloqueSql('bono-tabulador.sql'))

  // Una fila de cada cosa, subida como DUEÑO (bypasea RLS): es el estado
  // que después tienen que filtrar las políticas para los demás roles.
  await db.exec(
    `insert into public.bono_tabulador_paquete
       (hoja, codigo, cargo, departamento, dependencia, plantilla, salario, paquete, componentes)
     values
       ('OFICINA', '0150000', 'ASISTENTE DE GERENCIA', 'ADMINISTRACION', 'CENTRAL', 1, 457.23, 995.64,
        '{"bci": 396063.18}'::jsonb),
       ('SUCURSALES', '00370000', 'AUXILIAR DE PRECIOS', 'ALMACEN', 'PLANTA', 26, 143.46, 309.83,
        '{}')`
  )
  await db.exec(
    `insert into public.bono_tabulador_config (id, columnas, fecha_archivo, tasa_cambio, tasa_cupon)
     values (true, '[{"hoja":"OFICINA","key":"bci","etiqueta":"BCI "}]'::jsonb, '2026-11-10', 899.27, 26)`
  )
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
 * `fn` en esa sesión. La conexión de pglite es `postgres`, que es el DUEÑO
 * de las tablas y bypasea RLS. Siempre vuelve al rol original.
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

/** Baja al rol `anon`: nadie con sesión no debería ni mirar esto. */
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

describe('bono-tabulador.sql · la forma', () => {
  it('sólo dos hojas y componentes como objeto', async () => {
    await expect(
      db.query(
        `insert into public.bono_tabulador_paquete (hoja, codigo) values ('PRENSA', '00000000')`
      )
    ).rejects.toThrow(/hoja/i)

    await expect(
      db.query(
        `insert into public.bono_tabulador_paquete (hoja, codigo, componentes)
         values ('OFICINA', '00000001', '[]'::jsonb)`
      )
    ).rejects.toThrow(/componentes/i)
  })

  it('la config es UNA fila, con sus columnas en array', async () => {
    // Fila única: la segunda con id=true muere en la PK…
    await expect(
      db.query(`insert into public.bono_tabulador_config (id, columnas) values (true, '[]'::jsonb)`)
    ).rejects.toThrow(/unique|duplicate/i)
    // …y id=false en su check de fila única.
    await expect(
      db.query(`insert into public.bono_tabulador_config (id) values (false)`)
    ).rejects.toThrow(/check/i)
    // Las columnas son una LISTA (con UPDATE para que el check de arriba
    // no se colgue primero en un id=true ya existente).
    await expect(
      db.query(`update public.bono_tabulador_config set columnas = '{}'::jsonb where id`)
    ).rejects.toThrow(/check/i)
  })
})

describe('bono-tabulador.sql · sólo lectura', () => {
  it('NI el Líder escribe desde la app: no hay política de escritura', async () => {
    // Ésta ES la razón de que el import venga como SQL pegado: la única
    // forma de cambiar una cifra es reemplazar la foto del Excel.
    await conRol(LIDER, async () => {
      await expect(
        db.query(
          `insert into public.bono_tabulador_paquete (hoja, codigo, cargo) values ('OFICINA', '999', 'X')`
        )
      ).rejects.toThrow(/row-level security/i)
      // UPDATE y DELETE no dan error: al no haber política de escritura,
      // se filtran y devuelven CERO filas — nadie cambia una cifra.
      const u = await db.query(
        `update public.bono_tabulador_paquete set salario = 1 where id = 1`
      )
      expect(Number((u as { affectedRows?: number }).affectedRows ?? -1)).toBe(0)
      const d = await db.query(`delete from public.bono_tabulador_paquete where id = 1`)
      expect(Number((d as { affectedRows?: number }).affectedRows ?? -1)).toBe(0)
    })
  })

  it('las dos tablas se leen con sesión y sin ella no', async () => {
    const anon = await contar(
      `select case when has_table_privilege('anon', 'public.bono_tabulador_paquete', 'select') then 1 else 0 end as n`
    )
    expect(anon).toBe(0)

    await conAnon(async () => {
      await expect(
        db.query(`select id from public.bono_tabulador_paquete`)
      ).rejects.toThrow(/permission denied/i)
    })
  })
})

describe('bono-tabulador.sql · RLS', () => {
  it('leen LÍDER y GERENTE TH; el EVALUADOR no ve una cifra de sueldo', async () => {
    await conRol(LIDER, async () => {
      const n = await contar(`select count(*)::int as n from public.bono_tabulador_paquete`)
      expect(n).toBe(2)
      const cfg = await contar(`select count(*)::int as n from public.bono_tabulador_config`)
      expect(cfg).toBe(1)
    })
    await conRol(GERENTE_TH, async () => {
      const n = await contar(`select count(*)::int as n from public.bono_tabulador_paquete`)
      expect(n).toBe(2)
    })
    // Filtra (no da error): la política de select deja la consulta vacía.
    await conRol(EVALUADOR, async () => {
      const n = await contar(`select count(*)::int as n from public.bono_tabulador_paquete`)
      expect(n).toBe(0)
      const cfg = await contar(`select count(*)::int as n from public.bono_tabulador_config`)
      expect(cfg).toBe(0)
    })
  })

  it('la función `puede_bonos` es la misma cerradura de siempre', async () => {
    const n = await contar(
      `select case when exists (
         select 1 from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'puede_bonos' and p.prosecdef
       ) then 1 else 0 end as n`
    )
    expect(n).toBe(1)
  })
})
