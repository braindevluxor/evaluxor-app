import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { bloqueSql } from './supabaseSql'

/**
 * gran-cosecha.sql, ejecutado en un Postgres de verdad.
 *
 * POR QUÉ EXISTE ESTE TEST
 * ------------------------
 * El bloque carga reglas que sólo fallan cuando alguien guarda un dato
 * inválido o consulta con el rol equivocado:
 *
 *  1. El ROL JUEZ: el `check` de `profiles` e `invitaciones` se REHACE, así
 *     que probarlo es probar que el drop+add funcionó y que un rol inventado
 *     sigue fuera.
 *  2. Los `check` de negocio: mínimo 3 en el equipo, trimestre `2026-T1`…
 *     `2026-T4`, avance de 0 a 100 y título con contenido.
 *  3. RLS con `puede_gran_cosecha`: cualquiera crea el SUYO, sólo JUEZ y
 *     LÍDER editan el de otro, y NADIE borra (no hay política de delete).
 *  4. El TRIGGER de bitácora: que un update deje registro en la misma
 *     transacción, que lo escriba él y no la app, y que la app no pueda
 *     escribir la bitácora por su cuenta.
 *
 * Acá se corre el bloque TAL CUAL se pega al SQL Editor, dos veces (tiene
 * que ser idempotente: un `create trigger` sin `drop trigger if exists`
 * tumbaría la segunda corrida), contra un espejo mínimo de las tablas que
 * toca.
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

  do $$ begin
    grant usage on schema public to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
  end $$;

  -- Espejo mínimo: el bloque rehace el check de rol de estas DOS tablas,
  -- así que las dos tienen que existir con el constraint VIEJO (sin JUEZ),
  -- que es el estado real de una base ya creada.
  create table public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    email text not null default 'x@evaluxor.com',
    usuario text not null default '',
    nombre text not null default '',
    rol text not null default 'SIN_ROL'
      check (rol in ('SIN_ROL','LIDER','EVALUADOR','GERENTE_S','GERENTE_C','GERENTE_TH')),
    activo boolean not null default true
  );

  create table public.invitaciones (
    id uuid primary key default gen_random_uuid(),
    email text not null,
    usuario text not null default '',
    rol text not null check (rol in ('LIDER','EVALUADOR','GERENTE_S','GERENTE_C','GERENTE_TH')),
    token text not null unique default gen_random_uuid()::text
  );
`

const JUEZ = '00000000-0000-0000-0000-000000000001'
const LIDER = '00000000-0000-0000-0000-000000000002'
const EVALUADOR = '00000000-0000-0000-0000-000000000003'

let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  await db.exec(DDL)
  await db.exec(
    `insert into auth.users (id) values ('${JUEZ}'), ('${LIDER}'), ('${EVALUADOR}')`
  )
  await db.exec(
    `insert into public.profiles (id, nombre, rol) values
       ('${JUEZ}', 'Rita Juez', 'EVALUADOR'),
       ('${LIDER}', 'Ana Líder', 'LIDER'),
       ('${EVALUADOR}', 'Juan Trabajador', 'EVALUADOR')`
  )
  // Primera corrida… y la segunda, porque el bloque tiene que ser idempotente.
  await db.exec(bloqueSql('gran-cosecha.sql'))
  await db.exec(bloqueSql('gran-cosecha.sql'))

  // Ahora sí, el rol: se asigna DESPUÉS del bloque, que es justo lo que
  // cambió —antes el `check` viejo habría rechazado este update.
  await db.exec(`update public.profiles set rol = 'JUEZ' where id = '${JUEZ}'`)
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
 * `fn` en esa sesión. La conexión de pglite es `postgres`, que es el DUEÑO de
 * las tablas y bypasea RLS: sin este cambio un test de políticas leería todo
 * aunque la política estuviera mal.
 *
 * Siempre vuelve al rol original, también cuando la prueba falla.
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

/** Presenta un proyecto y devuelve su id, con equipo de 3 por defecto. */
async function presentar(valores: Record<string, unknown> = {}): Promise<string> {
  const fila: Record<string, unknown> = {
    periodo: '2026-T4',
    titulo: 'Huerto vertical',
    descripcion: 'Plantas en la tienda.',
    miembros: [
      { usuario_id: JUEZ, nombre: 'Rita Juez' },
      { usuario_id: LIDER, nombre: 'Ana Líder' },
      { usuario_id: EVALUADOR, nombre: 'Juan Trabajador' }
    ],
    avance: 0,
    estado: 'PROPUESTA',
    creador_id: EVALUADOR,
    ...valores
  }
  const columnas = Object.keys(fila)
  const r = await db.query(
    `insert into public.gran_cosecha_proyecto (${columnas.join(', ')})
     values (${columnas.map((_, i) => `$${i + 1}`).join(', ')})
     returning id`,
    columnas.map((c) => fila[c])
  )
  return (r.rows[0] as { id: string }).id
}

