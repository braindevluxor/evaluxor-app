import { describe, expect, it } from 'vitest'
import type { jsPDF } from 'jspdf'
import { buildAmonestacion, type AmonestacionDatos } from './amonestacionTrabajador'

/**
 * El texto tal como queda en el PDF, con los paréntesis que jsPDF escapa
 * (`\(a\)`): los tests leen el archivo crudo y una frase con paréntesis no
 * aparece escrita como la pasamos.
 *
 * Las frases largas también se chequean por TROZOS: `textoLinea` parte en
 * renglones y en el archivo crudo no existe la frase entera.
 */
function texto(pdf: jsPDF): string {
  return pdf.output().replace(/\\\(/g, '(').replace(/\\\)/g, ')')
}

function datos(extra: Partial<AmonestacionDatos> = {}): AmonestacionDatos {
  return {
    trabajador: { nombre: 'Ana Pérez', nacionalidad: 'V', dni: 12345678 },
    cargo: 'Cajero integral',
    unidad: 'Sucursal Centro',
    fechaVisita: '2026-10-15',
    nota: 62,
    puntos: [
      { item: 'Refrigeración', check: 'Sellos de puertas sin fugas', faltas: 4, reincidencias: 2, esReincidente: true },
      { item: 'Refrigeración', check: 'Sensor de alarma conectado', faltas: 1, reincidencias: 0, esReincidente: false }
    ],
    ...extra
  }
}

describe('amonestación por trabajador · PDF', () => {
  it('nombra a la persona y a su cargo: el papel tiene que poder firmarse', () => {
    const t = texto(buildAmonestacion(datos()))

    expect(t).toContain('Amonestación')
    expect(t).toContain('Ana Pérez')
    expect(t).toContain('V-12345678')
    expect(t).toContain('Cajero integral')
    expect(t).toContain('Sucursal Centro')
    // La visita y la nota son la razón del documento.
    expect(t).toContain('62%')
  })

  it('detalla los puntos del cargo y cuáles son reincidencias', () => {
    const t = texto(buildAmonestacion(datos()))

    expect(t).toContain('Puntos que originan esta amonestación')
    expect(t).toContain('Sellos de puertas sin fugas')
    expect(t).toContain('Sensor de alarma conectado')
    expect(t).toContain('1 de 2 con reincidencia en la evaluación inmediata anterior.')
  })

  it('cierra con la constancia y los renglones para firmar', () => {
    const t = texto(buildAmonestacion(datos()))

    expect(t).toContain('Constancia')
    expect(t).toContain('Se deja constancia de que Ana Pérez')
    expect(t).toContain('derivada del resultado de la evaluación realizada el 15/10/2026')
    expect(t).toContain('Responsable')
    // El aviso de reincidencias de la próxima visita es parte de la constancia.
    expect(t).toContain('Se recuerda que los puntos no cumplidos')
  })

  it('sin desglose de puntos el documento sale igual, explicando el motivo', () => {
    const t = texto(buildAmonestacion(datos({ puntos: [] })))

    expect(t).toContain('sin un desglose de puntos atribuible')
    expect(t).not.toContain('Sellos de puertas sin fugas')
    expect(t).toContain('Ana Pérez')
  })

  it('si nada había caído antes, lo dice en vez de insinuar reincidencia', () => {
    const t = texto(
      buildAmonestacion(datos({ puntos: [{ item: 'Plano', check: null, faltas: 1, reincidencias: 0, esReincidente: false }] }))
    )

    expect(t).toContain('Plano (ítem completo)')
    expect(t).toContain('Sin reincidencias en la evaluación inmediata anterior.')
    expect(t).not.toContain('con reincidencia en la evaluación')
  })
})
