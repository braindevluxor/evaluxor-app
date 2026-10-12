import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { IdCopiable } from './IdCopiable'

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

describe('IdCopiable · el ID del producto, tocable', () => {
  it('se lee como cualquier otro dato del renglón y promete copiar al tocarlo', () => {
    const html = renderToStaticMarkup(<IdCopiable id={100006130} />)
    expect(html).toContain('ID: 100006130')
    expect(html).toContain('title="Copiar ID 100006130"')
    expect(html).toContain('aria-label="Copiar ID 100006130"')
    // El texto entero es la zona de toque: no hay un botón chico al lado.
    expect(html).toMatch(/<button[^>]*type="button"/)
    expect(html).toContain('ID: 100006130</span>')
  })

  it('al pintar no está copiado todavía: el aviso existe pero sale vacío', () => {
    const html = renderToStaticMarkup(<IdCopiable id="7591002000011" />)
    expect(html).toContain('ID: 7591002000011')
    expect(html).not.toContain('ID copiado')
    expect(html).toContain('aria-live="polite"')
  })

  it('no dibuja caja ni contorno: sólo subrayado punteado', () => {
    const html = renderToStaticMarkup(<IdCopiable id={1} className="text-slate-700" />)
    expect(html).toContain('underline')
    expect(html).toContain('text-slate-700')
    expect(html).not.toContain('border-')
    expect(html).not.toContain('shadow-')
  })
})

describe('los tres lugares donde aparece el ID después de escanear', () => {
  const src = fuente('./ItemRenderer.tsx')

  it('la respuesta al escanear, la fila de la lista y el visor de evidencia', () => {
    expect(src).toContain('<IdCopiable id={borrador.apiId}')
    expect(src).toContain('<IdCopiable id={p.apiId}')
    expect(src).toContain('<IdCopiable id={producto.apiId}')
  })

  it('ninguno lo imprime como texto plano: si es texto, no se puede tocar', () => {
    expect(src).not.toContain('<strong className="text-slate-700">ID:')
    expect(src).not.toContain('<strong className="font-semibold text-slate-500">ID:')
    expect(src).not.toContain('`ID: ${producto.apiId}`')
  })
})
