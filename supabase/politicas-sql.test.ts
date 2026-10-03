import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * `reactivar-politicas.sql` y `validar-politicas.sql` son copias de lo que
 * dicen `schema.sql`, `incidencias.sql` y `proyectos-biometrico.sql`. Una copia
 * manual se desactualiza sola la primera vez que alguien agrega una política, y
 * el síntoma es boats: la tabla nueva queda abierta y nadie se entera hasta que
 * aparece en un reporte.
 *
 * Estos tests derivan la lista esperado de los archivos de origen, así que si
 * cambia una política y no se actualizan las copias, falla acá y no en producción.
 */

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

const schema = fuente('./schema.sql')
const incidencias = fuente('./incidencias.sql')
const biometrico = fuente('./proyectos-biometrico.sql')
const reactivar = fuente('./reactivar-politicas.sql')
const validar = fuente('./validar-politicas.sql')
const cerrar = fuente('./cerrar-lectura-anon.sql')
const permisos = fuente('./permisos-funcion.sql')

interface Politica {
  nombre: string
  tabla: string
}

/** Las políticas tal como están definidas en los archivos que se aplican. */
function politicasDeOrigen(): Politica[] {
  const salida: Politica[] = []
  for (const sql of [schema, incidencias, biometrico]) {
    for (const m of sql.matchAll(/^\s*create policy\s+"?(\w+)"?\s+on\s+(public\.\w+|storage\.objects)/gim)) {
      salida.push({ nombre: m[1], tabla: m[2] })
    }
  }
  // Sin el Set: un nombre repetido entre archivos es un error que hay que ver.
  const vistos = new Set<string>()
  for (const p of salida) {
    const clave = `${p.tabla}.${p.nombre}`
    expect(vistos.has(clave), `política duplicada en el origen: ${clave}`).toBe(false)
    vistos.add(clave)
  }
  return salida
}

const esperadas = politicasDeOrigen()

/** Los pares (nombre, tabla) que declara la lista `values` del validador. */
function declaradasEnValidador(): Politica[] {
  const bloque = validar.match(/with esperadas \(politica, tabla\) as \(\s*values([\s\S]*?)\n\)/)
  expect(bloque, 'no se encontró la lista de políticas esperadas').toBeTruthy()
  const salida: Politica[] = []
  for (const m of bloque![1].matchAll(/\('([^']+)',\s*'([^']+)'\)/g)) {
    salida.push({ nombre: m[1], tabla: m[2] })
  }
  return salida
}

/** Los `drop`/`create policy` que repone el reactivador. */
function respuestasEnReactivador(): Politica[] {
  const salida: Politica[] = []
  const re = /drop policy if exists "?(\w+)"? on (public\.\w+|storage\.objects);[\s\S]*?create policy\s+"?(\w+)"?\s+on (public\.\w+|storage\.objects)/gi
  for (const m of reactivar.matchAll(re)) {
    expect(m[1], `el drop y el create no coinciden: ${m[1]} vs ${m[3]}`).toBe(m[3])
    expect(m[2], `la tabla no coincide en ${m[1]}`).toBe(m[4])
    salida.push({ nombre: m[1], tabla: m[2] })
  }
  return salida
}

const clave = (p: Politica) => `${p.tabla}.${p.nombre}`

/**
 * El SQL sin comentarios. Necesario para los tests que preguntan "¿esto depende
 * de tal cosa?": los archivos explican en prosa qué archivos hay que correr antes,
 * y esa prosa no es una dependencia.
 */
function sinComentarios(sql: string): string {
  return sql.replace(/--[^\n]*/g, '')
}

/**
 * Los seis helpers que las políticas RLS invocan desde `using`/`with check`.
 * Postgres evalúa la política con los privilegios de quien consulta, así que sin
 * `EXECUTE` para `anon` y `authenticated` toda la app responde
 * `permission denied for function`. El advisor los marca como quitables: no lo son.
 */
const HELPERS_RLS = [
  'es_lider',
  'puede_ver_evaluacion',
  'puede_responder',
  'puede_manejar_instancia',
  'puede_reportar_incidencia',
  'puede_ver_incidencia',
]

