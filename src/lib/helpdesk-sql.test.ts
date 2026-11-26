import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { bloqueSql } from './supabaseSql'

/**
 * helpdesk.sql (la Mesa de Ayuda), ejecutado en un Postgres de verdad.
 *
 * POR QUÉ EXISTE ESTE TEST
 * ------------------------
 * Ése es el único archivo donde vive quién puede hacer qué en la mesa de
 * ayuda, y las reglas que sólo fallan cuando alguien consulta con el rol
 * equivocado:
 *
 *  1. Cualquier sesión CREA casos y los lee (es multisucursal: la que
 *     reporta no pide permiso) pero NO los gestiona: el UPDATE devuelve 0
 *     filas, no error — asignar, estados y prioridad son del Líder.
 *  2. Un mensaje sólo se escribe como `branch`; firmarlo `it` o `system`
 *     es mentir sobre quién contestó, y el RLS lo mata.
 *  3. Las NOTAS INTERNAS no existen para quien no es Líder.
 *  4. El `updated_at` del caso lo mueve el trigger `security definer`: la
 *     sucursal no puede UPDATEar el ticket pero su mensaje igual deja la
 *     marca de que algo pasó (por eso está security definer y no a mano).
 *  5. El `codigo` sale de la SECUENCIA: HD-1043 es el primero y no se
 *     repite aunque dos sucursales creen a la vez.
 *
 * Acá se corre el bloque TAL COMO se pega al SQL Editor, dos veces (tiene
 * que ser idempotente), sobre un espejo mínimo de sucursales, profiles y
 * la función `es_lider()`.
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
    -- Mismo default que Supabase: todo lo que se cree en public es usable
    -- por los dos roles; las POLÍTICAS son las que filtran qué se ve.
    alter default privileges in schema public grant all on tables to anon, authenticated;
    -- …y la secuencia del código HD-#### también: el default del ticket la
    -- usa al insertar, desde la sesión de la sucursal.
    alter default privileges in schema public grant all on sequences to anon, authenticated;
  end $$;

  -- Espejo mínimo de profiles: el bloque no lo toca, pero es_lider() lo lee
  -- y la política de alta del caso lee sucursal_id (el de la tienda de
  -- quien reporta: con él, el caso sólo puede abrirse en la SUYA).
  create table public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    nombre text not null default '',
    rol text not null default 'SIN_ROL'
      check (rol in ('SIN_ROL','LIDER','EVALUADOR','GERENTE_S','GERENTE_C','GERENTE_TH','JUEZ','GERENTE_TI','TECNICO_TI')),
    sucursal_id uuid,
    activo boolean not null default true
  );

  -- Sucursales: sólo la clave, que es lo que el caso referencia.
  create table public.sucursales (
    id uuid primary key default gen_random_uuid(),
    nombre text not null
  );

  -- es_lider() vive en el bloque RAÍZ de schema.sql y este bloque la usa
  -- en sus políticas.
  create or replace function public.es_lider()
  returns boolean language sql stable security definer set search_path = public as $$
    select exists (select 1 from public.profiles p where p.id = auth.uid() and p.rol = 'LIDER' and p.activo);
  $$;
`

const LIDER = '00000000-0000-0000-0000-000000000d01'
const SUCURSAL = '00000000-0000-0000-0000-000000000d02'
const SUCURSAL_ID = '00000000-0000-0000-0000-000000000d03'
const OTRA_SUCURSAL = '00000000-0000-0000-0000-000000000d04'
const GERENTE_TI = '00000000-0000-0000-0000-000000000d05'
const TECNICO_TI = '00000000-0000-0000-0000-000000000d06'

let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  await db.exec(DDL)
  await db.exec(
    `insert into auth.users (id) values
       ('${LIDER}'), ('${SUCURSAL}'), ('${GERENTE_TI}'), ('${TECNICO_TI}')`
  )
  await db.exec(
    `insert into public.sucursales (id, nombre) values
       ('${SUCURSAL_ID}', 'Sucursal Las Mercedes'),
       ('${OTRA_SUCURSAL}', 'Sucursal El Bosque')`
  )
  // La sucursal del perfil es la que la política de alta exige: el caso de
  // Carlos sólo puede abrirse en SU tienda. Los dos de TI no tienen sucursal
  // (son roles corporativos) y por eso eligen la del caso.
  await db.exec(
    `insert into public.profiles (id, nombre, rol, sucursal_id) values
       ('${LIDER}', 'Ana Líder', 'LIDER', null),
       ('${SUCURSAL}', 'Carlos Sucursal', 'EVALUADOR', '${SUCURSAL_ID}'),
       ('${GERENTE_TI}', 'Gina Gerente TI', 'GERENTE_TI', null),
       ('${TECNICO_TI}', 'Tomás Técnico TI', 'TECNICO_TI', null)`
  )
  // Primera corrida… y la segunda: el bloque tiene que ser idempotente.
  await db.exec(bloqueSql('helpdesk.sql'))
  await db.exec(bloqueSql('helpdesk.sql'))
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
 * `fn` en esa sesión. Siempre vuelve al rol original.
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

/** Baja al rol `anon`: nadie sin sesión toca la mesa de ayuda. */
async function conAnon(fn: () => Promise<void>): Promise<void> {
  await como(null)
  await db.exec('set role anon')
  try {
    await fn()
  } finally {
    await db.exec('reset role')
  }
}

