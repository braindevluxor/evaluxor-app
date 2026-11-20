import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { jsPDF } from 'jspdf'
import { htmlRevision, pintarFirmas } from './exportarRevisionPreEntrega'

/**
 * La hoja de la Revisión Pre-Entrega / Inspección, a texto.
 *
 * `htmlRevision` es puro (sin DOM, sin jsPDF): por eso se puede probar
 * sola, igual que `preguntasRevision`. Lo que cubre éste:
 *
 *  1. El QR al detalle PÚBLICO, que reemplazó a las fotos impresas.
 *  2. Que las evidencias NO vuelvan a imprimirse: el material visual vive
 *     en el enlace, no en el papel.
 *  3. Que la tabla tenga sus TRES columnas —Ítem, Valor/Estado y
 *     Observación— y que cada comentario vaya en la fila de SU punto.
 */

const BASE = {
  titulo: 'Inspección de vehículo',
  fecha: '2026-11-20',
  vehiculo: { placa: 'ABC123', marca: 'Toyota' },
  chofer: { cedula: 'V-12345678', nombre: 'Juan', apellido: 'Pérez' }
}

describe('htmlRevision · el QR al detalle público', () => {
  it('con enlace, dibuja el QR y explica que las evidencias están en línea', () => {
    const html = htmlRevision({
      ...BASE,
      urlDetalle: 'https://evaluxor.test/compartir/inspeccion/tokensecreto',
      // El QR lo genera `exportarRevisionPreEntrega` desde la URL: acá sólo
      // se pega, porque `htmlRevision` es sincrónico y el encoder no.
      qr: 'data:image/png;base64,iVBORw0KGgo='
    })

    expect(html).toContain('Detalle completo en línea')
    expect(html).toContain('Escaneá el código para ver las evidencias')
    expect(html).toContain('data:image/png;base64,iVBORw0KGgo=')
    expect(html).toContain('https://evaluxor.test/compartir/inspeccion/tokensecreto')
    // El motivo: el papel no lleva fotos.
    expect(html).toContain('Las fotos y los videos NO se imprimen')
  })

  it('sin enlace no hay sección de QR: no se enseña un hueco', () => {
    const html = htmlRevision({ ...BASE })
    expect(html).not.toContain('Detalle completo en línea')
    expect(html).not.toContain('Escaneá el código')
  })

  it('el QR nunca se dibuja sin haberlo generado', () => {
    // Una URL sin QR no puede pintar la sección: el `<img>` saldría roto.
    const html = htmlRevision({ ...BASE, urlDetalle: 'https://x.test/a' })
    expect(html).not.toContain('Detalle completo en línea')
  })
})

describe('htmlRevision · lo que NO debe volver', () => {  it('no imprime evidencias fotográficas ni firmas: quedan en el enlace y en el papel', () => {
    const html = htmlRevision({
      ...BASE,
      urlDetalle: 'https://x.test/a',
      qr: 'data:image/png;base64,x'
    })
    expect(html).not.toContain('Evidencias fotográficas')
    expect(html).not.toContain('<figure')
    // Las firmas TAMPOCO van acá: se dibujan en CADA hoja con jsPDF (ver
    // `pintarFirmas`), vacías, porque el documento se firma en papel. Tampoco
    // el pie con el logo: generaba una hoja de sobra con sólo el logo.
    expect(html).not.toContain('Firma del')
    expect(html).not.toContain('<footer')
  })

  it('la tabla tiene sus tres columnas y la observación va en la fila de su punto', () => {
    const html = htmlRevision({
      ...BASE,
      items: [
        {
          etiqueta: 'Carrocería y pintura · Sin abolladuras',
          valor: 'No cumple',
          grupo: 'Estética',
          observacion: 'Rayón en la puerta trasera'
        },
        { etiqueta: 'Carrocería y pintura · Sin óxido visible', valor: 'Cumple', grupo: 'Estética' }
      ]
    })

    // Las TRES columnas que pidió el usuario.
    expect(html).toContain('>Ítem<')
    expect(html).toContain('Valor / Estado')
    expect(html).toContain('>Observación<')

    // El comentario, en SU fila y no en una nota aparte…
    expect(html).toContain('Rayón en la puerta trasera')
    expect(html).not.toContain('· Nota')
    // …y la fila sin comentario queda con un guion, no vacía.
    expect(html).toContain('—')
    expect(html).toContain('Estética')
  })
})

describe('pintarFirmas · el pie de CADA hoja', () => {
  const PIE = 'Generado automáticamente por EvaLuxor · 20/11/2026'

  it('dibuja los dos rótulos, vacíos para firmar en papel', () => {
    const pdf = new jsPDF('p', 'mm', 'a4')
    pintarFirmas(pdf, 210, 297, 'conductor', PIE)
    const salida = pdf.output()

    expect(salida).toContain('Firma del conductor')
    expect(salida).toContain('Firma y sello del evaluador')
    expect(salida).toContain('Acepto las condiciones')
    // Un sólo texto por hoja: la firma capturada en la app NO se imprime.
    expect(salida.match(/Firma del conductor/g)).toHaveLength(1)
  })

  it('la marca de la familia va en la banda, no en un pie aparte', () => {
    // El `<footer>` del HTML generaba una HOJA DE SOBRA con sólo el logo:
    // la ventana de corte se achicó por la banda de firmas y el pie quedó
    // sin lugar. Ahora la marca se dibuja acá, en cada hoja.
    const fuente = readFileSync(
      fileURLToPath(new URL('./exportarRevisionPreEntrega.ts', import.meta.url)),
      'utf8'
    )
    expect(fuente).not.toContain('</footer>')
    expect(fuente).toContain('ponerLogoAlPie(')

    const pdf = new jsPDF('p', 'mm', 'a4')
    pintarFirmas(pdf, 210, 297, 'conductor', PIE)
    const salida = pdf.output()
    expect(salida).toContain('Generado automáticamente por EvaLuxor')
    // Y el logo queda incrustado en el archivo, no sólo referenciado.
    expect(salida).toMatch(/\/Subtype\s*\/Image/)
  })

  it('el rótulo sigue al documento: la Revisión Pre-Entrega dice chofer', () => {
    const pdf = new jsPDF('p', 'mm', 'a4')
    pintarFirmas(pdf, 210, 297, 'chofer', PIE)
    expect(pdf.output()).toContain('Firma del chofer')
  })

  it('la banda y el corte de páginas comparten el mismo contrato', () => {
    // La ventana de corte descuenta EXACTAMENTE el alto de la banda: si
    // alguien cambia uno sin mover el otro, el contenido se pisa con las
    // firmas (o se imprime una hoja con un pie enorme). Ése es el string
    // que une a las dos piezas.
    const fuente = readFileSync(
      fileURLToPath(new URL('./exportarRevisionPreEntrega.ts', import.meta.url)),
      'utf8'
    )
    expect(fuente).toContain('pdfHeight - MARGEN_INFERIOR_MM - ALTO_BANDA_FIRMA_MM')
    expect(fuente).toContain('const ALTO_BANDA_FIRMA_MM = 26')
  })
})
