// @vitest-environment jsdom
/**
 * Regresión: el selector de equipo ESCONDÍA a los ya elegidos.
 *
 * Los trabajadores de la nómina sólo entran a la lista cuando se los busca
 * —la búsqueda va al servidor porque son miles de filas—, así que con el
 * equipo cargado (tres integrantes SIN cuenta) el contador decía «Equipo
 * (3)» y la lista mostraba sólo a los usuarios del sistema: no se veía
 * quién estaba, y tampoco se podía sacar a nadie, porque sus filas no
 * estaban para destildarlas.
 *
 * Monta `SelectorEquipo` de verdad (jsdom + createRoot) sobre el equipo de
 * la captura y comprueba que los tres aparecen, marcados, y que se pueden
 * quitar.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { SelectorEquipo } from './GranCosecha'
import type { MiembroEquipo } from '../lib/data/granCosecha'
import type { ProfileVista } from '../lib/data/usuarios'

/** Los tres integrantes sin cuenta del proyecto de la captura. */
const EQUIPO: MiembroEquipo[] = [
  { usuario_id: '', nombre: 'Jovanny Rodríguez', nacionalidad: 'V', dni: 30111222 },
  { usuario_id: '', nombre: 'Luis Jose Rodríguez Guerra', nacionalidad: 'V', dni: 27333444 },
  { usuario_id: '', nombre: 'Enrique Miguel Chacon Almerida', nacionalidad: 'V', dni: 19555666 }
]

/** Dos usuarios del sistema, para ver que conviven con los de nómina. */
const CANDIDATOS: ProfileVista[] = [
  {
    id: 'u-1',
    email: 'tomasn@evaluxor.com',
    usuario: 'tomasn',
    nombre: 'Tomas Nava',
    rol: 'EVALUADOR',
    sucursal_id: null,
    activo: true,
    created_at: '',
    updated_at: ''
  },
  {
    id: 'u-2',
    email: 'samirv@evaluxor.com',
    usuario: 'samirv',
    nombre: 'Samir Vasquez',
    rol: 'EVALUADOR',
    sucursal_id: null,
    activo: true,
    created_at: '',
    updated_at: ''
  }
]

let container: HTMLDivElement
let root: Root

/** El selector CON estado, para poder destildar de verdad. */
function ConEstado({
  inicial,
  candidatos
}: {
  inicial: MiembroEquipo[]
  candidatos: ProfileVista[] | null
}) {
  const [elegidos, setElegidos] = useState(inicial)
  return (
    <SelectorEquipo
      elegidos={elegidos}
      candidatos={candidatos}
      onElegidos={setElegidos}
      problema={null}
    />
  )
}

async function montar(inicial: MiembroEquipo[], candidatos: ProfileVista[] | null) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(<ConEstado inicial={inicial} candidatos={candidatos} />)
  })
}

async function desmontar() {
  await act(async () => {
    root.unmount()
  })
}

/** El `<li>` de un integrante, si está en la lista. */
function filaDe(nombre: string): HTMLLIElement | undefined {
  return [...container.querySelectorAll('li')].find((li) =>
    (li.textContent ?? '').includes(nombre)
  )
}

const casillaDe = (nombre: string): HTMLInputElement | null =>
  (filaDe(nombre)?.querySelector('input[type="checkbox"]') ?? null) as HTMLInputElement | null

const nombres = () =>
  [...container.querySelectorAll('li .truncate')].map((s) => s.textContent?.trim() ?? '')

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  container?.remove()
})

describe('SelectorEquipo · los elegidos se ven', () => {
  it('muestra los tres integrantes sin cuenta, marcados, sin haber buscado nada', async () => {
    await montar(EQUIPO, CANDIDATOS)

    for (const miembro of EQUIPO) {
      const casilla = casillaDe(miembro.nombre)
      expect(casilla, `no aparece ${miembro.nombre}`).not.toBeNull()
      expect(casilla!.checked, `${miembro.nombre} debería estar marcado`).toBe(true)
    }
    // Y siguen conviviendo con los usuarios del sistema.
    expect(nombres()).toContain('Tomas Nava')
    await desmontar()
  })

  it('un elegido que SÍ está en la candidatura no aparece dos veces', async () => {
    // Tomas también es integrante: su fila tiene que ser UNA, no una por
    // ser candidato y otra por estar elegido.
    const conTomas: MiembroEquipo[] = [
      ...EQUIPO,
      { usuario_id: 'u-1', nombre: 'Tomas Nava' }
    ]
    await montar(conTomas, CANDIDATOS)

    expect(nombres().filter((n) => n === 'Tomas Nava')).toHaveLength(1)
    expect(casillaDe('Tomas Nava')!.checked).toBe(true)
    await desmontar()
  })

  it('destildar uno lo saca del equipo y actualiza el contador', async () => {
    await montar(EQUIPO, CANDIDATOS)
    expect(container.textContent).toContain('Equipo (3)')

    await act(async () => {
      casillaDe('Luis Jose Rodríguez Guerra')!.click()
    })

    expect(casillaDe('Luis Jose Rodríguez Guerra')!.checked).toBe(false)
    expect(container.textContent).toContain('Equipo (2)')
    // Los otros dos siguen donde estaban.
    expect(casillaDe('Jovanny Rodríguez')!.checked).toBe(true)
    await desmontar()
  })

  it('el equipo elegido se ve AUNQUE los candidatos sigan cargando', async () => {
    // `candidatos === null` es el "todavía no respondió": antes el spinner
    // tapaba por completo la lista y el equipo elegido quedaba invisible.
    await montar(EQUIPO, null)

    for (const miembro of EQUIPO) {
      expect(casillaDe(miembro.nombre), `no aparece ${miembro.nombre}`).not.toBeNull()
    }
    await desmontar()
  })
})
