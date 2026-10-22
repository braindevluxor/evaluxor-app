import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { destinoRespaldo, respaldoAutomatico } from './galeria'

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
    expect(destinoRespaldo('Mozilla/5.0 (Linux; Android 10; SM-T500)')).toBe('descargas')
    expect(destinoRespaldo('')).toBe('descargas')
  })

  it('en PC de escritorio no se respalda: la copia en Descargas sólo estorba', () => {
    // El usuario lo reportó: cada foto tomada se descargaba de nuevo al equipo.
    expect(destinoRespaldo('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('ninguno')
    expect(destinoRespaldo('Mozilla/5.0 (Windows NT 11.0; Win64; x64)')).toBe('ninguno')
    expect(destinoRespaldo('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('ninguno')
    expect(destinoRespaldo('Mozilla/5.0 (X11; Linux x86_64)')).toBe('ninguno')
  })

  it('la regla de equipo coincide con la de "¿dónde acaba?"', () => {
    expect(respaldoAutomatico('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe(true)
    expect(respaldoAutomatico('Mozilla/5.0 (Linux; Android 14; SM-S918B)')).toBe(true)
    expect(respaldoAutomatico('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe(false)
    expect(respaldoAutomatico('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe(false)
    // Desconocido: se conserva el respaldo para no quitarle la garantía a un teléfono raro.
    expect(respaldoAutomatico('')).toBe(true)
    // Coherencia: destino 'ninguno' ⇔ sin respaldo automático.
    for (const ua of ['', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Mozilla/5.0 (Linux; Android 14; SM-S918B)']) {
      expect(destinoRespaldo(ua) === 'ninguno').toBe(!respaldoAutomatico(ua))
    }
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

  it('avisa en pantalla dónde queda la copia, pero sólo donde hay copia', () => {
    expect(captura).toContain('const destino = destinoRespaldo()')
    expect(captura).toContain("'Cada foto que tomes también se guarda en Fotos.'")
    expect(captura).toContain("'Cada foto que tomes también se guarda en Descargas.'")
    // El texto está condicionado: en PC no se promete ningún destino.
    expect(captura).toContain("destino !== 'ninguno'")
    expect(items).toContain('const destino = destinoRespaldo()')
    expect(items).toContain("destino === 'ninguno' ? 'Tomar foto'")
  })

  it('en PC no se descarga nada: la guarda vive adentro, no en cada llamador', () => {
    // Guardia dentro de guardarEnGaleria: aunque alguien olvide preguntar,
    // una PC de escritorio nunca recibe la descarga automática.
    expect(galeria).toContain('if (!respaldoAutomatico()) return')
    expect(captura).toContain('if (respaldar) await guardarEnGaleria(originales)')
  })
})