describe('reactivar-politicas.sql · deja las reglas como están', () => {
  it('el extractor encuentra las políticas de los archivos de origen', () => {
    // Si esto baja de 45, algo se rompió el patrón y los tests de abajo pasarían
    // en falso (compararían contra una lista vacía).
    expect(esperadas.length).toBeGreaterThanOrEqual(45)
    expect(esperadas.every((p) => p.tabla === 'storage.objects' || p.tabla.startsWith('public.'))).toBe(true)
  })

  it('repone TODAS las políticas del origen, sin sobra ni falta', () => {
    const repuestas = respuestasEnReactivador()
    const faltantes = esperadas.filter((p) => !repuestas.some((r) => clave(r) === clave(p))).map(clave)
    const deMas = repuestas.filter((r) => !esperadas.some((p) => clave(p) === clave(r))).map(clave)
    expect({ faltantes, deMas }).toEqual({ faltantes: [], deMas: [] })
  })

  it('cada política va con su drop antes, para que se pueda correr dos veces', () => {
    const drops = [...reactivar.matchAll(/drop policy if exists "?(\w+)"? on /gi)].map((m) => m[1])
    for (const p of esperadas) expect(drops, `falta el drop de ${p.nombre}`).toContain(p.nombre)
  })

  it('enciende RLS en todas las tablas, y también en las que falten', () => {
    const tablas = [...new Set(esperadas.filter((p) => p.tabla.startsWith('public.')).map((p) => p.tabla))]
    for (const t of tablas) {
      expect(reactivar, `falta enable RLS de ${t}`).toMatch(
        new RegExp(`alter table ${t.replace('.', '\\.')} enable row level security;`)
      )
    }
    // El bloque DO es el que cubre una tabla nueva sin tocar el archivo.
    expect(reactivar).toContain('alter table public.%I enable row level security')
  })

  it('no crea ni borra tablas: solo RLS, políticas y permisos', () => {
    // Es lo que lo hace seguro correrlo sobre una base que ya tiene todo.
    expect(reactivar).not.toMatch(/^\s*(create|drop)\s+table\b/im)
    expect(reactivar).not.toMatch(/^\s*(truncate|delete\s+from|update\s+\w+\s+set)\b/im)
    expect(reactivar).not.toMatch(/^\s*insert\s+into/im)
    // `drop policy` sí está y es lo que hace idempotente al archivo. Lo que no
    // debe aparecer es un drop de otra cosa: si se cae una función o un trigger,
    // el archivo deja de ser solo RLS.
    expect(reactivar).not.toMatch(/^\s*drop\s+(function|trigger|index|table)\b/im)
    expect(reactivar).toMatch(/^\s*drop\s+policy\s+if\s+exists/im)
  })

  it('repone los permisos de las funciones, y no a los helpers de RLS', () => {
    // Si aparece un revoke contra un helper, revuelve el error caro: la base
    // queda entera ilegible con 'permission denied for function'.
    const revocadas = [...reactivar.matchAll(/revoke\s+execute\s+on\s+function\s+public\.(\w+)/gi)].map((m) => m[1])
    const rotas = HELPERS_RLS.filter((h) => revocadas.includes(h))
    expect(rotas, `no se puede revocar: ${rotas.join(', ')}`).toEqual([])
  })

  it('todo revoke quita PUBLIC y el rol, porque los permisos son aditivos', () => {
    const revocadas = [...reactivar.matchAll(/revoke\s+execute\s+on\s+function\s+public\.(\w+)[^;]*?from\s+([^;]+);/gi)]
    expect(revocadas.length).toBeGreaterThan(0)
    for (const [, fn, roles] of revocadas) {
      const lista = roles.split(',').map((r) => r.trim().toLowerCase())
      expect(lista, `${fn} sin PUBLIC`).toContain('public')
      expect(lista.some((r) => r === 'anon' || r === 'authenticated'), `${fn} no quita ningún rol de la API`).toBe(true)
    }
  })

  it('es una transacción: si algo falla no queda la base a medias', () => {
    expect(reactivar).toMatch(/^\s*begin;/im)
    expect(reactivar).toMatch(/^\s*commit;/im)
  })
})

