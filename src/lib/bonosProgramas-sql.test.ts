import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { bloqueSql } from './supabaseSql'

/**
 * bonos-programas.sql, ejecutado en un Postgres de verdad.
 *
 * POR QUÉ EXISTE ESTE TEST
 * ------------------------
 * Es el bloque que SEPARA los módulos de los programas de bonificación, y
 * las reglas que sólo fallan cuando alguien guarda un dato inválido o
 * consulta con el rol equivocado:
 *
 *  1. La FORMA de cada fuente: una de módulo sin módulo y una de actividad
 *     sin nombre no significan nada — los `check` están en la base, no sólo
 *     en el formulario.
 *  2. Lo que se BORRA y lo que no: borrar el módulo deja el programa entero
 *     (sólo pierde la fuente); borrar el programa se lleva fuentes y notas;
 *     el cargo que apuntaba a él queda sin programa, no se borra.
 *  3. La nota: una por persona y período (la PK lo garantiza), de 0 a 100 y
 *     con período de mes o de trimestre.
 *  4. RLS con `puede_bonos`: LÍDER y GERENTE TH entran, un EVALUADOR no ve
 *     ni toca una cifra de sueldo, y `anon` ni siquiera tiene privilegio de
 *     tabla (segunda cerradura).
 *
 * Acá se corre el bloque TAL CUAL se pega al SQL Editor, dos veces (tiene
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

  -- Espejo mínimo: las FK de bonos miran profiles y sucursales, y la fuente
  -- de un programa mira modulos.
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
const MODULO = '00000000-0000-0000-0000-000000000f10'
const CARGO = '00000000-0000-0000-0000-000000000f20'

let db: PGlite

/** Crea un programa y devuelve su id. */
async function crearPrograma(nombre = 'Bono por faltantes'): Promise<string> {
  const r = await db.query<{ id: string }>(
    `insert into public.bonos_programa (nombre) values ($1) returning id`,
    [nombre]
  )
  return r.rows[0].id
}

/** Agrega una fuente al programa y devuelve su id. */
async function agregarFuente(
  programa: string,
  valores: { tipo: string; modulo_id?: string | null; nombre?: string | null; peso?: number }
): Promise<string> {
  const r = await db.query<{ id: string }>(
    `insert into public.bonos_programa_fuente (bono_programa_id, tipo, modulo_id, nombre, peso)
     values ($1, $2, $3, $4, $5) returning id`,
    [programa, valores.tipo, valores.modulo_id ?? null, valores.nombre ?? null, valores.peso ?? 1]
  )
  return r.rows[0].id
}

async function contar(sql: string, params: unknown[] = []): Promise<number> {
  const r = await db.query(sql, params)
  return Number((r.rows[0] as { n: string | number }).n)
}

/** La sesión se hace pasar por este usuario: es lo que `auth.uid()` devuelve. */
async function como(usuario: string | null): Promise<void> {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [usuario ?? ''])
}

