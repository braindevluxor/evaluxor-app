import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { bloqueSql } from './supabaseSql'

/**
 * El enlace público de fallas por cargo, ejecutado en un Postgres de verdad.
 *
 * Espejo de `compartir-sql.test.ts` (el de conciliación) porque las dos
 * pantallas públicas son el mismo contrato con distinto contenido: una tabla
 * cerrada a `anon`, RLS que sólo deja ver a quien ya podía ver la evaluación,
 * y UNA función `security definer` como única puerta, con el token como
 * autorización.
 *
 * Acá se corre el bloque TAL CUAL se le pega al SQL Editor contra un
 * PostgreSQL 18 en memoria (@electric-sql/pglite): si el archivo no compila
 * —un CTE mal aliasado, una columna que la tabla no tiene—, este test falla
 * antes de que llegue a la base de nadie.
 *
 * El espejo de abajo es mínimo y, a propósito, `evaluaciones` NO tiene
 * `created_at`: es como está la tabla real del cliente, así que el RPC no
 * puede nombrarla.
 */

const DDL = `
  -- Roles de Supabase: sin ellos el revoke del archivo falla.
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  end $$;

  create table public.profiles (id uuid primary key, nombre text);

  create table public.sucursales (
    id uuid primary key, nombre text, shop_id text, branch_id text, direccion text
  );

  create table public.departamentos_centralizados (id uuid primary key, nombre text);

  -- A PROPOSITO SIN created_at: es como esta la tabla real del cliente.
  create table public.evaluaciones (
    id uuid primary key,
    sucursal_id uuid,
    departamento_id uuid,
    aperturada_por uuid,
    fecha date,
    estado text,
    puntuacion numeric,
    comentario_general text,
    cerrada_en timestamptz
  );

  create function public.es_lider() returns boolean
  language sql stable as $$ select true $$;

  create function public.puede_ver_evaluacion(e public.evaluaciones) returns boolean
  language sql stable as $$ select true $$;
`

const EV = '11111111-1111-1111-1111-111111111111'
const TOKEN = 'a'.repeat(64)
const SUCURSAL = '22222222-2222-2222-2222-222222222222'

/** El reporte congelado: sólo lo que la pantalla pública pinta. */
const REPORTE = JSON.stringify({
  unidad: 'Sucursal Norte',
  fecha: '2026-10-12',
  puntajeGeneral: 80,
  cargos: [
    {
      cargo: 'Depositaría',
      porciento: 62,
      perdidos: 6,
      pendientes: [
        {
          item: 'Refrigeración',
          modulo: 'Higiene',
          tipo: 'CHECKLIST',
          perdidos: 6,
          checks: ['Sellos sin fugas'],
          puntos: [6],
          evidencias: [],
          historial: { 'Sellos sin fugas': { faltas: 3, reincidencias: 2, esReincidente: true } },
          fotos: ['ev/ev1/sellos.jpg']
        }
      ]
    }
  ]
})

const DATOS = `
  insert into public.sucursales values ('${SUCURSAL}', 'Sucursal Norte', null, null, null);
  insert into public.evaluaciones
    values ('${EV}', '${SUCURSAL}', null, null, '2026-10-12', 'ACTIVA', 80, null, null);
  insert into public.cargos_compartidos
    values ('${EV}', '${TOKEN}', '${REPORTE.replace(/'/g, "''")}'::jsonb, true, null, now());
`

let db: PGlite

/** Llama al RPC y devuelve el objeto jsonb que sale. */
async function llamar(token: string): Promise<Record<string, unknown>> {
  const { rows } = await db.query<{ r: Record<string, unknown> }>(
    'select public.ver_cargos_compartidos($1) as r',
    [token]
  )
  return rows[0].r
}

beforeAll(async () => {
  db = await PGlite.create()
  await db.exec(DDL)
  // El bloque completo, con sus begin/commit y las tres consultas de
  // verificación del final: si alguna falla, esto explota acá.
  await db.exec(bloqueSql('compartir-cargos.sql'))
  await db.exec(DATOS)
}, 120_000)

afterAll(async () => {
  await db?.close()
})

