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
 *  3. Que los comentarios por punto (la fila «· Nota») siguen saliendo.
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

  it('la tabla de puntos y sus comentarios siguen en la hoja', () => {
    const html = htmlRevision({
      ...BASE,
      items: [
        { etiqueta: 'Documentación · SOAT vigente', valor: 'Cumple', grupo: 'Documentación' },
        { etiqueta: 'Documentación · Nota', valor: 'Vence en diciembre', grupo: 'Documentación' }
      ]
    })
    expect(html).toContain('Inspección / Checklist')
    expect(html).toContain('Documentación')
    expect(html).toContain('Vence en diciembre')
  })
})
