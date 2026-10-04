import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

function bloqueSql(nombre: string): string {
  const lines = fuente('../../supabase/schema.sql').split(/\r?\n/)
  let capturando = false
  let yaPasoCabecera = false
  const partes: string[] = []

  for (const linea of lines) {
    if (linea.includes(`Archivo consolidado: ${nombre}`)) {
      capturando = true
      continue
    }
    if (!capturando) continue
    if (linea.includes('###########################################################################')) {
      if (yaPasoCabecera) break
      yaPasoCabecera = true
      continue
    }
    if (yaPasoCabecera) partes.push(linea)
  }

  return partes.join('\n')
}

/** Quita comentarios de linea y de bloque para no leer SQL como código. */
function sinComentarios(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')
}

/**
 * Funciones del schema, con lo que importa para el caso: si es security definer
 * y si tiene search_path fijo.
 */
function funcionesDelSchema(): Map<string, { definer: boolean; searchPath: boolean; trigger: boolean }> {
  const schema = sinComentarios(fuente('../../supabase/schema.sql'))
  const mapa = new Map<string, { definer: boolean; searchPath: boolean; trigger: boolean }>()
  for (const f of schema.matchAll(
    /create or replace function public\.(\w+)\s*\(([^)]*)\)([\s\S]*?)\$\$;/g
  )) {
    const nombre = f[1]
    const cuerpo = f[3]
    // El tipo de retorno va seguido de `language` en la misma línea, o en la
    // siguiente (`returns trigger` + `language plpgsql`).
    const ret = cuerpo.match(/returns\s+([^\n]*)/i)?.[1] ?? ''
    mapa.set(nombre, {
      definer: /security\s+definer/i.test(cuerpo),
      searchPath: /set\s+search_path/i.test(cuerpo),
      trigger: /^trigger\b/i.test(ret.trim())
    })
  }
  return mapa
}

/**
 * Los ayudantes que invocan las políticas RLS. Revocarles EXECUTE no es
 * endurecimiento: rompe la app entera, porque cada select/insert/update pasa por
 * ellos. La lista sale de los `using (...)` / `with check (...)` del propio SQL.
 */
function helpersDePolitica(): string[] {
  const archivos = [
    sinComentarios(bloqueSql('schema.sql')),
    sinComentarios(bloqueSql('incidencias.sql')),
    sinComentarios(bloqueSql('proyectos-biometrico.sql'))
  ]
  const usados = new Set<string>()
  for (const sql of archivos) {
    for (const p of sql.matchAll(/(?:using|with check)\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)/gi)) {
      for (const fn of p[1].matchAll(/public\.(\w+)\s*\(/g)) usados.add(fn[1])
    }
  }
  return [...usados].sort()
}

const remediation = sinComentarios(bloqueSql('permisos-funcion.sql'))
const schema = sinComentarios(bloqueSql('schema.sql'))

/** Todo el código de la app, para cruzar qué funciones se llaman por RPC. */
function codigoDeLaApp(): string {
  const raiz = fileURLToPath(new URL('../../src/', import.meta.url))
  let todo = ''
  for (const sub of ['lib', 'context', 'pages', 'components']) {
    const dir = join(raiz, sub)
    if (!existsSync(dir)) continue
    for (const archivo of readdirSync(dir, { recursive: true, withFileTypes: true })) {
      if (!archivo.isFile()) continue
      const nombre = join(archivo.parentPath ?? dir, archivo.name)
      if (!/\.(ts|tsx)$/.test(archivo.name)) continue
      if (/\.test\.tsx?$/.test(archivo.name)) continue
      todo += readFileSync(nombre, 'utf8') + '\n'
    }
  }
  return todo
}

const codigoApp = codigoDeLaApp()
const remitenteDeRespuestas = fuente('./offline/sync.ts')

