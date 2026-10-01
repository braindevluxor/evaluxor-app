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

const origenes = ['schema.sql', 'incidencias.sql', 'proyectos-biometrico.sql']

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

const schema = fuente('./schema.sql')
const incidencias = fuente('./incidencias.sql')
const biometrico = fuente('./proyectos-biometrico.sql')
const reactivar = fuente('./reactivar-politicas.sql')
const validar = fuente('./validar-politicas.sql')

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
function repuestasEnReactivador(): Politica[] {
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

describe('reactivar-politicas.sql · deja las reglas como están', () => {
  it('el extractor encuentra las políticas de los archivos de origen', () => {
    // Si esto baja de 45, algo se rompió el patrón y los tests de abajo pasarían
    // en falso (compararían contra una lista vacía).
    expect(esperadas.length).toBeGreaterThanOrEqual(45)
    expect(esperadas.every((p) => p.tabla === 'storage.objects' || p.tabla.startsWith('public.'))).toBe(true)
  })

  it('repone TODAS las políticas del origen, sin sobra ni falta', () => {
    const repuestas = repuestasEnReactivador()
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
    const helpers = ['es_lider', 'puede_ver_evaluacion', 'puede_responder', 'puede_manejar_instancia', 'puede_reportar_incidencia', 'puede_ver_incidencia']
    const revocadas = [...reactivar.matchAll(/revoke\s+execute\s+on\s+function\s+public\.(\w+)/gi)].map((m) => m[1])
    const rotas = helpers.filter((h) => revocadas.includes(h))
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