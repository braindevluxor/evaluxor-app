import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { extensionDeMime, esVideo, esVideoPath, LIMITE_SEGUNDOS_VIDEO } from './fotos'
import { photoPath, pathsCandidatosFoto } from './offline/transform'

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

/**
 * Videos de evidencia, además de fotos.
 *
 * Comparten TODO con la foto: el mismo campo `photoIds`, la misma cola de
 * subida, la misma tabla `fotos` y el mismo bucket. Lo único propio es que el
 * navegador no los transcodifica — así que pesan y hay que limitarlos a
 * `LIMITE_SEGUNDOS_VIDEO` — y que no tienen cuadro que imprimir ni trazos que
 * quemar. Ésta cubre esas diferencias.
 */
describe('evidencias · lo que distingue a un video de una foto', () => {
  it('la extensión del path la dicta el MIME, y de ahí se colige el tipo', () => {
    // Un .jpg a secas haría que un video subiera con nombre de imagen y la
    // galería no supiera qué pintar.
    expect(esVideo('video/mp4')).toBe(true)
    expect(esVideo('video/quicktime')).toBe(true)
    expect(esVideo('image/jpeg')).toBe(false)
    expect(extensionDeMime('video/mp4')).toBe('mp4')
    expect(extensionDeMime('video/webm')).toBe('webm')
    expect(extensionDeMime('video/quicktime')).toBe('mov')
    expect(extensionDeMime('image/jpeg')).toBe('jpg')
    // Sin tipo conocido: video a mp4 e imagen a jpg, como se venía guardando.
    expect(extensionDeMime('application/octet-stream')).toBe('jpg')
    expect(esVideoPath('ev/abc/evidencia/123.mp4')).toBe(true)
    expect(esVideoPath('ev/abc/evidencia/123.mov')).toBe(true)
    expect(esVideoPath('ev/abc/evidencia/123.jpg')).toBe(false)
    // La URL firmada puede traer ?token: la extensión se mira antes del signo.
    expect(esVideoPath('ev/abc/evidencia/123.webm?token=1')).toBe(true)
  })

  it('la ruta de subida lleva esa extensión, y el respaldo prueba las conocidas', () => {
    expect(photoPath('abc', 'evidencia', 'foto1')).toBe('ev/abc/evidencia/foto1.jpg')
    expect(photoPath('abc', 'evidencia', 'video1', 'video/mp4')).toBe('ev/abc/evidencia/video1.mp4')
    expect(photoPath('abc', 'evidencia', 'video1', 'video/quicktime')).toBe('ev/abc/evidencia/video1.mov')
    // Si el registro local se perdió, sólo queda el id: se prueban las
    // extensiones en vez de dar el archivo por perdido.
    expect(pathsCandidatosFoto('abc', 'video1')).toEqual([
      'ev/abc/evidencia/video1.jpg',
      'ev/abc/evidencia/video1.mp4',
      'ev/abc/evidencia/video1.webm',
      'ev/abc/evidencia/video1.mov'
    ])
  })

  it('los videos se adjuntan con su tope de duración y su botón', () => {
    const fotos = fuente('../components/PhotoCapture.tsx')
    // El límite se valida al adjuntar, con aviso: el teléfono no deja limitar
    // la grabación, así que sólo queda rechazar después.
    expect(fotos).toContain('const duracion = await duracionVideo(f)')
    expect(fotos).toContain('duracion > LIMITE_SEGUNDOS_VIDEO + 0.5')
    expect(fotos).toContain("avisar(`El video dura")
    // El video va tal cual, sin pasar por la compresión de imagen.
    expect(fotos).toContain('ids.push(await addPhoto(f, mime))')
    // Tres salidas: foto, video y galería (que ya ofrece las dos).
    expect(fotos).toContain('accept="video/*"')
    expect(fotos).toContain('accept="image/*,video/*"')
    expect(fotos).toContain('aria-label="Grabar video"')
    expect(fotos).toContain('aria-label="Adjuntar foto o video desde la galería"')
    expect(fotos).toContain(`Máximo {LIMITE_SEGUNDOS_VIDEO} segundos por video.`)
    // En las evidencias de los ítems, el mismo video, en su botón redondo.
    const items = fuente('../components/ItemRenderer.tsx')
    expect(items).toContain('aria-label="Grabar video de evidencia"')
    expect(items).toContain('accept="image/*,video/*"')
    expect(LIMITE_SEGUNDOS_VIDEO).toBe(10)
  })

  it('lo que muestra evidencias sabe distinguir foto de video', () => {
    // Miniatura y visor: el video se pinta como `<video>`, no como una foto
    // congelada, y sin el lápiz que quema trazos sobre el blob.
    const minitas = fuente('../components/PhotoCapture.tsx')
    expect(minitas).toContain('<video src={p.url} preload="metadata" muted playsInline')
    expect(minitas).toContain('esVideo={!!imagenAbierta && esVideo(imagenAbierta.mime)}')
    expect(minitas).toContain('!esVideo(p.mime) ? (')

    const visor = fuente('../components/ModalImagen.tsx')
    expect(visor).toContain('esVideo?: boolean')
    expect(visor).toContain('controls')
    expect(visor).toContain("title={esVideo ? 'Vista previa de video' : 'Vista previa de imagen'}")

    const galeria = fuente('../components/dashboard/Fotogaleria.tsx')
    expect(galeria).toContain('esVideoPath(p)')
    expect(galeria).toContain('<video\n                  src={urls[p]}')
    expect(galeria).toContain('esVideo={!!imagenAbierta && esVideoPath(imagenAbierta)}')
    // Dibujar sobre la foto sólo aplica a fotos.
    expect(galeria).toContain('footer={imagenAbierta && !esVideoPath(imagenAbierta) ? (')
  })

  it('el PDF por cargos no intenta imprimir videos', () => {
    // `addImage` no sabe dibujar un mp4: sin este filtro el reporte entero
    // fallaría por una evidencia que además no tiene cuadro que imprimir.
    const cargos = fuente('./pdf/reporteCargos.ts')
    expect(cargos).toContain('.filter((p) => !esVideoPath(p))')
  })
})
