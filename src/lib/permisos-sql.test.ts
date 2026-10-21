import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bloqueSql, schemaSql, sinComentarios } from './supabaseSql'

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
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
    sinComentarios(bloqueSql('incidencias.sql'))
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
const schemaCompleto = sinComentarios(schemaSql())

/**
 * ¿Existe la función en `supabase/schema.sql`?
 *
 * Un revoke apuntando a una función que no existe hace fallar el archivo
 * entero en el SQL Editor, así que el chequeo no es cosmético: es la red que
 * evita que un `revoke` bien intencionado deje la base a medio camino.
 *
 * Se busca en el ARCHIVO ENTERO y no en el primer bloque: desde que cada
 * funcionalidad quedó en su propio bloque consolidado, una función puede
 * estar definida en un bloque y revocarse en otro (la de la pre-entrega, la
 * del enlace público, las del backfill de departamentos). Mirlar sólo el
 * primer bloque daba por inexistentes cinco funciones que sí están.
 */
function existeEnSchema(nombre: string): boolean {
  return new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${nombre}\\s*\\(`).test(schemaCompleto)
}

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
    const sinSesion = new Set(['intento_login', 'email_por_usuario', 'ver_conciliacion_compartida'])
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

describe('schema.sql · el enlace público de conciliación', () => {
  /**
   * Es la única apertura a `anon` que existe después del login, y es
   * deliberada: hay una pantalla pública (`/compartir/:token`) para quien
   * quiere ver la conciliación de una evaluación sin tener cuenta. Estos tests
   * existen para que la próxima apertura tenga que venir con su motivo.
   */
  it('la única función abierta a anon, además de las del login, es el enlace', () => {
    const abiertas = [...remediation.matchAll(
      /grant\s+execute\s+on\s+function\s+public\.(\w+)\([^)]*\)\s+to\s+([^;]*\banon\b[^;]*);/gi
    )]
      .map((m) => m[1])
      .sort()
    expect(abiertas).toEqual(['email_por_usuario', 'intento_login', 'ver_conciliacion_compartida'])
  })

  it('la puerta es el token, y un token malo no devuelve nada', () => {
    const sql = sinComentarios(bloqueSql('compartir-evaluacion.sql'))
    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.ver_conciliacion_compartida\(p_token text\)/i)
    // SECURITY DEFINER es obligatorio (sin permiso de tabla no leería nada), y
    // con él viene la obligación de fijar el search_path.
    expect(sql).toMatch(/security\s+definer/i)
    expect(sql).toMatch(/set\s+search_path\s*=\s*public,\s*pg_temp/i)
    // Sin sesión no hay `auth.uid()` que preguntar: la única autorización es
    // que el token exista Y que el enlace esté activo.
    expect(sql).toMatch(/c\.activo\s+and\s+c\.token\s*=\s*p_token/)
    // Un token inválido tiene que ser indistinguible de "no existe", o se
    // pueden enumerar enlaces probando tokens y comparando respuestas.
    expect(sql).toContain("'evaluacion', (")
    expect(sql).toMatch(/'respuestas',\s*\(select coalesce\(jsonb_agg/)
  })

  it('el enlace no abre más que la conciliación', () => {
    const sql = sinComentarios(bloqueSql('compartir-evaluacion.sql'))
    // Nada de esto puede salir por un enlace público: son las tablas que
    // exponen evidencia física, personas o el resto de la evaluación.
    for (const tabla of ['fotos', 'incidencias', 'profiles', 'asignaciones', 'instancias_grupo']) {
      expect(sql, `la función no debe leer ${tabla}`).not.toMatch(new RegExp(`from\\s+public\\.${tabla}\\b`, 'i'))
    }
    // Los ítems se filtran por tipo: sólo conciliación.
    expect(sql).toMatch(/i\.tipo\s*=\s*'CONCILIACION'/)
  })

  it('la tabla nace cerrada para anon y con RLS', () => {
    const sql = sinComentarios(bloqueSql('compartir-evaluacion.sql'))
    expect(sql).toMatch(/alter\s+table\s+public\.evaluaciones_compartidas\s+enable\s+row\s+level\s+security/i)
    // Ninguna política es para anon: quien no tiene sesión ni siquiera llega a
    // evaluar políticas porque `cerrar-permisos-anon.sql` le quitó el permiso
    // de tabla, y la RLS es la segunda capa.
    const politicas = [...sql.matchAll(/create\s+policy\s+(\w+)[\s\S]*?\bto\s+(\w+)/gi)].map((m) => `${m[1]}:${m[2]}`)
    expect(politicas.length).toBeGreaterThan(0)
    expect(politicas.every((p) => p.endsWith(':authenticated'))).toBe(true)
    // Y crear o apagar enlaces es cosa de Líder, igual que todo el catálogo.
    expect(sql).toMatch(/using\s*\(\s*public\.es_lider\(\)\s*\)\s*with\s+check\s*\(\s*public\.es_lider\(\)\s*\)/i)
  })

  it('la evaluación sale sólo con columnas que la tabla real tiene', () => {
    const sql = sinComentarios(bloqueSql('compartir-evaluacion.sql'))
    const cuerpo = sql.match(/ev as \(([\s\S]*?)\),\s*resp as/)?.[1] ?? ''
    expect(cuerpo.length).toBeGreaterThan(0)
    // `schema.sql` declara `evaluaciones.created_at`, pero hay bases creadas
    // antes de que existiera ese campo y `create table if not exists` no lo
    // agregó después: nombrarlo hacía fallar la función entera con 42703.
    // `aperturada_por` se cayó en la misma limpieza y de paso cumple la
    // promesa del enlace: no muestra quién evaluó.
    expect(cuerpo).not.toMatch(/created_at/)
    expect(cuerpo).not.toMatch(/aperturada_por/)
    // Estas sí están: `indicadores.ts` las escribe o filtra por nombre.
    for (const col of ['estado', 'puntuacion', 'comentario_general', 'cerrada_en', 'fecha']) {
      expect(cuerpo, col).toContain(col)
    }
  })

  it('el enlace se apaga sin borrar la evaluación', () => {
    const sql = sinComentarios(bloqueSql('compartir-evaluacion.sql'))
    // `activo` es lo que hace reversible el enlace: apagarlo no depende de
    // borrar la fila, y borrar la fila no depende de borrar la evaluación.
    expect(sql).toMatch(/activo\s+boolean\s+not\s+null\s+default\s+true/)
    // La PK es la evaluación: compartir dos veces REEMPLAZA el enlace en vez
    // de acumular links viejos que nadie puede revocar.
    expect(sql).toMatch(/evaluacion_id\s+uuid\s+primary\s+key/)
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
    const firmas = [...remediation.matchAll(/revoke\s+execute\s+on\s+function\s+public\.(\w+)\(/gi)].map((m) => m[1])
    expect(firmas.length).toBeGreaterThan(0)
    // El revoke vive en el bloque `permisos-funcion.sql` y la función en otro:
    // si se separan demasiado, uno de los dos apunta al vacío.
    for (const f of firmas) expect(existeEnSchema(f), `no existe ${f}`).toBe(true)
    // Y la función tiene que estar DEFINIDA antes del revoke: el archivo se
    // aplica de arriba abajo y un revoke a una función que todavía no existe
    // deja el archivo a medio camino.
    for (const f of firmas) {
      const def = schemaCompleto.search(new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${f}\\s*\\(`))
      const revs = [...schemaCompleto.matchAll(new RegExp(`revoke\\s+execute\\s+on\\s+function\\s+public\\.${f}\\s*\\(`, 'gi'))].map((m) => m.index)
      expect(revs.length, `${f}: sin revoke`).toBeGreaterThan(0)
      for (const rev of revs) {
        expect(def, `${f}: hay un revoke antes de la definición`).toBeGreaterThan(-1)
        expect(def, `${f}: el revoke va antes de la definición`).toBeLessThan(rev)
      }
    }
  })
})

