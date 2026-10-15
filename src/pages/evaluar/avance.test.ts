import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * El avance de una evaluación se cuenta por contenido real de la respuesta, no por
 * la mera existencia de la clave: si no, abrir un ítem sin contestarlo lo dejaba
 * marcado y el módulo arrancaba en "1/N" (o el ítem obligatorio no bloqueaba el
 * envío). Estos tests挡住了 la regresión sobre las tres pantallas que cuentan.
 */
function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

describe('avance de la evaluación · solo cuentan respuestas con contenido', () => {
  it('EvaluarHome solo muestra sucursales con una evaluación abierta', () => {
    const src = fuente('./EvaluarHome.tsx')
    expect(src).toContain('const sucursalesAbiertas = sucursales.filter((sucursal) => !!activas[sucursal.id])')
    expect(src).toContain('{sucursalesAbiertas.map((s) =>')
    expect(src).toContain('No hay evaluaciones abiertas')
  })

  it('EvaluarSucursal (burbuja y modal de módulos) usa tieneRespuesta', () => {
    const src = fuente('./EvaluarSucursal.tsx')
    expect(src).toContain('tieneRespuesta')
    // El conteo no puede volver a mirar solo la existencia de la clave.
    expect(src).not.toMatch(/respuestas\[p\.key\]\)\.length/)
  })

  it('EvaluarResumen cuenta respondidos y pendientes con tieneRespuesta', () => {
    const src = fuente('./EvaluarResumen.tsx')
    expect(src).toContain('tieneRespuesta')
    expect(src).not.toMatch(/!draft\.respuestas\[p\.key\]\)\.length/)
    expect(src).not.toMatch(/pasos\.filter\(\(p\) => draft\.respuestas\[p\.key\]\)\.length/)
  })

  it('el resumen de módulos del dashboard ignora filas de respuesta vacías', () => {
    const src = fuente('../../lib/data/indicadores.ts')
    expect(src).toMatch(/if \(tieneRespuesta\(it, r\.valor\)\) a\.respondidas\+\+/)
  })
})
