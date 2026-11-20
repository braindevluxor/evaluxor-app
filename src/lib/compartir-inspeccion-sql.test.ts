import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { bloqueSql } from './supabaseSql'

/**
 * El enlace público de una inspección, ejecutado en un Postgres de verdad.
 *
 * Es el espejo de `compartir-cargos-sql.test.ts` (y de `compartir-sql.test.ts`):
 * las tres pantallas públicas son el mismo contrato con distinto contenido —
 * una tabla cerrada a `anon`, RLS que sólo deja ver a quien ya podía ver el
 * registro, y UNA función `security definer` como única puerta, con el token
 * como autorización.
 *
 * Lo que importa acá y no en otro lado:
 *
 *  1. Que `anon` NO tenga privilegio de tabla y que la función sí se pueda
 *     llamar: es lo que hace que el QR del PDF sirva sin cuenta.
 *  2. Que el detalle viaje CONGELADO: lo que se guardó es lo que se lee,
 *     aunque el registro cambie después.
 *  3. Que token equivocado y enlace apagado sean indistinguibles.
 *  4. Quién puede generar un enlace: el dueño de la inspección o el Líder.
 *
 * Acá se corre el bloque TAL CUAL se le pega al SQL Editor, dos veces (tiene
 * que ser idempotente).
 */

const DDL = `
  -- Roles de Supabase: sin ellos el revoke del archivo falla.
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

  create table public.profiles (id uuid primary key, nombre text);

  -- Como la base real: todo autenticado nace con permiso de tabla y anon
  -- lo pierde con el alter default privileges ... revoke de
  -- cerrar-permisos-anon.sql, que corre antes que este bloque.
  do $$ begin
    grant usage on schema public to anon, authenticated;
    alter default privileges in schema public grant all on tables to authenticated;
    alter default privileges in schema public revoke all on tables from anon;
  end $$;

  -- La cerradura del resto de la consola (sale del bloque raíz en la base
  -- real): el bloque sólo la USA en sus políticas.
  create function public.es_lider() returns boolean
  language sql stable as $$ select false $$;

  -- Espejo mínimo de la revisión: sólo lo que tocan las políticas del
  -- bloque (el id y QUIÉN la hizo).
  create table public.revision_pre_entrega (
    id uuid primary key,
    evaluador_id uuid
  );
`

const EVALUADOR = '33333333-3333-3333-3333-333333333333'
const OTRO = '44444444-4444-4444-4444-444444444444'
const REVISION = '55555555-5555-5555-5555-555555555555'
/** Otra revisión del MISMO dueño, para probar la inserción sin chocar con la PK. */
const REVISION_B = '66666666-6666-6666-6666-666666666666'
const TOKEN = 'b'.repeat(64)

/** El detalle congelado: lo que el QR de la hoja lleva adentro. */
const DETALLE = JSON.stringify({
  titulo: 'Inspección de vehículo',
  fecha: '2026-11-20',
  evaluador: 'Rita Evaluadora',
  observaciones: 'Sin novedades',
  vehiculo: { placa: 'ABC123', marca: 'Toyota' },
  persona: { cedula: 'V-12345678', nombre: 'Juan' },
  items: [{ etiqueta: 'Documentación · SOAT vigente', valor: 'Cumple', grupo: 'Documentación' }],
  evidencias: [{ pie: 'SOAT', rutas: ['ev/r1/evidencia/soat.jpg'] }],
  fotosFirmadas: { 'ev/r1/evidencia/soat.jpg': 'https://storage.test/soat?token=x' }
})

let db: PGlite

/** Llama al RPC y devuelve el objeto jsonb que sale. */
async function llamar(token: string): Promise<Record<string, unknown>> {
  const { rows } = await db.query<{ r: Record<string, unknown> }>(
    'select public.ver_inspeccion_compartida($1) as r',
    [token]
  )
  return rows[0].r
}

/** La sesión se hace pasar por este usuario: es lo que `auth.uid()` devuelve. */
async function como(usuario: string | null): Promise<void> {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [usuario ?? ''])
}

/** Baja a `authenticated` para que el RLS se aplique de verdad. */
async function conRol(usuario: string, fn: () => Promise<void>): Promise<void> {
  await como(usuario)
  await db.exec('set role authenticated')
  try {
    await fn()
  } finally {
    await db.exec('reset role')
    await como(null)
  }
}

beforeAll(async () => {
  db = await PGlite.create()
  await db.exec(DDL)
  await db.exec(
    `insert into public.profiles (id, nombre) values
       ('${EVALUADOR}', 'Rita Evaluadora'), ('${OTRO}', 'Juan Terceño')`
  )
  await db.exec(`insert into public.revision_pre_entrega values ('${REVISION}', '${EVALUADOR}')`)
  await db.exec(`insert into public.revision_pre_entrega values ('${REVISION_B}', '${EVALUADOR}')`)
  // Dos veces: el bloque tiene que ser idempotente.
  await db.exec(bloqueSql('compartir-inspeccion.sql'))
  await db.exec(bloqueSql('compartir-inspeccion.sql'))
  await db.exec(
    `insert into public.inspecciones_compartidas
       (revision_id, token, datos, activo, creado_por)
     values ('${REVISION}', '${TOKEN}', '${DETALLE.replace(/'/g, "''")}'::jsonb, true, '${EVALUADOR}')`
  )
}, 120_000)

