import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * `supabase/schema.sql`, el único archivo SQL del repo.
 *
 * Antes cada funcionalidad traía su `.sql` aparte y los tests lo leían directo.
 * Se unificaron todos en `schema.sql`, que los trae como bloques marcados con
 * `-- Archivo consolidado: <archivo>.sql`. `bloqueSql` extrae uno por su marca,
 * así que un test sigue leyendo «la semilla de la inspección» y no el archivo
 * entero — que es justo lo que hay que mirar, porque el resto del consolidado
 * trae cosas que nada tienen que ver con eso.
 */
export function schemaSql(): string {
  return readFileSync(fileURLToPath(new URL('../../supabase/schema.sql', import.meta.url)), 'utf8')
}

/**
 * El contenido de un bloque consolidado, sin el resto del archivo.
 *
 * Devuelve todo lo que hay entre la cabecera del bloque y la siguiente marca
 * `###`. Si no está (se borró o se renombró), falla acá y no en una aserción
 * perdida más abajo: un bloque que no se encuentra no prueba nada.
 */
export function bloqueSql(nombre: string): string {
  const lineas = schemaSql().split(/\r?\n/)
  let capturando = false
  let yaPasoCabecera = false
  const partes: string[] = []

  for (const linea of lineas) {
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

  if (!yaPasoCabecera) {
    throw new Error(`schema.sql no trae el bloque "${nombre}"`)
  }
  return partes.join('\n')
}

/** Quita comentarios de linea y de bloque para no leer SQL como codigo. */
export function sinComentarios(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')
}
