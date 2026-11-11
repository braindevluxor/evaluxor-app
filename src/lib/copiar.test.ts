import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { copiarAlPortapapeles } from './copiar'

function fuente(): string {
  return readFileSync(fileURLToPath(new URL('./copiar.ts', import.meta.url)), 'utf8')
}

describe('copiarAlPortapapeles', () => {
  it('un texto vacío no vale la pena copiarlo y devuelve false en el acto', async () => {
    expect(await copiarAlPortapapeles('')).toBe(false)
  })

  // Vitest corre en node: no hay `document`, así que se ejercita justo el caso
  // que antes reventaba — el helper debe decir "no pude" y no tirar.
  it('sin navegador devuelve false en vez de romper', async () => {
    expect(await copiarAlPortapapeles('100006130')).toBe(false)
  })

  it('intenta primero el portapapeles moderno y usa el atajo sólo como respaldo', () => {
    const helper = fuente()
    const moderno = helper.indexOf('navigator.clipboard.writeText(texto)')
    const atajo = helper.indexOf('return copiaConAtajo(texto)')
    expect(moderno).toBeGreaterThan(-1)
    expect(atajo).toBeGreaterThan(moderno)
    expect(helper).toContain("document.execCommand('copy')")
    // El atajo es el respaldo de un `catch`, no un camino que se saltee nada.
    expect(helper).toMatch(/catch \{\s*\/\/ Permiso negado o contexto inseguro/)
  })
})
