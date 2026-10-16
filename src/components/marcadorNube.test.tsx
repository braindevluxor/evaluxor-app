import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

/**
 * Dibujar sobre fotos que ya viven en el bucket: las de las incidencias y las
 * evidencias de otras evaluaciones se suben pronto y dejan de existir en el
 * equipo, así que el lápiz tiene que funcionar también ahí.
 *
 * Acá no se prueba el dibujo (eso es `fotos.test.ts` y `fotoEditor.test.ts`):
 * se prueba que la marca vuelva al MISMO path y que las tres galerías ofrezcan
 * la entrada, porque si falta una, esa foto queda sin lápiz en una pantalla.
 */
describe('fotos de la nube · dibujar sobre incidencias y evidencias', () => {
  it('la foto se baja, se marca y se re-graba al mismo path con upsert', () => {
    const src = fuente('./MarcadorNube.tsx')
    expect(src).toContain('.download(path)')
    expect(src).toContain('.upload(path, blob, { contentType: mime, upsert: true })')
    // El id de la foto ES su path: nada se mueve de carpeta ni se duplica.
    expect(src).toContain('El path del bucket ES el id de la foto')
    expect(src).toContain('URL.createObjectURL(data)')
  })

  it('cada marca guardada sube una version que refresca las URLs firmadas', () => {
    const src = fuente('./MarcadorNube.tsx')
    expect(src).toContain('setVersion((v) => v + 1)')
    // Si la subida falla, el editor ya se cerró: el aviso va aparte del modal.
    expect(src).toContain('role="alert"')
  })

  it('las tres galerías ofrecen dibujar desde el visor y montan el editor', () => {
    for (const ruta of ['./dashboard/Fotogaleria.tsx', './IncidenciasEvaluacion.tsx', '../pages/evaluar/IncidenciasPage.tsx']) {
      const src = fuente(ruta)
      expect(src, ruta).toContain('Dibujar sobre la foto')
      expect(src, ruta).toContain('{marcador.editor}')
      expect(src, ruta).toContain('marcador.abrir(')
    }
  })

  it('las tres recargan las URLs cuando el marcador sube de version', () => {
    expect(fuente('./dashboard/Fotogaleria.tsx')).toContain('[claves, marcador.version]')
    expect(fuente('./IncidenciasEvaluacion.tsx')).toContain('[filas, marcador.version]')
    expect(fuente('../pages/evaluar/IncidenciasPage.tsx')).toContain('[paths, marcador.version]')
  })

  it('el visor guarda el path (no la URL) para seguir viendo la misma foto', () => {
    expect(fuente('./dashboard/Fotogaleria.tsx')).toContain('urls[imagenAbierta] ?? null')
    expect(fuente('./IncidenciasEvaluacion.tsx')).toContain('urlsFotos[imagenAbierta.incidenciaId]?.[imagenAbierta.path]')
    expect(fuente('../pages/evaluar/IncidenciasPage.tsx')).toContain('urls[imagenAbierta] ?? null')
  })

  it('el detalle le pasa el mismo marcador a las dos listas de incidencias', () => {
    const detalle = fuente('../pages/EvaluacionDetalle.tsx')
    expect(detalle.match(/marcador=\{incidencias\.marcador\}/g)?.length).toBe(2)
  })
})