async function contar(sql: string, params: unknown[] = []): Promise<number> {
  const r = await db.query(sql, params)
  return Number((r.rows[0] as { n: string | number }).n)
}

describe('gran-cosecha.sql · el rol JUEZ', () => {
  it('el check de profiles acepta a JUEZ y sigue rechazando un rol inventado', async () => {
    // El bloque suelta el constraint viejo y lo vuelve a poner con JUEZ
    // adentro. Antes de eso, este INSERT habría fallado con 23514.
    const nueva = '00000000-0000-0000-0000-000000000010'
    await db.query(`insert into auth.users (id) values ($1)`, [nueva])
    await expect(
      db.query(`insert into public.profiles (id, nombre, rol) values ($1, 'Otro Juez', 'JUEZ')`, [nueva])
    ).resolves.toBeTruthy()

    const otra = '00000000-0000-0000-0000-000000000011'
    await db.query(`insert into auth.users (id) values ($1)`, [otra])
    await expect(
      db.query(`insert into public.profiles (id, nombre, rol) values ($1, 'Nadie', 'SUPERVISOR')`, [otra])
    ).rejects.toThrow(/check/i)
  })

  it('la invitación también se puede emitir para un juez', async () => {
    // Es la otra boca del mismo rol: con el check viejo el Líder no podría
    // ni invitar al juez.
    await expect(
      db.query(`insert into public.invitaciones (email, usuario, rol) values ('juez@x.com', 'ritaj', 'JUEZ')`)
    ).resolves.toBeTruthy()

    await expect(
      db.query(`insert into public.invitaciones (email, usuario, rol) values ('x@x.com', 'otro', 'SUPERVISOR')`)
    ).rejects.toThrow(/check/i)
  })
})

describe('gran-cosecha.sql · las reglas del proyecto', () => {
  it('el equipo es de a lo menos 3 personas', async () => {
    await expect(
      presentar({
        miembros: [
          { usuario_id: JUEZ, nombre: 'Rita' },
          { usuario_id: LIDER, nombre: 'Ana' }
        ]
      })
    ).rejects.toThrow(/check/i)
    await expect(presentar()).resolves.toBeTruthy()
  })

  it('el equipo no puede quedar por debajo de tres aunque se mande entero', async () => {
    // El mínimo es la ÚNICA regla del equipo que la base puede hacer sola:
    // un `check` no puede mirar dentro de un array (no admite subconsultas),
    // así que "sin repetidos" lo garantiza la app con `validarEquipo` —lo
    // prueba `granCosecha.test.ts`— y acá sólo se cubre lo de SQL.
    await expect(
      presentar({
        miembros: [
          { usuario_id: JUEZ, nombre: 'Rita' },
          { usuario_id: LIDER, nombre: 'Ana' },
          { usuario_id: EVALUADOR, nombre: 'Juan' },
          { usuario_id: EVALUADOR, nombre: 'Juan repetido' }
        ]
      })
    ).resolves.toBeTruthy()
  })

  it('el período es un trimestre del año', async () => {
    await expect(presentar({ periodo: '2026-T1' })).resolves.toBeTruthy()
    await expect(presentar({ periodo: '2026-T4' })).resolves.toBeTruthy()
    await expect(presentar({ periodo: '2026-T5' })).rejects.toThrow(/check/i)
    await expect(presentar({ periodo: '2026-11' })).rejects.toThrow(/check/i)
    await expect(presentar({ periodo: 'noviembre' })).rejects.toThrow(/check/i)
  })

  it('el avance va de 0 a 100 y el título no puede quedar vacío', async () => {
    await expect(presentar({ avance: 100 })).resolves.toBeTruthy()
    await expect(presentar({ avance: 101 })).rejects.toThrow(/check/i)
    await expect(presentar({ avance: -1 })).rejects.toThrow(/check/i)
    await expect(presentar({ titulo: '   ' })).rejects.toThrow(/check/i)
  })
})