describe('schema.sql · no rompe las políticas RLS', () => {
  const helpers = helpersDePolitica()

  it('el extractor encuentra los ayudantes de política', () => {
    // Si el extractor se rompe, los tests de abajo pasarían sin comprobar nada.
    expect(helpers).toContain('es_lider')
    expect(helpers).toContain('puede_ver_evaluacion')
    expect(helpers).toContain('puede_responder')
  })

  it('no revoca EXECUTE de ninguna función que usen las políticas', () => {
    // El error caro: revocar es_lider deja la base entera inaccesible.
    const revocadas = new Set(
      [...remediation.matchAll(/revoke\s+execute\s+on\s+function\s+public\.(\w+)/gi)].map((m) => m[1])
    )
    const rotas = helpers.filter((h) => revocadas.has(h))
    expect(rotas, `no se puede revocar: ${rotas.join(', ')}`).toEqual([])
  })

  it('tampoco los revoca en schema.sql (una instalación nueva los deja igual)', () => {
    const revocadas = new Set(
      [...schema.matchAll(/revoke\s+execute\s+on\s+function\s+public\.(\w+)/gi)].map((m) => m[1])
    )
    expect(helpers.filter((h) => revocadas.has(h))).toEqual([])
  })

  it('deja acceso a las dos de la pantalla de login, que corren sin sesión', () => {
    for (const fn of ['intento_login', 'email_por_usuario']) {
      // Nunca se les quita `anon`: en el login todavía no hay sesión. Lo que sí
      // sobra es `authenticated`, y quitárselo es seguro (ver AuthContext.signIn).
      expect(remediation).toMatch(new RegExp(`revoke[^;]*${fn}\\([^)]*\\) from public, authenticated;`, 'i'))
      expect(remediation).toMatch(new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${fn}\\([^)]*\\) to anon;`, 'i'))
      expect(remediation).not.toMatch(new RegExp(`revoke[^;]*${fn}[^;]* from [^;]*\\banon\\b`, 'i'))
    }
  })

  it('quita PUBLIC y el rol de la API, porque los permisos en Postgres son aditivos', () => {
    // El error del primer intento: revocar solo de PUBLIC no cambiaba nada, porque
    // el proyecto trae un `grant all on all functions` que deja permiso propio de
    // `anon`. Todo revoke tiene que llevar PUBLIC y el rol que se le quita.
    const revocadas = [...remediation.matchAll(/revoke\s+execute\s+on\s+function\s+public\.(\w+)[^;]*?from\s+([^;]+);/gi)]
    expect(revocadas.length).toBeGreaterThan(0)
    for (const [, fn, roles] of revocadas) {
      const lista = roles.split(',').map((r) => r.trim().toLowerCase())
      expect(lista, `${fn} sin PUBLIC`).toContain('public')
      expect(
        lista.some((r) => r === 'anon' || r === 'authenticated'),
        `${fn} no quita ningún rol de la API: PUBLIC solo no alcanza`
      ).toBe(true)
    }
  })
})

describe('schema.sql · corrige lo que sí está expuesto', () => {
  const fns = funcionesDelSchema()

  it('el extractor lee las funciones del schema', () => {
    expect(fns.get('validar_suma_puntaje_items')?.trigger).toBe(true)
    expect(fns.get('es_lider')?.definer).toBe(true)
  })

  it('toda función con search_path en el schema', () => {
    // La única que faltaba era validar_suma_puntaje_items (la alerta 0011).
    const sinFijar = [...fns.entries()].filter(([, v]) => !v.searchPath).map(([n]) => n)
    expect(sinFijar).toEqual([])
  })

  it('toda función de trigger deja de ser ejecutable por PUBLIC', () => {
    const revocadas = new Set(
      [...remediation.matchAll(/revoke\s+execute\s+on\s+function\s+public\.(\w+)/gi)].map((m) => m[1])
    )
    const deTrigger = [...fns.entries()].filter(([, v]) => v.trigger).map(([n]) => n)
    expect(deTrigger.length).toBeGreaterThan(0)
    expect(deTrigger.filter((n) => !revocadas.has(n))).toEqual([])
  })

  it('mantiene el permiso de la única de trigger que NO es security definer', () => {
    // validar_suma_puntaje_items corre como el rol que escribe (el Líder). Si se
    // le quita el permiso, toda edición de un ítem falla con "permission denied".
    expect(fns.get('validar_suma_puntaje_items')?.definer).toBe(false)
    expect(remediation).toMatch(
      /grant\s+execute\s+on\s+function\s+public\.validar_suma_puntaje_items\(\)\s+to\s+authenticated/i
    )
  })

  it('las funciones que exigen sesión no quedan abiertas para anon', () => {
    for (const fn of ['desbloquear_usuario', 'registrar_sync']) {
      expect(remediation).toMatch(new RegExp(`revoke\\s+execute\\s+on\\s+function\\s+public\\.${fn}\\([^)]*\\)\\s+from\\s+public`, 'i'))
      expect(remediation).toMatch(new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${fn}\\([^)]*\\)\\s+to\\s+authenticated`, 'i'))
    }
  })

  it('revoca de PUBLIC, no solo de anon: los permisos son aditivos', () => {
    // `revoke ... from anon` con el grant de PUBLIC intacto no quita nada: anon
    // seguiría pudiendo llamarla. Hay que quitar el grant heredado.
    const revokes = [...remediation.matchAll(/revoke\s+execute\s+on\s+function\s+public\.\w+\([^)]*\)\s+from\s+(\w+)/gi)]
    expect(revokes.length).toBeGreaterThan(0)
    expect(revokes.every((m) => m[1].toLowerCase() === 'public')).toBe(true)
  })

  /**
   * El advisor de Supabase solo marca funciones `security definer`. `upsert_respuestas`
   * es `security invoker`, así que no aparece en ninguna de las 21 alertas y a este
   * archivo —que recorre justamente las del advisor— se le escapaba: `anon` podía
   * ejecutarla con el `grant all on all functions` inicial de Supabase.
   *
   * Que sea invoker la hace poco grave (corre como quien llama, así que sin permiso
   * de tabla no escribe nada), pero el punto de estos tests es que la lista de
   * funciones a cerrar no se puede armar leyendo el advisor.
   */
  it('cierra también las funciones invoker que el advisor no marca', () => {
    const revocadas = new Set(
      [...remediation.matchAll(/revoke\s+execute\s+on\s+function\s+public\.(\w+)/gi)].map((m) => m[1])
    )
    // Ninguna función del schema que NO sea security definer debería quedarle
    // permiso a anon. Las hay de dos tipos: triggers y upsert_respuestas.
    const noDefiner = [...funcionesDelSchema().entries()]
      .filter(([, v]) => !v.definer)
      .map(([n]) => n)
    expect(noDefiner.length).toBeGreaterThan(0)
    expect(noDefiner.filter((n) => !revocadas.has(n)), 'quedan ejecutables por anon').toEqual([])
  })

  it('`upsert_respuestas` conserva `authenticated`, porque la app la llama por RPC', () => {
    // src/lib/offline/sync.ts:145 la llama al enviar la cola de respuestas, siempre
    // con sesión. Sin este grant, subir respuestas falla con "permission denied".
    expect(remitenteDeRespuestas).toContain("supabase.rpc('upsert_respuestas'")
    expect(remediation).toMatch(
      /grant\s+execute\s+on\s+function\s+public\.upsert_respuestas\(jsonb\)\s+to\s+authenticated/i
    )
  })

  it('ninguna función que la app llame por RPC queda sin permiso', () => {
    // Cada rpc() del código tiene que conservar el grant. El error caro: que un
    // revoke se lleve por delante el permiso de una función que la app usa.
    //
    // Ojo con el rol: no es el mismo para todas. `intento_login` y
    // `email_por_usuario` se llaman en la pantalla de login, que corre SIN
    // sesión, así que su grant tiene que llegar a `anon`. Todas las demás se
    // llaman con la sesión ya puesta, y para esas el que sirve es `authenticated`.
    // Exigir `authenticated` para todas rompería las dos del login.
    const sinSesion = new Set(['intento_login', 'email_por_usuario'])
    const rpcs = new Set([...codigoApp.matchAll(/supabase\.rpc\(\s*'(\w+)'/g)].map((m) => m[1]))
    expect(rpcs.size).toBeGreaterThan(0)
    for (const fn of rpcs) {
      const rol = sinSesion.has(fn) ? 'anon' : 'authenticated'
      expect(
        remediation,
        `${fn}: la app la llama por RPC pero ningún archivo le da permiso a ${rol}`
      ).toMatch(new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${fn}\\([^)]*\\)\\s+to\\s+${rol}`, 'i'))
    }
  })
})

describe('schema.sql · corre limpio', () => {
  it('va en una transacción y es idempotente', () => {
    // El SQL Editor corre cada archivo en una transacción; sin `begin`, un fallo a
    // la mitad deja los permisos a medio camino.
    expect(remediation).toMatch(/^\s*begin\s*;/m)
    expect(remediation).toMatch(/commit\s*;/)
    // `alter function ... set` y `revoke` son idempotentes: se puede repetir.
    expect(remediation).not.toMatch(/\bdrop\s+(function|trigger)\b/i)
  })

  it('cada revoke apunta a una función que existe en el schema', () => {
    const fns = funcionesDelSchema()
    const firmas = [...remediation.matchAll(/revoke\s+execute\s+on\s+function\s+public\.(\w+)\(/gi)].map((m) => m[1])
    expect(firmas.length).toBeGreaterThan(0)
    for (const f of firmas) expect(fns.has(f), `no existe ${f}`).toBe(true)
  })
})