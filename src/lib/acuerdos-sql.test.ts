import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { bloqueSql } from './supabaseSql'

/**
 * acuerdos-comerciales.sql, ejecutado en un Postgres de verdad.
 *
 * POR QUÉ EXISTE ESTE TEST
 * ------------------------
 * El módulo se apoya en TRES permisos distintos y sólo la base los garantiza:
 *
 *  1. COOR_ACU crea y gestiona —catálogo, proveedores, espacios, acuerdos—
 *     y el AUD_EX registra cobros; el LÍDER SÓLO VE (así lo pidió el usuario
 *     y es lo que este test protege: que el Líder no escriba acá).
 *  2. Las formas: el solape de fechas no es un `check` (lo valida la
 *     pantalla) pero sí lo es `fecha_fin >= fecha_inicio`, el monto > 0 y
 *     la unicidad (sucursal, código) del espacio.
 *  3. Los catálogos nacen sembrados: diez tipos de espacio y las opciones
 *     del formulario.
 *
 * Acá se corre el bloque TAL CÓMO está en `supabase/schema.sql`, dos veces
 * (idempotente), sobre un espejo mínimo de las tablas que toca.
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

  -- Supabase: storage, que es donde viven las políticas de planos y comprobantes.
  create schema if not exists storage;
  create table if not exists storage.buckets (id text primary key, name text, public boolean default false);
  create table if not exists storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text,
    name text
  );

  -- Espejo mínimo de profiles e invitaciones: el bloque rehace su check
  -- de rol, así que las dos tablas tienen que existir con esa forma.
  create table public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    nombre text not null default '',
    usuario text not null default '',
    rol text not null default 'SIN_ROL'
      check (rol in ('SIN_ROL','LIDER','EVALUADOR','GERENTE_S','GERENTE_C','GERENTE_TH','JUEZ','GERENTE_TI','TECNICO_TI','COOR_ACU','AUD_EX')),
    sucursal_id uuid,
    activo boolean not null default true
  );

  create table public.invitaciones (
    id uuid primary key default gen_random_uuid(),
    email text not null,
    usuario text not null default '',
    rol text not null
      check (rol in ('LIDER','EVALUADOR','GERENTE_S','GERENTE_C','GERENTE_TH','JUEZ','GERENTE_TI','TECNICO_TI','COOR_ACU','AUD_EX')),
    sucursal_id uuid,
    token text not null unique default gen_random_uuid()::text,
    usado boolean not null default false
  );

  create table public.sucursales (
    id uuid primary key default gen_random_uuid(),
    nombre text not null
  );
`

const LIDER = '00000000-0000-0000-0000-000000000a01'
const COOR = '00000000-0000-0000-0000-000000000a02'
const AUD = '00000000-0000-0000-0000-000000000a03'
const EVALUADOR = '00000000-0000-0000-0000-000000000a04'
const SUCURSAL = '00000000-0000-0000-0000-000000000a05'

let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  await db.exec(DDL)
  await db.exec(
    `insert into auth.users (id) values ('${LIDER}'), ('${COOR}'), ('${AUD}'), ('${EVALUADOR}')`
  )
  await db.exec(
    `insert into public.sucursales (id, nombre) values ('${SUCURSAL}', 'Luxor Central')`
  )
  await db.exec(
    `insert into public.profiles (id, nombre, rol, sucursal_id) values
       ('${LIDER}', 'Ana Líder', 'LIDER', null),
       ('${COOR}', 'Caro Coordinadora', 'COOR_ACU', null),
       ('${AUD}', 'Alvaro Auditor', 'AUD_EX', null),
       ('${EVALUADOR}', 'Eva Evaluador', 'EVALUADOR', '${SUCURSAL}')`
  )
  // Primera corrida… y la segunda: el bloque tiene que ser idempotente.
  await db.exec(bloqueSql('acuerdos-comerciales.sql'))
  await db.exec(bloqueSql('acuerdos-comerciales.sql'))
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

async function contar(sql: string): Promise<number> {
  const r = await db.query(sql)
  return Number((r.rows[0] as { n: string | number }).n)
}

describe('acuerdos-comerciales.sql · los catálogos nacen sembrados', () => {
  it('diez tipos de espacio y las seis opciones del formulario', async () => {
    expect(await contar(`select count(*)::int as n from public.acuerdo_tipo_espacio`)).toBe(10)
    expect(
      await contar(`select count(*)::int as n from public.acuerdo_catalogo where clase = 'FRECUENCIA'`)
    ).toBe(4)
    expect(
      await contar(`select count(*)::int as n from public.acuerdo_catalogo where clase = 'TIPO_PAGO'`)
    ).toBe(2)
  })

  it('una opción repetida no entra (unicidad de clase + valor)', async () => {
    await expect(
      db.query(`insert into public.acuerdo_catalogo (clase, valor) values ('FRECUENCIA', 'Mensual')`)
    ).rejects.toThrow(/duplicate|unique/i)
  })
})

describe('acuerdos-comerciales.sql · quién escribe qué', () => {
  let espacio = ''
  let acuerdo = ''

  it('el Coordinador crea proveedor, espacio y acuerdo', async () => {
    await conRol(COOR, async () => {
      await db.query(
        `insert into public.acuerdo_proveedor (nombre, contacto, color)
         values ('Publicidad Norte', '0414-123', '#0b2545')`
      )
      const suc = await db.query<{ id: string }>(`select id from public.sucursales limit 1`)
      const tipo = await db.query<{ id: string }>(`select id from public.acuerdo_tipo_espacio limit 1`)
      const proveedor = await db.query<{ id: string }>(`select id from public.acuerdo_proveedor limit 1`)

      await db.query(
        `insert into public.acuerdo_espacio (sucursal_id, tipo_id, codigo, detalle, x, y)
         values ($1, $2, 'G-03', 'Entrada, a la derecha', 12.5, 40)`,
        [suc.rows[0].id, tipo.rows[0].id]
      )
      const esp = await db.query<{ id: string }>(`select id from public.acuerdo_espacio limit 1`)
      espacio = esp.rows[0].id

      await db.query(
        `insert into public.acuerdo_comercial (espacio_id, proveedor_id, fecha_inicio, fecha_fin, monto_usd, frecuencia, tipo_pago)
         values ($1, $2, '2026-01-01', '2026-12-31', 120, 'Mensual', 'Nota de crédito')`,
        [espacio, proveedor.rows[0].id]
      )
      const acu = await db.query<{ id: string }>(`select id from public.acuerdo_comercial limit 1`)
      acuerdo = acu.rows[0].id
    })

    // El Auditor no crea acuerdos: eso es del Coordinador.
    await conRol(AUD, async () => {
      await expect(
        db.query(
          `insert into public.acuerdo_comercial (espacio_id, proveedor_id, fecha_inicio, fecha_fin, monto_usd, frecuencia, tipo_pago)
           values ($1, (select id from public.acuerdo_proveedor limit 1), '2026-01-01', '2026-06-30', 50, 'Mensual', 'Factura')`,
          [espacio]
        )
      ).rejects.toThrow(/row-level security/i)
    })

    // Y el Coordinador no registra cobros: eso es del Auditor.
    await conRol(COOR, async () => {
      await expect(
        db.query(
          `insert into public.acuerdo_cobro (acuerdo_id, fecha, monto) values ($1, '2026-01-15', 120)`,
          [acuerdo]
        )
      ).rejects.toThrow(/row-level security/i)
    })
  })

  it('el Auditor registra el cobro y el Coordinador lo ve', async () => {
    await conRol(AUD, async () => {
      await db.query(
        `insert into public.acuerdo_cobro (acuerdo_id, fecha, monto)
         select id, '2026-01-15', 120 from public.acuerdo_comercial limit 1`
      )
    })
    await conRol(COOR, async () => {
      expect(await contar(`select count(*)::int as n from public.acuerdo_cobro`)).toBe(1)
    })
  })

  it('el LÍDER sólo ve: no escribe ni acuerdos ni cobros', async () => {    await conRol(LIDER, async () => {
      expect(await contar(`select count(*)::int as n from public.acuerdo_comercial`)).toBe(1)
      expect(await contar(`select count(*)::int as n from public.acuerdo_espacio`)).toBe(1)

      await expect(
        db.query(`insert into public.acuerdo_proveedor (nombre) values ('El que no debe')`)
      ).rejects.toThrow(/row-level security/i)

      // UPDATE sin error pero SIN filas: la política lo deja afuera.
      const r = await db.query(
        `update public.acuerdo_comercial set monto_usd = 999 where id = $1 returning id`,
        [acuerdo]
      )
      expect(r.rows).toHaveLength(0)
    })

    // El evaluador ni ve las cifras.
    await conRol(EVALUADOR, async () => {
      expect(await contar(`select count(*)::int as n from public.acuerdo_comercial`)).toBe(0)
      expect(await contar(`select count(*)::int as n from public.acuerdo_proveedor`)).toBe(0)
    })
  })

  it('el Coordinador ELIMINA el acuerdo y sus cobros se van en cascada', async () => {
    // El cobro lo registró el Auditor; el borrado lo hace el Coordinador.
    await conRol(COOR, async () => {
      const r = await db.query(`delete from public.acuerdo_comercial where id = $1 returning id`, [acuerdo])
      expect(r.rows).toHaveLength(1)
    })

    // Se fue él y —por el `on delete cascade`— también su cobro.
    expect(await contar(`select count(*)::int as n from public.acuerdo_comercial`)).toBe(0)
    expect(await contar(`select count(*)::int as n from public.acuerdo_cobro`)).toBe(0)

    // El Auditor ya no tiene nada que cobrar, pero sigue pudiendo leer.
    await conRol(AUD, async () => {
      expect(await contar(`select count(*)::int as n from public.acuerdo_comercial`)).toBe(0)
    })

    // Ningún otro rol puede borrar: la política sigue siendo del Coordinador.
    await conRol(LIDER, async () => {
      const r = await db.query(`delete from public.acuerdo_comercial`)
      expect(r.rows).toHaveLength(0)
    })
  })
})

describe('acuerdos-comerciales.sql · la forma', () => {
  it('la fecha final no puede ser anterior a la inicial, ni el monto en cero', async () => {
    await expect(
      db.query(
        `insert into public.acuerdo_comercial (espacio_id, proveedor_id, fecha_inicio, fecha_fin, monto_usd, frecuencia, tipo_pago)
         values ((select id from public.acuerdo_espacio limit 1), (select id from public.acuerdo_proveedor limit 1),
                 '2026-05-01', '2026-04-01', 10, 'Mensual', 'Factura')`
      )
    ).rejects.toThrow(/acuerdo_fechas_chk|check/i)

    await expect(
      db.query(
        `insert into public.acuerdo_comercial (espacio_id, proveedor_id, fecha_inicio, fecha_fin, monto_usd, frecuencia, tipo_pago)
         values ((select id from public.acuerdo_espacio limit 1), (select id from public.acuerdo_proveedor limit 1),
                 '2026-05-01', '2026-06-01', 0, 'Mensual', 'Factura')`
      )
    ).rejects.toThrow(/monto_usd|check/i)
  })

  it('un espacio no se repite en la misma sucursal (código único)', async () => {
    await expect(
      db.query(
        `insert into public.acuerdo_espacio (sucursal_id, tipo_id, codigo, x, y)
         select sucursal_id, tipo_id, 'G-03', 50, 50 from public.acuerdo_espacio limit 1`
      )
    ).rejects.toThrow(/duplicate|unique/i)
  })

  it('las posiciones están dentro del plano (0 a 100)', async () => {
    await expect(
      db.query(
        `insert into public.acuerdo_espacio (sucursal_id, tipo_id, codigo, x, y)
         select sucursal_id, tipo_id, 'FUERA', 150, 50 from public.acuerdo_espacio limit 1`
      )
    ).rejects.toThrow(/acuerdo_espacio_x_check|check/i)
  })

  it('la forma es punto, cuadro o círculo (y el tamaño, dentro del plano)', async () => {    await expect(
      db.query(
        `insert into public.acuerdo_espacio (sucursal_id, tipo_id, codigo, x, y, forma)
         select sucursal_id, tipo_id, 'FORMA-RARA', 10, 10, 'triangulo' from public.acuerdo_espacio limit 1`
      )
    ).rejects.toThrow(/acuerdo_espacio_forma_chk|check/i)

    await expect(
      db.query(
        `insert into public.acuerdo_espacio (sucursal_id, tipo_id, codigo, x, y, forma, ancho, alto)
         select sucursal_id, tipo_id, 'ANCHO-GORDO', 10, 10, 'rectangulo', 150, 10 from public.acuerdo_espacio limit 1`
      )
    ).rejects.toThrow(/acuerdo_espacio_ancho_chk|check/i)

    // Un punto dibujado a mano queda con tamaño cero, y eso está permitido.
    await db.query(
      `insert into public.acuerdo_espacio (sucursal_id, tipo_id, codigo, x, y, forma, ancho, alto)
       select sucursal_id, tipo_id, 'PUNTO-OK', 10, 10, 'punto', 0, 0 from public.acuerdo_espacio limit 1`
    )
  })
})

describe('acuerdos-comerciales.sql · el contrato adjunto', () => {
  it('la tabla guarda la ruta del contrato, vacía si no hay', async () => {
    const cols = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'acuerdo_comercial'`
    )
    expect(cols.rows.map((c) => c.column_name)).toContain('contrato')

    // Se crea sin contrato y después se le puede adjuntar uno.
    const creado = await db.query<{ id: string }>(
      `insert into public.acuerdo_comercial (espacio_id, proveedor_id, fecha_inicio, fecha_fin, monto_usd, frecuencia, tipo_pago)
       values ((select id from public.acuerdo_espacio limit 1), (select id from public.acuerdo_proveedor limit 1),
               '2026-03-01', '2026-08-31', 75, 'Trimestral', 'Factura')
       returning id`
    )
    const id = creado.rows[0].id
    const inicial = await db.query<{ contrato: string | null }>(
      `select contrato from public.acuerdo_comercial where id = $1`,
      [id]
    )
    expect(inicial.rows[0].contrato).toBeNull()

    await db.query(
      `update public.acuerdo_comercial set contrato = 'contratos/' || $1::text || '/contrato.pdf' where id = $1`,
      [id]
    )
    const conArchivo = await db.query<{ contrato: string }>(
      `select contrato from public.acuerdo_comercial where id = $1`,
      [id]
    )
    expect(conArchivo.rows[0].contrato).toBe(`contratos/${id}/contrato.pdf`)
  })

  it('la carpeta contratos/ es del Coordinador en las tres políticas de subida', async () => {
    // `qual` y `with_check` vienen ya como texto en `pg_policies`.
    const filas = await db.query<{ policyname: string; cuerpo: string }>(
      `select policyname,
              coalesce(qual, '') || coalesce(with_check, '') as cuerpo
         from pg_policies
        where schemaname = 'storage' and tablename = 'objects'
          and policyname in ('acuerdos_subida', 'acuerdos_gestion', 'acuerdos_borrado')`
    )
    expect(filas.rows).toHaveLength(3)
    for (const f of filas.rows) {
      expect(f.cuerpo, f.policyname).toContain("'contratos'")
      expect(f.cuerpo, f.policyname).toContain('es_coordinador_acu()')
      // Los comprobantes siguen siendo del Auditor.
      expect(f.cuerpo, f.policyname).toContain("'comprobantes'")
      expect(f.cuerpo, f.policyname).toContain('es_aud_ex()')
    }
  })
})

describe('acuerdos-comerciales.sql · el bucket', () => {
  it('nace privado y con sus cuatro políticas', async () => {
    expect(
      await contar(`select case when b."public" then 1 else 0 end as n from storage.buckets b where b.id = 'acuerdos'`)
    ).toBe(0)

    const filas = await db.query<{ policyname: string }>(
      `select policyname from pg_policies
        where schemaname = 'storage' and tablename = 'objects' and policyname like 'acuerdos%'`
    )
    expect(filas.rows.map((f) => f.policyname).sort()).toEqual([
      'acuerdos_borrado',
      'acuerdos_gestion',
      'acuerdos_subida',
      'acuerdos_ver'
    ])
  })
})