describe('gran-cosecha.sql · quién entra', () => {
  it('puede_gran_cosecha deja pasar al Juez y al Líder, a nadie más', async () => {
    for (const [usuario, esperado] of [
      [JUEZ, true],
      [LIDER, true],
      [EVALUADOR, false]
    ] as const) {
      await como(usuario)
      const r = await db.query('select public.puede_gran_cosecha() as ok')
      expect((r.rows[0] as { ok: boolean }).ok, usuario).toBe(esperado)
    }
    await como(null)
  })

  it('cualquiera crea SU proyecto, pero no el de otro', async () => {
    await conRol(EVALUADOR, async () => {
      await expect(presentar({ creador_id: EVALUADOR })).resolves.toBeTruthy()
      // RLS con `with check`: mandar el id de otro hace que el INSERT ni
      // siquiera pase, sin que la pantalla tenga que controlarlo.
      await expect(presentar({ creador_id: LIDER })).rejects.toThrow()
    })
  })

  it('un trabajador no edita el proyecto de otro: no le toca ninguna fila', async () => {
    const ajeno = await presentar({ creador_id: LIDER })
    await conRol(EVALUADOR, async () => {
      const r = await db.query(
        `update public.gran_cosecha_proyecto set titulo = 'Ajenado' where id = $1 returning id`,
        [ajeno]
      )
      expect(r.rows).toHaveLength(0)
    })
    const sigue = await db.query(`select titulo from public.gran_cosecha_proyecto where id = $1`, [ajeno])
    expect((sigue.rows[0] as { titulo: string }).titulo).toBe('Huerto vertical')
  })

  it('nadie borra un proyecto: se cancela con estado', async () => {
    // Sin política de `delete`, RLS no deja pasar el borrado por más rol que
    // se tenga, y un delete en cascata se llevaría la bitácora con él.
    for (const usuario of [EVALUADOR, JUEZ, LIDER]) {
      const id = await presentar({ creador_id: EVALUADOR })
      await conRol(usuario, async () => {
        const r = await db.query(
          `delete from public.gran_cosecha_proyecto where id = $1 returning id`,
          [id]
        )
        expect(r.rows, `borró como ${usuario}`).toHaveLength(0)
      })
    }
    const quedan = await contar(`select count(*) as n from public.gran_cosecha_proyecto`)
    expect(quedan).toBeGreaterThan(0)
  })
})

