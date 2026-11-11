import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { bloqueSql } from './supabaseSql'

/**
 * bonos.sql, ejecutado en un Postgres de verdad.
 *
 * POR QUÉ EXISTE ESTE TEST
 * ------------------------
 * El bloque carga reglas que sólo fallan cuando alguien guarda un dato
 * inválido o consulta con el rol equivocado:
 *
 *  1. Los `check` de negocio: período con formato de mes (`2026-11`) o de
 *     trimestre (`2026-T1`), nota de 0 a 100, montos no negativos y el
 *     «pagar con nota» —un pago sin nota no tiene porcentaje que pagar—.
 *  2. Los `unique`: un cargo no se configura dos veces y una persona no
 *     cobra dos veces en el mismo período. Son los que hacen que la
 *     generación se pueda volver a correr.
 *  3. RLS con la función `puede_bonos`: LÍDER y GERENTE TH entran, un
 *     EVALUADOR no ve ni toca una cifra de sueldo, y `anon` ni siquiera
 *     tiene privilegio de tabla (segunda cerradura).
 *
 * Acá se corre el bloque TAL CUAL se pega al SQL Editor, dos veces (tiene
 * que ser idempotente), contra un espejo mínimo de las tablas que toca.
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

  -- Espejo mínimo de lo que el bloque toca: las FK de bonos_pago miran
  -- profiles (quién pagó) y sucursales (dónde trabaja la persona).
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
`

const LIDER = '00000000-0000-0000-0000-000000001d01'
const GERENTE_TH = '00000000-0000-0000-0000-000000007701'
const EVALUADOR = '00000000-0000-0000-0000-000000000e01'
const SUCURSAL = '00000000-0000-0000-0000-000000000001'
const SUCURSAL_B = '00000000-0000-0000-0000-000000000002'

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
  await db.exec(
    `insert into public.sucursales (id, nombre) values
       ('${SUCURSAL}', 'Eva Centro'),
       ('${SUCURSAL_B}', 'Eva Norte')`
  )
  await db.exec(bloqueSql('bonos.sql'))
  // Segunda corrida: tiene que seguir limpio, el bloque es idempotente.
  await db.exec(bloqueSql('bonos.sql'))
  // La nómina espejo pide `puede_bonos` (sale del bloque de arriba).
  await db.exec(bloqueSql('nomina-trabajadores.sql'))
  await db.exec(bloqueSql('nomina-trabajadores.sql'))
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
 * de las tablas y bypasea RLS: sin este cambio un test de políticas leería
 * todo aunque la política estuviera mal.
 *
 * Siempre vuelve al rol original, también cuando la prueba falla: si no, un
 * solo error dejaría todos los tests siguientes corriendo como
 * `authenticated` y el fracaso se propagaría como una cadena de ruidos.
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

/** Inserta un cargo y devuelve su id, con la configuración por defecto. */
async function insertarCargo(valores: Record<string, unknown> = {}): Promise<string> {
  const fila: Record<string, unknown> = {
    cargo: 'Cajero integral',
    clave: 'cajerointegral',
    activo: true,
    monto: 100,
    nota_minima: 70,
    periodicidad: 'MENSUAL',
    ...valores
  }
  const columnas = Object.keys(fila)
  const r = await db.query(
    `insert into public.bonos_cargo (${columnas.join(', ')})
     values (${columnas.map((_, i) => `$${i + 1}`).join(', ')})
     returning id`,
    columnas.map((c) => fila[c])
  )
  return (r.rows[0] as { id: string }).id
}

/** Inserta un pago sobre el cargo indicado y devuelve su id. */
async function insertarPago(bonoId: string, valores: Record<string, unknown> = {}): Promise<string> {
  const fila: Record<string, unknown> = {
    bono_cargo_id: bonoId,
    periodo: '2026-11',
    sucursal_id: SUCURSAL,
    nacionalidad: 'V',
    dni: 12345678,
    nombre: 'Ana Pérez',
    cargo: 'Cajero integral',
    monto_base: 100,
    nota_minima: 70,
    ...valores
  }
  const columnas = Object.keys(fila)
  const r = await db.query(
    `insert into public.bonos_pago (${columnas.join(', ')})
     values (${columnas.map((_, i) => `$${i + 1}`).join(', ')})
     returning id`,
    columnas.map((c) => fila[c])
  )
  return (r.rows[0] as { id: string }).id
}

async function contar(sql: string): Promise<number> {
  const r = await db.query(sql)
  return Number((r.rows[0] as { n: string | number }).n)
}

