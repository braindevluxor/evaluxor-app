import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { generarToken, urlCompartida } from './compartir'

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

/** Quita comentarios de línea y de bloque para no leer SQL como código. */
function sinComentarios(sql: string): string {
  return sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
}

describe('generarToken', () => {
  it('da 64 caracteres hexadecimales', () => {
    // 32 bytes en hex: el token es la ÚNICA autorización del enlace, así que su
    // longitud no es un detalle estético.
    expect(generarToken()).toMatch(/^[0-9a-f]{64}$/)
  })

  it('no se repite', () => {
    const vistos = new Set(Array.from({ length: 200 }, () => generarToken()))
    expect(vistos.size).toBe(200)
  })

  it('no depende de la evaluación', () => {
    // Que no haya forma de derivar el token de un id conocido: si lo hubiera,
    // compartir una evaluación sería regalar las demás.
    expect(generarToken()).not.toBe(generarToken())
  })
})

describe('urlCompartida', () => {
  it('apunta a /compartir/<token>', () => {
    expect(urlCompartida('abc123')).toMatch(/\/compartir\/abc123$/)
  })
})

describe('compartir.ts · la única puerta es el RPC', () => {
  it('lee sólo por la función pública, nunca por tabla', () => {
    const codigo = fuente('./compartir.ts')
    expect(codigo).toContain("supabase.rpc('ver_conciliacion_compartida'")
    // Si la página pudiera pedir otra evaluación directamente, el enlace no
    // sería un límite: sería un extra. El RPC sólo acepta el token.
    expect(codigo).not.toMatch(/\.from\('evaluaciones'\)/)
    expect(codigo).not.toMatch(/\.from\('respuestas'\)/)
    expect(codigo).not.toMatch(/\.from\('fotos'\)/)
    expect(codigo).not.toMatch(/\.from\('incidencias'\)/)
  })

  it('compartir otra vez reemplaza el enlace, no acumula', () => {
    const codigo = fuente('./compartir.ts')
    // Una fila por evaluación (PK = evaluacion_id) y un upsert contra esa
    // clave: el token viejo deja de servir sin que nadie tenga que borrarlo.
    expect(codigo).toMatch(/onConflict:\s*'evaluacion_id'/)
    expect(fuente('../../../supabase/compartir-evaluacion.sql')).toMatch(
      /evaluacion_id\s+uuid\s+primary\s+key/
    )
  })

  it('apagar no borra nada', () => {
    const codigo = fuente('./compartir.ts')
    expect(codigo).toMatch(/\.update\(\{\s*activo:\s*false\s*\}\)/)
    expect(codigo).not.toMatch(/\.delete\(/)
  })

  it('el RPC es de sólo lectura', () => {
    // Tampoco se escribe desde el enlace: el cuerpo de la función no puede tener
    // ninguna sentencia de escritura. Se mira el cuerpo y no el archivo entero
    // porque el DDL de la tabla (`on delete cascade`) es legítimo y está fuera.
    const sql = sinComentarios(fuente('../../../supabase/compartir-evaluacion.sql'))
    const cuerpo = sql.match(/as\s*\$\$([\s\S]*?)\$\$;/i)?.[1] ?? ''
    expect(cuerpo.length).toBeGreaterThan(0)
    expect(cuerpo).not.toMatch(/\b(insert|update|delete|truncate|create|alter|drop)\b/i)
    // `stable` además le dice a PostgREST que puede cachearla por petición.
    expect(sql).toMatch(/\blanguage\s+sql\s+stable\s+security\s+definer\b/i)
  })
})