describe('gran-cosecha.sql · la bitácora la escribe el trigger', () => {
  it('un alta deja una fila ALTA y con el autor de la sesión', async () => {
    // La sesión se pone a mano: el trigger guarda `auth.uid()`, no el
    // `creador_id`, así que sin fijarla el autor sería el usuario que dejó
    // encendida la sesión en la prueba anterior.
    await como(EVALUADOR)
    const id = await presentar()
    const filas = await db.query(
      `select tipo, autor_id, detalle from public.gran_cosecha_bitacora where proyecto_id = $1`,
      [id]
    )
    expect(filas.rows).toHaveLength(1)
    expect((filas.rows[0] as { tipo: string }).tipo).toBe('ALTA')
    // Se hizo pasar por el creador: es el que disparó el insert.
    expect((filas.rows[0] as { autor_id: string }).autor_id).toBe(EVALUADOR)
    expect(String((filas.rows[0] as { detalle: string }).detalle)).toContain('Huerto vertical')
    await como(null)
  })

  it('el bloque corre dos veces y el trigger escribe UNA fila, no dos', async () => {
    // Es la prueba de idempotencia que importa: si el `create trigger` no
    // estuviera precedido del `drop trigger if exists`, la segunda corrida
    // habría fallado… o peor, dejaría dos triggers y dos filas por cambio.
    const id = await presentar()
    await db.query(`update public.gran_cosecha_proyecto set avance = 10 where id = $1`, [id])
    const n = await contar(
      `select count(*) as n from public.gran_cosecha_bitacora where proyecto_id = $1 and tipo = 'AVANCE'`,
      [id]
    )
    expect(n).toBe(1)
  })

  it('cada cambio deja su fila con su tipo y su porcentaje', async () => {
    const id = await presentar()

    await db.query(
      `update public.gran_cosecha_proyecto set avance = 55, avance_nota = 'Terminamos la maqueta' where id = $1`,
      [id]
    )
    await db.query(`update public.gran_cosecha_proyecto set estado = 'EN_CURSO' where id = $1`, [id])
    await db.query(`update public.gran_cosecha_proyecto set titulo = 'Huerto vertical II' where id = $1`, [id])
    await db.query(`update public.gran_cosecha_proyecto set avance = 80, avance_nota = '' where id = $1`, [id])
    await db.query(
      `update public.gran_cosecha_proyecto
          set miembros = miembros || '[{"usuario_id":"00000000-0000-0000-0000-000000000009","nombre":"Cuarta"}]'::jsonb
        where id = $1`,
      [id]
    )

    const filas = await db.query<{ tipo: string; porcentaje: number | null; detalle: string }>(
      `select tipo, porcentaje, detalle from public.gran_cosecha_bitacora
        where proyecto_id = $1 order by created_at, id`,
      [id]
    )
    const tipos = filas.rows.map((f) => f.tipo)
    expect(tipos).toContain('ALTA')
    expect(tipos.filter((t) => t === 'AVANCE')).toHaveLength(2)
    expect(tipos).toContain('ESTADO')
    expect(tipos).toContain('EDICION')
    expect(tipos).toContain('MIEMBROS')

    const avances = filas.rows.filter((f) => f.tipo === 'AVANCE')
    expect(avances.map((f) => f.porcentaje)).toEqual([55, 80])
    expect(avances[0].detalle).toBe('Terminamos la maqueta')

    const estado = filas.rows.find((f) => f.tipo === 'ESTADO')!
    expect(estado.detalle).toBe('PROPUESTA → EN_CURSO')

    const miembros = filas.rows.find((f) => f.tipo === 'MIEMBROS')!
    expect(miembros.detalle).toContain('de 3 a 4 integrantes')
  })

  it('un update que no cambia nada no deja registro', async () => {
    // Si no, cualquier guardado (o un `updated_at` solo) llenaría la
    // bitácora de filas que no dicen nada.
    const id = await presentar()
    await db.query(`update public.gran_cosecha_proyecto set titulo = 'Huerto vertical' where id = $1`, [id])
    const n = await contar(`select count(*) as n from public.gran_cosecha_bitacora where proyecto_id = $1`, [id])
    expect(n).toBe(1)
  })

  it('la app no puede escribir la bitácora por su cuenta', async () => {
    // Sólo hay política de SELECT: quien edita el proyecto no tiene por qué
    // poder inventarse un registro, que es justamente lo que garantiza el
    // trigger.
    const id = await presentar()
    await conRol(JUEZ, async () => {
      // Sin política de INSERT, el RLS no devuelve 0 filas como en un update:
      // el INSERT se RECHAZA con un error 42501. Si algún día apareciera una
      // política, acá se caería en vez de dejar pasar el registro inventado.
      await expect(
        db.query(
          `insert into public.gran_cosecha_bitacora (proyecto_id, tipo, detalle)
           values ($1, 'AVANCE', 'Registro inventado') returning id`,
          [id]
        )
      ).rejects.toThrow(/row-level security/i)
    })
    const n = await contar(
      `select count(*) as n from public.gran_cosecha_bitacora where detalle = 'Registro inventado'`
    )
    expect(n).toBe(0)
  })
})

describe('gran-cosecha.sql · permisos', () => {
  it('anon no tiene privilegio de tabla en ninguna de las dos', async () => {
    // El `revoke all ... from anon` del bloque es la primera capa; el RLS la
    // segunda. Sin la primera, anon llegaría a evaluar políticas.
    for (const tabla of ['gran_cosecha_proyecto', 'gran_cosecha_bitacora']) {
      const n = await contar(
        `select case when has_table_privilege('anon', 'public.${tabla}', 'select') then 1 else 0 end as n`
      )
      expect(n, tabla).toBe(0)
    }
  })

  it('la función de sesión no queda abierta para anon', async () => {
    const definer = await contar(
      `select case when exists (
         select 1 from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'puede_gran_cosecha'
            and p.prosecdef
       ) then 1 else 0 end as n`
    )
    expect(definer).toBe(1)

    const anon = await contar(
      `select case when has_function_privilege('anon', 'public.puede_gran_cosecha()', 'execute') then 1 else 0 end as n`
    )
    expect(anon).toBe(0)
  })

  it('el proyecto tiene select, insert y update… pero NO delete', async () => {
    const filas = await db.query<{ policyname: string; cmd: string }>(
      `select policyname, cmd from pg_policies
        where schemaname = 'public' and tablename = 'gran_cosecha_proyecto' order by policyname`
    )
    const comandos = filas.rows.map((f) => f.cmd.toLowerCase()).sort()
    expect(comandos).toEqual(['insert', 'select', 'update'])

    // Y la bitácora sólo se lee: ni insert (lo hace el trigger) ni update ni
    // delete (el registro no se reescribe).
    const bit = await db.query<{ cmd: string }>(
      `select cmd from pg_policies where schemaname = 'public' and tablename = 'gran_cosecha_bitacora'`
    )
    expect(bit.rows.map((r) => r.cmd.toLowerCase())).toEqual(['select'])
  })
})
