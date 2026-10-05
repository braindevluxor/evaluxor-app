import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { colorFondoBadge } from '../components/ui'
import { PuntajeTotal } from './EvaluacionDetalle'

/**
 * El puntaje total de la evaluación.
 *
 * Lo que se vigila acá es que el número grande no pueda mentir. Es la lectura
 * principal de la pantalla y va justo al lado de la etiqueta que lo califica: si
 * el color y el texto dijeran cosas distintas, el veredicto de la visita se
 * leería de dos maneras opuestas en el mismo renglón.
 */

const UMBRAL = 80

/**
 * Copia de `estadoBadge`. Va escrita a mano a propósito: si se importara la
 * función, cambiar un umbral movería el color y la prueba pasaría igual, y justo
 * lo que hay que vigilar es que se muevan JUNTOS.
 */
function estado(puntaje: number | null): { texto: string; color: number } {
  if (puntaje == null) return { texto: 'Sin puntaje', color: 0 }
  if (puntaje >= UMBRAL) return { texto: 'Cumple', color: 2 }
  if (puntaje >= 60) return { texto: 'En riesgo', color: 3 }
  return { texto: 'No cumple', color: 4 }
}

function render(puntaje: number | null, completos = 18, total = 21) {
  return renderToStaticMarkup(
    <PuntajeTotal puntaje={puntaje} estado={estado(puntaje)} completos={completos} total={total} />
  )
}

/** El texto del span del número, sin el "%" que va adentro. */
function numero(html: string): string {
  const m = html.match(/<span class="text-4xl[^"]*"[^>]*>([\s\S]*?)<\/span>/)
  return m ? m[1].replace(/<[^>]+>/g, '') : ''
}

/** Todas las clases del span del número, y solo de él. */
function clasesDelNumero(html: string): string {
  const m = html.match(/<span class="(text-4xl[^"]*)"/)
  return m ? m[1] : ''
}

function colorDelNumero(html: string): string | null {
  const m = clasesDelNumero(html).match(/text-[a-z]+-\d+/)
  return m ? m[0] : null
}

