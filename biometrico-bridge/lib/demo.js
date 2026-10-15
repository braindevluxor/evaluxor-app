// Marcajes de ejemplo, para probar el flujo completo (web -> puente -> Supabase)
// sin el equipo físico. Se usan solo con MODO=demo.
// ------------------------------------------------------------------------------

export function generarDemo() {
  const hoy = new Date()
  const personas = [
    { dni: '1712345678' },
    { dni: '1712345679' },
    { dni: '1712345680' }
  ]
  const jornada = [
    [8, 5, 'ENTRADA'],
    [12, 30, 'SALIDA'],
    [13, 0, 'ENTRADA'],
    [17, 45, 'SALIDA']
  ]
  const resultado = []
  for (let i = 1; i <= 4; i++) {
    for (const p of personas) {
      const dia = new Date(hoy)
      dia.setDate(dia.getDate() - i)
      for (const [hh, mm, tipo] of jornada) {
        const f = new Date(dia)
        f.setHours(hh, mm, 0, 0)
        resultado.push({ dni: p.dni, fecha: f.toISOString(), tipo })
      }
    }
  }
  return resultado
}
