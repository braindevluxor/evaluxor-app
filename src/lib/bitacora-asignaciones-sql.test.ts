import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { bloqueSql } from './supabaseSql'

/**
 * bitacora-asignaciones.sql, ejecutado en un Postgres de verdad.
 *
 * POR QUÉ EXISTE ESTE TEST
 * ------------------------
 * El bloque carga un trigger, que es la pieza que más fácil se rompe en silencio:
 * si la función no corre, nadie se entera — la app sigue guardando normal y el
 * historial simplemente queda vacío. Acá se comprueba que el trigger ESCRIBE,
 * y sobre todo tres cosas que sólo fallan en runtime:
 *
 *  1. **El guardado de la app no se rompe.** La función es SECURITY DEFINER
 *     y la bitácora no tiene política de INSERT: si el orden estuviera mal (el
 *     revoke antes del `create or replace`, o la función sin DEFINER) el Líder
 *     no podría guardar una asignación. Se prueba guardando de verdad.
 *  2. **Un UPDATE que no cambia nada no deja fila.** Es la decisión de diseño
 *     que más ruido evitaría si estuviera mal: cada guardado de la pantalla de
 *     configuración escribiría historial mudo.
 *  3. **El `case tg_op` no toca la rama equivocada.** En un DELETE `new` es
 *     null y en un INSERT `old` lo es: si la función los leyera sin mirar
 *     `tg_op`, el primer borrado revienta.
 *
 * Además, como todos los bloques del repo, se corre DOS VECES para probar la
 * idempotencia: la segunda no debe duplicar triggers ni tumbar nada.
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

  do $$ begin
    grant usage on schema public to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
  end $$;

  create table public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    nombre text,
    rol text not null default 'EVALUADOR',
    activo boolean not null default true
  );

  create or replace function public.es_lider()
  returns boolean language sql stable security definer set search_path = public as $$
    select exists (select 1 from public.profiles p where p.id = auth.uid() and p.rol = 'LIDER' and p.activo);
  $$;

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

  create table public.modulos (
    id uuid primary key default gen_random_uuid(),
    nombre text not null,
    activo boolean not null default true,
    created_at timestamptz not null default now()
  );

  -- Espejo mínimo de las cuatro tablas que el bloque instrumenta, copiado de
  -- schema.sql. Sólo las columnas que la función trigger lee: el id (para el
  -- registro_id) y las que cambian en un guardado real.
  create table public.asignaciones (
    id uuid primary key default gen_random_uuid(),
    evaluador_id uuid not null references public.profiles(id) on delete cascade,
    sucursal_id uuid not null references public.sucursales(id) on delete cascade,
    activa boolean not null default true,
    created_by uuid references public.profiles(id) on delete set null,
    created_at timestamptz not null default now(),
    unique (evaluador_id, sucursal_id)
  );

  create table public.asignaciones_modulos (
    id uuid primary key default gen_random_uuid(),
    evaluador_id uuid not null references public.profiles(id) on delete cascade,
    modulo_id uuid not null references public.modulos(id) on delete cascade,
    activa boolean not null default true,
    created_by uuid references public.profiles(id) on delete set null,
    created_at timestamptz not null default now(),
    unique (evaluador_id, modulo_id)
  );

  create table public.sucursal_modulos (
    id uuid primary key default gen_random_uuid(),
    sucursal_id uuid not null references public.sucursales(id) on delete cascade,
    modulo_id uuid not null references public.modulos(id) on delete cascade,
    activa boolean not null default true,
    created_at timestamptz not null default now(),
    unique (sucursal_id, modulo_id)
  );

  create table public.departamento_modulos (
    id uuid primary key default gen_random_uuid(),
    departamento_id uuid not null references public.departamentos_centralizados(id) on delete cascade,
    modulo_id uuid not null references public.modulos(id) on delete cascade,
    activa boolean not null default true,
    created_at timestamptz not null default now(),
    unique (departamento_id, modulo_id)
  );
`

const SUCURSAL = '00000000-0000-0000-0000-000000000001'
const DEPTO = '00000000-0000-0000-0000-00000000000d'
const MODULO = '00000000-0000-0000-0000-00000000f001'
const EVALUADOR = '00000000-0000-0000-0000-000000000e01'
const LIDER = '00000000-0000-0000-0000-000000001d01'

let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  await db.exec(DDL)
  await db.exec(`insert into public.sucursales (id, nombre) values ('${SUCURSAL}', 'Eva Centro')`)
  await db.exec(`insert into public.departamentos_centralizados (id, nombre) values ('${DEPTO}', 'Taller Automotriz')`)
  await db.exec(`insert into public.modulos (id, nombre) values ('${MODULO}', 'Inspección')`)
  // Los perfiles cuelgan de auth.users (FK): primero los usuarios de auth.
  await db.exec(
    `insert into auth.users (id) values ('${LIDER}'), ('${EVALUADOR}')`
  )
  await db.exec(
    `insert into public.profiles (id, nombre, rol) values
       ('${LIDER}', 'Ana Líder', 'LIDER'),
       ('${EVALUADOR}', 'Juan Evaluador', 'EVALUADOR')`
  )
  await db.exec(bloqueSql('bitacora-asignaciones.sql'))
  // Segunda corrida: tiene que seguir limpio, el bloque es idempotente.
  await db.exec(bloqueSql('bitacora-asignaciones.sql'))
})

afterAll(async () => {
  await db.close()
})

/** La sesión se hace pasar por este usuario: es lo que `auth.uid()` devuelve. */
async function como(usuario: string | null): Promise<void> {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [usuario ?? ''])
}