/** Crea un caso devolviendo su código, como lo haría una sucursal. */
async function crearCaso(titulo = 'El POS no imprime'): Promise<string> {
  const r = await db.query<{ codigo: string }>(
    `insert into helpdesk_ticket
       (titulo, descripcion, sucursal_id, sucursal_nombre, reportado_nombre,
        categoria, prioridad)
     values ($1, 'Falla al cerrar el turno', $2, 'Sucursal Las Mercedes',
             'Carlos Sucursal', 'Impresoras y Etiquetadoras', 'Alta')
     returning codigo`,
    [titulo, SUCURSAL_ID]
  )
  return r.rows[0].codigo
}

describe('helpdesk.sql · casos', () => {
  it('nace numerado desde HD-1043, con el default de la secuencia', async () => {
    await conRol(SUCURSAL, async () => {
      expect(await crearCaso()).toBe('HD-1043')
    })
    // El default corre en la sesión de la sucursal: si la secuencia no
    // estuviera concedida, el INSERT moriría antes de llegar al RLS.
    await conRol(SUCURSAL, async () => {
      expect(await crearCaso('Segundo caso')).toBe('HD-1044')
    })
  })

  it('el caso nace en la SUCURSAL DEL QUE REPORTA: no se puede abrir en otra', async () => {
    // La suya: pasa (es lo que hace la pantalla, con la sucursal bloqueada).
    await conRol(SUCURSAL, async () => {
      expect(await crearCaso('Caso de mi tienda')).toMatch(/^HD-/)
    })

    // La de otra sucursal: el `with check` la rechaza. La pantalla ya muestra
    // la sucursal como dato y sin selector; la BASE es lo que impide mandarla
    // a otra desde afuera.
    await conRol(SUCURSAL, async () => {
      await expect(
        db.query(
          `insert into helpdesk_ticket (titulo, sucursal_id, sucursal_nombre, categoria)
           values ('Colado en otra tienda', '${OTRA_SUCURSAL}', 'Sucursal El Bosque', 'Redes y Wi-Fi')`
        )
      ).rejects.toThrow(/row-level security/i)
    })

    // El Líder sí puede abrirla en cualquiera: su perfil no tiene sucursal
    // y, además, `es_lider()` manda.
    await conRol(LIDER, async () => {
      await expect(
        db.query(
          `insert into helpdesk_ticket (titulo, sucursal_id, sucursal_nombre, categoria)
           values ('Desde oficina', '${SUCURSAL_ID}', 'Sucursal Las Mercedes', 'Redes y Wi-Fi')`
        )
      ).resolves.toBeDefined()
    })
  })

  it('cualquier sesión lee todos los casos; anon ni siquiera eso', async () => {
    await conRol(SUCURSAL, async () => {
      const r = await db.query(`select codigo from helpdesk_ticket`)
      expect(r.rows.length).toBeGreaterThanOrEqual(2)
    })
    await conAnon(async () => {
      await expect(db.query(`select codigo from helpdesk_ticket`)).rejects.toThrow(
        /permission denied|row-level security/i
      )
    })
  })

  it('la sucursal NO gestiona: su UPDATE del caso no toca ninguna fila', async () => {
    const codigo = await crearCaso('Caso que la sucursal quiere cerrar sola')
    await conRol(SUCURSAL, async () => {
      const r = await db.query(
        `update helpdesk_ticket set estado = 'Cerrado', prioridad = 'Baja'
          where codigo = $1 returning codigo`,
        [codigo]
      )
      // Sin error y SIN filas: la política `using (es_lider())` la deja afuera.
      expect(r.rows).toHaveLength(0)
    })
    const r = await db.query<{ estado: string }>(
      `select estado from helpdesk_ticket where codigo = $1`,
      [codigo]
    )
    expect(r.rows[0].estado).toBe('Abierto')
  })

  it('el Líder sí gestiona: estado, prioridad y técnico', async () => {
    const codigo = await crearCaso('Caso que TI toma')
    await conRol(LIDER, async () => {
      const r = await db.query(
        `update helpdesk_ticket
            set estado = 'En Progreso', prioridad = 'Crítica',
                tecnico_dni = 12345678, tecnico_nombre = 'Luis Soporte'
          where codigo = $1 returning codigo`,
        [codigo]
      )
      expect(r.rows).toHaveLength(1)
    })
    const r = await db.query<{ estado: string; tecnico_nombre: string }>(
      `select estado, tecnico_nombre from helpdesk_ticket where codigo = $1`,
      [codigo]
    )
    expect(r.rows[0].estado).toBe('En Progreso')
    expect(r.rows[0].tecnico_nombre).toBe('Luis Soporte')
  })

  it('rechaza estados y prioridades fuera del catálogo (check)', async () => {
    await conRol(LIDER, async () => {
      await expect(
        db.query(`insert into helpdesk_ticket (titulo, categoria, estado) values ('X', 'Sistema / ERP', 'Vuelo')`)
      ).rejects.toThrow(/violates check constraint/i)
    })
  })
})