/** Agrega una sucursal al alcance de un cargo. */
async function insertarAlcance(bonoId: string, valores: Record<string, unknown> = {}): Promise<void> {
  const fila: Record<string, unknown> = {
    bono_cargo_id: bonoId,
    sucursal_id: SUCURSAL,
    monto: null,
    ...valores
  }
  const columnas = Object.keys(fila)
  await db.query(
    `insert into public.bonos_cargo_sucursal (${columnas.join(', ')})
     values (${columnas.map((_, i) => `$${i + 1}`).join(', ')})`,
    columnas.map((c) => fila[c])
  )
}

describe('bonos.sql · las reglas de los pagos', () => {
  it('el bloque es idempotente: se puede volver a aplicar sin romper nada', async () => {
    await db.exec(bloqueSql('bonos.sql'))
    expect(await contar(`select count(*) as n from public.bonos_cargo`)).toBe(0)
  })

  it('las columnas de departamento existen en las dos tablas (la migración incluida)', async () => {
    // `create table if not exists` no agrega columnas a una tabla ya creada:
    // es el `add column if not exists` del bloque el que las pone, y acá se
    // comprueba que las dos quedaron.
    expect(
      await contar(
        `select count(*) as n from information_schema.columns
          where table_name in ('bonos_cargo', 'bonos_pago') and column_name = 'departamento'`
      )
    ).toBe(2)
    // Y se puede guardar: dos filas del mismo cargo, una por área.
    await expect(
      insertarCargo({ cargo: 'Comprador/a', clave: 'comprador', departamento: 'Compras' })
    ).resolves.toBeTruthy()
    await expect(
      insertarCargo({ cargo: 'Comprador/a', clave: 'comprador', departamento: 'Servicios Generales' })
    ).resolves.toBeTruthy()
  })

  it('el mismo cargo SÍ puede repetirse en la base: el no-solape lo valida la app', async () => {
    // Antes había un `unique (clave)` que impedía repetir el cargo. Se cayó
    // para permitir otra fila con OTRO conjunto de sucursales (montos o
    // períodos distintos por tienda); lo que se garantiza acá es que la
    // constraint vieja ya no exista ni siquiera en una tabla recién creada.
    await insertarCargo({ cargo: 'Cajero integral', clave: 'cajerointegral' })
    await expect(insertarCargo({ cargo: 'CAJERO INTEGRAL', clave: 'cajerointegral' })).resolves.toBeTruthy()
    expect(
      await contar(
        `select case when exists (
           select 1 from pg_constraint where conname = 'bonos_cargo_unico'
         ) then 1 else 0 end as n`
      )
    ).toBe(0)
    // Y con otra clave sigue cabiendo, obviamente.
    await expect(insertarCargo({ cargo: 'Chofer', clave: 'chofer' })).resolves.toBeTruthy()
  })

  it('el período sólo admite formato de mes o de trimestre válidos', async () => {
    const bono = await insertarCargo({ cargo: 'Depositaría', clave: 'depositaria' })
    await expect(insertarPago(bono, { periodo: '2026-11' })).resolves.toBeTruthy()
    await expect(insertarPago(bono, { periodo: '2026-01', dni: 1 })).resolves.toBeTruthy()
    await expect(insertarPago(bono, { periodo: '2026-T1', dni: 2 })).resolves.toBeTruthy()
    await expect(insertarPago(bono, { periodo: '2026-T4', dni: 3 })).resolves.toBeTruthy()

    await expect(insertarPago(bono, { periodo: '2026-13', dni: 4 })).rejects.toThrow(/check/i)
    await expect(insertarPago(bono, { periodo: '2026-T5', dni: 5 })).rejects.toThrow(/check/i)
    await expect(insertarPago(bono, { periodo: '2026-0', dni: 6 })).rejects.toThrow(/check/i)
    await expect(insertarPago(bono, { periodo: 'noviembre 2026', dni: 7 })).rejects.toThrow(/check/i)
  })

  it('la nota va de 0 a 100 y los montos no pueden ser negativos', async () => {
    const bono = await insertarCargo({ cargo: 'Encargado de turno', clave: 'encargadodeturno' })
    await expect(insertarPago(bono, { nota: 101 })).rejects.toThrow(/check/i)
    await expect(insertarPago(bono, { nota: -1 })).rejects.toThrow(/check/i)
    await expect(insertarPago(bono, { nota: 85 })).resolves.toBeTruthy()

    await expect(insertarPago(bono, { monto_base: -1, dni: 11 })).rejects.toThrow(/check/i)
    await expect(insertarCargo({ cargo: 'Chofer', clave: 'chofer2', monto: -5 })).rejects.toThrow(/check/i)
    await expect(
      insertarCargo({ cargo: 'Soldador', clave: 'soldador', nota_minima: 101 })
    ).rejects.toThrow(/check/i)
  })

  it('un pago no se marca PAGADO sin nota: sin nota no hay porcentaje', async () => {
    const bono = await insertarCargo({ cargo: 'Almacenero', clave: 'almacenero' })
    await expect(insertarPago(bono, { estado: 'PAGADO', dni: 21 })).rejects.toThrow(
      /bonos_pago_paga_con_nota/i
    )
    await expect(
      insertarPago(bono, { estado: 'PAGADO', nota: 90, monto: 90, dni: 22 })
    ).resolves.toBeTruthy()
    // Un PENDIENTO con nota sigue siendo válido: la nota se carga antes de pagar.
    await expect(insertarPago(bono, { nota: 60, monto: 0, dni: 23 })).resolves.toBeTruthy()
  })

  it('el mismo período no le paga dos veces a la misma persona', async () => {
    const bono = await insertarCargo({ cargo: 'Reponedor', clave: 'reponedor' })
    await insertarPago(bono, { dni: 31 })
    await expect(insertarPago(bono, { dni: 31 })).rejects.toThrow(/duplicate|unique|única/i)
    // Otra persona, otro cargo o distinta nacionalidad sí caben.
    await expect(insertarPago(bono, { dni: 32 })).resolves.toBeTruthy()
    await expect(insertarPago(bono, { dni: 31, nacionalidad: 'E' })).resolves.toBeTruthy()
  })
})