afterAll(async () => {
  await db?.close()
})

describe('compartir-inspeccion.sql · la tabla y sus permisos', () => {
  it('anon no tiene privilegio de tabla, pero la función sí se puede llamar', async () => {
    const tabla = await db.query<{ anon_select: boolean; rls: boolean; politicas: number }>(`
      select
        has_table_privilege('anon', c.oid, 'select') as anon_select,
        c.relrowsecurity as rls,
        (select count(*)::int from pg_policies pp
          where pp.schemaname = 'public' and pp.tablename = c.relname) as politicas
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'inspecciones_compartidas'
    `)
    expect(tabla.rows[0].anon_select).toBe(false)
    expect(tabla.rows[0].rls).toBe(true)
    // select + gestión (all): dos, sin delete aparte porque `for all` lo incluye.
    expect(tabla.rows[0].politicas).toBe(2)

    // ÉSE es el permiso que hace que el QR sirva sin cuenta.
    const funcion = await db.query<{ anon: boolean }>(`
      select has_function_privilege('anon', 'public.ver_inspeccion_compartida(text)', 'execute') as anon
    `)
    expect(funcion.rows[0].anon).toBe(true)
  })

  it('es SECURITY DEFINER con search_path fijo', async () => {
    const { rows } = await db.query<{ definer: boolean; search_path: boolean }>(`
      select p.prosecdef as definer,
             coalesce(p.proconfig::text, '') like '%search_path%' as search_path
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'ver_inspeccion_compartida'
    `)
    expect(rows).toHaveLength(1)
    expect(rows[0].definer).toBe(true)
    expect(rows[0].search_path).toBe(true)
  })
})

describe('ver_inspeccion_compartida · contra un Postgres real', () => {
  it('con el token correcto devuelve el detalle CONGELADO', async () => {
    const paquete = await llamar(TOKEN)
    const datos = paquete.datos as Record<string, unknown>
    expect(datos).toBeTruthy()
    expect(datos.titulo).toBe('Inspección de vehículo')
    expect(datos.vehiculo).toEqual({ placa: 'ABC123', marca: 'Toyota' })
    // Lo que se guardó es lo que se lee: los comentarios y las rutas de las
    // fotos viajan tal cual, con sus URLs firmadas.
    expect(datos.items).toEqual([
      { etiqueta: 'Documentación · SOAT vigente', valor: 'Cumple', grupo: 'Documentación' }
    ])
    expect(datos.fotosFirmadas).toEqual({ 'ev/r1/evidencia/soat.jpg': 'https://storage.test/soat?token=x' })
    expect(paquete.generado).toBeTruthy()
  })

  it('token equivocado y enlace apagado devuelven lo mismo', async () => {
    // Si se distinguieran, se podría adivinar un token comparando respuestas.
    const malo = await llamar('c'.repeat(64))
    expect(malo.datos).toBeNull()

    await db.exec(
      `update public.inspecciones_compartidas set activo = false where token = '${TOKEN}'`
    )
    const apagado = await llamar(TOKEN)
    expect(apagado.datos).toBeNull()

    await db.exec(
      `update public.inspecciones_compartidas set activo = true where token = '${TOKEN}'`
    )
  })

  it('el dueño de la inspección ve su enlace; un tercero no', async () => {
    await conRol(EVALUADOR, async () => {
      const ve = await db.query(
        `select token from public.inspecciones_compartidas where revision_id = '${REVISION}'`
      )
      expect(ve.rows).toHaveLength(1)
    })

    await conRol(OTRO, async () => {
      const ve = await db.query(
        `select token from public.inspecciones_compartidas where revision_id = '${REVISION}'`
      )
      expect(ve.rows, 'un tercero no ve los enlaces de una inspección ajena').toHaveLength(0)
    })
  })

  it('generar el enlace es del dueño o del Líder; un tercero no puede', async () => {
    // Token distinto en cada intento: también es único, y chocaría antes
    // que la política que se quiere probar.
    const generar = (revision: string) =>
      db.query(
        `insert into public.inspecciones_compartidas (revision_id, token, datos)
         values ($1, $2, '{}'::jsonb)`,
        [revision, crypto.randomUUID()]
      )
    const limpiar = () =>
      db.query(`delete from public.inspecciones_compartidas where revision_id = '${REVISION_B}'`)

    // El dueño sí (la sesión es la del evaluador de la revisión)…
    await conRol(EVALUADOR, async () => {
      await expect(generar(REVISION_B)).resolves.toBeTruthy()
      await limpiar()
    })
    // …el Líder también (`es_lider` en la política)…
    await db.exec(
      `create or replace function public.es_lider() returns boolean language sql stable as $$ select true $$`
    )
    await conRol(OTRO, async () => {
      await expect(generar(REVISION_B)).resolves.toBeTruthy()
      await limpiar()
    })
    await db.exec(
      `create or replace function public.es_lider() returns boolean language sql stable as $$ select false $$`
    )
    // …y un tercero, no: RLS rechaza el INSERT, no lo filtra en silencio.
    await conRol(OTRO, async () => {
      await expect(generar(REVISION_B)).rejects.toThrow(/row-level security/i)
    })
  })
})