describe('helpdesk.sql · sólo el gerente reparte', () => {
  it('el Técnico no asigna: el disparador lo frena, pero el estado sí lo cambia', async () => {
    const codigo = await crearCaso('Caso que el técnico quiere tomarse')
    await conRol(TECNICO_TI, async () => {
      await expect(
        db.query(
          `update helpdesk_ticket set tecnico_dni = 44444444, tecnico_nombre = 'Se autoasigna'
            where codigo = $1`,
          [codigo]
        )
      ).rejects.toThrow(/Sólo el Gerente de TI/)

      // Cambiar el ESTADO es su trabajo: el disparador sólo mira al técnico
      // de la fila, no al resto de la gestión.
      const r = await db.query(
        `update helpdesk_ticket set estado = 'En Progreso' where codigo = $1 returning codigo`,
        [codigo]
      )
      expect(r.rows).toHaveLength(1)
    })
  })

  it('el Gerente de TI sí reparte', async () => {
    const codigo = await crearCaso('Caso que el gerente reparte')
    await conRol(GERENTE_TI, async () => {
      const r = await db.query<{ tecnico_dni: number }>(
        `update helpdesk_ticket set tecnico_dni = 44444444, tecnico_nombre = 'Rosa Redes'
          where codigo = $1 returning tecnico_dni`,
        [codigo]
      )
      expect(Number(r.rows[0].tecnico_dni)).toBe(44444444)
    })
  })

  it('el atendedor puede ser un USUARIO con rol TECNICO_TI: el disparador también lo mira', async () => {
    const codigo = await crearCaso('Caso para un usuario técnico')

    // El Técnico no se lo asigna a sí mismo por usuario, tampoco…
    await conRol(TECNICO_TI, async () => {
      await expect(
        db.query(`update helpdesk_ticket set tecnico_usuario = '${TECNICO_TI}' where codigo = $1`, [codigo])
      ).rejects.toThrow(/Sólo el Gerente de TI/)
    })

    // …y el Gerente sí: queda guardado el UUID del usuario (que no tiene
    // DNI) en la columna nueva, con el nombre para mostrar.
    await conRol(GERENTE_TI, async () => {
      const r = await db.query<{ tecnico_usuario: string }>(
        `update helpdesk_ticket set tecnico_usuario = '${TECNICO_TI}', tecnico_nombre = 'Tomás Técnico TI'
          where codigo = $1 returning tecnico_usuario`,
        [codigo]
      )
      expect(r.rows[0].tecnico_usuario).toBe(TECNICO_TI)
    })
  })
})