/**
 * Baja al rol `authenticated` para que el RLS se aplique de verdad: la
 * conexión de pglite es `postgres`, que es el DUEÑO de las tablas y
 * bypasea RLS. Siempre vuelve al rol original, también si la prueba falla.
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
  await db.exec(`insert into public.modulos (id, nombre) values ('${MODULO}', 'Faltantes')`)
  // El bloque de bonos es el que define `puede_bonos` Y la tabla de cargos:
  // sin él, las políticas de abajo no analizan y el INSERT tampoco.
  await db.exec(bloqueSql('bonos.sql'))
  await db.exec(bloqueSql('bonos.sql'))
  await db.exec(
    `insert into public.bonos_cargo (id, cargo, clave, monto) values
       ('${CARGO}', 'Gerente de mercado', 'gerente de mercado', 100)`
  )
  // Y éste, dos veces: tiene que ser idempotente.
  await db.exec(bloqueSql('bonos-programas.sql'))
  await db.exec(bloqueSql('bonos-programas.sql'))
}, 120_000)

afterAll(async () => {
  await db?.close()
})

describe('bonos-programas.sql · la forma de cada fuente', () => {
  it('una fuente sin nombre no se guarda, sea de módulo o de actividad', async () => {
    const programa = await crearPrograma('Bono de prueba')
    const rechazo = /violates not-null constraint|violates check constraint/i
    await expect(agregarFuente(programa, { tipo: 'MODULO' })).rejects.toThrow(rechazo)
    await expect(agregarFuente(programa, { tipo: 'ACTIVIDAD' })).rejects.toThrow(rechazo)
    // Con sólo espacios tampoco: el `check` mira el nombre ya recortado.
    await expect(agregarFuente(programa, { tipo: 'ACTIVIDAD', nombre: '   ' })).rejects.toThrow(rechazo)
    // Con nombre sí: la actividad es la que no depende de nada más.
    await expect(
      agregarFuente(programa, { tipo: 'ACTIVIDAD', nombre: 'Auditoría de precios' })
    ).resolves.toBeTruthy()
  })

  it('una fuente de ACTIVIDAD no puede apuntar a un módulo', async () => {
    const programa = await crearPrograma('Bono de prueba 2')
    await expect(
      agregarFuente(programa, { tipo: 'ACTIVIDAD', nombre: 'Actividad', modulo_id: MODULO })
    ).rejects.toThrow(/bonos_fuente_actividad_chk|violates check constraint/i)
  })

  it('el peso tiene que ser positivo', async () => {
    const programa = await crearPrograma('Bono de prueba 3')
    await expect(
      agregarFuente(programa, { tipo: 'ACTIVIDAD', nombre: 'Actividad', peso: 0 })
    ).rejects.toThrow(/bonos_programa_fuente_peso_check|violates check constraint/i)
  })

  it('la nota va de 0 a 100 y con período de mes o de trimestre', async () => {
    const programa = await crearPrograma('Bono de prueba 4')
    const fuente = await agregarFuente(programa, { tipo: 'ACTIVIDAD', nombre: 'Actividad' })
    const nota = (periodo: string, valor: number) =>
      db.query(
        `insert into public.bonos_programa_nota (bono_programa_fuente_id, periodo, dni, nota)
         values ($1, $2, 12345678, $3)`,
        [fuente, periodo, valor]
      )

    await expect(nota('2026-11', 85)).resolves.toBeTruthy()
    await expect(nota('2026-T4', 90)).resolves.toBeTruthy()
    await expect(nota('2026-13', 85)).rejects.toThrow(/check/i)
    await expect(nota('noviembre', 85)).rejects.toThrow(/check/i)
    await expect(nota('2026-12', 101)).rejects.toThrow(/check/i)
    await expect(nota('2026-12', -1)).rejects.toThrow(/check/i)
  })

  it('la misma persona no se anota dos veces en la misma fuente y período', async () => {
    const programa = await crearPrograma('Bono de prueba 5')
    const fuente = await agregarFuente(programa, { tipo: 'ACTIVIDAD', nombre: 'Actividad' })
    const nota = (dni: number) =>
      db.query(
        `insert into public.bonos_programa_nota (bono_programa_fuente_id, periodo, dni, nota)
         values ($1, '2026-11', $2, 80)`,
        [fuente, dni]
      )

    await expect(nota(11111111)).resolves.toBeTruthy()
    await expect(nota(11111111)).rejects.toThrow(/duplicate key|bonos_programa_nota_pkey/i)
    // Otra persona en el mismo período entra sin problema.
    await expect(nota(22222222)).resolves.toBeTruthy()
  })
})

describe('bonos-programas.sql · qué se borra y qué no', () => {
  it('borrar el MÓDULO deja el programa entero: la fuente queda sin módulo', async () => {
    const modulo = '00000000-0000-0000-0000-000000000f11'
    await db.exec(`insert into public.modulos (id, nombre) values ('${modulo}', 'Temporal')`)
    const programa = await crearPrograma('Bono con módulo')
    // La app copia el nombre del módulo al agregar la fuente: es el respaldo
    // que queda cuando el módulo desaparece.
    const fuente = await agregarFuente(programa, { tipo: 'MODULO', modulo_id: modulo, nombre: 'Temporal' })

    await db.exec(`delete from public.modulos where id = '${modulo}'`)

    const quedan = await contar(
      `select count(*) as n from public.bonos_programa_fuente where id = '${fuente}'`
    )
    expect(quedan).toBe(1)
    const sinModulo = await contar(
      `select count(*) as n from public.bonos_programa_fuente where id = '${fuente}' and modulo_id is null`
    )
    expect(sinModulo).toBe(1)
    // El nombre se queda: la fila sigue siendo legible sin el módulo.
    const nombre = await db.query<{ nombre: string }>(
      `select nombre from public.bonos_programa_fuente where id = '${fuente}'`
    )
    expect(nombre.rows[0].nombre).toBe('Temporal')
    const sigueElPrograma = await contar(
      `select count(*) as n from public.bonos_programa where id = '${programa}'`
    )
    expect(sigueElPrograma).toBe(1)
  })

  it('borrar el PROGRAMA se lleva fuentes y notas, y el cargo queda sin programa', async () => {
    const programa = await crearPrograma('Bono efímero')
    const fuente = await agregarFuente(programa, { tipo: 'ACTIVIDAD', nombre: 'Actividad' })
    await db.query(
      `insert into public.bonos_programa_nota (bono_programa_fuente_id, periodo, dni, nota)
       values ($1, '2026-11', 33333333, 70)`,
      [fuente]
    )
    await db.query(
      `update public.bonos_cargo set bono_programa_id = $1 where id = '${CARGO}'`,
      [programa]
    )

    await db.exec(`delete from public.bonos_programa where id = '${programa}'`)

    // Fuentes y notas salieron en cascada…
    expect(await contar(`select count(*) as n from public.bonos_programa_fuente where id = '${fuente}'`)).toBe(0)
    expect(
      await contar(`select count(*) as n from public.bonos_programa_nota where bono_programa_fuente_id = '${fuente}'`)
    ).toBe(0)
    // …y el CARGO sigue vivo, sólo que sin programa (`on delete set null`):
    // borrar la configuración del bono no borra el bono.
    const cargo = await contar(
      `select count(*) as n from public.bonos_cargo where id = '${CARGO}' and bono_programa_id is null`
    )
    expect(cargo).toBe(1)
  })

  it('la columna del cargo existe y es opcional', async () => {
    const n = await contar(
      `select count(*) as n from information_schema.columns
        where table_name = 'bonos_cargo' and column_name = 'bono_programa_id'`
    )
    expect(n).toBe(1)
  })
})

describe('bonos-programas.sql · quién entra', () => {
  it('RLS está encendido en las tres tablas, con select filtrado', async () => {
    for (const tabla of ['bonos_programa', 'bonos_programa_fuente', 'bonos_programa_nota']) {
      const r = await db.query<{ rls: boolean; politicas: number }>(
        `select c.relrowsecurity as rls,
                (select count(*)::int from pg_policies pp
                  where pp.schemaname = 'public' and pp.tablename = c.relname) as politicas
           from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname = $1`,
        [tabla]
      )
      expect(r.rows[0].rls, tabla).toBe(true)
      // select + gestión (all): dos, sin delete aparte porque `for all` lo incluye.
      expect(r.rows[0].politicas, tabla).toBe(2)
    }
  })

  it('un EVALUADOR no ve ni toca un programa de bono', async () => {
    const programa = await crearPrograma('Bono invisible')
    await agregarFuente(programa, { tipo: 'ACTIVIDAD', nombre: 'Actividad' })

    await conRol(EVALUADOR, async () => {
      const ve = await db.query(`select id from public.bonos_programa where id = $1`, [programa])
      expect(ve.rows, 'un EVALUADOR no ve cifras de sueldo').toHaveLength(0)

      // Y un INSERT se RECHAZA (with check de `puede_bonos`), no se filtra.
      await expect(
        db.query(`insert into public.bonos_programa (nombre) values ('Infiltrado')`)
      ).rejects.toThrow(/row-level security/i)
    })
    await como(null)
  })

  it('LÍDER y GERENTE TH leen y escriben', async () => {
    for (const usuario of [LIDER, GERENTE_TH]) {
      const id = await crearPrograma(`Bono de ${usuario.slice(-4)}`)
      await conRol(usuario, async () => {
        const ve = await db.query(`select id from public.bonos_programa where id = $1`, [id])
        expect(ve.rows, `no lo ve ${usuario}`).toHaveLength(1)

        const escribe = await db.query(
          `update public.bonos_programa set descripcion = 'Editado' where id = $1 returning id`,
          [id]
        )
        expect(escribe.rows, `no lo edita ${usuario}`).toHaveLength(1)
      })
    }
    await como(null)
  })

  it('anon no tiene privilegio de tabla en ninguna de las tres', async () => {
    for (const tabla of ['bonos_programa', 'bonos_programa_fuente', 'bonos_programa_nota']) {
      const n = await contar(
        `select case when has_table_privilege('anon', 'public.${tabla}', 'select') then 1 else 0 end as n`
      )
      expect(n, tabla).toBe(0)
    }
  })
})