/**
 * Baja al rol `authenticated` para que el RLS se aplique de verdad.
 *
 * La conexión de pglite es `postgres`, que es el DUEÑO de las tablas, y el
 * dueño bypasea RLS salvo `FORCE ROW LEVEL SECURITY`. Sin este cambio, un
 * test de políticas leería todo aunque la política estuviera mal — que era
 * exactamente el falso positivo que obligó a escribirlo.
 */
async function comoRolNormal(): Promise<void> {
  await db.exec('set role authenticated')
}

/** Vuelve al rol de la conexión para poder seguir escribiendo el espejo. */
async function volverAlRolOriginal(): Promise<void> {
  await db.exec('reset role')
}

async function filas(sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
  const r = await db.query(sql, params)
  return r.rows as Record<string, unknown>[]
}

async function contar(sql: string, params: unknown[] = []): Promise<number> {
  const [f] = await filas(sql, params)
  return Number(f.n)
}

describe('bitacora-asignaciones.sql · el trigger escribe de verdad', () => {
  it('una alta queda registrada con la tabla, la fila y quien la hizo', async () => {
    await como(EVALUADOR)
    await db.query(
      `insert into public.asignaciones (evaluador_id, sucursal_id, created_by)
       values ($1, $2, $1)`,
      [EVALUADOR, SUCURSAL]
    )

    const filasBitacora = await filas(
      `select tabla, accion, registro_id, datos_previos, datos_nuevos, actor
       from public.bitacora_asignaciones order by created_at desc limit 1`
    )
    expect(filasBitacora).toHaveLength(1)
    expect(filasBitacora[0].tabla).toBe('asignaciones')
    expect(filasBitacora[0].accion).toBe('CREADO')
    expect(filasBitacora[0].actor).toBe(EVALUADOR)
    // Un CREADO no tiene previo: no hay nada que valía antes.
    expect(filasBitacora[0].datos_previos).toBeNull()
    // Y el nuevo trae la fila entera, con el `activa` en true.
    expect(filasBitacora[0].datos_nuevos).toMatchObject({ activa: true, evaluador_id: EVALUADOR })
  })

  it('desasignar queda registrado: es un UPDATE que nadie veía antes', async () => {
    await como(LIDER)
    // Así lo hace la app: no borra la fila, la apaga (ver configurarSucursalModulos).
    await db.query(`update public.asignaciones set activa = false where sucursal_id = $1`, [SUCURSAL])

    const [ultima] = await filas(
      `select accion, datos_previos, datos_nuevos, actor
       from public.bitacora_asignaciones order by created_at desc limit 1`
    )
    expect(ultima.accion).toBe('MODIFICADO')
    expect(ultima.actor).toBe(LIDER)
    // Las dos orillas: qué valía (true) y qué vale ahora (false).
    expect(ultima.datos_previos).toMatchObject({ activa: true })
    expect(ultima.datos_nuevos).toMatchObject({ activa: false })
  })

  it('un UPDATE que no cambia nada no deja fila en el historial', async () => {
    await como(LIDER)
    const antes = await contar(`select count(*)::int as n from public.bitacora_asignaciones`)
    // El mismo valor que ya tiene: no es un cambio.
    await db.query(`update public.asignaciones set activa = false where sucursal_id = $1`, [SUCURSAL])
    const despues = await contar(`select count(*)::int as n from public.bitacora_asignaciones`)
    expect(despues).toBe(antes)
  })

  it('un borrado se registra con la fila previa y sin la siguiente', async () => {
    await como(LIDER)
    await db.query(`delete from public.asignaciones where sucursal_id = $1`, [SUCURSAL])

    const [ultima] = await filas(
      `select accion, datos_previos, datos_nuevos from public.bitacora_asignaciones order by created_at desc limit 1`
    )
    expect(ultima.accion).toBe('ELIMINADO')
    expect(ultima.datos_previos).toMatchObject({ activa: false, sucursal_id: SUCURSAL })
    expect(ultima.datos_nuevos).toBeNull()
  })
})

