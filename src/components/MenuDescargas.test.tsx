import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import { FileDown, FileSpreadsheet, Users } from 'lucide-react'
import { MenuDescargas, type OpcionDescarga } from './MenuDescargas'

const opciones: OpcionDescarga[] = [
  { id: 'pdf', etiqueta: 'PDF general', icono: <FileDown />, onSelect: () => undefined },
  { id: 'excel', etiqueta: 'Excel general', icono: <FileSpreadsheet />, onSelect: () => undefined },
  { id: 'cargos', etiqueta: 'Por cargo (PDF o Excel)', icono: <Users />, onSelect: () => undefined }
]

const html = (disabled = false): string => renderToStaticMarkup(<MenuDescargas opciones={opciones} disabled={disabled} />)

describe('menú único de descargas', () => {
  it('en reposo sólo pinta UN botón, sin las opciones escondidas', () => {
    // El criterio del cambio: la barra tiene una acción «Descargas», no tres
    // botones seguidos. El menú cerrado no debe filtrar sus opciones.
    const markup = html()
    expect(markup.match(/<button/g)?.length).toBe(1)
    expect(markup).not.toContain('PDF general')
    expect(markup).not.toContain('Excel general')
    expect(markup).not.toContain('Por cargo')
  })

  it('el botón usa la cara de la barra y se anuncia como menú', () => {
    // En el HTML renderizado la clase sale EVALUADA (no el texto
    // `BOTON_CABECERA`), así que el rostro se busca en el fuente. Por defecto
    // es el de la barra azul, y `claseBoton` lo cambia para filas sobre
    // blanco (el Historial pasa `claseBotonIcono('secondary')`).
    const fuente = readFileSync(fileURLToPath(new URL('./MenuDescargas.tsx', import.meta.url)), 'utf8')
    expect(fuente).toContain('claseBoton ?? BOTON_CABECERA')
    expect(fuente).toContain('claseBoton?: string')
    const markup = html()
    expect(markup).toContain('aria-haspopup="menu"')
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).toContain('title="Descargar"')
    expect(markup).toContain('aria-label="Descargar"')
  })

  it('el menú sale por portal en fixed, fuera del overflow de la tabla', () => {
    // La tabla del Historial vive en un `overflow-x-auto`: un menú `absolute`
    // común queda cortado y las últimas filas no lo verían. Y como va por
    // portal, el clic en una opción tiene que contar como "adentro" para que
    // el mousedown no lo cierre antes del click.
    const fuente = readFileSync(fileURLToPath(new URL('./MenuDescargas.tsx', import.meta.url)), 'utf8')
    expect(fuente).toContain('createPortal(')
    expect(fuente).toContain('fixed z-[100]')
    expect(fuente).toContain('menuRef.current?.contains(destino)')
  })

  it('mientras se genera un archivo no se abre el menú', () => {
    expect(html(true)).toContain('disabled')
  })

  it('las tres opciones siguen disponibles y en el mismo orden de siempre', () => {
    // El orden es el de la barra anterior: PDF, Excel, por cargo.
    const etiquetas = opciones.map((o) => o.etiqueta)
    expect(etiquetas).toEqual(['PDF general', 'Excel general', 'Por cargo (PDF o Excel)'])
  })
})
