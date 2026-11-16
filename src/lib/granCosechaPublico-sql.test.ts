import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { bloqueSql } from './supabaseSql'

/**
 * gran-cosecha-publico.sql, ejecutado en un Postgres de verdad.
 *
 * POR QUÉ EXISTE ESTE TEST
 * ------------------------
 * Es el único bloque que se abre a `anon` después del cierre general, y la
 * página que lo usa se comparte por WhatsApp: si algo se escapa de acá, sale
 * a internet sin sesión. Lo que sólo falla cuando corre de verdad:
 *
 *  1. La tabla de contenido: `anon` SIN privilegio (la página no escribe ni
 *     lee directo), RLS encendido, y SIN política de delete —el contenido se
 *     reescribe, no se borra—.
 *  2. La cerradura: JUEZ y LÍDER cargan contenido; un trabajador autenticado
 *     ni siquiera puede hacer un INSERT (42501).
 *  3. `ver_concurso_publico`: SECURITY DEFINER + search_path fijo, con `anon`
 *     ejecutándola de verdad (es la que lee la landing) y devolviendo SÓLO lo
 *     que la página pinta: proyectos del período, sin CANCELADOS, sin
 *     `creador_id` ni `autor_id`, los `miembros` convertidos a nombres y los
 *     AVANCES de la bitácora.
 *
 * Acá se corre el bloque TAL CUAL se pega al SQL Editor, dos veces (tiene que
 * ser idempotente), después de `gran-cosecha.sql`, que es como se instala.
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

  -- Espejo mínimo con el constraint de rol VIEJO (sin JUEZ): es el estado
  -- real de una base ya creada, justo lo que gran-cosecha.sql rehace.
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

/** Carga una fila de contenido editorial. */
async function cargar(periodo: string, clave: string, valor: unknown): Promise<void> {
  await db.query(
    `insert into public.gran_cosecha_contenido (periodo, clave, valor) values ($1, $2, $3::jsonb)`,
    [periodo, clave, JSON.stringify(valor)]
  )
}

/**
 * Lo que hace el editor al guardar: reescribe la fila de esa (periodo, clave)
 * en vez de duplicarla — `upsert` con `onConflict: 'periodo,clave'` en
 * `concursoPublico.guardarContenido`.
 */
async function reescribir(periodo: string, clave: string, valor: unknown): Promise<void> {
  await db.query(
    `insert into public.gran_cosecha_contenido (periodo, clave, valor)
     values ($1, $2, $3::jsonb)
     on conflict (periodo, clave) do update set valor = excluded.valor`,
    [periodo, clave, JSON.stringify(valor)]
  )
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
 * Baja al rol `authenticated` para que el RLS se aplique de verdad. La
 * conexión de pglite es `postgres`, el DUEÑO de las tablas, que bypasea RLS.
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

/** Llama al RPC como lo hace la landing: SIN sesión, rol `anon`. */
async function llamarAnon(periodo: string): Promise<Record<string, unknown>> {
  await db.exec('set role anon')
  try {
    const { rows } = await db.query<{ r: Record<string, unknown> }>(
      'select public.ver_concurso_publico($1) as r',
      [periodo]
    )
    return rows[0].r
  } finally {
    await db.exec('reset role')
  }
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(DDL)
  await db.exec(`insert into auth.users (id) values ('${JUEZ}'), ('${LIDER}'), ('${EVALUADOR}')`)
  await db.exec(
    `insert into public.profiles (id, nombre, rol) values
       ('${JUEZ}', 'Rita Juez', 'EVALUADOR'),
       ('${LIDER}', 'Ana Líder', 'LIDER'),
       ('${EVALUADOR}', 'Juan Trabajador', 'EVALUADOR')`
  )
  // El concurso primero (tablas, trigger y `puede_gran_cosecha`) y después el
  // bloque público, igual que en el archivo. Dos corridas: idempotencia.
  await db.exec(bloqueSql('gran-cosecha.sql'))
  await db.exec(bloqueSql('gran-cosecha-publico.sql'))
  await db.exec(bloqueSql('gran-cosecha-publico.sql'))
  await db.exec(`update public.profiles set rol = 'JUEZ' where id = '${JUEZ}'`)

  // --- Datos ------------------------------------------------------------
  const lidera = await presentar({ titulo: 'Estantes sin quiebres', avance: 82 })
  await db.query(
    `update public.gran_cosecha_proyecto set avance = 45, avance_nota = 'Primer piloto' where id = $1`,
    [lidera]
  )
  await db.query(
    `update public.gran_cosecha_proyecto set avance = 82, avance_nota = 'Dos sucursales' where id = $1`,
    [lidera]
  )
  // Un cambio que NO es avance: la bitácora lo registra, la landing no lo
  // debe mostrar en el «cómo fue avanzando».
  await db.query(`update public.gran_cosecha_proyecto set estado = 'EN_CURSO' where id = $1`, [lidera])

  await presentar({ titulo: 'Caja cero espera', avance: 67 })
  // Cancelado: ya no es participante, la landing no lo puede listar.
  await presentar({ titulo: 'Proyecto que no siguió', estado: 'CANCELADO', avance: 99 })
  // De OTRO trimestre: no entra en el paquete de éste.
  await presentar({ periodo: '2026-T3', titulo: 'Del trimestre pasado', avance: 100 })

  await cargar('GLOBAL', 'bases', { texto: 'Reglamento del concurso' })
  await cargar('2026-T4', 'premios', {
    items: [{ puesto: '1er puesto', titulo: 'Gran Cosecha' }]
  })
  await cargar('2026-T3', 'premios', { items: [{ puesto: 'Otro', titulo: 'Del T3' }] })
}, 120_000)