describe('validar-politicas.sql · mira lo que hay que mirar', () => {
  it('declara exactamente las políticas del origen', () => {
    const declaradas = declaradasEnValidador()
    expect(declaradas.length).toBe(esperadas.length)
    const faltantes = esperadas.filter((p) => !declaradas.some((d) => clave(d) === clave(p))).map(clave)
    const deMas = declaradas.filter((d) => !esperadas.some((p) => clave(p) === clave(d))).map(clave)
    expect({ faltantes, deMas }).toEqual({ faltantes: [], deMas: [] })
  })

  it('detecta RLS apagado y también RLS sin políticas, que son fallos distintos', () => {
    // Con RLS apagado la tabla está abierta; con RLS y cero políticas no devuelve
    // nada. Ambos son silenciosos, así que tienen que salir por separado.
    expect(validar).toContain('c.relrowsecurity')
    expect(validar).toContain('FALTA RLS')
    expect(validar).toContain('sin politicas')
  })

  it('avisa si a un helper de RLS le sacaron el EXECUTE', () => {
    // El síntoma de eso no es 'no tenés permiso' sino que la app deja de leer y
    // escribir en todo, que es mucho más difícil de diagnoses.
    expect(validar).toMatch(/has_function_privilege\('authenticated'/)
    for (const h of ['es_lider', 'puede_responder', 'puede_manejar_instancia']) {
      expect(validar).toContain(h)
    }
  })

  it('solo da por buena la apertura de las dos funciones del login', () => {
    expect(validar).toContain("when p.proname in ('intento_login', 'email_por_usuario')")
    expect(validar).toContain('ABIERTA A ANON')
  })

  it('no modifica nada: es de solo lectura', () => {
    expect(validar).not.toMatch(/^\s*(create|drop|alter|insert|update|delete|revoke|grant)\b/im)
  })
})

/**
 * Siete tablas se leían sin sesión. Todas tenían su política de lectura como
 * `for select using (true)` SIN `to authenticated`, y sin `to` una política RLS
 * aplica a PUBLIC, que incluye al rol `anon`. Sumado al `grant all` inicial de
 * Supabase, cualquiera sin cuenta hacía `select *` y se llevaba, entre otras
 * cosas, la rúbrica completa con puntajes y umbrales.
 *
 * El advisor no reportó NINGUNA de las siete: sus 29 avisos eran todos de
 * funciones. Estos tests existen para que no vuelva a abrirse por descuido.
 */
describe('lectura anónima · las 7 tablas del catálogo', () => {
  /** Las que tenían `using (true)` sin `to`, en el orden en que se corrigen. */
  const TABLAS = [
    'profiles',
    'sucursales',
    'modulos',
    'items',
    'sucursal_modulos',
    'sucursal_items',
    'sucursal_opciones',
  ]

  const conPolitica = [
    ['schema.sql', schema],
    ['reactivar-politicas.sql', reactivar],
    ['cerrar-lectura-anon.sql', cerrar],
  ] as const

  /** La sentencia `create policy <tabla>_select ... ;` tal cual está escrita. */
  function politica(sql: string, tabla: string): string | undefined {
    return [...sql.matchAll(new RegExp(`^\\s*create policy\\s+${tabla}_select\\b[\\s\\S]*?;`, 'gim'))][0]?.[0]
  }

  it('ninguna política de lectura se queda sin `to authenticated`', () => {
    // `using (true)` sola NO cierra nada: sin `to` la política sigue aplicando a
    // PUBLIC. El `to authenticated` es la parte que hace el trabajo.
    for (const [nombre, sql] of conPolitica) {
      for (const tabla of TABLAS) {
        const stmt = politica(sql, tabla)
        expect(stmt, `${nombre}: no se encuentra la política ${tabla}_select`).toBeTruthy()
        expect(
          stmt!.toLowerCase(),
          `${nombre}: ${tabla}_select sin 'to authenticated' (deja leer a anon)`
        ).toMatch(/\bto\s+authenticated\b/)
      }
    }
  })

  it('el nombre de la política es el de la tabla, sin parecidos', () => {
    // Escribir `perfiles_select` en vez de `profiles_select` (español por
    // costumbre) deja la política vieja viva: el `drop` no borra nada, el `create`
    // agrega una segunda, y como las políticas permisivas se unen con OR la que
    // abría `anon` sigue abriendo. El archivo da "éxito" y no cierra nada. Por eso
    // no basta con Testear el `to`: hay que fijar el nombre exacto.
    for (const [nombre, sql] of conPolitica) {
      for (const [, politica_, tabla] of sql.matchAll(
        /^\s*create policy\s+(\w+_select)\s+on\s+public\.(\w+)\s+for\s+select/gim
      )) {
        expect(
          politica_.toLowerCase(),
          `${nombre}: la política de lectura de ${tabla} se llama ${politica_}, pero el drop de este mismo archivo no la borra`
        ).toBe(`${tabla}_select`)
      }
    }
  })

  it('cada `drop` de lectura precede a su `create`, con el mismo nombre', () => {
    // Un `drop` con otro nombre deja la política vieja viva (ver el test
    // anterior), y uno faltante hace que la segunda corrida tire 42710 y corte el
    // resto del bloque en el SQL Editor.
    const drops = [...sinComentarios(cerrar).matchAll(/drop policy if exists (\w+_select) on public\.(\w+);/gi)].map(
      (m) => m[1].toLowerCase()
    )
    const creates = [...sinComentarios(cerrar).matchAll(/create policy (\w+_select) on public\.(\w+) for select/gi)]
      .map((m) => m[1].toLowerCase())
    expect(drops.sort()).toEqual([...creates].sort())
  })

  it('cada una de las 7 tiene su revoke del permiso a `anon`', () => {
    // La política sola no alcanza: los permisos de Postgres son aditivos, así que
    // un `grant select` explícito al rol la saltearía. Hacen falta las dos llaves.
    // El revoke va en un bucle sobre la lista, así que se chequea que estén todas.
    for (const [nombre, sql] of conPolitica) {
      for (const tabla of TABLAS) {
        const codigo = sinComentarios(sql)
        const revokeLiteral = new RegExp(
          `revoke\\s+select\\s+on\\s+public\\.${tabla}\\s+from\\s+anon\\s*;`,
          'i'
        ).test(codigo)
        const revokeEnBucle = /foreach\s+t\s+in\s+array/i.test(codigo) && codigo.includes(`'${tabla}'`)
        expect(
          revokeLiteral || revokeEnBucle,
          `${nombre}: falta el revoke select de ${tabla} para anon`
        ).toBe(true)
      }
    }
  })

  it('el bucle de revoke cubre exactamente las 7, sin forgetting ni sobrantes', () => {
    // Un `foreach` con una lista desalineada es el modo típico de que este fix se
    // applies a 6 de 7 en silencio.
    for (const [nombre, sql] of conPolitica) {
      const bloque = sinComentarios(sql).match(/foreach\s+t\s+in\s+array\s+array\[([\s\S]*?)\]/i)
      if (!bloque) continue
      const enElBucle = [...bloque[1].matchAll(/'(\w+)'/g)].map((m) => m[1])
      expect(enElBucle.sort(), `${nombre}: el bucle de revoke no coincide con la lista`).toEqual([...TABLAS].sort())
    }
  })

  it('`anon` no queda con select por un grant explícito en ningún archivo', () => {
    // Un `grant select on public.<tabla> to anon` deshace el fix sin tocar la
    // política, y no se vería en el advisor.
    for (const [nombre, sql] of conPolitica) {
      for (const tabla of TABLAS) {
        expect(
          sql,
          `${nombre}: hay un grant select a anon sobre ${tabla}`
        ).not.toMatch(new RegExp(`grant\\s+select\\s+on\\s+public\\.${tabla}\\s+to\\s+anon`, 'i'))
      }
    }
  })

  it('`authenticated` conserva la lectura en las 7, porque la app la necesita', () => {
    // El catálogo entero sale de `catalog.ts` (CatalogContext, que recién carga
    // cuando hay perfil) y los joins por FK como
    // `sucursal:sucursales!profiles_sucursal_id_fkey` dependen de `sucursales`.
    // Cerrar a "solo yo" o a "solo Líder" rompe esas pantallas.
    for (const [nombre, sql] of conPolitica) {
      for (const tabla of TABLAS) {
        const codigo = sinComentarios(sql)
        expect(
          codigo,
          `${nombre}: le cerró ${tabla} al rol autenticado`
        ).not.toMatch(new RegExp(`revoke\\s+select\\s+on\\s+public\\.${tabla}\\s+from\\s+([^;]*\\bauthenticated\\b)`, 'i'))
      }
    }
  })

  it('las tablas que ya devolvían cero filas para anon no se tocan', () => {
    // `evaluaciones`, `respuestas`, `instancias_grupo`, `fotos`, `asignaciones` e
    // `incidencias` preguntan por `auth.uid()` o `es_lider()`, que para anon da
    // falso: el `using` ya las cerraba. Este test es para que nadie las "arregle"
    // después y rompa algo que funcionaba.
    const yaCerradas = [
      'evaluaciones',
      'respuestas',
      'instancias_grupo',
      'fotos',
      'asignaciones',
      'asignaciones_modulos',
    ]
    for (const [nombre, sql] of conPolitica) {
      for (const tabla of yaCerradas) {
        const stmt = politica(sql, tabla)
        if (!stmt) continue
        expect(
          stmt!.toLowerCase(),
          `${nombre}: ${tabla} ya estaba cerrada por su using; no le cambies el to`
        ).not.toMatch(/\bto\s+authenticated\b/)
      }
    }
  })

  it('el login sigue funcionando: las dos funciones del login conservan `anon`', () => {
    // El fix de las tablas no puede arrastrar a estas dos. Son security definer,
    // así que no dependen del permiso sobre la tabla, pero el permiso sobre la
    // función sí: sin él no hay pantalla de login.
    for (const [nombre, sql] of [
      ['schema.sql', schema],
      ['reactivar-politicas.sql', reactivar],
      ['permisos-funcion.sql', permisos],
    ] as const) {
      for (const fn of ['intento_login', 'email_por_usuario']) {
        const grants = [
          ...sql.matchAll(
            new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${fn}\\([^)]*\\)\\s+to\\s+([^;]+);`, 'gi')
          ),
        ]
        expect(grants.length, `${nombre}: sin grant execute de ${fn}`).toBeGreaterThan(0)
        const ultimo = grants[grants.length - 1][1].toLowerCase()
        const roles = ultimo.split(',').map((r) => r.trim())
        expect(roles, `${nombre}: ${fn} perdió el acceso de anon`).toContain('anon')
      }
    }
  })

  it('el login no queda abierto a `authenticated` de paso', () => {
    // Estas dos son de la pantalla sin sesión. Dejarlas en `authenticated` no
    // rompe nada, pero son dos de las alertas del advisor sin motivo, y una de
    // las dos fuentes (`schema.sql`) las tenía abiertas.
    for (const [nombre, sql] of [
      ['schema.sql', schema],
      ['reactivar-politicas.sql', reactivar],
      ['permisos-funcion.sql', permisos],
    ] as const) {
      for (const fn of ['intento_login', 'email_por_usuario']) {
        for (const [, roles] of sql.matchAll(
          new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${fn}\\([^)]*\\)\\s+to\\s+([^;]+);`, 'gi')
        )) {
          expect(roles.toLowerCase(), `${nombre}: ${fn} sigue con permiso para authenticated`).not.toMatch(
            /\bauthenticated\b/
          )
        }
      }
    }
  })

  it('cerrar-lectura-anon.sql es idempotente', () => {
    // `create policy` a secas tira 42710 si la política ya existe, y en el SQL
    // Editor eso corta el resto del bloque. Por eso los `drop policy if exists`
    // van explícitos y literales, uno por tabla.
    for (const tabla of TABLAS) {
      expect(cerrar, `falta el drop de ${tabla}_select`).toMatch(
        new RegExp(`drop policy if exists ${tabla}_select on public\\.${tabla};`, 'i')
      )
    }
  })

  it('cerrar-lectura-anon.sql no depende de `incidencias`, que es lo que lo hace utilizable', () => {
    // Es el fix que hay que correr ANTES de poder correr el reactivador, y el
    // reactivador sí depende de `incidencias.sql`. Si este también dependiera,
    // quedaría trabado el orden entero. Sin comentarios: el archivo explica el
    // orden en la prosa, y eso no es una dependencia.
    const codigo = sinComentarios(cerrar)
    expect(codigo).not.toMatch(/incidencias?/i)
    expect(codigo).not.toMatch(/puede_(reportar|ver)_incidencia/i)
  })

  it('cerrar-lectura-anon.sql no toca permisos de funciones', () => {
    // Si apareciera un revoke de execute, podría llevarse por delante un helper de
    // RLS y romper la app entera desde un archivo que dice cerrar la lectura.
    const codigo = sinComentarios(cerrar)
    expect(codigo).not.toMatch(/\b(grant|revoke)\s+execute\b/i)
  })

  it('ningún archivo revoca EXECUTE a un helper de RLS', () => {
    for (const [nombre, sql] of [
      ['schema.sql', schema],
      ['reactivar-politicas.sql', reactivar],
      ['cerrar-lectura-anon.sql', cerrar],
      ['permisos-funcion.sql', permisos],
    ] as const) {
      const revocadas = [...sql.matchAll(/revoke\s+execute\s+on\s+function\s+public\.(\w+)/gi)].map((m) => m[1])
      const rotas = HELPERS_RLS.filter((h) => revocadas.includes(h))
      expect(rotas, `${nombre}: no se puede revocar ${rotas.join(', ')}`).toEqual([])
    }
  })
})