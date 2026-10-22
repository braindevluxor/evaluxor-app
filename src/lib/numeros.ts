/**
 * Formato numérico con coma decimal (es-AR/es) y hasta `decimales` decimales.
 * Tolera null/undefined y no agrega ceros innecesarios a la derecha.
 */
export function num(n: number | null | undefined, decimales = 2): string {
  if (n == null || Number.isNaN(n)) return '—'
  const [entera, dec] = String(Math.round(n * 10 ** decimales) / 10 ** decimales).split('.')
  // Disminuye los decimales si son todo ceros (p. ej. 86,00 → 86).
  return dec ? `${entera},${dec}` : entera
}

/** Ídem con sufijo de porcentaje: 86,67% (o — si es null). */
export function pct(n: number | null | undefined, decimales = 2): string {
  const s = num(n, decimales)
  return s === '—' ? s : `${s}%`
}

/**
 * Reparte porcentajes de participación (0..100) de un conjunto de magnitudes de modo
 * que sumen exactamente 100 (método del mayor resto). Evita el desfase de redondeo
 * individual (p. ej. 7+7+...+5 = 102%).
 */
export function distribuirPorcentajes(values: number[]): number[] {
  const total = values.reduce((a, b) => a + Math.max(0, b), 0)
  if (total <= 0) return values.map(() => 0)
  const exactos = values.map((v) => (Math.max(0, v) / total) * 100)
  const bases = exactos.map((e) => Math.floor(e))
  const resto = 100 - bases.reduce((a, b) => a + b, 0)
  const orden = exactos
    .map((e, i) => ({ i, frac: e - bases[i] }))
    .sort((a, b) => b.frac - a.frac)
    .map((o) => o.i)
  for (let k = 0; k < resto && k < orden.length; k++) bases[orden[k]] += 1
  return bases
}