import { describe, expect, it } from 'vitest'
import {
  EJEMPLO_CONCURSO,
  contenidoDe,
  diasHasta,
  ejemploPara,
  estadoHito,
  fechaLarga,
  type FilaContenido
} from './concursoPublico'

/**
 * Gran Cosecha · lo que la landing pública decide sin tocar la red.
 *
 * El SQL cubre lo mismo desde el otro lado (`granCosechaPublico-sql.test.ts`);
 * éste cubre la parte que sólo vive en el cliente: qué fila manda cuando hay
 * dos para la misma clave, cómo se re-etiqueta el ejemplo al trimestre que se
 * está mirando y cómo se leen las fechas del calendario.
 */

const filas: FilaContenido[] = [
  { clave: 'bases', periodo: 'GLOBAL', valor: { texto: 'Global' } },
  { clave: 'premios', periodo: 'GLOBAL', valor: { items: [{ puesto: 'Global', titulo: 'Global' }] } },
  { clave: 'premios', periodo: '2026-T4', valor: { items: [{ puesto: 'Del trimestre', titulo: 'T4' }] } },
  { clave: 'faq', periodo: '2026-T4', valor: { items: [] } }
]

describe('contenidoDe · qué fila publica', () => {
  it('la fila del trimestre manda sobre la GLOBAL', () => {
    // Es la que alguien cargó para ESTE concurso: si la página publicara la
    // global, el contenido cargado para el trimestre no aparecería nunca.
    const premios = contenidoDe(filas, 'premios', '2026-T4')
    expect((premios as { items: { puesto: string }[] }).items[0].puesto).toBe('Del trimestre')
  })

  it('si sólo hay GLOBAL, esa se publica en cualquier trimestre', () => {
    const bases = contenidoDe(filas, 'bases', '2026-T1')
    expect((bases as { texto: string }).texto).toBe('Global')
  })

  it('sin fila de ningún tipo devuelve null, no un valor inventado', () => {
    // La sección muestra su estado vacío en vez de inventar texto.
    expect(contenidoDe(filas, 'jurado', '2026-T4')).toBeNull()
    expect(contenidoDe([], 'bases', '2026-T4')).toBeNull()
  })

  it('la fila de un trimestre distinto no se cuela', () => {
    // La FAQ cargada en T4 no se publica en T2.
    expect(contenidoDe(filas, 'faq', '2026-T2')).toBeNull()
  })
})

describe('ejemploPara · la vista previa', () => {
  it('re-etiqueta las filas del trimestre al que se está mirando', () => {
    const paquete = ejemploPara('2026-T2')
    expect(paquete.periodo).toBe('2026-T2')
    const claves = paquete.contenido.map((f) => `${f.periodo}/${f.clave}`)
    expect(claves).toContain('2026-T2/premios')
    expect(claves).not.toContain('2026-T4/premios')
    // Sin esto `contenidoDe` buscaría las filas de T2 y no encontraría las
    // del ejemplo: la página se quedaría sin secciones.
    expect(contenidoDe(paquete.contenido, 'premios', '2026-T2')).not.toBeNull()
  })

  it('las claves GLOBAL viajan tal cual, para todos los trimestres', () => {
    const paquete = ejemploPara('2026-T1')
    const globales = paquete.contenido.filter((f) => f.periodo === 'GLOBAL').map((f) => f.clave)
    expect(globales).toContain('bases')
    expect(globales).toContain('faq')
    expect(globales).toContain('ganadores')
  })

  it('los proyectos son los mismos en cualquier trimestre', () => {
    expect(ejemploPara('2026-T1').proyectos).toEqual(EJEMPLO_CONCURSO.proyectos)
  })

  it('el ejemplo está listo para pintarse: estados y avances válidos', () => {
    // Si el ejemplo trae un estado que la landing no conoce, el chip pinta
    // `undefined` en vez de una etiqueta.
    const estados = new Set(EJEMPLO_CONCURSO.proyectos.map((p) => p.estado))
    expect([...estados]).toEqual(['EN_CURSO'])
    for (const p of EJEMPLO_CONCURSO.proyectos) {
      expect(p.avance).toBeGreaterThanOrEqual(0)
      expect(p.avance).toBeLessThanOrEqual(100)
      expect(p.miembros.length).toBeGreaterThanOrEqual(3)
      expect(p.avances.length).toBeGreaterThan(0)
      // El último avance del historial es el que se muestra como nota.
      expect(p.avance_nota).toBe(p.avances[p.avances.length - 1].detalle)
    }
  })
})

describe('fechas del calendario', () => {
  const hoy = new Date(2026, 10, 15) // 15 de noviembre de 2026

  it('fechaLarga escribe «18 de diciembre» sin año si es el corriente', () => {
    expect(fechaLarga('2026-12-18', hoy)).toBe('18 de diciembre')
    expect(fechaLarga('2026-11-15', hoy)).toBe('15 de noviembre')
    // Otro año sí lo lleva: el calendario puede arrastrar hitos del anterior.
    expect(fechaLarga('2025-12-18', hoy)).toBe('18 de diciembre de 2025')
  })

  it('fechaLarga no inventa ante una fecha malformada', () => {
    expect(fechaLarga('mañana', hoy)).toBe('mañana')
    expect(fechaLarga('2026-13-45', hoy)).toBe('2026-13-45')
  })

  it('diasHasta cuenta días calendario, con signo', () => {
    expect(diasHasta('2026-11-15', hoy)).toBe(0)
    expect(diasHasta('2026-11-18', hoy)).toBe(3)
    expect(diasHasta('2026-11-12', hoy)).toBe(-3)
    // Un hito de medianoche no cambia el resultado: se compara por día.
    expect(diasHasta('2026-12-18', hoy)).toBe(33)
  })

  it('estadoHito separa lo hecho de lo que falta', () => {
    expect(estadoHito('2026-11-01', hoy)).toBe('pasado')
    expect(estadoHito('2026-11-15', hoy)).toBe('hoy')
    expect(estadoHito('2026-12-18', hoy)).toBe('futuro')
  })
})
