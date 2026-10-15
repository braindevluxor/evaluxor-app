import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { destinoRespaldo } from './galeria'

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

describe('galeria · dónde acaba la copia', () => {
  it('en iPhone va a Fotos, que es la única vía a la galería desde la web', () => {
    expect(destinoRespaldo('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe('fotos')
    expect(destinoRespaldo('Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X)')).toBe('fotos')
    expect(destinoRespaldo('Mozilla/5.0 (iPod Touch; CPU iPhone OS 15_0 like Mac OS X)')).toBe('fotos')
  })

  it('en el resto va a Descargas, carpeta que las galerías del teléfono muestran', () => {
    expect(destinoRespaldo('Mozilla/5.0 (Linux; Android 14; SM-S918B)')).toBe('descargas')
    expect(destinoRespaldo('Mozilla/5.0 (Linux; Android 13; moto g (84)))')).toBe('descargas')
    expect(destinoRespaldo('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('descargas')
    expect(destinoRespaldo('')).toBe('descargas')
  })
})

describe('galeria · cómo se guarda', () => {
  const galeria = fuente('./galeria.ts')
  const captura = fuente('../components/PhotoCapture.tsx')
  const items = fuente('../components/ItemRenderer.tsx')

  it('en iPhone pasa por compartir para que el usuario toque Guardar imagen', () => {
    expect(galeria).toContain('navigator.share({ files })')
    expect(galeria).toContain('puedeCompartir(files)')
    // Si el usuario cierra la hoja fue una decisión: no se le descarga encima.
    expect(galeria).toContain("'AbortError'")
    expect(galeria).toContain("return 'ninguno'")
  })

  it('en el resto descarga con un nombre que no se repite entre fotos seguidas', () => {
    expect(galeria).toContain('a.download = nombreDeRespaldo(file)')
    expect(galeria).toContain('getMilliseconds()')
    expect(galeria).toContain('`EvaLuxor-${marca}${ext}`')
    // El blob no se revoca en el acto: la descarga todavía lo está usando.
    expect(galeria).toContain('URL.revokeObjectURL(url)')
    expect(galeria).toContain('60_000')
  })

  it('la copia usa el archivo original, sin comprimir', () => {
    // Ni importa el compresor ni recibe un blob: entra el File tal cual sale
    // de la cámara.
    expect(galeria).not.toContain('comprimirFoto')
    expect(galeria).not.toContain('../lib/fotos')
    expect(captura).toContain('const originales = Array.from(files)')
    expect(captura).toContain('if (respaldar) await guardarEnGaleria(originales)')
    // Y la app sigue guardando su versión comprimida de siempre.
    expect(captura).toContain('addPhoto(blob, mime)')
  })

  it('sólo se dispara con la cámara: lo que viene de la galería ya está ahí', () => {
    expect(captura).toContain('agregar(e.target, true)')
    expect(captura).toContain('agregar(e.target, false)')
    expect(captura).toContain('guardarFotosDe(input.files, desdeCamara)')
    expect(items).toContain('guardarFotosDe(input.files, desdeCamara)')
    expect(items).toContain('agregar(e.target, true)')
    expect(items).toContain('agregar(e.target, false)')
  })

  it('avisa en pantalla dónde queda la copia, porque un respaldo nadie lo usa si no existe', () => {
    expect(captura).toContain('destinoRespaldo()')
    expect(captura).toContain("'Cada foto que tomes también se guarda en Fotos.'")
    expect(captura).toContain("'Cada foto que tomes también se guarda en Descargas.'")
    expect(items).toContain('destinoRespaldo()')
  })
})