describe('helpdesk.sql · el equipo de TI', () => {
  it('el Técnico atiende el caso, pero no arma el equipo', async () => {
    const codigo = await crearCaso('Caso para el técnico')

    // Atender es su trabajo: toma el caso y cambia el estado.
    await conRol(TECNICO_TI, async () => {
      const r = await db.query(
        `update helpdesk_ticket set estado = 'En Progreso', tecnico_nombre = 'Tomás Técnico TI'
          where codigo = $1 returning codigo`,
        [codigo]
      )
      expect(r.rows).toHaveLength(1)

      // …pero administrar el equipo es de Líder o Gerente de TI.
      await expect(
        db.query(`insert into helpdesk_tecnico (dni, nombre) values (555, 'Invitado')`)
      ).rejects.toThrow(/row-level security/i)
    })

    const r = await db.query<{ estado: string }>(
      `select estado from helpdesk_ticket where codigo = $1`,
      [codigo]
    )
    expect(r.rows[0].estado).toBe('En Progreso')
  })

  it('el Gerente de TI arma el equipo y escribe notas que el Técnico lee', async () => {
    await conRol(GERENTE_TI, async () => {
      await db.query(`insert into helpdesk_tecnico (dni, nombre) values (555, 'Invitado TI')`)
      const alta = await db.query(`select dni from helpdesk_tecnico where dni = 555`)
      expect(alta.rows).toHaveLength(1)
      await db.query(`delete from helpdesk_tecnico where dni = 555`)

      // La nota interna la escribe el equipo de TI…
      const codigo = await crearCaso('Caso con nota interna del equipo')
      await db.query(
        `insert into helpdesk_mensaje (codigo_ticket, sender_type, sender_name, texto, es_nota_interna)
         values ($1, 'it', 'Gina Gerente TI', 'Revisar hoy, es urgente', true)`,
        [codigo]
      )
    })

    // …y el Técnico la lee (la sucursal no: eso cubre su propio test).
    await conRol(TECNICO_TI, async () => {
      const n = await db.query<{ n: number }>(
        `select count(*)::int as n from helpdesk_mensaje
          where es_nota_interna = true and sender_name = 'Gina Gerente TI'`
      )
      expect(Number(n.rows[0].n)).toBe(1)
    })
  })
})

