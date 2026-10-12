import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import { CompartirEvaluacion } from './CompartirEvaluacion'

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

describe('CompartirEvaluacion · botón', () => {
  it('en el encabezado va sobre fondo oscuro', () => {
    const html = renderToStaticMarkup(<CompartirEvaluacion evaluacionId="ev-1" creadoPor={null} />)
    // El detalle de evaluación tiene el encabezado en `bg-primary`: ahí el
    // botón se pinta con fondo translúcido y texto blanco.
    expect(html).toContain('bg-white/10')
    expect(html).toContain('text-white')
    expect(html).toContain('h-4 w-4')
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

  it('el modal no se pinta hasta que se abre', () => {
    const html = renderToStaticMarkup(
      <CompartirEvaluacion variante="ficha" evaluacionId="ev-1" creadoPor={null} />
    )
    expect(html).toContain('Compartir conciliación')
    expect(html).not.toContain('Generar enlace público')
    expect(html).not.toContain('sólo lectura')
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

  it('no consulta el enlace hasta que alguien abre el modal', () => {
    // En una lista esto se renderiza una vez por evaluación: una petición por
    // fila al montar la página es tráfico que nadie pidió.
    const codigo = fuente('./CompartirEvaluacion.tsx')
    expect(codigo).toMatch(/if \(!abierto\) return/)
    expect(codigo).toContain("obtenerEnlace(evaluacionId)")
  })
})