describe('ver_cargos_compartidos · contra un Postgres real', () => {
  it('crea la tabla cerrada: anon sin permiso, RLS encendido y dos políticas', async () => {
    const { rows } = await db.query<{ anon_select: boolean; rls: boolean; politicas: number }>(`
      select
        has_table_privilege('anon', c.oid, 'select') as anon_select,
        c.relrowsecurity as rls,
        (select count(*)::int from pg_policies pp
          where pp.schemaname = 'public' and pp.tablename = c.relname) as politicas
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'cargos_compartidos'
    `)
    expect(rows[0].anon_select).toBe(false)
    expect(rows[0].rls).toBe(true)
    // Quien ya puede ver la evaluación, y el Líder que gestiona el enlace.
    expect(rows[0].politicas).toBe(2)
  })

  it('la función está abierta a las dos sesiones y cerrada a PUBLIC', async () => {
    const { rows } = await db.query<{ anon: boolean; sesion: boolean; publico: boolean }>(`
      select
        has_function_privilege('anon', 'public.ver_cargos_compartidos(text)', 'execute') as anon,
        has_function_privilege('authenticated', 'public.ver_cargos_compartidos(text)', 'execute') as sesion,
        has_function_privilege('public', 'public.ver_cargos_compartidos(text)', 'execute') as publico
    `)
    expect(rows[0].anon).toBe(true)
    expect(rows[0].sesion).toBe(true)
    // El revoke tiene que ir con PUBLIC: los permisos son aditivos.
    expect(rows[0].publico).toBe(false)
  })

  it('con el token correcto devuelve la evaluación y el reporte congelado', async () => {
    const r = await llamar(TOKEN)
    const ev = r.evaluacion as Record<string, unknown>
    expect(ev.id).toBe(EV)
    expect(ev.estado).toBe('ACTIVA')
    expect(ev.fecha).toBe('2026-10-12')
    expect((ev.sucursal as Record<string, unknown>).nombre).toBe('Sucursal Norte')
    // Sin departamento: la evaluación es de sucursal y la otra mitad queda vacía.
    expect(ev.departamento).toBeNull()

    // El reporte entero, tal cual lo generó la app.
    const datos = r.datos as { unidad: string; cargos: unknown[] }
    expect(datos.unidad).toBe('Sucursal Norte')
    expect(datos.cargos).toHaveLength(1)
    // Y cuándo se generó, que es lo que hace que se lea como una bitácora.
    expect(typeof r.generado).toBe('string')
  })

  it('no expone al evaluador ni respuestas sueltas', async () => {
    const r = await llamar(TOKEN)
    const ev = r.evaluacion as Record<string, unknown>
    // La promesa del enlace: no se ve quién evaluó.
    expect(ev.aperturada_por).toBeUndefined()
    expect(ev.abierta_en).toBeUndefined()
    // Sólo salen estos ocho campos: si mañana se agrega una columna a
    // `evaluaciones` no se filtra sola por `select *`.
    expect(Object.keys(ev).filter((k) => k !== 'sucursal' && k !== 'departamento').sort()).toEqual(
      [
        'id',
        'sucursal_id',
        'departamento_id',
        'fecha',
        'estado',
        'puntuacion',
        'comentario_general',
        'cerrada_en'
      ].sort()
    )
    // Ni respuestas ni ítems sueltos: el enlace sólo lleva el reporte.
    expect(r.respuestas).toBeUndefined()
    expect(r.items).toBeUndefined()
    expect(r.modulos).toBeUndefined()
  })

  it('un token inventado y uno apagado dan lo mismo: evaluación null', async () => {
    const malo = await llamar('b'.repeat(64))
    expect(malo.evaluacion).toBeNull()
    expect(malo.datos).toBeUndefined()

    // Apagar el enlace deja de servir sin tocar la evaluación.
    await db.exec('update public.cargos_compartidos set activo = false')
    const apagado = await llamar(TOKEN)
    expect(apagado.evaluacion).toBeNull()

    await db.exec('update public.cargos_compartidos set activo = true')
    expect((await llamar(TOKEN)).evaluacion).not.toBeNull()
  })
})
