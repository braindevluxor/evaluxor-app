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
 *     LÍDER editan el de otro; BORRAR usa la MISMA cerradura y se lleva la
 *     bitácora y los riegos en cascada.
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
      check (rol in ('SIN_ROL','LIDER','EVALUADOR','GERENTE_S','GERENTE_C','GERENTE_TH','GERENTE_TI','TECNICO_TI')),
    activo boolean not null default true
  );

  create table public.invitaciones (
    id uuid primary key default gen_random_uuid(),
    email text not null,
    usuario text not null default '',
    rol text not null check (rol in ('LIDER','EVALUADOR','GERENTE_S','GERENTE_C','GERENTE_TH','GERENTE_TI','TECNICO_TI')),
    token text not null unique default gen_random_uuid()::text
  );

  -- Espejo de la nómina (la crea el bloque de nómina-trabajadores, que este
  -- test NO corre): sólo lo que lee la RPC de candidatos del equipo. Sin la
  -- FK a sucursales — acá sólo importa la persona, no su tienda.
  create table public.trabajadores_nomina (
    sucursal_id uuid not null default gen_random_uuid(),
    nacionalidad text not null default 'V',
    dni bigint not null,
    datos jsonb not null,
    actualizado_en timestamptz not null default now(),
    constraint trabajadores_nomina_unico primary key (sucursal_id, nacionalidad, dni)
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

  // Los `usuario` de cada perfil: ES ESA CLAVE con la que se riega (la misma
  // que mandan los portales hermanos), así que los tres tienen que tenerla.
  await db.exec(
    `update public.profiles set usuario = 'rita.juez' where id = '${JUEZ}';
     update public.profiles set usuario = 'ana.lider' where id = '${LIDER}';
     update public.profiles set usuario = 'juan.trabajador' where id = '${EVALUADOR}'`
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

  it('la categoría es Cultivando Ideas o Premiamos tu Compra (o vacía)', async () => {
    const id = await presentar({ titulo: 'Con categoría', categoria: 'Cultivando Ideas' })
    await expect(
      db.query(`update public.gran_cosecha_proyecto set categoria = 'Premiamos tu Compra' where id = $1`, [id])
    ).resolves.toBeTruthy()
    // «Cosecha en Equipo» NO es categoría de proyecto: es el PREMIO al
    // departamento con los KPI de puntuación más altos.
    await expect(
      db.query(`update public.gran_cosecha_proyecto set categoria = 'Cosecha en Equipo' where id = $1`, [id])
    ).rejects.toThrow(/categoria/i)
    await expect(
      db.query(`update public.gran_cosecha_proyecto set categoria = 'Categoría inventada' where id = $1`, [id])
    ).rejects.toThrow(/categoria/i)
    // Las filas viejas quedan en NULL y eso es válido: la web las muestra
    // con su chip de «Sin categoría».
    await expect(
      db.query(`update public.gran_cosecha_proyecto set categoria = null where id = $1`, [id])
    ).resolves.toBeTruthy()
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

  it('borra el proyecto SU equipo, un juez o el líder… pero no el de otro', async () => {
    // La MISMA cerradura que el update: `creador_id = auth.uid()` o
    // `puede_gran_cosecha()`. Ojo con lo que devuelve: un delete filtrado por
    // RLS NO da error, devuelve CERO filas — y esa es exactamente la señal
    // que usa la app para avisar «no te corresponde» en vez de mentir con un
    // «proyecto borrado».
    const mio = await presentar({ creador_id: EVALUADOR })
    await conRol(EVALUADOR, async () => {
      const r = await db.query(
        `delete from public.gran_cosecha_proyecto where id = $1 returning id`,
        [mio]
      )
      expect(r.rows, 'el creador borra el suyo').toHaveLength(1)
    })

    for (const usuario of [JUEZ, LIDER]) {
      const ajeno = await presentar({ creador_id: EVALUADOR })
      await conRol(usuario, async () => {
        const r = await db.query(
          `delete from public.gran_cosecha_proyecto where id = $1 returning id`,
          [ajeno]
        )
        expect(r.rows, `borró como ${usuario}`).toHaveLength(1)
      })
    }

    const deOtro = await presentar({ creador_id: LIDER })
    await conRol(EVALUADOR, async () => {
      const r = await db.query(
        `delete from public.gran_cosecha_proyecto where id = $1 returning id`,
        [deOtro]
      )
      expect(r.rows, 'un trabajador no borra el proyecto de otro').toHaveLength(0)
    })
    const sigue = await db.query(`select id from public.gran_cosecha_proyecto where id = $1`, [deOtro])
    expect(sigue.rows, 'el proyecto ajeno sigue intacto').toHaveLength(1)
  })

  it('borrar se lleva la bitácora y los riegos en cascada', async () => {
    // El proyecto es UNA fila con dos hijos: `on delete cascade` en las dos
    // tablas. Si la cascada no corriera (o la RLS de la bitácora la
    // frenara), el delete entero fallaría con violación de FK y acá se caería.
    const id = await presentar({ creador_id: EVALUADOR })
    await db.query(
      `update public.gran_cosecha_proyecto set avance = 50, avance_nota = 'A medio camino' where id = $1`,
      [id]
    )
    await db.query(
      `insert into public.gran_cosecha_riego (proyecto_id, usuario) values ($1, 'academia:101')`,
      [id]
    )
    expect(
      await contar(`select count(*) as n from public.gran_cosecha_bitacora where proyecto_id = $1`, [id])
    ).toBeGreaterThan(0)
    expect(await contar(`select count(*) as n from public.gran_cosecha_riego where proyecto_id = $1`, [id])).toBe(1)

    await conRol(EVALUADOR, async () => {
      const r = await db.query(
        `delete from public.gran_cosecha_proyecto where id = $1 returning id`,
        [id]
      )
      expect(r.rows).toHaveLength(1)
    })

    expect(await contar(`select count(*) as n from public.gran_cosecha_proyecto where id = $1`, [id])).toBe(0)
    expect(
      await contar(`select count(*) as n from public.gran_cosecha_bitacora where proyecto_id = $1`, [id])
    ).toBe(0)
    expect(await contar(`select count(*) as n from public.gran_cosecha_riego where proyecto_id = $1`, [id])).toBe(0)
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

  it('el proyecto tiene select, insert, update y delete; la bitácora, sólo select', async () => {
    const filas = await db.query<{ policyname: string; cmd: string }>(
      `select policyname, cmd from pg_policies
        where schemaname = 'public' and tablename = 'gran_cosecha_proyecto' order by policyname`
    )
    const comandos = filas.rows.map((f) => f.cmd.toLowerCase()).sort()
    // El delete es el único con `using` y sin `with check`: en un borrado no
    // hay fila nueva que validar, sólo quién está mirando la vieja.
    expect(comandos).toEqual(['delete', 'insert', 'select', 'update'])

    // Y la bitácora sólo se lee: ni insert (lo hace el trigger) ni update ni
    // delete (el registro no se reescribe; la única forma de que desaparezca
    // es el cascade de SU proyecto).
    const bit = await db.query<{ cmd: string }>(
      `select cmd from pg_policies where schemaname = 'public' and tablename = 'gran_cosecha_bitacora'`
    )
    expect(bit.rows.map((r) => r.cmd.toLowerCase())).toEqual(['select'])
  })
})

describe('gran-cosecha.sql · regar desde EvaLuxor', () => {
  /** La RPC como la llama la pantalla: sólo el proyecto, NUNCA identidad. */
  async function regar(proyectoId: string): Promise<Record<string, unknown>> {
    const r = await db.query<{ regar_proyecto: Record<string, unknown> }>(
      `select public.regar_proyecto($1) as regar_proyecto`,
      [proyectoId]
    )
    return r.rows[0].regar_proyecto
  }

  /** El mapa de conteos que lee la consola, con la sesión puesta. */
  async function leerRiegos(): Promise<Record<string, { riegos: number; mio: boolean }>> {
    const r = await db.query<{ riegos_de_la_cosecha: Record<string, { riegos: number; mio: boolean }> }>(
      `select public.riegos_de_la_cosecha() as riegos_de_la_cosecha`
    )
    return r.rows[0].riegos_de_la_cosecha
  }

  it('guarda el USUARIO de la sesión y cuenta UNA vez por persona', async () => {
    const proyecto = await presentar({ titulo: 'Para regar' })

    await conRol(EVALUADOR, async () => {
      // El primero: entra y devuelve el conteo.
      expect(await regar(proyecto)).toEqual({ ya_regado: false, riegos: 1 })
      // El mismo, otra vez: NO duplica y lo dice.
      expect(await regar(proyecto)).toEqual({ ya_regado: true, riegos: 1 })
    })

    // La clave de la fila es el `usuario` DEL PERFIL de quien apretó — la
    // misma que mandan los portales—, no un id de sesión.
    const filas = await db.query<{ usuario: string }>(
      `select usuario from public.gran_cosecha_riego where proyecto_id = $1`,
      [proyecto]
    )
    expect(filas.rows.map((f) => f.usuario)).toEqual(['juan.trabajador'])
  })

  it('otra persona riega el mismo proyecto: son DOS riegos', async () => {
    const proyecto = await presentar({ titulo: 'Para regar entre dos' })
    await conRol(EVALUADOR, async () => {
      await regar(proyecto)
    })
    await conRol(JUEZ, async () => {
      expect(await regar(proyecto)).toEqual({ ya_regado: false, riegos: 2 })
    })
    const n = await contar(
      `select count(*) as n from public.gran_cosecha_riego where proyecto_id = $1`,
      [proyecto]
    )
    expect(n).toBe(2)
  })

  it('la identidad NO es parámetro: no hay forma de regar por otro', async () => {
    // La única entrada de la función es el proyecto; quién riega lo decide
    // la función con la sesión, así que ni la pantalla ni un llamado roto
    // pueden mandar el usuario de otro.
    const { rows } = await db.query<{ args: string }>(
      `select pg_get_function_arguments(p.oid) as args
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'regar_proyecto'`
    )
    expect(rows[0].args).toBe('p_proyecto_id uuid')
  })

  it('anon no riega ni lee: ni la función ni la tabla', async () => {
    for (const fn of ['regar_proyecto(uuid)', 'quitar_riego(uuid)', 'riegos_de_la_cosecha()']) {
      const n = await contar(
        `select case when has_function_privilege('anon', 'public.${fn}', 'execute') then 1 else 0 end as n`
      )
      expect(n, fn).toBe(0)
    }

    const proyecto = await presentar({ titulo: 'Protegido de anon' })
    await como(null)
    await db.exec('set role anon')
    try {
      await expect(regar(proyecto)).rejects.toThrow(/permission denied for function/i)
    } finally {
      await db.exec('reset role')
    }
    const n = await contar(
      `select count(*) as n from public.gran_cosecha_riego where proyecto_id = $1`,
      [proyecto]
    )
    expect(n).toBe(0)
  })

  it('un proyecto cancelado o inexistente no se riega', async () => {
    const cancelado = await presentar({ titulo: 'Canceladito', estado: 'CANCELADO' })
    await conRol(EVALUADOR, async () => {
      await expect(regar(cancelado)).rejects.toThrow(/ya no participa/i)
      await expect(regar('00000000-0000-0000-0000-00000000ffff')).rejects.toThrow(/No existe ese proyecto/i)
    })
  })

  it('un perfil sin usuario de EvaLuxor no puede regar (y no deja rastro)', async () => {
    const proyecto = await presentar({ titulo: 'Perfil sin usuario' })
    await db.query(`update public.profiles set usuario = '' where id = $1`, [EVALUADOR])
    try {
      await conRol(EVALUADOR, async () => {
        await expect(regar(proyecto)).rejects.toThrow(/usuario de EvaLuxor/i)
      })
    } finally {
      await db.query(`update public.profiles set usuario = 'juan.trabajador' where id = $1`, [EVALUADOR])
    }
    const n = await contar(
      `select count(*) as n from public.gran_cosecha_riego where proyecto_id = $1`,
      [proyecto]
    )
    expect(n).toBe(0)
  })

  it('el conteo de la consola: número y lo mío, sin identidad de nadie', async () => {
    const proyecto = await presentar({ titulo: 'Para el conteo' })
    await conRol(EVALUADOR, async () => {
      await regar(proyecto)
    })
    await conRol(JUEZ, async () => {
      await regar(proyecto)
    })

    await conRol(EVALUADOR, async () => {
      const mapa = await leerRiegos()
      expect(mapa[proyecto]).toEqual({ riegos: 2, mio: true })
      // Ni un solo `usuario` cruza por más de que la sesión tenga sesión.
      expect(JSON.stringify(mapa)).not.toContain('trabajador')
    })

    // LÍDER no riegó: ve el conteo, pero NO como suyo.
    await conRol(LIDER, async () => {
      const mapa = await leerRiegos()
      expect(mapa[proyecto]).toEqual({ riegos: 2, mio: false })
    })

    // Un proyecto sin riegos ni siquiera aparece en el mapa: la pantalla
    // distingue «nadie regó» de «no sé» por la clave que exista.
    const virgen = await presentar({ titulo: 'Sin riegos' })
    await conRol(LIDER, async () => {
      const mapa = await leerRiegos()
      expect(mapa[virgen]).toBeUndefined()
    })
  })
})

describe('gran-cosecha.sql · quitar el riego desde EvaLuxor', () => {
  /** Regar con la sesión actual: el mismo camino que la pantalla. */
  async function regar(proyectoId: string): Promise<Record<string, unknown>> {
    const r = await db.query<{ regar_proyecto: Record<string, unknown> }>(
      `select public.regar_proyecto($1) as regar_proyecto`,
      [proyectoId]
    )
    return r.rows[0].regar_proyecto
  }

  /** La RPC de quitar como la llama la pantalla: sólo el proyecto. */
  async function quitar(proyectoId: string): Promise<Record<string, unknown>> {
    const r = await db.query<{ quitar_riego: Record<string, unknown> }>(
      `select public.quitar_riego($1) as quitar_riego`,
      [proyectoId]
    )
    return r.rows[0].quitar_riego
  }

  /** El mapa de conteos que lee la consola, con la sesión puesta. */
  async function leerRiegos(): Promise<Record<string, { riegos: number; mio: boolean }>> {
    const r = await db.query<{ riegos_de_la_cosecha: Record<string, { riegos: number; mio: boolean }> }>(
      `select public.riegos_de_la_cosecha() as riegos_de_la_cosecha`
    )
    return r.rows[0].riegos_de_la_cosecha
  }

  it('quita el PROPIO riego y deja el de los demás intacto', async () => {
    const proyecto = await presentar({ titulo: 'Para quitar' })
    await conRol(EVALUADOR, async () => {
      await regar(proyecto)
    })
    await conRol(JUEZ, async () => {
      await regar(proyecto)
    })

    await conRol(EVALUADOR, async () => {
      // El primero: se va el mío y baja el conteo.
      expect(await quitar(proyecto)).toEqual({ quitado: true, riegos: 1 })
      // Segunda vez: no había nada que quitar y lo dice, SIN error, con el
      // conteo verdadero — así la consola no pinta un número inventado.
      expect(await quitar(proyecto)).toEqual({ quitado: false, riegos: 1 })

      // La consola ve el efecto: ya no es mío y quedó en uno.
      const mapa = await leerRiegos()
      expect(mapa[proyecto]).toEqual({ riegos: 1, mio: false })
    })

    // Quedó SÓLO el riego del JUEZ: nadie más perdió el suyo.
    const filas = await db.query<{ usuario: string }>(
      `select usuario from public.gran_cosecha_riego where proyecto_id = $1`,
      [proyecto]
    )
    expect(filas.rows.map((f) => f.usuario)).toEqual(['rita.juez'])
  })

  it('nadie quita el riego de otro: la identidad no es parámetro', async () => {
    const proyecto = await presentar({ titulo: 'Riego ajeno' })
    await conRol(EVALUADOR, async () => {
      await regar(proyecto)
    })

    // La única entrada de la función es el proyecto, igual que al regar.
    const { rows } = await db.query<{ args: string }>(
      `select pg_get_function_arguments(p.oid) as args
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'quitar_riego'`
    )
    expect(rows[0].args).toBe('p_proyecto_id uuid')

    // Llamando con la SESIÓN de otro, el ajeno no se toca.
    await conRol(LIDER, async () => {
      expect(await quitar(proyecto)).toEqual({ quitado: false, riegos: 1 })
    })
    const n = await contar(
      `select count(*) as n from public.gran_cosecha_riego where proyecto_id = $1`,
      [proyecto]
    )
    expect(n).toBe(1)
  })

  it('un perfil sin usuario de EvaLuxor no puede quitar (y no borra nada)', async () => {
    const proyecto = await presentar({ titulo: 'Sin usuario para quitar' })
    await conRol(EVALUADOR, async () => {
      await regar(proyecto)
    })
    await db.query(`update public.profiles set usuario = '' where id = $1`, [EVALUADOR])
    try {
      await conRol(EVALUADOR, async () => {
        await expect(quitar(proyecto)).rejects.toThrow(/usuario de EvaLuxor/i)
      })
    } finally {
      await db.query(`update public.profiles set usuario = 'juan.trabajador' where id = $1`, [EVALUADOR])
    }
    // El riego sigue ahí: el intento fallido no borró nada.
    const n = await contar(
      `select count(*) as n from public.gran_cosecha_riego where proyecto_id = $1`,
      [proyecto]
    )
    expect(n).toBe(1)
  })

  it('el riego propio se quita aunque el proyecto esté cancelado', async () => {
    // `regar` se niega en un CANCELADO; QUIZAR no: es deshacer lo PROPIO y
    // no agrega nada al concurso — sacar tu fila no necesita permiso de
    // edición sobre el proyecto de nadie.
    const proyecto = await presentar({ titulo: 'Cancelado con riego' })
    await conRol(EVALUADOR, async () => {
      await regar(proyecto)
    })
    await db.query(`update public.gran_cosecha_proyecto set estado = 'CANCELADO' where id = $1`, [proyecto])

    await conRol(EVALUADOR, async () => {
      expect(await quitar(proyecto)).toEqual({ quitado: true, riegos: 0 })
    })
  })
})

describe('gran-cosecha.sql · los riegos', () => {
  const regar = (proyecto: string, usuario: string) =>
    db.query(
      `insert into public.gran_cosecha_riego (proyecto_id, usuario) values ($1, $2)`,
      [proyecto, usuario]
    )

  it('un usuario riega UNA vez por proyecto: la unicidad la tiene la PK', async () => {
    const enUno = await presentar({ titulo: 'Proyecto con riego' })
    const enOtro = await presentar({ titulo: 'Otro proyecto con riego' })

    // El primer riego entra…
    await regar(enUno, 'academia:101')
    // …el mismo usuario sobre el MISMO proyecto, no: choca con la clave
    // primaria. No es la app la que lo evita, es la base.
    await expect(regar(enUno, 'academia:101')).rejects.toThrow(/duplicate key/i)

    // Pero el mismo usuario sí riega OTRO proyecto, y OTRO usuario el mismo:
    // la unicidad es por par (proyecto, usuario), como un "me gusta".
    await regar(enUno, 'desarrollo:77')
    await regar(enOtro, 'academia:101')

    const n = await contar(
      `select count(*) as n from public.gran_cosecha_riego where proyecto_id = $1`,
      [enUno]
    )
    expect(n).toBe(2)
  })

  it('el usuario va sin espacios de más: con y sin, es el mismo riego', async () => {
    const proyecto = await presentar({ titulo: 'Proyecto con riego 2' })
    await regar(proyecto, 'academia:202')
    // Un `trim` malo en el portal no crearía un "segundo usuario" invisible.
    await expect(regar(proyecto, ' academia:202 ')).rejects.toThrow(/check|violaci/i)
    // Y un usuario totalmente vacío ni siquiera es un riego.
    await expect(regar(proyecto, '   ')).rejects.toThrow(/check|violaci/i)
  })

  it('nadie riega desde EvaLuxor: sin privilegio para anon ni para la sesión', async () => {
    // Dos capas en este orden: el revoke (sin privilegio de tabla ni siquiera
    // se llega a evaluar el RLS) y el RLS sin ninguna política.
    for (const rol of ['anon', 'authenticated']) {
      const n = await contar(
        `select case when has_table_privilege('${rol}', 'public.gran_cosecha_riego', 'select')
                then 1 else 0 end as n`
      )
      expect(n, `${rol} no puede leer los riegos`).toBe(0)
    }

    const rls = await contar(
      `select relrowsecurity::int as n from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = 'gran_cosecha_riego'`
    )
    expect(rls).toBe(1)

    const politicas = await contar(
      `select count(*)::int as n from pg_policies
        where schemaname = 'public' and tablename = 'gran_cosecha_riego'`
    )
    expect(politicas).toBe(0)

    // Una sesión que intente regar, ni llega: la escribe sólo la edge
    // function con la service_role.
    const proyecto = await presentar({ titulo: 'Proyecto con riego 3' })
    await conRol(EVALUADOR, async () => {
      await expect(regar(proyecto, 'academia:303')).rejects.toThrow(
        /permission denied|row-level security/i
      )
    })
  })

  it('un riego a un proyecto que no existe no entra', async () => {
    await expect(regar('00000000-0000-0000-0000-00000000ffff', 'academia:404')).rejects.toThrow(
      /foreign key/i
    )
  })
})

describe('gran-cosecha.sql · las fotos del proyecto', () => {
  it('nacen vacías, las cambia el que edita el proyecto y no ensucian la bitácora', async () => {
    const id = await presentar({ titulo: 'Proyecto con fotos' })

    // El default es cadena vacía: la tarjeta de la landing usa la inicial.
    const inicial = await db.query<{ imagen: string; foto: string }>(
      `select imagen, foto from public.gran_cosecha_proyecto where id = $1`,
      [id]
    )
    expect(inicial.rows[0]).toEqual({ imagen: '', foto: '' })

    // El creador cambia sus fotos: la RLS de UPDATE es por fila y cubre las
    // columnas nuevas sin tocar políticas…
    await conRol(EVALUADOR, async () => {
      await db.query(
        `update public.gran_cosecha_proyecto
            set imagen = 'https://supabase.test/proyectos/cara.webp',
                foto   = 'https://supabase.test/proyectos/equipo.webp'
          where id = $1`,
        [id]
      )
    })

    const despues = await db.query<{ imagen: string; foto: string }>(
      `select imagen, foto from public.gran_cosecha_proyecto where id = $1`,
      [id]
    )
    expect(despues.rows[0]).toEqual({
      imagen: 'https://supabase.test/proyectos/cara.webp',
      foto: 'https://supabase.test/proyectos/equipo.webp'
    })

    // …y cambiar una foto NO deja fila en la bitácora: es cosmético, no un
    // avance ni una edición de contenido. Sigue habiendo sólo el ALTA.
    const filas = await db.query<{ tipo: string }>(
      `select tipo from public.gran_cosecha_bitacora where proyecto_id = $1 order by created_at`,
      [id]
    )
    expect(filas.rows.map((f) => f.tipo)).toEqual(['ALTA'])
  })
})

describe('gran-cosecha.sql · los candidatos sin cuenta', () => {
  it('anon no la puede llamar: es sólo para sesiones', async () => {
    const anon = await contar(
      `select case when has_function_privilege('anon', 'public.listar_trabajadores_equipo(text)', 'execute')
              then 1 else 0 end as n`
    )
    expect(anon).toBe(0)

    await como(null)
    await db.exec('set role anon')
    try {
      await expect(
        db.query(`select public.listar_trabajadores_equipo('maria')`)
      ).rejects.toThrow(/permission denied for function/i)
    } finally {
      await db.exec('reset role')
    }
  })

  it('busca por nombre o cédula, deja a cada persona UNA vez y sólo manda lo mínimo', async () => {
    // La MISMA persona en dos sucursales (se cambió de tienda): el picker
    // tiene que verla UNA sola vez, con su registro más reciente.
    await db.query(
      `insert into public.trabajadores_nomina (sucursal_id, nacionalidad, dni, datos, actualizado_en) values
         (gen_random_uuid(), 'V', 12345678,
          '{"name":"Maria","lastname":"Perez","branch_name":"Centro","active":true}', '2026-01-01'),
         (gen_random_uuid(), 'V', 12345678,
          '{"name":"Maria","lastname":"Perez","branch_name":"Norte","active":true}', '2026-06-01'),
         (gen_random_uuid(), 'V', 87654321,
          '{"name":"Jose","lastname":"Gomez","branch_name":"Sur","active":false}', '2026-06-01')`
    )

    await conRol(EVALUADOR, async () => {
      const buscar = async (texto: string): Promise<Record<string, unknown>[]> => {
        const r = await db.query<{ filas: Record<string, unknown>[] }>(
          `select public.listar_trabajadores_equipo($1) as filas`,
          [texto]
        )
        return r.rows[0].filas
      }

      const porApellido = await buscar('perez')
      expect(porApellido).toHaveLength(1)
      expect(porApellido[0].nacionalidad).toBe('V')
      expect(Number(porApellido[0].dni)).toBe(12345678)
      expect(porApellido[0].name).toBe('Maria')
      // La sucursal es la del registro MÁS RECIENTE (se cambió a Norte).
      expect(porApellido[0].sucursal).toBe('Norte')

      // También por cédula, como la escribe la gente.
      expect(await buscar('V-1234')).toHaveLength(1)

      // Sólo lo mínimo para el picker: ni el resto de `datos` (sueldos,
      // fechas, cargo) ni basura.
      expect(Object.keys(porApellido[0]).sort()).toEqual(
        ['active', 'estado', 'estado_display', 'is_active', 'lastname', 'name',
         'nacionalidad', 'status', 'status_display', 'sucursal', 'dni'].sort()
      )

      // Sin coincidencias o sin texto: lista vacía, NO la nómina entera.
      expect(await buscar('zzzz')).toHaveLength(0)
      expect(await buscar('')).toHaveLength(0)
    })
    await como(null)
  })
})