afterAll(async () => {
  await db?.close()
})

describe('gran-cosecha-publico.sql · la tabla de contenido', () => {
  it('nace cerrada: anon sin privilegio, RLS encendido y sin delete', async () => {
    const { rows } = await db.query<{ anon_select: boolean; rls: boolean; politicas: number }>(`
      select
        has_table_privilege('anon', c.oid, 'select') as anon_select,
        c.relrowsecurity as rls,
        (select count(*)::int from pg_policies pp
          where pp.schemaname = 'public' and pp.tablename = c.relname) as politicas
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'gran_cosecha_contenido'
    `)
    expect(rows[0].anon_select).toBe(false)
    expect(rows[0].rls).toBe(true)
    // SELECT + INSERT + UPDATE, y SIN delete: el contenido se reescribe.
    expect(rows[0].politicas).toBe(3)
  })

  it('la forma es la del editor: (periodo, clave) y claves conocidas', async () => {
    await expect(cargar('2026-T4', 'inventada', {})).rejects.toThrow(/check/i)
    await expect(cargar('2026-T5', 'bases', { texto: 'x' })).rejects.toThrow(/check/i)
    await expect(cargar('2026-11', 'bases', { texto: 'x' })).rejects.toThrow(/check/i)
    // Y la clave de la PK: reescribir la misma (periodo, clave) actualiza la
    // fila, no deja dos.
    await cargar('2026-T4', 'jurado', { items: [] })
    await reescribir('2026-T4', 'jurado', { items: [{ nombre: 'Rita', cargo: 'Juez' }] })
    const n = await contar(
      `select count(*) as n from public.gran_cosecha_contenido where periodo = '2026-T4' and clave = 'jurado'`
    )
    expect(n).toBe(1)
  })

  it('JUEZ y LÍDER cargan contenido; un trabajador ni inserta', async () => {
    await conRol(JUEZ, async () => {
      await expect(cargar('2026-T4', 'faq', { items: [] })).resolves.toBeUndefined()
    })
    await conRol(LIDER, async () => {
      await expect(cargar('2026-T4', 'calendario', { hitos: [] })).resolves.toBeUndefined()
    })
    await conRol(EVALUADOR, async () => {
      await expect(cargar('2026-T4', 'ganadores', { items: [] })).rejects.toThrow(/row-level security/i)
    })
    await como(null)
  })

  it('un trabajador lee el contenido (es público) pero no lo cambia', async () => {
    const antes = await contar(
      `select count(*) as n from public.gran_cosecha_contenido where clave = 'jurado' and periodo = '2026-T4'`
    )
    await conRol(EVALUADOR, async () => {
      // SELECT abierto a `authenticated`: la página pública lo muestra igual.
      const r = await db.query(
        `select valor from public.gran_cosecha_contenido where clave = 'bases' and periodo = 'GLOBAL'`
      )
      expect(r.rows).toHaveLength(1)

      // UPDATE: RLS filtra la fila y no la toca (0 filas, sin error).
      const upd = await db.query(
        `update public.gran_cosecha_contenido set valor = '{"texto":"Ajenado"}'::jsonb
          where clave = 'bases' and periodo = 'GLOBAL' returning clave`
      )
      expect(upd.rows).toHaveLength(0)
    })
    await como(null)
    const sigue = await db.query<{ valor: { texto: string } }>(
      `select valor from public.gran_cosecha_contenido where clave = 'bases' and periodo = 'GLOBAL'`
    )
    expect(sigue.rows[0].valor.texto).toBe('Reglamento del concurso')
    expect(antes).toBeGreaterThan(0)
  })

  it('nadie borra contenido: ni el JUEZ, por más rol que tenga', async () => {
    await conRol(JUEZ, async () => {
      const r = await db.query(
        `delete from public.gran_cosecha_contenido where clave = 'faq' returning clave`
      )
      expect(r.rows).toHaveLength(0)
    })
    await como(null)
    const queda = await contar(`select count(*) as n from public.gran_cosecha_contenido where clave = 'faq'`)
    expect(queda).toBeGreaterThan(0)
  })
})

