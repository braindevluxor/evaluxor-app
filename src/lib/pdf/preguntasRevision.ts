import type { Item, Opcion } from '../types'
import type { ValorChecklist, ValorCumple } from '../scoring'

/**
 * Resolución de un ítem del catálogo al texto que se imprime en el PDF de la
 * Revisión Pre-Entrega.
 *
 * Vive aparte de `exportarRevisionPreEntrega.ts` a propósito: es lógica pura
 * (sin jsPDF ni html2canvas) y así se puede probar sola.
 */

/** Un ítem del check list ya resuelto a texto (el PDF no necesita los ids). */
export interface PreguntaResuelta {
  texto: string
  /** Filas: etiqueta + estado. En CHECKLIST es una por opción. */
  filas: { etiqueta: string; valor: string }[]
  /** Nota al pie (dictamen cumple / no cumple). */
  veredicto?: string | null
}

/** Opción cumplida: marcada, o que alcanza el mínimo si es un rango. */
export function opcionCumplida(o: Opcion, valor: ValorChecklist | null): boolean {
  if (o.tipo_respuesta === 'RANGO') {
    const v = valor?.valores?.[o.id]
    if (typeof v !== 'number') return false
    return o.minimo == null || v >= o.minimo
  }
  return (valor?.selected ?? []).includes(o.id)
}

/**
 * Convierte un ítem del catálogo + su respuesta al texto que va en el PDF.
 *
 * Es el mismo criterio de cumplimiento que usa el puntaje de la evaluación
 * (`scoring.ts`), para que el PDF no diga "cumple" donde la pantalla diga que
 * no. Sin respuesta, todas las opciones quedan como pendientes.
 */
export function resolverPregunta(item: Item, valor: unknown): PreguntaResuelta {
  if (item.tipo === 'CHECKLIST') {
    const v = (valor as ValorChecklist | null) ?? null
    const informativos = new Set(v?.informativos ?? [])
    const opciones = (item.opciones ?? []) as Opcion[]
    return {
      texto: item.texto,
      filas: opciones.map((o) => {
        if (informativos.has(o.id)) return { etiqueta: o.etiqueta, valor: 'Informativo' }
        const cumplida = opcionCumplida(o, v)
        const valorRango = o.tipo_respuesta === 'RANGO' ? v?.valores?.[o.id] : undefined
        const sufijo =
          o.tipo_respuesta === 'RANGO' && typeof valorRango === 'number'
            ? ` (${valorRango}${o.unidad ? ` ${o.unidad}` : ''})`
            : ''
        return { etiqueta: o.etiqueta, valor: `${cumplida ? 'Cumple' : 'No cumple'}${sufijo}` }
      })
    }
  }

  if (item.tipo === 'CUMPLE_NO_CUMPLE') {
    const v = (valor as ValorCumple | null) ?? null
    const estado =
      v?.value === true ? 'Cumple' : v?.value === false ? 'No cumple' : v?.informativo ? 'Informativo' : '—'
    const notas = (v?.evidencias ?? [])
      .map((e) => e.comentario?.trim())
      .filter((c): c is string => !!c)
    return {
      texto: item.texto,
      filas: [{ etiqueta: 'Estado', valor: estado }],
      veredicto: notas.length ? notas.join(' · ') : null
    }
  }

  // Tipos que la herramienta no usa (CONCILIACION, PLANO_XY, secciones…): se
  // listan igual, para que el PDF no pierda preguntas silenciosamente.
  return { texto: item.texto, filas: [{ etiqueta: 'Detalle', valor: 'No aplica a esta herramienta' }] }
}
