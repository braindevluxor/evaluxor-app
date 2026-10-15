import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
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

/** Quita comentarios de linea y de bloque para no leer SQL como columnas. */
function sinComentarios(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')
}

/**
 * Columnas de cada tabla, tal como las define el schema: los `create table`
 * y los `alter table ... add column if not exists` de la línea de tiempo.
 */
function columnasDelSchema(): Map<string, Set<string>> {
  const schema = sinComentarios(fuente('../../supabase/schema.sql'))
  const tablas = new Map<string, Set<string>>()

  for (const bloque of schema.matchAll(/create table if not exists public\.(\w+)\s*\(([\s\S]*?)\n\);/g)) {
    const cols = new Set<string>()
    for (const linea of bloque[2].split('\n')) {
      const col = linea.trim().match(/^(\w+)\s+\w/)
      if (col) cols.add(col[1])
    }
    tablas.set(bloque[1], cols)
  }

  for (const alt of schema.matchAll(/alter table public\.(\w+)\s+add column if not exists (\w+)/g)) {
    tablas.get(alt[1])?.add(alt[2])
  }

  return tablas
}

/** Nombres de columna de una lista `select a.x, b.y as z, cuenta() as n`. */
function columnasDelSelect(lista: string): string[] {
  return lista
    .split(',')
    .map((parte) => parte.trim())
    .filter(Boolean)
    .map((parte) => {
      if (/ as /i.test(parte)) return parte.split(/\s+as\s+/i)[1].trim()
      if (parte === '*') return null
      return parte.split('.').pop()!.trim()
    })
    .filter((col): col is string => col != null)
}

/**
 * Alias → columnas válidas. Resuelve tanto `public.tabla alias` como los CTE y
 * los subselect del propio archivo (que también exponen `alias.columna`). El
 * orden importa: un CTE puede reutilizar la letra de una tabla en otro ámbito
 * (`evaluaciones_bloqueadas ev` convive con `evaluaciones ev`), y gana el último.
 */
function aliasDeColumnas(sql: string, tablas: Map<string, Set<string>>): Map<string, Set<string>> {
  // Origen (nombre) → columnas, sea tabla del schema o CTE del propio archivo.
  const origenes = new Map<string, Set<string>>()

  for (const cte of sql.matchAll(/(\w+)\s+as\s*\(([\s\S]*?)\n\)/gi)) {
    const select = cte[2].match(/select\s+([\s\S]*?)\s+from/i)
    if (select) origenes.set(cte[1], new Set(columnasDelSelect(select[1])))
  }

  for (const [tabla, cols] of tablas) origenes.set(tabla, cols)

  // `from <origen> <alias>` / `join <origen> <alias>`, con o sin `public.`.
  const res = new Map<string, Set<string>>()
  for (const ref of sql.matchAll(/(?:from|join)\s+(?:public\.)?(\w+)\s+(?:as\s+)?(\w+)\b/gi)) {
    const cols = origenes.get(ref[1])
    if (cols) res.set(ref[2], new Set(cols))
  }

  // Subselect lateral: `) b on true`
  for (const sub of sql.matchAll(/join\s+lateral\s*\(([\s\S]*?)\)\s+(\w+)\s+on\s+true/gi)) {
    const select = sub[1].match(/select\s+([\s\S]*?)\s+from/i)
    if (select) res.set(sub[2], new Set(columnasDelSelect(select[1])))
  }

  return res
}

describe('schema.sql · las columnas existen', () => {
  const sql = sinComentarios(bloqueSql('diagnostico-guardado.sql'))
  const tablas = columnasDelSchema()
  const alias = aliasDeColumnas(sql, tablas)

  it('el extractor sacude las tablas y columnas del schema', () => {
    // Si el schema cambia de forma, el test avisa en vez de pasar por alto todo.
    expect(tablas.get('items')?.has('texto')).toBe(true)
    expect(tablas.get('evaluaciones')?.has('estado')).toBe(true)
    expect(tablas.get('asignaciones_modulos')?.has('activa')).toBe(true)
  })

  it('toda columna referenciada existe en la tabla de su alias', () => {
    const rotas: string[] = []
    for (const ref of sql.matchAll(/\b([a-z]{1,3})\.(\w+)\b/g)) {
      const cols = alias.get(ref[1])
      // Alias que no sabemos resolver (p.ej. `auth.uid()`): no es una columna.
      if (cols && !cols.has(ref[2])) rotas.push(`${ref[1]}.${ref[2]}`)
    }
    expect(rotas, `columnas inexistentes: ${rotas.join(', ')}`).toEqual([])
  })

  it('el ítem se identifica por `texto`, la columna que realmente tiene', () => {
    // Regresión: la consulta usaba `i.nombre` y el SQL Editor la rechazaba con
    // 42703. En `items` la etiqueta del ítem es `texto`.
    expect(sql).not.toMatch(/\bi\.nombre\b/)
    expect(sql).toMatch(/\bi\.texto\b/)
  })
})

describe('schema.sql · cubre las cuatro causas que aplica RLS', () => {
  const sql = sinComentarios(bloqueSql('diagnostico-guardado.sql'))

  it('las cuatro reglas de puede_responder', () => {
    expect(sql).toContain("'EVALUACION NO ACTIVA'")
    expect(sql).toContain("'ASIGNACION DADA DE BAJA'")
    expect(sql).toContain("'ITEM DESACTIVADO'")
    // El módulo sin fila activa en una sucursal que sí tiene otros: es el caso
    // que el `exists` de puede_responder no resuelve y bloquea el guardado.
    expect(sql).toContain("'MODULO NO APLICA A LA SUCURSAL'")
    expect(sql).toMatch(/not exists \([\s\S]{0,220}sm\.modulo_id = m\.id and sm\.activa/)
  })

  it('no confunde sucursal_items con el módulo: esa tabla no bloquea el guardado', () => {
    // puede_responder solo mira sucursal_modulos. Diagnosticar `si.activa`
    // señalaba un bloqueo inexistente y dejaba pasar el real.
    const usaSucursalItems = /from\s+public\.sucursal_items/.test(sql)
    expect(usaSucursalItems).toBe(false)
  })
})
