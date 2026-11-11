import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ALTO_LOGO_PIE, ANCHO_LOGO_PIE, ponerLogoAlPie, xTextoDelPie } from './marcaPie'
import logoPie from '../../assets/logo-pie.png?inline'
import { jsPDF } from 'jspdf'

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

/** Proporción real del archivo recortado a su contenido. */
const PROPORCION = 400 / 129

describe('marca al pie de los reportes', () => {
  it('el logo viaja embebido como data URL, no como archivo suelto', () => {
    // Si fuera una ruta, el PDF se quedaría sin marca cuando no hay señal, que
    // es exactamente cuándo se generan los informes: en el campo.
    expect(logoPie.startsWith('data:image/png;base64,')).toBe(true)
    expect(logoPie).not.toMatch(/^https?:\/\//)
    expect(logoPie.length).toBeGreaterThan(1000)
  })

  it('se dibuja con la proporción del archivo, así que nunca se deforma', () => {
    expect(ANCHO_LOGO_PIE).toBe(26)
    expect(ALTO_LOGO_PIE).toBeCloseTo(ANCHO_LOGO_PIE / PROPORCION, 5)
    expect(ponerLogoAlPie).toBeTypeOf('function')
  })

  it('el texto del pie se corre para dejarle el lugar a la marca', () => {
    // Antes el texto arrancaba en el margen; ese hueco ahora lo ocupa el logo.
    expect(xTextoDelPie(14)).toBe(14 + ANCHO_LOGO_PIE + 3)
    expect(xTextoDelPie(14)).toBeGreaterThan(14 + ANCHO_LOGO_PIE)
  })

  it('el logo queda incrustado en el archivo, no sólo referenciado', () => {
    const pagina = { orientation: 'portrait', unit: 'mm', format: 'a4', compress: false } as const
    const vacio = new jsPDF(pagina)
    const conMarca = new jsPDF(pagina)
    ponerLogoAlPie(conMarca, 14, 290)

    expect(conMarca.output().length - vacio.output().length).toBeGreaterThan(1000)
    expect(conMarca.output()).toMatch(/\/Subtype\s*\/Image/)
  })
})

describe('los tres reportes quedan con la misma familia de pie', () => {
  it('los dos informes en jsPDF ponen la marca y corren el texto', () => {
    for (const archivo of ['./index.ts', './reporteModulo.ts']) {
      const pdf = fuente(archivo)
      expect(pdf).toContain('ponerLogoAlPie(pdf, MARGEN, alto - 7)')
      expect(pdf).toContain('pdf.text(pie, xTextoDelPie(MARGEN), alto - 7)')
      expect(pdf).not.toContain('pdf.text(pie, MARGEN, alto - 7)')
    }
  })

  it('el de revisión, que se pinta en HTML antes de volcarse al PDF, también', () => {
    const revision = fuente('./exportarRevisionPreEntrega.ts')
    expect(revision).toContain('src="${logoPie}"')
    expect(revision).toContain('width:104px')
    // El pie era de texto centrado: ahora es una fila con la marca a la izquierda.
    expect(revision).not.toContain('text-align:center;font-size:10px')
  })
})