describe('schema.sql · marcar fotos que ya estan en el bucket', () => {
  const sql = fuente('../../supabase/schema.sql')

  it('evidencias_update re-graba ev/<evaluacion>/... solo para quien ve la evaluacion', () => {
    expect(sql).toContain('create policy "evidencias_update" on storage.objects for update')
    expect(sql).toContain("name like 'ev/%'")
    expect(sql).toContain('public.puede_ver_evaluacion(e)')
    // Las dos secciones del archivo (definicion y reponer) la traen.
    expect(sql.match(/create policy "evidencias_update"/g)?.length).toBe(2)
    // Y esta en la consulta de verificacion que revisa la base.
    expect(sql).toContain("('evidencias_update', 'storage.objects')")
  })

  it('los contadores de politicas del diagnostico dicen la verdad', () => {
    // Los dos numeros son el resumen del archivo entero: si alguien agrega una
    // politica y no los actualiza, dejan de contar nada.
    const declaradas = Number(sql.match(/-- storage\.objects \((\d+) políticas/)?.[1])
    const enElArchivo = (sql.match(/create policy[^\n]* on storage\.objects/gi) || []).length
    expect(enElArchivo).toBeGreaterThan(0)
    expect(declaradas).toBe(enElArchivo)

    const esperadas = Number(sql.match(/estan las (\d+)/)?.[1])
    const iLista = sql.indexOf('with esperadas (politica, tabla) as (')
    // La lista termina en la línea que cierra el `values`. Buscar el primer
    // "select" la cortaba a la mitad, porque `evaluaciones_select` tiene la
    // palabra adentro: contaba 2 filas de las 64.
    const iCierre = sql.indexOf('\n)', iLista)
    const filasDeLaLista = (sql.slice(iLista, iCierre).match(/^\s*\('/gm) || []).length
    expect(filasDeLaLista).toBeGreaterThan(0)
    expect(esperadas).toBe(filasDeLaLista)
  })

  it('el Lider puede reescribir la foto de una incidencia ajena, no solo verla', () => {
    /* El visor de incidencias del detalle es del Lider y una marca se sube con
       upsert: sin UPDATE para el Lider, «Dibujar sobre la foto» sobre una
       incidencia de otro evaluador termina en un 403. */
    const updates = sql.match(/create policy storage_incidencias_update[\s\S]*?\);/g) ?? []
    expect(updates.length).toBeGreaterThanOrEqual(2)
    for (const update of updates) {
      expect(update).toContain('public.es_lider()')
      expect(update).toContain('i.evaluador_id = auth.uid()')
    }
  })
})