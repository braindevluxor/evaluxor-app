import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { bloqueSql } from './supabaseSql'

/**
 * tabulador-paquetes.sql, ejecutado en un Postgres de verdad.
 *
 * POR QUÉ EXISTE ESTE TEST
 * ------------------------
 * El tabulador son cifras de sueldo y este bloque es nuevo —se reemplazó la
 * foto del Excel por una tabla editable—, así que lo que sólo falla cuando
 * alguien consulta con el rol equivocado o intenta escribir una cifra vive
 * acá:
 *
 *  1. La FORMA: cargo obligatorio, cifras sin negativos y plazas enteras.
 *  2. SE ESCRIBE: a diferencia del tabulador viejo (sólo lectura), el LÍDER
 *     y el GERENTE TH dan de alta, editan y borran desde la consola.
 *  3. RLS con `puede_bonos`: los DOS roles anteriores, un EVALUADOR que no
 *     ve ni escribe una cifra de sueldo, y `anon` sin privilegio de tabla.
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
  await db.exec(bloqueSql('tabulador-paquetes.sql'))
  await db.exec(bloqueSql('tabulador-paquetes.sql'))

  // Dos filas, subidas como DUEÑO (bypasea RLS): es el estado que después
  // tienen que filtrar las políticas para los demás roles.
  await db.exec(
    `insert into public.tabulador_paquete
       (codigo, cargo, clave, departamento, dependencia, plantilla,
        salario_bs, bono_traslado_bs, bono_asistencia_usd, cestatickets_usd, paquete_aprobado_usd)
     values
       ('0150000', 'ASISTENTE DE GERENCIA', 'asistentedegerencia', 'ADMINISTRACION', 'CENTRAL', 1,
        457.23, 100, 50, 30, 995.64),
       ('00370000', 'AUXILIAR DE PRECIOS', 'auxiliardeprecios', 'ALMACEN', 'PLANTA', 26,
        143.46, 0, 25, 15, 309.83)`
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

describe('tabulador-paquetes.sql · la forma', () => {
  it('el cargo es obligatorio y ninguna cifra admite negativos', async () => {
    await expect(
      db.query(`insert into public.tabulador_paquete (codigo) values ('9999999')`)
    ).rejects.toThrow(/cargo/i)

    await expect(
      db.query(`insert into public.tabulador_paquete (cargo, salario_bs) values ('X', -1)`)
    ).rejects.toThrow(/salario_bs/i)

    await expect(
      db.query(`insert into public.tabulador_paquete (cargo, bono_asistencia_usd) values ('X', -0.5)`)
    ).rejects.toThrow(/bono_asistencia_usd/i)

    await expect(
      db.query(`insert into public.tabulador_paquete (cargo, plantilla) values ('X', -3)`)
    ).rejects.toThrow(/plantilla/i)

    await expect(
      db.query(`insert into public.tabulador_paquete (cargo, paquete_aprobado_usd) values ('X', -1)`)
    ).rejects.toThrow(/paquete_aprobado_usd/i)
  })

  it('guarda el PAQUETE y NO guarda el compensatorio: ése se calcula', async () => {
    const columnas = await contar(
      `select count(*)::int as n from information_schema.columns
        where table_schema = 'public' and table_name = 'tabulador_paquete'
          and column_name in ('paquete_aprobado_usd', 'bono_compensatorio_usd')`
    )
    // Sólo el paquete: la migración baja el compensatorio que se guardaba.
    expect(columnas).toBe(1)
    await expect(
      db.query(`insert into public.tabulador_paquete (cargo, bono_compensatorio_usd) values ('X', 1)`)
    ).rejects.toThrow(/bono_compensatorio_usd/)
  })

  it('el bloque es idempotente: se puede pegar de una corrida', async () => {
    // Si no fuera idempotente, esto revienta.
    await db.exec(bloqueSql('tabulador-paquetes.sql'))
  })
})

describe('tabulador-paquetes.sql · se edita desde la consola', () => {
  it('el LÍDER da de alta, edita y borra (a diferencia del tabulador del Excel)', async () => {
    await conRol(LIDER, async () => {
      const alta = await db.query<{ id: string }>(
        `insert into public.tabulador_paquete (codigo, cargo, clave, salario_bs, bono_asistencia_usd)
         values ('9990000', 'AUXILIAR NUEVO', 'auxiliarnuevo', 500, 75)
         returning id`
      )
      expect(alta.rows).toHaveLength(1)

      await db.query(
        `update public.tabulador_paquete set salario_bs = 550 where codigo = '9990000'`
      )
      await db.query(`delete from public.tabulador_paquete where codigo = '9990000'`)

      // Y las filas de los demás las ve, porque comparten la cerradura.
      expect(await contar(`select count(*)::int as n from public.tabulador_paquete`)).toBe(2)
    })
  })
})

describe('tabulador-paquetes.sql · RLS', () => {
  it('leen LÍDER y GERENTE TH; el EVALUADOR no ve una cifra de sueldo', async () => {
    await conRol(LIDER, async () => {
      expect(await contar(`select count(*)::int as n from public.tabulador_paquete`)).toBe(2)
    })
    await conRol(GERENTE_TH, async () => {
      expect(await contar(`select count(*)::int as n from public.tabulador_paquete`)).toBe(2)
    })
    // Filtra (no da error): la política de select deja la consulta vacía.
    await conRol(EVALUADOR, async () => {
      expect(await contar(`select count(*)::int as n from public.tabulador_paquete`)).toBe(0)
    })
  })

  it('el EVALUADOR ni escribe: la política de escritura lo manda al RLS', async () => {
    await conRol(EVALUADOR, async () => {
      await expect(
        db.query(`insert into public.tabulador_paquete (cargo, clave) values ('INTRUSO', 'intruso')`)
      ).rejects.toThrow(/row-level security/i)
      // UPDATE y DELETE no dan error: no hay fila visible, así que no tocan nada.
      const u = await db.query(
        `update public.tabulador_paquete set salario_bs = 1 where codigo = '0150000'`
      )
      expect(Number((u as { affectedRows?: number }).affectedRows ?? 0)).toBe(0)
    })
  })

  it('la misma cerradura de los bonos: `puede_bonos` con sesión y security definer', async () => {
    const n = await contar(
      `select case when exists (
         select 1 from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'puede_bonos' and p.prosecdef
       ) then 1 else 0 end as n`
    )
    expect(n).toBe(1)
  })

  it('anon no llega ni a la tabla', async () => {
    const anon = await contar(
      `select case when has_table_privilege('anon', 'public.tabulador_paquete', 'select') then 1 else 0 end as n`
    )
    expect(anon).toBe(0)

    await conAnon(async () => {
      await expect(db.query(`select id from public.tabulador_paquete`)).rejects.toThrow(
        /permission denied/i
      )
    })
  })
})