describe('helpdesk.sql · chat', () => {
  it('la sucursal escribe sólo como branch: no puede firmar como TI', async () => {
    const codigo = await crearCaso('Para el chat')
    await conRol(SUCURSAL, async () => {
      await expect(
        db.query(
          `insert into helpdesk_mensaje (codigo_ticket, sender_type, sender_name, texto)
           values ($1, 'it', 'Falso TI', 'Le cambio el estado yo')`,
          [codigo]
        )
      ).rejects.toThrow(/row-level security/i)
      await expect(
        db.query(
          `insert into helpdesk_mensaje (codigo_ticket, sender_type, sender_name, texto)
           values ($1, 'system', 'Sistema HelpDesk', 'Resuelto solito')`,
          [codigo]
        )
      ).rejects.toThrow(/row-level security/i)
    })
  })

  it('el Líder sí escribe como TI y como sistema', async () => {
    const codigo = await crearCaso('Para el chat del líder')
    await conRol(LIDER, async () => {
      await db.query(
        `insert into helpdesk_mensaje (codigo_ticket, sender_type, sender_name, texto)
         values ($1, 'it', 'Ana Líder (TI)', 'Revisamos el caso')`,
        [codigo]
      )
      await db.query(
        `insert into helpdesk_mensaje (codigo_ticket, sender_type, sender_name, texto)
         values ($1, 'system', 'Sistema HelpDesk', 'Caso asignado')`,
        [codigo]
      )
    })
    const r = await db.query(
      `select sender_type from helpdesk_mensaje where codigo_ticket = $1 order by created_at`,
      [codigo]
    )
    expect(r.rows.map((f) => (f as { sender_type: string }).sender_type)).toEqual([
      'it',
      'system'
    ])
  })

  it('las notas internas no existen para la sucursal (son del equipo de TI)', async () => {
    const codigo = await crearCaso('Caso con nota interna')
    await conRol(LIDER, async () => {
      await db.query(
        `insert into helpdesk_mensaje (codigo_ticket, sender_type, sender_name, texto)
         values ($1, 'it', 'Ana Líder (TI)', '¿Pueden reiniciar el POS?')`,
        [codigo]
      )
      await db.query(
        `insert into helpdesk_mensaje
           (codigo_ticket, sender_type, sender_name, texto, es_nota_interna)
         values ($1, 'it', 'Ana Líder (TI)', 'El usuario hizo algo raro', true)`,
        [codigo]
      )
    })
    await conRol(SUCURSAL, async () => {
      const internas = await db.query(
        `select count(*)::int as n from helpdesk_mensaje
          where codigo_ticket = $1 and es_nota_interna = true`,
        [codigo]
      )
      expect((internas.rows[0] as { n: number }).n).toBe(0)
      // …y el resto del chat sí lo ve: la nota no borra la conversación.
      const total = await db.query(
        `select count(*)::int as n from helpdesk_mensaje where codigo_ticket = $1`,
        [codigo]
      )
      expect((total.rows[0] as { n: number }).n).toBe(1)
    })
    await conRol(LIDER, async () => {
      const internas = await db.query(
        `select count(*)::int as n from helpdesk_mensaje
          where codigo_ticket = $1 and es_nota_interna = true`,
        [codigo]
      )
      expect((internas.rows[0] as { n: number }).n).toBe(1)
    })
  })

  it('el mensaje de la sucursal mueve el updated_at del caso (trigger definer)', async () => {
    const codigo = await crearCaso('Caso para el sello')
    // Lo pongo viejo a mano: sin el trigger, el mensaje lo dejaría igual.
    await db.query(
      `update helpdesk_ticket set updated_at = now() - interval '1 hour' where codigo = $1`,
      [codigo]
    )
    await conRol(SUCURSAL, async () => {
      await db.query(
        `insert into helpdesk_mensaje (codigo_ticket, sender_type, sender_name, texto)
         values ($1, 'branch', 'Carlos Sucursal (Sucursal Las Mercedes)', 'Sigue fallando')`,
        [codigo]
      )
    })
    const r = await db.query<{ fresco: boolean }>(
      `select updated_at > now() - interval '5 minutes' as fresco
         from helpdesk_ticket where codigo = $1`,
      [codigo]
    )
    expect(r.rows[0].fresco).toBe(true)
  })
})

describe('helpdesk.sql · equipo TI', () => {
  it('lo carga y quita sólo el Líder; el resto sólo lo lee', async () => {
    await conRol(SUCURSAL, async () => {
      await expect(
        db.query(
          `insert into helpdesk_tecnico (dni, nombre) values (87654321, 'Intruso')`
        )
      ).rejects.toThrow(/row-level security/i)
      const r = await db.query(`select count(*)::int as n from helpdesk_tecnico`)
      expect((r.rows[0] as { n: number }).n).toBe(0)
    })
    await conRol(LIDER, async () => {
      await db.query(
        `insert into helpdesk_tecnico (dni, nacionalidad, nombre, especialidad)
         values (87654321, 'V', 'Luis Soporte', 'Redes')`
      )
      // Re-elegir al mismo lo reactiva con la especialidad nueva (upsert).
      await db.query(
        `insert into helpdesk_tecnico (dni, nacionalidad, nombre, especialidad, activo)
         values (87654321, 'V', 'Luis Soporte', 'Impresoras', false)
         on conflict (nacionalidad, dni)
         do update set especialidad = excluded.especialidad, activo = excluded.activo`
      )
    })
    const r = await db.query<{ especialidad: string; activo: boolean }>(
      `select especialidad, activo from helpdesk_tecnico where dni = 87654321`
    )
    expect(r.rows[0].especialidad).toBe('Impresoras')
    expect(r.rows[0].activo).toBe(false)
    await conRol(LIDER, async () => {
      await db.query(`delete from helpdesk_tecnico where dni = 87654321`)
    })
    const luego = await db.query(
      `select count(*)::int as n from helpdesk_tecnico where dni = 87654321`
    )
    expect((luego.rows[0] as { n: number }).n).toBe(0)
  })
})
