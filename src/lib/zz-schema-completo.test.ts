import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

/**
 * TEMPORAL: corre el schema.sql ENTERO para localizar una sentencia que
 * falla al pegarla en el SQL Editor.
 */
describe('schema completo', () => {
  it('se puede pegar de una corrida', async () => {
    const sql = readFileSync(fileURLToPath(new URL('../../supabase/schema.sql', import.meta.url)), 'utf8')
    const db = new PGlite({ extensions: { pgcrypto } })
    try {
      await db.exec(sql)
      expect(true).toBe(true)
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : String(e)
      const consulta = (e as { query?: string }).query ?? ''
      throw new Error(`FALLÓ: ${mensaje}\n---\n${consulta.slice(0, 800)}`)
    } finally {
      await db.close()
    }
  }, 300_000)
})
