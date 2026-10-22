export function normalizarEtiquetaRegistro(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9]/g, '')
}

export function yaExisteRegistroConEtiqueta<T extends { etiqueta?: string | null }>(registros: T[], valor: string): boolean {
  const buscado = normalizarEtiquetaRegistro(valor)
  if (!buscado) return false
  return registros.some((registro) => normalizarEtiquetaRegistro(registro.etiqueta ?? '') === buscado)
}
