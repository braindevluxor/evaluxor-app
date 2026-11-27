import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

/**
 * Colaboración en vivo (EvaluarSucursal): el único canal de realtime de la
 * app.
 *
 * POR QUÉ EXISTE ESTE TEST
 * ------------------------
 * El consumo de Realtime se fue a 5,3 M de mensajes y éste era el canal: el
 * guardado diferido subía el lote COMPLETO cada pocos segundos y el canal
 * escuchaba TODO —incluido el eco de la propia subida—. Las dos salvaciones
 * que se agregaron y éste test vigila:
 *
 *  1. El filtro excluye lo que escribí yo (`respondido_por=neq.<miId>`): el
 *     refresco tras subir es explícito (`sincronizarRef`), no depende del eco.
 *  2. La subida va diferida5 s (antes800 ms), porque el borrador ya vive en
 *     IndexedDB: esperar no pierde nada y un toque por segundo ya no sube.
 *
 * La guarda de la RPC (`upsert_respuestas`) tiene su prueba de
 * comportamiento en `upsertRespuestas-sql.test.ts`.
 */
describe('colaboración en vivo · el canal de realtime', () => {
  const pagina = fuente('./EvaluarSucursal.tsx')

  it('escucha sólo a los OTROS: el eco propio queda fuera del filtro', () => {
    expect(pagina).toContain('respondido_por=neq.${miId}')
    // Las dos tablas siguen escuchadas (la de instancias no tiene columna
    // de autor, y cambia poco).
    expect(pagina).toContain("table: 'respuestas'")
    expect(pagina).toContain("table: 'instancias_grupo'")
    // El refresco tras subir es explícito y el canal se limpia al salir.
    expect(pagina).toContain('void sincronizarRef.current()')
    expect(pagina).toContain('supabase.removeChannel(channel)')
  })

  it('la subida va diferida5 s: un toque por segundo ya no sube el lote', () => {
    expect(pagina).toContain('}, 5000)')
    expect(pagina).not.toContain('}, 800)')
    // Y la espera está explicada: el borrador no se pierde.
    expect(pagina).toContain('El borrador ya vive en IndexedDB')
  })
})
