import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { bloqueSql } from './supabaseSql'

/**
 * alertas-cargo.sql, ejecutado en un Postgres de verdad.
 *
 * POR QUÉ EXISTE ESTE TEST
 * ------------------------
 * El bloque es corto pero carga cuatro reglas que sólo fallan cuando alguien
 * escribe un dato inválido o consulta con otro rol:
 *
 *  1. El `check` de unidad XOR: una alerta es DE una sucursal o DE un
 *     departamento, nunca de las dos ni de ninguna. Sin el check, un insert
 *     mal armado crearía una fila que el panel no sabe a qué columna mirar.
 *  2. El índice único PARCIAL con `coalesce`: es el que sostiene «una sola
 *     alerta PENDIENTE por cargo, unidad Y VISITA». Un índice único común no
 *     serviría (dos NULL no son iguales) y sin el `where estado = 'PENDIENTE'`
 *     no podría acumularse historial.
 *  3. La migración del modelo viejo: la tabla se crea como está hoy en
 *     producción (SIN evaluación), con una alerta de ese modelo adentro, y el
 *     bloque tiene que agregar la columna, borrar esa fila y cerrar la tabla
 *     con `not null` + FK. Ese es el camino que va a recorrer en Supabase.
 *  4. RLS con las dos políticas y el revoke a `anon`, que sólo se leen desde
 *     `pg_policies` y `has_table_privilege`.
 *
 * Acá se corre el bloque TAL CUAL se pega al SQL Editor, dos veces (tiene que
 * ser idempotente), contra un espejo mínimo de las tablas que toca.
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

  -- Espejo mínimo de lo que el bloque toca, copiado de schema.sql. Sólo lo que
  -- las FK de alertas_cargo miran: la evaluación entra únicamente como
  -- destino de la FK nueva, así que su espejo es su id.
  create table public.evaluaciones (
    id uuid primary key
  );

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

  create table public.departamentos_centralizados (
    id uuid primary key default gen_random_uuid(),
    nombre text not null,
    activa boolean not null default true,
    created_at timestamptz not null default now()
  );

  create or replace function public.es_lider()
  returns boolean language sql stable security definer set search_path = public as $$
    select exists (select 1 from public.profiles p where p.id = auth.uid() and p.rol = 'LIDER' and p.activo);
  $$;
`

/** La tabla COMO ESTÁ HOY en producción: sin evaluación y con su índice viejo. */
const MODELO_VIEJO = `
  create table public.alertas_cargo (
    id uuid primary key default gen_random_uuid(),
    clave_cargo text not null,
    cargo text not null,
    sucursal_id uuid references public.sucursales(id) on delete cascade,
    departamento_id uuid references public.departamentos_centralizados(id) on delete cascade,
    nivel text not null check (nivel in ('AMONESTACION', 'LLAMADO')),
    nota integer not null check (nota >= 0 and nota <= 100),
    estado text not null default 'PENDIENTE' check (estado in ('PENDIENTE', 'ATENDIDA')),
    atendida_en timestamptz,
    atendida_por uuid references public.profiles(id) on delete set null,
    created_at timestamptz not null default now(),
    constraint alertas_cargo_unidad_check check ((sucursal_id is null) <> (departamento_id is null))
  );

  create unique index alertas_cargo_pendiente
    on public.alertas_cargo (clave_cargo, coalesce(sucursal_id, departamento_id))
    where estado = 'PENDIENTE';
`

const SUCURSAL = '00000000-0000-0000-0000-000000000001'
const SUCURSAL_2 = '00000000-0000-0000-0000-000000000002'
const DEPARTAMENTO = '00000000-0000-0000-0000-00000000000d'
const EVAL_1 = '00000000-0000-0000-0000-000000000e01'
const EVAL_2 = '00000000-0000-0000-0000-000000000e02'

let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  await db.exec(DDL)
  await db.exec(`insert into public.sucursales (id, nombre) values ('${SUCURSAL}', 'Eva Centro'), ('${SUCURSAL_2}', 'Eva Sur')`)
  await db.exec(`insert into public.departamentos_centralizados (id, nombre) values ('${DEPARTAMENTO}', 'Contabilidad')`)
  await db.exec(`insert into public.evaluaciones (id) values ('${EVAL_1}'), ('${EVAL_2}')`)
  // Se arranca desde la tabla VIEJA, con una alerta de ese modelo adentro: es
  // el camino que va a recorrer en Supabase.
  await db.exec(MODELO_VIEJO)
  await db.query(
    `insert into public.alertas_cargo (clave_cargo, cargo, sucursal_id, nivel, nota)
     values ('cajero', 'Cajero', $1, 'LLAMADO', 62)`,
    [SUCURSAL]
  )
  await db.exec(bloqueSql('alertas-cargo.sql'))
  // Segunda corrida: tiene que seguir limpio, el bloque es idempotente.
  await db.exec(bloqueSql('alertas-cargo.sql'))
})

