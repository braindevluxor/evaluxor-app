import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

/**
 * Dos evaluaciones abiertas para la MISMA unidad.
 *
 * El listado era por unidad: UNA sola fila con una fecha arbitraria (la
 * primera que traía la consulta, que viene sin ordenar) y, al tocar, se
 * abría siempre la más reciente. La otra quedaba invisible e inalcanzable,
 * que es justamente como se pierde el registro de que falta cerrar una.
 *
 * Ahora: una fila por evaluación, cada una con su fecha, y cada fila manda
 * la SUYA con `?ev=`. Si el Líder no cerró una, las dos se ven —no se
 * esconden— y el evaluador entra a la que quiere.
 */
describe('evaluar · dos evaluaciones abiertas para la misma unidad', () => {
  const home = fuente('./EvaluarHome.tsx')
  const sucursal = fuente('./EvaluarSucursal.tsx')

  it('el listado guarda TODAS las evaluaciones de la unidad, no una sola fecha', () => {
    expect(home).toContain('useState<Record<string, VistaEvaluacion[]>>')
    // El colapso viejo: quedarse con la primera fecha que traía el orden
    // natural de la tabla, que no es ninguno.
    expect(home).not.toContain('if (unidad && !map[unidad]) map[unidad] = e.fecha')
    // La más reciente arriba, que es la que abre la pantalla siguiente si no
    // se elige fila: el orden del listado tiene que ser el mismo que el de
    // `EvaluarSucursal`.
    expect(home).toContain('lista.sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0))')
  })

  it('cada fila abre la SUYA evaluación, con su fecha a la vista', () => {
    expect(home).toContain('to={`/evaluar/${s.id}?ev=${ev.id}`}')
    expect(home).toContain('to={`/evaluar/departamento/${d.id}?ev=${ev.id}`}')
    expect(home).toContain('Evaluación abierta · {fechaBonita(ev.fecha)}')
  })

  it('«Continuar» sólo en la fila que tiene el borrador local', () => {
    // El borrador es por UNIDAD: si las dos filas dijeran «Continuar», el
    // evaluador tocaría la que NO tiene su trabajo sin red y lo perdería.
    expect(home).toContain('const [conDraft, setConDraft] = useState<Record<string, string | null>>({})')
    expect(home).toContain('draft === ev.fecha')
  })

  it('EvaluarSucursal abre la elegida y, sin parámetro, la más reciente', () => {
    expect(sucursal).toContain("consulta.get('ev')")
    expect(sucursal).toContain('candidatas.find((e) => e.id === evElegida) ??')
    expect(sucursal).toContain('[...candidatas].sort(')
    // Cambiar de fila con la MISMA unidad no desmonta la pantalla: si el
    // efecto no dependiera de `evElegida`, seguirías viendo la otra
    // evaluación con sus respuestas encima.
    expect(sucursal).toContain('}, [unidadId, profile, evElegida])')
  })
})