describe('bonos.sql · el alcance por sucursal', () => {
  it('una sucursal está una sola vez en el conjunto, pero el conjunto admite varias', async () => {
    const bono = await insertarCargo({ cargo: 'Tecnólogo', clave: 'tecnologo' })
    await insertarAlcance(bono, { sucursal_id: SUCURSAL, monto: 120 })
    await expect(insertarAlcance(bono, { sucursal_id: SUCURSAL, monto: 130 })).rejects.toThrow(
      /duplicate|unique|única/i
    )
    await expect(insertarAlcance(bono, { sucursal_id: SUCURSAL_B, monto: 140 })).resolves.toBeUndefined()
  })

  it('el monto por sucursal no puede ser negativo; NULL = el del cargo', async () => {
    const bono = await insertarCargo({ cargo: 'Cartógrafo', clave: 'cartografo' })
    await expect(insertarAlcance(bono, { monto: -1 })).rejects.toThrow(/check/i)
    await expect(insertarAlcance(bono, { monto: null })).resolves.toBeUndefined()
  })

  it('no se puede apuntar a una sucursal que no existe', async () => {
    const bono = await insertarCargo({ cargo: 'Migrador', clave: 'migrador' })
    await expect(
      insertarAlcance(bono, { sucursal_id: '00000000-0000-0000-0000-00000000dead' })
    ).rejects.toThrow()
  })

  it('borrar el cargo se lleva su alcance (cascade), no deja filas huérfanas', async () => {
    const bono = await insertarCargo({ cargo: 'Paisajista', clave: 'paisajista' })
    await insertarAlcance(bono, { sucursal_id: SUCURSAL, monto: 10 })
    await insertarAlcance(bono, { sucursal_id: SUCURSAL_B, monto: 20 })
    await db.query(`delete from public.bonos_cargo where id = $1`, [bono])
    expect(
      await contar(`select count(*) as n from public.bonos_cargo_sucursal where bono_cargo_id = '${bono}'`)
    ).toBe(0)
  })
})

