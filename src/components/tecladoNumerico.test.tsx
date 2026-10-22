import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

/** El campo donde se escribe el SKU escaneado. */
function campoSku(): string {
  const codigo = fuente('./ItemRenderer.tsx')
  const i = codigo.indexOf('ref={skuInputRef}')
  expect(i, 'no encontré el campo de SKU').toBeGreaterThan(-1)
  const f = codigo.indexOf('placeholder="SKU', i)
  return codigo.slice(i, f === -1 ? undefined : f)
}

/** El campo de cantidades y de precios. Es el mismo componente, con otro rótulo. */
function campoCantidad(): string {
  const codigo = fuente('./ItemRenderer.tsx')
  const i = codigo.indexOf('function CampoConciliacion')
  expect(i, 'no encontré CampoConciliacion').toBeGreaterThan(-1)
  const f = codigo.indexOf('\nfunction ', i + 10)
  return codigo.slice(i, f === -1 ? undefined : f)
}

describe('teclado numérico en la conciliación', () => {
  it('escanear un producto abre el teclado numérico', () => {
    // Lo único que se escribe acá es un código de barras: en el teléfono el
    // teclado de texto es una fila entera de teclas de más. Con `inputMode`
    // y no `type="number"` —el SKU sigue siendo texto— para que el campo
    // conserve el botón de limpiar que da `type="search"`.
    expect(campoSku()).toContain('inputMode="numeric"')
    expect(campoSku()).toContain('type="search"')
    // Y nada que pelee con el teclado numérico.
    expect(campoSku()).not.toContain('inputMode="search"')
    expect(campoSku()).not.toContain('autoCapitalize="characters"')
  })

  it('el campo de SKU sigue recibiendo el código del escáner handheld', () => {
    // Un escáner no usa el teclado: inyecta el código y su Enter, que detecta
    // el `onChange` de abajo. Si se cambiara por `type="number"` o se le
    // filtraran caracteres, el escáner dejaría de servir.
    const sku = campoSku()
    expect(sku).toContain('autoCorrect="off"')
    expect(sku).toContain('autoCapitalize="off"')
    const codigo = fuente('./ItemRenderer.tsx')
    expect(codigo).toMatch(/raw\.includes\('\\n'\)[\s\S]{0,400}aplicarCodigo\(limpio\)/)
  })

  it('cantidades y precios abren el teclado decimal', () => {
    // Teórica y Física son cantidad; Sistema y Hablador son el MISMO campo en
    // modo precio —el rótulo cambia, el componente no—, así que no hay un
    // campo de precio aparte que se pueda quedar sin teclado.
    expect(campoCantidad()).toContain('type="number"')
    expect(campoCantidad()).toContain('inputMode="decimal"')
    expect(campoCantidad()).toContain('min={0}')
  })

  it('el modo precio pasa por ese mismo campo, no por otro', () => {
    const codigo = fuente('./ItemRenderer.tsx')
    expect(codigo).toContain(
      "etiqueta={contraDato === 'FINAL_BASE' ? 'Teórica (precio)' : 'Teórica (SOH)'}"
    )
    // Y la edición de una fila ya registrada también.
    expect(codigo).toContain('<CampoConciliacion etiqueta="T · Teórica"')
    expect(codigo).toContain('<CampoConciliacion etiqueta="F · Física"')
  })
})

describe('teclado en la consulta de /evaluar', () => {
  const codigo = fuente('../pages/evaluar/EvaluarSucursal.tsx')

  it('el SKU y la cédula van numéricos, la placa no', () => {
    // La placa lleva letras y con teclado numérico no se puede escribir: ése
    // es el único que necesita texto. El SKU y el documento son sólo dígitos.
    expect(codigo).toContain("inputMode={apiSeccion.id === 'vehiculos' ? 'text' : 'numeric'}")
    expect(codigo).not.toContain('inputMode="search"')
    // Y el autocompletado sigue en mayúsculas sólo donde hace falta.
    expect(codigo).toContain("autoCapitalize={apiSeccion.id === 'vehiculos' ? 'characters' : 'off'}")
  })
})
