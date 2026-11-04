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

  it('lee por la función única y usa las fotos firmadas al compartir', () => {
    expect(pagina).toContain('leerCargosPublicos(token)')
    // Las URLs vienen en el propio enlace (firmadas con la sesión del Líder):
    // la firma con sesión anónima queda sólo como respaldo de los enlaces
    // viejos.
    expect(pagina).toContain('datos.fotosFirmadas')
    expect(pagina).toContain('createSignedUrls')
    // Y las URLs relativas que quedaron guardadas en enlaces viejos se
    // reparan al abrir: contra el origen de la app darían el HTML de la SPA.
    expect(pagina).toContain('/storage/v1${url}')
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

  it('las fotos son miniaturas que abren a pantalla completa', () => {
    // Mismo criterio que el detalle: cuadritos chicos para poder RECORRER los
    // pendientes, y el visor recién al tocar. El visor (`ModalImagen`) es un
    // componente puro —sin sesión ni Supabase— por eso puede estar acá; lo
    // único que se dejó afuera fue el botón de «dibujar sobre la foto», que
    // es edición.
    expect(pagina).toContain('aspect-square w-full rounded-md')
    expect(pagina).toContain('onClick={() => setAbierta(ruta)}')
    expect(pagina).toContain('<ModalImagen')
    expect(pagina).not.toContain('Dibujar sobre la foto')
    // Los videos entran igual que en el detalle: póster con su cruz de play
    // y el visor los reproduce.
    expect(pagina).toContain('esVideoPath(ruta)')
    expect(pagina).toContain('esVideo={!!abierta && esVideoPath(abierta)}')
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
    // enlace (no se recalcula al abrirse), y sale de ahí CON las fotos ya
    // firmadas con la sesión del que comparte.
    expect(lib).toContain('datos: conFotos, activo: true')
    expect(lib).toContain('createSignedUrls(rutas, SEGUNDOS_DE_FIRMA)')
    // La trampa de la librería: devuelve DOS campos y sólo uno sirve.
    // `signedURL` es la ruta relativa, que en el <img> se resuelve contra el
    // origen de la APP y da 404; `signedUrl` es la absoluta.
    expect(lib).toContain('firma.signedUrl')
    expect(lib).not.toContain('firma.signedURL')
    expect(fuente('./CargosPublicos.tsx')).toContain('firmada.signedUrl')
    expect(fuente('./CargosPublicos.tsx')).not.toContain('firmada.signedURL')
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
