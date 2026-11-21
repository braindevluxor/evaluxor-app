import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { bloqueSql } from './supabaseSql'

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

/**
 * El QR del PDF de la inspección y lo que lleva adentro.
 *
 * Las reglas de permisos y de token tienen sus propios tests
 * (`compartir-inspeccion-sql.test.ts`); éste mira el cableado: que la ruta
 * pública exista, que el PDF deje de pegar fotos y pase a llevar el QR, y
 * que la pantalla sepa firmar lo que el enlace no traiga.
 */
describe('inspección compartida · la ruta pública', () => {
  const app = fuente('../App.tsx')

  it('la ruta está SIN RequireAuth, con las otras pantallas de invitado', () => {
    const consola = app.indexOf('<ConsoleLayout />')
    const ruta = app.indexOf('path="/compartir/inspeccion/:token"')
    expect(ruta).toBeGreaterThan(-1)
    expect(ruta, 'el enlace del QR no puede pedir sesión').toBeLessThan(consola)
    expect(app).toContain("import('./pages/publico/InspeccionPublica')")
  })
})

describe('inspección compartida · el PDF', () => {
  const pdf = fuente('../lib/pdf/exportarRevisionPreEntrega.ts')
  const exportador = fuente('../lib/pdf/exportarInspeccion.ts')

  it('el documento lleva el QR y NO las evidencias', () => {
    expect(pdf).toContain('Detalle completo en línea')
    expect(pdf).toContain('datos.qr')
    expect(pdf).not.toContain('Evidencias fotográficas')
    // El QR se genera desde la URL antes de volcar el HTML.
    expect(pdf).toContain('QRCode.toDataURL')
    expect(pdf).toContain('htmlRevision({ ...datos, qr }, enc)')
  })

  it('el enlace se asegura ANTES de generar la hoja y si falla se avisa', () => {
    expect(exportador).toContain('const urlDetalle = await enlaceDelDetalle(')
    expect(exportador).toContain('urlDetalle')
    expect(exportador).toContain('El PDF sale sin QR')
    // Las fotos ya no se bajan para el documento: quedan en el enlace.
    expect(exportador).not.toContain('fotosParaPdf')
    expect(exportador).not.toContain('revokeObjectURL')
  })

  it('la pre-entrega también lleva su QR', () => {
    const pantalla = fuente('../pages/herramientas/RevisionPreEntrega.tsx')
    expect(pantalla).toContain('asegurarEnlaceInspeccion(')
    expect(pantalla).toContain('urlDetalle')
  })
})

describe('inspección compartida · el detalle en línea', () => {
  const pagina = fuente('../pages/publico/InspeccionPublica.tsx')
  const datos = fuente('./data/compartirInspeccion.ts')
  const sql = bloqueSql('compartir-inspeccion.sql')

  it('la pantalla lee por la RPC y muestra fotos Y videos', () => {
    expect(pagina).toContain('leerInspeccionPublica')
    expect(pagina).not.toContain('supabase.rpc(')
    // La llamada vive en el data layer, con la función pública.
    expect(datos).toContain("supabase.rpc('ver_inspeccion_compartida'")
    // Las fotos y los videos: el mismo criterio que el resto de las
    // pantallas públicas (el tipo sale de la extensión de la ruta).
    expect(pagina).toContain('esVideoPath')
    expect(pagina).toContain('<ModalImagen')
    // Si el enlace no trae una URL firmada, se firma acá.
    expect(pagina).toContain('createSignedUrls')
  })

  it('el detalle se arma con las filas del PDF y sus evidencias', () => {
    expect(datos).toContain('export function armarDetalleInspeccion')
    expect(datos).toContain('evidenciasDeRespuestas')
    expect(datos).toContain('export async function asegurarEnlaceInspeccion')
    expect(datos).toContain("from('inspecciones_compartidas')")
    // REUTILIZA el enlace activo: el QR de un PDF impreso no puede morir
    // cuando se vuelve a descargar el documento.
    expect(datos).toContain('if (existente?.activo) return urlCompartidaInspeccion')
  })

  it('el bloque de la base crea la tabla y su única puerta', () => {
    expect(sql).toContain('create table if not exists public.inspecciones_compartidas (')
    expect(sql).toContain('create or replace function public.ver_inspeccion_compartida(p_token text)')
    expect(sql).toContain('security definer')
    expect(sql).toContain('grant  execute on function public.ver_inspeccion_compartida(text) to anon, authenticated;')
    // La puerta de escritura: el dueño de la revisión o el Líder.
    expect(sql).toContain('r.evaluador_id = auth.uid() or public.es_lider()')
    expect(sql).toContain('for select to authenticated')
  })
})