describe('puntaje total de la evaluación', () => {
  it('el número va grande, es el dato principal del encabezado', () => {
    const html = render(78)
    expect(html).toMatch(/text-4xl[^\n]*font-extrabold/)
    expect(html).toMatch(/sm:text-5xl/)
    expect(html).toContain('78')
    expect(html).toContain('%')
  })

  /* Sin `tabular-nums` el ancho del número cambia con cada dígito, y en una
     evaluación en viva —que se repinta cada 15 s— el bloque entero da un tirón
     lateral en vez de solo cambiar el número. */
  it('el número no cambia de ancho al actualizarse', () => {
    expect(render(78)).toMatch(/tabular-nums/)
  })

  /* El número va en el color del FONDO del tag de estado —rojo, amarillo, verde
     claro—, un paso más oscuro para que se lea sobre la tarjeta blanca. No en el
     `text-red-700` de la etiqueta ni en negro. */
  it('el número va en el color del tag, un paso más oscuro', () => {
    expect(colorDelNumero(render(30))).toBe('text-red-200')
    expect(colorDelNumero(render(78))).toBe('text-amber-200')
    expect(colorDelNumero(render(95))).toBe('text-green-200')
  })

  /* Y tiene que ser EXACTAMENTE el fondo de la etiqueta, no "parecido": si el
     número eligiera su tono por su cuenta, cambiar un color de la paleta dejaría
     el 62% de un rojo y la etiqueta de otro. Estos son los fondos de la paleta de
     `Badge` un paso más oscuros, escritos a mano para que se note si alguien los
     cambia de un lado solo. */
  it('el color del número sale del fondo de la etiqueta', () => {
    expect(colorFondoBadge(4)).toBe('text-red-200')
    expect(colorFondoBadge(3)).toBe('text-amber-200')
    expect(colorFondoBadge(2)).toBe('text-green-200')
    // Y nunca puede devolver el `bg-*`: se usa como color de texto.
    expect(colorFondoBadge(4)).not.toContain('bg-')
    // Ni el tono exacto del fondo, que era lo que no se leía.
    expect(colorFondoBadge(4)).not.toBe('text-red-100')
  })

  /* El caso donde se contradicen: exactamente en el umbral. Si el número pasara a
     verde antes que la etiqueta, o al revés, la fila decía "Cumple" en amarillo. */
  it('el color y la etiqueta cruzan el umbral en el mismo punto', () => {
    const justoDebajo = render(79.9)
    expect(colorDelNumero(justoDebajo)).toBe('text-amber-200')
    expect(justoDebajo).toContain('En riesgo')

    const justoArriba = render(80)
    expect(colorDelNumero(justoArriba)).toBe('text-green-200')
    expect(justoArriba).toContain('Cumple')
  })

  /* El texto más útil de la pantalla: cuánto falta, no solo cuánto hay. Y el
     redondeo a un decimal evita "faltan 1,9999999 puntos". */
  it('dice cuánto falta para el mínimo', () => {
    expect(render(78)).toContain('Faltan 2 para el mínimo de 80%')
    expect(render(79.94)).toContain('Faltan 0.1 para el mínimo de 80%')
    expect(render(45.5)).toContain('Faltan 34.5 para el mínimo de 80%')
  })

  it('el que llega al mínimo se mide por arriba, no por abajo', () => {
    expect(render(80)).toContain('0 por encima del mínimo de 80%')
    expect(render(92)).toContain('12 por encima del mínimo de 80%')
    // Y no puede decir "faltan -0": ese signo negativo sería un bug visible.
    expect(render(80)).not.toContain('Faltan')
  })

  /* El aviso del hueco es la ÚNICA parte que se pinta en rojo aparte del número, y
     solo cuando de verdad falta: en un 100% no puede quedar un rojo colgando al
     lado de un verde. Es justamente el problema de dejar el número en tono claro:
     el "Faltan N" es el que avisa. */
  it('el aviso rojo es solo para el que no llega', () => {
    expect(render(78)).toContain('font-bold text-red-600')
    expect(render(95)).not.toContain('font-bold text-red-600')
  })

  /* Sin puntaje: guion, no cero. Un "0%" en rojo al lado de "Sin puntaje" sería un
     veredicto sobre una visita que todavía no terminó. Y el guion NO va en el
     `text-slate-100` de la paleta: claro sobre blanco no se ve, y lo invisible
     parece una carga rota. */
  it('sin puntaje no inventa un número ni un hueco', () => {
    const html = render(null)
    expect(numero(html)).toBe('—')
    expect(colorDelNumero(html)).toBe('text-slate-300')
    expect(html).toContain('Todavía no hay puntaje')
    expect(html).not.toContain('Faltan')
    expect(html).not.toContain('por encima')
  })

  /* El denominador son los ítems CON respuesta y veredicto, no todos los de la
     plantilla: un ítem sin responder no está incompleto, todavía no toca. Por eso
     el rótulo dice "al 100%" y no "de N ítems". */
  it('el conteo de ítems completos no se muestra si no hay ninguno puntuable', () => {
    expect(render(78, 18, 21)).toContain('18 de 21 ítems al 100%')
    expect(render(78, 0, 0)).not.toContain('ítems al 100%')
  })

  /* Ya no hay dial ni pastilla: el anillo se probó y se sacó porque repetía lo
     que el color ya decía, y la pastilla porque dejaba dos bloques de color en la
     misma esquina. Estos tests fallan si alguien los vuelve a poner. */
  it('no quedó gráfico ni fondo propio en el número', () => {
    const html = render(78)
    expect(html).not.toContain('<svg')
    expect(html).not.toContain('stroke-dashoffset')
    expect(clasesDelNumero(html)).not.toMatch(/bg-|rounded/)
  })
})

describe('el umbral del puntaje total', () => {
  /* El color del número, la etiqueta y la frase de "faltan" tienen que pasar
     juntos por el mismo 80. Es el invariante que no se ve leyendo el componente:
     los tres usan el mismo dato, pero solo si el número está escrito una sola vez. */
  const fuente = readFileSync(new URL('./EvaluacionDetalle.tsx', import.meta.url), 'utf8')

  it('no hay un 80 escrito a mano dentro del bloque', () => {
    const bloque = fuente.slice(fuente.indexOf('export function PuntajeTotal'))
    expect(bloque).not.toMatch(/puntaje\s*>=\s*80/)
    expect(bloque).not.toMatch(/puntaje\s*<\s*80/)
    expect(bloque).toContain('UMBRAL_CUMPLE')
  })
})
