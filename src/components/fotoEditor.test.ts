import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Pruebas de fuente, como las del resto del proyecto: no hay jsdom y el
 * `renderToStaticMarkup` no ejecuta punteros ni canvas. Acá se cubre el
 * cableado que hace que la marca de un daño llegue al PDF y a la nube.
 */
const fuente = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

describe('FotoEditor · marcar el daño en la foto', () => {
  const editor = fuente('./FotoEditor.tsx')
  const captura = fuente('./PhotoCapture.tsx')
  const fotos = fuente('../lib/fotos.ts')
  const db = fuente('../lib/offline/db.ts')

  it('quema el trazo sobre la foto, a resolución completa', () => {
    // El canvas de guardado no es el de pantalla: arranca de la foto original
    // a su tamaño natural y le pinta los encima.
    expect(fotos).toContain('canvas.width = img.naturalWidth')
    expect(fotos).toContain('canvas.height = img.naturalHeight')
    expect(fotos).toContain('ctx.drawImage(img, 0, 0)')
    expect(fotos).toContain('pintarTrazos(ctx, trazos)')
    expect(editor).toContain('quemarTrazos(foto.blob, trazos)')
  })

  it('la marca se guarda en el mismo id: el PDF y la nube la ven sin regenerar nada', () => {
    expect(editor).toContain('onGuardar(foto.id, blob, mime)')
    expect(captura).toContain('updatePhotoBlob(id, blob, mime)')
    expect(db).toContain('export async function updatePhotoBlob')
    // Y no se crea ninguna foto nueva: el id del registro no cambia.
    expect(editor).not.toContain('addPhoto(')
  })

  it('se dibuja con el dedo, y el trazo se guarda en coordenadas de la imagen', () => {
    expect(editor).toContain('onPointerDown={bajar}')
    expect(editor).toContain('onPointerMove={mover}')
    // Sin esto el dedo desplaza la página en vez de dibujar.
    expect(editor).toContain('touch-none')
    expect(editor).toContain('puntoAImagen(')
    // El grosor se traduce al píxel de la imagen: la marca no se achica con el
    // zoom de la pantalla.
    expect(editor).toContain('grosorEnImagen(')
    expect(fotos).toContain('GROSOR_PANTALLA')
  })

  it('ofrece deshacer, borrar todo y paleta pensada para daño', () => {
    expect(editor).toContain('Deshacer el último trazo')
    expect(editor).toContain('Borrar todas las marcas')
    expect(editor).toContain('aria-pressed={color === c.hex}')
    expect(fotos).toContain("id: 'rojo'")
    expect(fotos).toContain("id: 'amarillo'")
    expect(fotos).toContain("id: 'blanco'")
  })

  it('toda foto local se puede marcar: el lápiz está en la miniatura y en el visor', () => {
    expect(captura).toContain('aria-label="Marcar daño en la foto"')
    expect(captura).toContain('Dibujar sobre la foto')
    expect(captura).toContain('setEditando(p)')
    // Al guardar se recargan las miniaturas: la marca se ve de inmediato.
    expect(captura).toMatch(/updatePhotoBlob\(id, blob, mime\)[\s\S]{0,160}cargarPreviews\(\)/)
  })

  it('sin guardar no se pierde nada: cancelar sólo cierra el editor', () => {
    expect(editor).toContain('onCancel')
    expect(editor).not.toContain('updatePhotoBlob')
  })
})