describe('ver_concurso_publico · contra un Postgres real', () => {
  it('anon puede llamarla: es la que lee la landing sin cuenta', async () => {
    // Sin este permiso la página caería siempre en datos de ejemplo.
    const anon = await contar(
      `select case when has_function_privilege('anon', 'public.ver_concurso_publico(text)', 'execute')
              then 1 else 0 end as n`
    )
    expect(anon).toBe(1)

    // Y llamándola de verdad, con el rol `anon` puesto.
    const r = await llamarAnon('2026-T4')
    expect(r.periodo).toBe('2026-T4')
  })

  it('la función de sesión sigue cerrada para anon', async () => {
    // Las dos capas conviven: ésta lee el concurso sin sesión, la otra es la
    // que decide quién escribe. Si `puede_gran_cosecha` se abriera a anon,
    // cualquiera averiguaría quién es JUEZ.
    const anon = await contar(
      `select case when has_function_privilege('anon', 'public.puede_gran_cosecha()', 'execute')
              then 1 else 0 end as n`
    )
    expect(anon).toBe(0)
  })

  it('es SECURITY DEFINER con search_path fijo', async () => {
    // Obligatorio: corre sin sesión y anon no tiene privilegio de tabla.
    const { rows } = await db.query<{ definer: boolean; search_path: boolean }>(`
      select p.prosecdef as definer,
             coalesce(p.proconfig::text, '') like '%search_path%' as search_path
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'ver_concurso_publico'
    `)
    expect(rows).toHaveLength(1)
    expect(rows[0].definer).toBe(true)
    expect(rows[0].search_path).toBe(true)
  })

  it('devuelve sólo el período pedido, ordenado por avance', async () => {
    const r = await llamarAnon('2026-T4')
    const proyectos = r.proyectos as { titulo: string; avance: number; estado: string }[]
    expect(proyectos.map((p) => p.titulo)).toEqual(['Estantes sin quiebres', 'Caja cero espera'])
    expect(proyectos.map((p) => p.avance)).toEqual([82, 67])

    // Nada de otros trimestres ni de cancelados.
    const t3 = await llamarAnon('2026-T3')
    const proyectosT3 = t3.proyectos as { titulo: string }[]
    expect(proyectosT3.map((p) => p.titulo)).toEqual(['Del trimestre pasado'])

    const t4 = new Set((proyectos as { titulo: string }[]).map((p) => p.titulo))
    expect(t4.has('Proyecto que no siguió')).toBe(false)
    expect(t4.has('Del trimestre pasado')).toBe(false)
  })

  it('no expone identificadores: ni creador, ni autor, ni usuario del equipo', async () => {
    const r = await llamarAnon('2026-T4')
    const proyectos = r.proyectos as Record<string, unknown>[]
    for (const p of proyectos) {
      expect(p.creador_id, p.titulo as string).toBeUndefined()
      expect(p.usuario_id, p.titulo as string).toBeUndefined()
      // El equipo sale como NOMBRES: el jsonb de la tabla guarda usuario_id +
      // nombre, y sólo el nombre es contenido público.
      for (const miembro of p.miembros as unknown[]) {
        expect(typeof miembro).toBe('string')
      }
      expect(p.miembros).toEqual(['Rita Juez', 'Ana Líder', 'Juan Trabajador'])
      for (const a of p.avances as Record<string, unknown>[]) {
        expect(a.autor_id).toBeUndefined()
      }
    }
  })

  it('el historial trae SÓLO avances: estado y equipo no son contenido público', async () => {
    const r = await llamarAnon('2026-T4')
    const proyectos = r.proyectos as { titulo: string; avances: { porcentaje: number; detalle: string }[] }[]
    const lidera = proyectos.find((p) => p.titulo === 'Estantes sin quiebres')!
    // El ALTA (porcentaje null) y el cambio de estado son filas de la
    // bitácora, pero no de AVANCE: acá sólo llegan los dos avances reales.
    expect(lidera.avances.map((a) => a.porcentaje)).toEqual([45, 82])
    expect(lidera.avances.map((a) => a.detalle)).toEqual(['Primer piloto', 'Dos sucursales'])
  })

  it('el contenido trae la fila del trimestre Y la GLOBAL', async () => {
    const r = await llamarAnon('2026-T4')
    const contenido = r.contenido as { clave: string; periodo: string; valor: Record<string, unknown> }[]
    const claves = contenido.map((c) => `${c.periodo}/${c.clave}`)
    expect(claves).toContain('GLOBAL/bases')
    expect(claves).toContain('2026-T4/premios')
    // La del otro trimestre no viaja en este paquete.
    expect(claves).not.toContain('2026-T3/premios')

    const bases = contenido.find((c) => c.clave === 'bases')!
    expect(bases.valor.texto).toBe('Reglamento del concurso')
  })

  it('un período sin proyectos ni contenido devuelve paquetes vacíos, no null', async () => {
    const r = await llamarAnon('2026-T2')
    expect(r.proyectos).toEqual([])
    // GLOBAL siempre viaja: bases, FAQ y ganadores no dependen del trimestre.
    expect(Array.isArray(r.contenido)).toBe(true)
    expect((r.contenido as { clave: string }[]).map((c) => c.clave)).toEqual(['bases'])
  })
})