describe('bonos.sql · quién entra', () => {
  it('puede_bonos deja pasar al Líder y al Gerente de Talento Humano, y a nadie más', async () => {
    await como(LIDER)
    expect((await db.query('select public.puede_bonos() as ok')).rows[0]).toMatchObject({ ok: true })
    await como(GERENTE_TH)
    expect((await db.query('select public.puede_bonos() as ok')).rows[0]).toMatchObject({ ok: true })
    await como(EVALUADOR)
    expect((await db.query('select public.puede_bonos() as ok')).rows[0]).toMatchObject({ ok: false })
    await como(null)
    expect((await db.query('select public.puede_bonos() as ok')).rows[0]).toMatchObject({ ok: false })
    await como('')
  })

  it('el Líder configura cargos y consulta pagos', async () => {
    await conRol(LIDER, async () => {
      const bono = await insertarCargo({ cargo: 'Carnicero', clave: 'carnicero' })
      expect(await contar(`select count(*) as n from public.bonos_cargo where id = '${bono}'`)).toBe(1)
      await insertarPago(bono, { dni: 41 })
      expect(await contar(`select count(*) as n from public.bonos_pago`)).toBeGreaterThan(0)
    })
  })

  it('el Gerente de Talento Humano también: es su área', async () => {
    await conRol(GERENTE_TH, async () => {
      expect(await contar(`select count(*) as n from public.bonos_cargo`)).toBeGreaterThan(0)
      const bono = await insertarCargo({ cargo: 'Panadero', clave: 'panadero' })
      await insertarPago(bono, { dni: 51, nota: 95, monto: 95 })
      await db.query(
        `update public.bonos_pago set estado = 'PAGADO', pagado_en = current_date, pagado_por = $1
          where bono_cargo_id = $2`,
        [GERENTE_TH, bono]
      )
      expect(
        await contar(`select count(*) as n from public.bonos_pago where estado = 'PAGADO' and bono_cargo_id = '${bono}'`)
      ).toBe(1)
    })
  })

  it('un Evaluador no ve una cifra de sueldo ni la toca', async () => {
    // El cargo existe (creado como dueño de las tablas): así, si el insert
    // del alcance falla es por RLS y no por la foreign key.
    const bono = await insertarCargo({ cargo: 'Falsificador', clave: 'falsificador' })
    await conRol(EVALUADOR, async () => {
      expect(await contar(`select count(*) as n from public.bonos_cargo`)).toBe(0)
      expect(await contar(`select count(*) as n from public.bonos_cargo_sucursal`)).toBe(0)
      expect(await contar(`select count(*) as n from public.bonos_pago`)).toBe(0)
      await expect(insertarAlcance(bono, {})).rejects.toThrow(/row-level security/i)
      await expect(insertarCargo({ cargo: 'Impostor', clave: 'impostor' })).rejects.toThrow(
        /row-level security/i
      )
    })
  })

  it('anon no tiene ni el privilegio de tabla: la cerradura cerrada', async () => {
    expect(
      await contar(
        `select case when has_table_privilege('anon', 'public.bonos_cargo', 'select') then 1 else 0 end as n`
      )
    ).toBe(0)
    expect(
      await contar(
        `select case when has_table_privilege('anon', 'public.bonos_pago', 'select') then 1 else 0 end as n`
      )
    ).toBe(0)
  })
})

describe('nomina-trabajadores.sql · la tabla espejo de trabajadores', () => {
  it('la identidad es (sucursal, nacionalidad, DNI) y la foto va cruda en `datos`', async () => {
    expect(
      await contar(
        `select count(*) as n from pg_index i
          where i.indrelid = 'public.trabajadores_nomina'::regclass and i.indisprimary`
      )
    ).toBe(1)
    expect(
      await contar(
        `select count(*) as n from information_schema.columns
          where table_name = 'trabajadores_nomina' and column_name = 'datos'`
      )
    ).toBe(1)
  })

  it('el bloque es idempotente y sin pg_cron/pg_net no crea la programación', async () => {
    await db.exec(bloqueSql('nomina-trabajadores.sql'))
    // En el espejo no están las extensiones: si la función se creara igual,
    // `cron.schedule` explotaría al definirla. Debe quedarse sin crear.
    expect(
      await contar(
        `select case when to_regprocedure('public.programar_nomina_cron()') is null then 1 else 0 end as n`
      )
    ).toBe(1)
  })

  it('el Líder lee la nómina y el Evaluador ni la ve ni la toca', async () => {
    // La fila la escribe el dueño de las tablas, igual que la haría el cron
    // con la service role (que bypasea RLS).
    await db.query(
      `insert into public.trabajadores_nomina (sucursal_id, nacionalidad, dni, datos)
       values ($1, 'V', 777, $2)`,
      [SUCURSAL, JSON.stringify({ name: 'Ana', role_name: 'Subgerente', active: true })]
    )

    await conRol(LIDER, async () => {
      expect(await contar(`select count(*) as n from public.trabajadores_nomina`)).toBe(1)
    })
    await conRol(GERENTE_TH, async () => {
      expect(await contar(`select count(*) as n from public.trabajadores_nomina`)).toBe(1)
    })
    await conRol(EVALUADOR, async () => {
      expect(await contar(`select count(*) as n from public.trabajadores_nomina`)).toBe(0)
      // Sin política de escritura, el rol autenticado no puede meter filas.
      await expect(
        db.query(
          `insert into public.trabajadores_nomina (sucursal_id, nacionalidad, dni, datos)
           values ($1, 'V', 888, '{}'::jsonb)`,
          [SUCURSAL]
        )
      ).rejects.toThrow(/row-level security/i)
    })
  })

  it('la configuración del cron no la ve nadie más que el servidor', async () => {
    expect(
      await contar(
        `select case when has_table_privilege('authenticated', 'public.nomina_cron', 'select') then 1 else 0 end as n`
      )
    ).toBe(0)
    expect(
      await contar(`select case when has_table_privilege('anon', 'public.nomina_cron', 'select') then 1 else 0 end as n`)
    ).toBe(0)
    // Tampoco se le puede escribir desde la app.
    await conRol(LIDER, async () => {
      await expect(db.query(`insert into public.nomina_cron (id, activo) values (true, true)`)).rejects.toThrow()
    })
  })
})