describe('bitacora-asignaciones.sql · las cuatro tablas del alcance', () => {
  it('cada tabla de asignación tiene su trigger y deja su rastro', async () => {
    await como(EVALUADOR)

    await db.query(
      `insert into public.asignaciones_modulos (evaluador_id, modulo_id) values ($1, $2)`,
      [EVALUADOR, MODULO]
    )
    await db.query(
      `insert into public.sucursal_modulos (sucursal_id, modulo_id) values ($1, $2)`,
      [SUCURSAL, MODULO]
    )
    await db.query(
      `insert into public.departamento_modulos (departamento_id, modulo_id) values ($1, $2)`,
      [DEPTO, MODULO]
    )

    const tablas = await filas(
      `select distinct tabla from public.bitacora_asignaciones order by tabla`
    )
    expect(tablas.map((t) => t.tabla)).toEqual([
      'asignaciones',
      'asignaciones_modulos',
      'departamento_modulos',
      'sucursal_modulos'
    ])

    // Los cuatro triggers quedaron puestos tras la segunda corrida del bloque:
    // si la idempotencia fallara, `create trigger` sin el drop tiraría error.
    const triggers = await filas(
      `select count(*)::int as n from pg_trigger
       where tgname like 'trg_bitacora_%' and not tgisinternal`
    )
    expect(triggers[0].n).toBe(4)
  })

  it('la configuración por departamento deja la fila entera para leer', async () => {
    // Es el caso del Taller Automotriz: el Líder marca un módulo y después lo
    // desmarca. Con el `update activa` de la app, eso eran dos filas mudas.
    await como(LIDER)
    await db.query(
      `update public.departamento_modulos set activa = false where departamento_id = $1`,
      [DEPTO]
    )

    const historial = await filas(
      `select accion, datos_previos->>'activa' as antes, datos_nuevos->>'activa' as ahora
       from public.bitacora_asignaciones
       where tabla = 'departamento_modulos' order by created_at`
    )
    expect(historial).toHaveLength(2)
    expect(historial[0]).toMatchObject({ accion: 'CREADO', ahora: 'true' })
    expect(historial[1]).toMatchObject({ accion: 'MODIFICADO', antes: 'true', ahora: 'false' })
  })
})

describe('bitacora-asignaciones.sql · quién puede leerla y escribirla', () => {
  it('el Líder lee; un evaluador no', async () => {
    // Sin bajar de rol el owner bypasea RLS y los dos verían lo mismo.
    await comoRolNormal()

    await como(LIDER)
    const comoLider = await contar(
      `select count(*)::int as n from public.bitacora_asignaciones`
    )
    expect(comoLider).toBeGreaterThan(0)

    await como(EVALUADOR)
    const comoEvaluador = await contar(
      `select count(*)::int as n from public.bitacora_asignaciones`
    )
    // Cero: la política es `using (es_lider())`, no un filtro por fila, así
    // que para quien no es Líder no ve NADA del historial.
    expect(comoEvaluador).toBe(0)

    await volverAlRolOriginal()
  })

  it('nadie escribe desde la app: no hay política de INSERT', async () => {
    const politicas = await filas(
      `select cmd from pg_policies
       where tablename = 'bitacora_asignaciones' and schemaname = 'public'`
    )
    // Sólo la de lectura. Sin política de INSERT, UPDATE o DELETE, el RLS
    // bloquea cualquier escritura que no venga del trigger (SECURITY DEFINER).
    expect(politicas.map((p) => p.cmd)).toEqual(['SELECT'])
  })

  it('anon no puede ni leerla, aunque RLS quedara apagado', async () => {
    const acceso = await filas(
      `select has_table_privilege('anon', 'public.bitacora_asignaciones', 'SELECT') as puede`
    )
    expect(acceso[0].puede).toBe(false)
  })

  it('el trigger sí puede escribir: guardar una asignación no se rompe', async () => {
    // Esta es la aserción que protege el orden del revoke y el SECURITY
    // DEFINER. Si fallara, el Líder no podría guardar NINGUNA asignación.
    // Corre como rol normal, que es como lo hace la app.
    await comoRolNormal()
    await como(EVALUADOR)
    await expect(
      db.query(
        `insert into public.asignaciones_modulos (evaluador_id, modulo_id)
         values ($1, $2) on conflict do nothing`,
        [EVALUADOR, MODULO]
      )
    ).resolves.toBeTruthy()
    await volverAlRolOriginal()
  })

  it('el actor queda vacío si nadie está en sesión', async () => {
    // Un delete desde el SQL Editor (sin JWT): no se inventa un responsable.
    await como(null)
    await db.query(`delete from public.sucursal_modulos where sucursal_id = $1`, [SUCURSAL])
    const [ultima] = await filas(
      `select actor from public.bitacora_asignaciones order by created_at desc limit 1`
    )
    expect(ultima.actor).toBeNull()
  })
})