afterAll(async () => {
  await db.close()
})

async function filas(sql: string): Promise<Record<string, unknown>[]> {
  const r = await db.query(sql)
  return r.rows as Record<string, unknown>[]
}

/** Inserta una alerta mínima válida; el `override` cambia lo que se quiere probar. */
async function insertar(override: Record<string, unknown> = {}): Promise<void> {
  const payload = {
    clave_cargo: 'cajero',
    cargo: 'Cajero',
    sucursal_id: SUCURSAL,
    departamento_id: null,
    evaluacion_id: EVAL_1,
    nivel: 'AMONESTACION',
    nota: 75,
    estado: 'PENDIENTE',
    ...override
  }
  await db.query(
    `insert into public.alertas_cargo (clave_cargo, cargo, sucursal_id, departamento_id, evaluacion_id, nivel, nota, estado)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [payload.clave_cargo, payload.cargo, payload.sucursal_id, payload.departamento_id, payload.evaluacion_id, payload.nivel, payload.nota, payload.estado]
  )
}

describe('alertas-cargo.sql · corre limpio y migra el modelo viejo', () => {
  it('las alertas sin evaluación (el modelo viejo) quedan borradas', async () => {
    const sinEvaluacion = await filas(
      `select count(*)::int as n from public.alertas_cargo where evaluacion_id is null`
    )
    expect(sinEvaluacion[0].n).toBe(0)
    // Y la del modelo viejo en particular ya no está.
    const vieja = await filas(
      `select count(*)::int as n from public.alertas_cargo where clave_cargo = 'cajero' and nota = 62`
    )
    expect(vieja[0].n).toBe(0)
  })

  it('la tabla tiene las columnas esperadas, con su unidad XOR, la visita, su nivel y su nota de 0 a 100', async () => {
    const columnas = await filas(`
      select column_name, data_type, is_nullable
      from information_schema.columns
      where table_schema = 'public' and table_name = 'alertas_cargo'
      order by column_name
    `)
    expect(columnas.map((c) => c.column_name)).toEqual([
      'atendida_en',
      'atendida_por',
      'cargo',
      'clave_cargo',
      'created_at',
      'departamento_id',
      'estado',
      'evaluacion_id',
      'id',
      'nivel',
      'nota',
      'sucursal_id'
    ])
    // La visita no es opcional: sin ella no hay fila que armar en el panel.
    expect(columnas.find((c) => c.column_name === 'evaluacion_id')?.is_nullable).toBe('NO')
    expect(columnas.find((c) => c.column_name === 'nivel')?.is_nullable).toBe('NO')

    // Los checks que el bloque declara, leídos de la base y no del texto.
    const checks = await filas(`
      select pg_get_constraintdef(oid) as def
      from pg_constraint
      where conrelid = 'public.alertas_cargo'::regclass and contype = 'c'
      order by conname
    `)
    const defs = checks.map((c) => String(c.def)).join(' | ')
    expect(defs).toContain('AMONESTACION')
    expect(defs).toContain('LLAMADO')
    expect(defs).toContain('PENDIENTE')
    expect(defs).toContain('ATENDIDA')
    expect(defs).toContain('nota >= 0')
    expect(defs).toContain('nota <= 100')
    expect(defs).toContain('(sucursal_id IS NULL) <> (departamento_id IS NULL)')
  })

  it('la evaluación es una FK real con cascada, y no admite una visita inexistente', async () => {
    const fks = await filas(`
      select pg_get_constraintdef(oid) as def
      from pg_constraint
      where conrelid = 'public.alertas_cargo'::regclass and contype = 'f'
    `)
    const deVisita = fks.find((f) => String(f.def).includes('evaluacion_id'))
    expect(String(deVisita?.def)).toContain('REFERENCES evaluaciones(id)')
    expect(String(deVisita?.def)).toContain('ON DELETE CASCADE')

    await expect(insertar({ evaluacion_id: '00000000-0000-0000-0000-0000000000ff' })).rejects.toThrow()
  })
})

describe('alertas-cargo.sql · reglas de escritura', () => {
  it('una alerta necesita exactamente una unidad: ni las dos ni ninguna', async () => {
    await expect(insertar({ departamento_id: DEPARTAMENTO })).rejects.toThrow()
    await expect(insertar({ sucursal_id: null, departamento_id: null })).rejects.toThrow()
    // La válida sí entra (la deja para el final del describe).
    await expect(insertar()).resolves.toBeUndefined()
  })

  it('nivel y estado sólo aceptan sus valores conocidos y la nota va de 0 a 100', async () => {
    await expect(insertar({ nivel: 'REGAÑO' })).rejects.toThrow()
    await expect(insertar({ estado: 'VENCIDA' })).rejects.toThrow()
    await expect(insertar({ nota: 101 })).rejects.toThrow()
    await expect(insertar({ nota: -1 })).rejects.toThrow()
  })
})

describe('alertas-cargo.sql · una sola pendiente por cargo, unidad y visita', () => {
  it('la segunda pendiente de la MISMA visita choca con el índice único parcial', async () => {
    await expect(insertar()).rejects.toThrow(/duplicate|única|unique/i)
  })

  it('otra VISITA del mismo cargo y unidad sí puede tener su pendiente', async () => {
    // Ése es el cambio de modelo: el llamado es de la visita, no de la
    // relación histórica entre el cargo y la tienda.
    await expect(insertar({ evaluacion_id: EVAL_2 })).resolves.toBeUndefined()
  })

  it('otro cargo o otra unidad también puede tener su pendiente', async () => {
    await expect(insertar({ clave_cargo: 'encargado', cargo: 'Encargado' })).resolves.toBeUndefined()
    await expect(insertar({ clave_cargo: 'cajero', sucursal_id: SUCURSAL_2 })).resolves.toBeUndefined()
  })

  it('atendida la de una visita, la de la otra sigue pidiendo acción (ahí está el historial)', async () => {
    await db.query(
      `update public.alertas_cargo set estado = 'ATENDIDA'
       where clave_cargo = 'cajero' and sucursal_id = '${SUCURSAL}' and evaluacion_id = '${EVAL_1}'`
    )

    await expect(insertar()).resolves.toBeUndefined()
    const estados = await filas(
      `select evaluacion_id, estado from public.alertas_cargo
       where clave_cargo = 'cajero' and sucursal_id = '${SUCURSAL}'
       order by evaluacion_id, estado`
    )
    expect(estados).toEqual([
      { evaluacion_id: EVAL_1, estado: 'ATENDIDA' },
      { evaluacion_id: EVAL_1, estado: 'PENDIENTE' },
      { evaluacion_id: EVAL_2, estado: 'PENDIENTE' }
    ])
  })
})

describe('alertas-cargo.sql · permisos', () => {
  it('RLS encendido y las dos políticas: lectura con sesión, gestión sólo al Líder', async () => {
    const rls = await filas(`
      select relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'alertas_cargo'
    `)
    expect(rls).toEqual([{ relrowsecurity: true }])

    const politicas = await filas(`
      select policyname, cmd, coalesce(array_to_string(roles, ','), '') as roles, coalesce(qual, '') as condicion
      from pg_policies
      where schemaname = 'public' and tablename = 'alertas_cargo'
      order by policyname
    `)
    // Igual que el resto de la configuración: la `..._lider` no lleva `to`, así
    // que Postgres la registra como PUBLIC y lo que filtra es el `es_lider()`.
    expect(politicas.map((p) => `${p.policyname} ${String(p.cmd).toLowerCase()} ${p.roles}`)).toEqual([
      'alertas_cargo_lider all public',
      'alertas_cargo_select select authenticated'
    ])
    expect(String(politicas[0].condicion)).toContain('es_lider()')
  })

  it('anon no lee la tabla; con sesión sí', async () => {
    const permisos = await filas(`
      select has_table_privilege('anon', 'public.alertas_cargo', 'select') as anon_lee,
             has_table_privilege('authenticated', 'public.alertas_cargo', 'select') as sesion_lee
    `)
    expect(permisos).toEqual([{ anon_lee: false, sesion_lee: true }])
  })
})

describe('alertas-cargo.sql · a quién se le aplicó', () => {
  async function insertarTrabajador(override: Record<string, unknown> = {}): Promise<void> {
    const p = { evaluacion_id: EVAL_1, nacionalidad: 'V', dni: 12345678, nombre: 'Ana Pérez', ...override }
    await db.query(
      `insert into public.alerta_trabajadores (alerta_id, nacionalidad, dni, nombre)
       select id, $1, $2, $3 from public.alertas_cargo
       where evaluacion_id = $4 order by created_at limit 1`,
      [p.nacionalidad, p.dni, p.nombre, p.evaluacion_id]
    )
  }

  it('la tabla tiene la identidad del trabajador (nacionalidad + dni) y su nombre', async () => {
    const columnas = await filas(`
      select column_name, is_nullable
      from information_schema.columns
      where table_schema = 'public' and table_name = 'alerta_trabajadores'
      order by column_name
    `)
    expect(columnas.map((c) => c.column_name)).toEqual([
      'alerta_id',
      'created_at',
      'dni',
      'id',
      'nacionalidad',
      'nombre'
    ])
    expect(columnas.find((c) => c.column_name === 'alerta_id')?.is_nullable).toBe('NO')
  })

  it('el mismo trabajador no se anota dos veces en la MISMA alerta, pero sí en otra', async () => {
    await expect(insertarTrabajador()).resolves.toBeUndefined()
    await expect(insertarTrabajador({ nombre: 'Ana Pérez (duplicada)' })).rejects.toThrow(/duplicate|única|unique/i)

    // Otra alerta del mismo trabajador sí puede llevarlo: es la misma persona
    // notificada en dos ocasiones (acá, una visita distinta ya atendida).
    await db.query(
      `insert into public.alertas_cargo (clave_cargo, cargo, sucursal_id, evaluacion_id, nivel, nota, estado)
       select clave_cargo, cargo, sucursal_id, '${EVAL_2}', 'AMONESTACION', 70, 'ATENDIDA'
       from public.alertas_cargo where evaluacion_id = '${EVAL_1}' order by created_at limit 1`
    )
    await expect(insertarTrabajador({ evaluacion_id: EVAL_2 })).resolves.toBeUndefined()

    const total = await filas(`select count(*)::int as n from public.alerta_trabajadores`)
    expect(total[0].n).toBe(2)
  })

  it('borrar la alerta se lleva a sus trabajadores', async () => {
    const antes = await filas(`select count(*)::int as n from public.alerta_trabajadores`)
    // Sólo las de la visita 1: el test de ciclos de vida de abajo necesita que
    // siga habiendo una alerta pendiente.
    await db.query(`delete from public.alertas_cargo where evaluacion_id = '${EVAL_1}'`)
    const despues = await filas(`select count(*)::int as n from public.alerta_trabajadores`)
    // Queda sólo el que estaba en la alerta de la visita 2.
    expect(antes[0].n).toBe(2)
    expect(despues[0].n).toBe(1)
  })

  it('RLS encendido, lectura con sesión, gestión sólo al Líder, y anon fuera', async () => {
    const politicas = await filas(`
      select policyname, cmd from pg_policies
      where schemaname = 'public' and tablename = 'alerta_trabajadores'
      order by policyname
    `)
    expect(politicas).toEqual([
      { policyname: 'alerta_trabajadores_lider', cmd: 'ALL' },
      { policyname: 'alerta_trabajadores_select', cmd: 'SELECT' }
    ])

    const permisos = await filas(`
      select has_table_privilege('anon', 'public.alerta_trabajadores', 'select') as anon_lee,
             has_table_privilege('authenticated', 'public.alerta_trabajadores', 'select') as sesion_lee
    `)
    expect(permisos).toEqual([{ anon_lee: false, sesion_lee: true }])
  })
})

describe('alertas-cargo.sql · ciclos de vida', () => {
  it('borrar la sucursal se lleva sus alertas y el departamento las suyas', async () => {
    await db.query(`delete from public.sucursales where id = '${SUCURSAL_2}'`)
    const deSucursal = await filas(`select count(*)::int as n from public.alertas_cargo where sucursal_id = '${SUCURSAL_2}'`)
    expect(deSucursal[0].n).toBe(0)

    await expect(insertar({ clave_cargo: 'contador', cargo: 'Contador', sucursal_id: null, departamento_id: DEPARTAMENTO })).resolves.toBeUndefined()
    await db.query(`delete from public.departamentos_centralizados where id = '${DEPARTAMENTO}'`)
    const deDepartamento = await filas(
      `select count(*)::int as n from public.alertas_cargo where departamento_id = '${DEPARTAMENTO}'`
    )
    expect(deDepartamento[0].n).toBe(0)
  })

  it('atendida_por apunta a profiles y se anula si el perfil desaparece', async () => {
    const perfil = await filas(`
      insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000aa') returning id
    `)
    await filas(`
      insert into public.profiles (id, nombre, rol) values ('00000000-0000-0000-0000-0000000000aa', 'Ana', 'LIDER')
    `)
    const pendiente = await filas(
      `select id from public.alertas_cargo where estado = 'PENDIENTE' limit 1`
    )
    await db.query(`update public.alertas_cargo set atendida_por = $1 where id = $2`, [
      '00000000-0000-0000-0000-0000000000aa',
      pendiente[0].id
    ])
    await db.query(`delete from auth.users where id = '${perfil[0].id}'`)

    const trasBorrar = await filas(
      `select atendida_por from public.alertas_cargo where id = '${pendiente[0].id}'`
    )
    expect(trasBorrar[0].atendida_por).toBeNull()
  })
})
