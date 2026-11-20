import { describe, expect, it } from 'vitest'
import { htmlRevision } from './exportarRevisionPreEntrega'

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

describe('htmlRevision · lo que NO debe volver', () => {
  it('no imprime evidencias fotográficas: quedaron en el enlace', () => {
    const html = htmlRevision({
      ...BASE,
      urlDetalle: 'https://x.test/a',
      qr: 'data:image/png;base64,x'
    })
    expect(html).not.toContain('Evidencias fotográficas')
    expect(html).not.toContain('<figure')
    // La firma y el logo SIGUEN en el documento: son parte del acta.
    expect(html).toContain('Firma del chofer')
    expect(html).toContain('alt="EvaLuxor"')
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
