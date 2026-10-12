import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import { CompartirEvaluacion } from './CompartirEvaluacion'

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

describe('CompartirEvaluacion · botón', () => {
  it('en el encabezado va sin fondo y sólo icono', () => {
    const html = renderToStaticMarkup(<CompartirEvaluacion evaluacionId="ev-1" creadoPor={null} />)
    // El encabezado del detalle puso sus botones como puro icono sobre el azul:
    // un disco translúcido ahí se leía como un contorno. Éste va igual, y el
    // color del icono sale del texto.
    expect(html).toContain('text-white')
    expect(html).toContain('h-10 w-10')
    expect(html).toContain('h-5 w-5')
    // Sin fondo de reposo. `hover:bg-white/10` sí está permitido: ese tinte sólo
    // aparece apuntando, y es lo único que dice en escritorio que se puede tocar.
    expect(html).not.toMatch(/(^|[\s"'])bg-white\/10/)
    // Y el color sale del texto, no de una variante clara que quedaría
    // invisible sobre azul.
    expect(html).not.toContain('text-slate-500')
  })

  it('en el historial se ve igual que los otros botones de la fila', () => {
    const html = renderToStaticMarkup(
      <CompartirEvaluacion variante="ficha" evaluacionId="ev-1" creadoPor={null} />
    )
    // Misma cara que el Eye y el FileDown de al lado: `claseBotonIcono('neutral')`
    // y el icono del mismo tamaño que los vecinos.
    expect(html).toContain('text-slate-500')
    expect(html).toContain('hover:bg-slate-100')
    expect(html).toContain('h-5 w-5')
    expect(html).not.toContain('bg-white/10')
  })

  it('las dos caras son distinguibles, sin mezclar colores', () => {
    const cabecera = renderToStaticMarkup(
      <CompartirEvaluacion evaluacionId="ev-1" creadoPor={null} />
    )
    const ficha = renderToStaticMarkup(
      <CompartirEvaluacion variante="ficha" evaluacionId="ev-1" creadoPor={null} />
    )
    expect(cabecera).toContain('text-white')
    expect(ficha).not.toContain('text-white')
    expect(ficha).toContain('text-slate-500')
    expect(cabecera).not.toContain('text-slate-500')
  })

  it('el modal no se pinta hasta que se abre', () => {
    const html = renderToStaticMarkup(
      <CompartirEvaluacion variante="ficha" evaluacionId="ev-1" creadoPor={null} />
    )
    expect(html).toContain('aria-label="Compartir la conciliación con un enlace público"')
    expect(html).not.toContain('Generar enlace público')
    expect(html).not.toContain('sólo lectura')
  })
})

describe('CompartirEvaluacion · el indicador verde', () => {
  it('en reposo el icono no es verde', () => {
    // El verde sólo tiene que aparecer cuando se sabe que el enlace está
    // activo: un verde de mentira mientras se consulta sería peor que gris.
    for (const variante of ['header', 'ficha'] as const) {
      const html = renderToStaticMarkup(
        <CompartirEvaluacion variante={variante} evaluacionId="ev-1" creadoPor={null} />
      )
      expect(html, variante).not.toContain('text-green-')
    }
  })

  it('cada cara trae su verde: sobre azul y sobre blanco no son el mismo', () => {
    const codigo = fuente('./CompartirEvaluacion.tsx')
    // El encabezado del detalle es azul, ahi va un verde claro; en las listas
    // va el verde de `variantesIcono.success`, el mismo que usan los demás
    // botones activos de la app.
    expect(codigo).toContain('text-green-400')
    expect(codigo).toContain("claseBotonIcono('success')")
    // Y el color se aplica cambiando la cara entera, no apilando clases:
    // Tailwind no garantiza que la última gane.
    expect(codigo).toContain('activo ? cara.activo : cara.boton')
  })

  it('el estado sale de un lote, no de una petición por fila', () => {
    const codigo = fuente('./CompartirEvaluacion.tsx')
    expect(codigo).toContain('suscribirEnlace(evaluacionId')
    // El lote va a la base con `.in(...)`: una sola petición por página.
    const datos = fuente('../lib/data/compartir.ts')
    expect(datos).toMatch(/\.in\('evaluacion_id', ids\)/)
    // Generar y apagar actualizan el indicador al instante, sin releer.
    expect(datos).toContain('export function guardarEnlaceEnCache')
    expect(codigo).toContain('guardarEnlaceEnCache(evaluacionId')
  })

  it('si la petición falla, el botón no se queda en verde de mentira', () => {
    const datos = fuente('../lib/data/compartir.ts')
    // El fallo no se cachea, para que el próximo render vuelva a pedir en vez
    // de dar por sentado que no hay enlace.
    expect(datos).toMatch(/if \(error\) return/)
  })
})

describe('CompartirEvaluacion · dónde se usa', () => {
  it('está en las dos vistas de historial, y sólo para Líder', () => {
    // El detalle, el historial del dashboard y el historial del evaluador: si
    // se puede generar en un sitio, apagar tiene que poderse desde cualquiera.
    for (const archivo of [
      '../pages/EvaluacionDetalle.tsx',
      '../pages/dashboard/Historial.tsx',
      '../pages/evaluar/MisEvaluaciones.tsx'
    ]) {
      const codigo = fuente(archivo)
      expect(codigo, archivo).toContain('<CompartirEvaluacion')
      expect(codigo, archivo).toContain("rol === 'LIDER'")
    }
    // Las dos pantallas de lista usan la cara de ficha.
    expect(fuente('../pages/dashboard/Historial.tsx')).toContain('variante="ficha"')
    expect(fuente('../pages/evaluar/MisEvaluaciones.tsx')).toContain('variante="ficha"')
  })

  it('el modal vuelve a leer al abrir, aunque el indicador ya sepa', () => {
    // La caché es un indicador, no la verdad: el modal consulta fresco cada
    // vez que se abre, porque el enlace pudo apagarse desde el detalle.
    const codigo = fuente('./CompartirEvaluacion.tsx')
    expect(codigo).toMatch(/if \(!abierto\) return/)
    expect(codigo).toContain('obtenerEnlace(evaluacionId)')
  })
})
