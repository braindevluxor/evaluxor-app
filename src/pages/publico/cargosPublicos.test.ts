import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

/**
 * El enlace público de fallas por cargo: la bitácora de atención del
 * trabajador.
 *
 * Es el hermano del enlace de conciliación, así que éste cubre lo que lo hace
 * distinto: la ruta propia, el reporte CONGELADO que se guarda (con las
 * reincidencias), las fotos firmadas al abrirse —que la conciliación no hace—
 * y el botón que lo genera desde el selector de cargos. El SQL que lo cierra
 * se prueba aparte, en un Postgres de verdad
 * (`src/lib/compartir-cargos-sql.test.ts`).
 */
describe('enlace público de fallas por cargo · la pantalla', () => {
  const pagina = fuente('./CargosPublicos.tsx')

  it('tiene su propia ruta, aparte del enlace de conciliación', () => {
    const app = fuente('../../App.tsx')
    expect(app).toContain('path="/compartir/cargos/:token"')
    expect(app).toContain('<CargosPublicos />')
    // Las dos pantallas de invitado comparten el marco (sin sesión, sin
    // sidebar) en vez de duplicarlo.
    expect(pagina).toContain("from './Invitado'")
    expect(fuente('./ConciliacionPublica.tsx')).toContain("from './Invitado'")
  })

  it('lee por la función única y firma SÓLO las fotos de su propio reporte', () => {
    expect(pagina).toContain('leerCargosPublicos(token)')
    expect(pagina).toContain('createSignedUrls')
    // A diferencia de la conciliación, acá las fotos sí salen: el enlace sólo
    // puede firmar las rutas que trae su reporte, no el bucket entero.
    expect(fuente('./ConciliacionPublica.tsx')).not.toMatch(/createSignedUrl/)
    // Y sigue sin Realtime: un canal exigiría políticas `to anon`.
    expect(pagina).not.toMatch(/\.channel\(|postgres_changes/)
  })

  it('muestra la reincidencia de cada punto, con su contexto', () => {
    expect(pagina).toContain('pendiente.historial[check]')
    expect(pagina).toContain('function ChipHistorial')
    expect(pagina).toContain('Reincidencia')
    // El número viaja en el `title`: «reincidente» sin decir cuántas veces
    // cayó es un juicio sin contexto.
    expect(cuerpoDelChip(pagina)).toContain('faltas')
  })

  it('no tiene ningún control de edición', () => {
    expect(pagina).not.toContain('<input')
    expect(pagina).not.toContain('<select')
    expect(pagina).not.toContain('<textarea')
  })
})

/** El cuerpo del chip de historial, para mirar qué dice. */
function cuerpoDelChip(codigo: string): string {
  return codigo.slice(codigo.indexOf('function ChipHistorial'))
}

describe('enlace público de fallas por cargo · quién lo genera', () => {
  it('la librería guarda, apaga y lee con el mismo molde que conciliación', () => {
    const lib = fuente('../../lib/data/compartirCargos.ts')
    expect(lib).toContain(".from('cargos_compartidos')")
    expect(lib).toContain("supabase.rpc('ver_cargos_compartidos'")
    // Mismo generador de tokens (32 bytes aleatorios) y otra ruta.
    expect(lib).toContain('generarToken()')
    expect(lib).toContain('/compartir/cargos/${token}')
    // El reporte viaja congelado en el upsert: es la decisión de diseño del
    // enlace (no se recalcula al abrirse).
    expect(lib).toContain('datos, activo: true')
  })

  it('el selector de cargos ofrece compartir, junto a los formatos', () => {
    const selector = fuente('../../components/SelectorReporteCargo.tsx')
    expect(selector).toContain('onCompartir?:')
    expect(selector).toContain('onCompartir(elegidos)')
  })

  it('las dos pantallas que bajan el reporte también lo comparten', () => {
    // Mismo contenido que el PDF, así que lo arma la misma función.
    expect(fuente('../EvaluacionDetalle.tsx')).toContain('onCompartir={compartirPorCargos}')
    expect(fuente('../EvaluacionDetalle.tsx')).toContain('armarDatosPorCargos(elegidos, true)')
    expect(fuente('../dashboard/Historial.tsx')).toContain('onCompartir={(elegidos) => void compartirPorCargos(elegidos)}')
    expect(fuente('../dashboard/Historial.tsx')).toContain('armarDatosPorCargos(cargosEn, elegidos, true)')
  })
})
