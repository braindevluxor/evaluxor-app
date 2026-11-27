/**
 * El código de evaluación es el id de la fila, pero mostrado: se enmascara el
 * centro para que sirva para identificar el informe sin ser el id completo
 * (el que abre puertas en la API). Vive aparte para que los dos formatos de
 * exportación —PDF y Excel— digan exactamente lo mismo del mismo código.
 */
export function ocultarCentroCodigoEvaluacion(codigo: string): string {
  const compacto = codigo.replace(/-/g, '')
  if (!/^[\da-f]{32}$/i.test(compacto)) return codigo
  const enmascarado = `${compacto.slice(0, 12)}********${compacto.slice(20)}`
  return `${enmascarado.slice(0, 8)}-${enmascarado.slice(8, 12)}-${enmascarado.slice(12, 16)}-${enmascarado.slice(16, 20)}-${enmascarado.slice(20)}`
}
