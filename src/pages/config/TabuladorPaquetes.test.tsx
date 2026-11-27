// @vitest-environment jsdom
/**
 * El Tabulador de paquetes montado de verdad (jsdom + createRoot).
 *
 * El data layer se MOCKEA —la tabla vive en Supabase y exige sesión—, y la
 * pantalla se prueba con una foto de dos cargos: que cargue en su vista por
 * defecto (SEGÚN DECLARACIÓN), que las otras dos vistas conviertan con la
 * tasa del BCV, que sin tasa no se inventen cifras, y que el formulario
 * cargue y guarde en la moneda declarada — no en la de la vista.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { TabuladorPaquetesPage } from './TabuladorPaquetes'
import {
  eliminarFila,
  guardarFila,
  listarTabulador,
  type FilaTabulador
} from '../../lib/data/tabuladorPaquetes'
import { suscribirAvisos, type Aviso } from '../../lib/aviso'

vi.mock('../../lib/data/tabuladorPaquetes', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../lib/data/tabuladorPaquetes')>()
  return { ...original, listarTabulador: vi.fn(), guardarFila: vi.fn(), eliminarFila: vi.fn() }
})

const FILAS: FilaTabulador[] = [
  {
    id: 'aaa',
    codigo: '0150000',
    cargo: 'ASISTENTE DE GERENCIA',
    departamento: 'ADMINISTRACION',
    dependencia: 'CENTRAL',
    plantilla: 1,
    salario_bs: 3650,
    bono_traslado_bs: 730,
    bono_asistencia_usd: 100,
    cestatickets_usd: 50,
    paquete_aprobado_usd: 400
  },
  {
    id: 'bbb',
    codigo: '0037000',
    cargo: 'AUXILIAR DE PRECIOS',
    departamento: 'ALMACEN',
    dependencia: 'PLANTA',
    plantilla: 26,
    salario_bs: 143.46,
    bono_traslado_bs: 0,
    bono_asistencia_usd: 40,
    cestatickets_usd: 10,
    paquete_aprobado_usd: 200
  }
]

/** La tasa del BCV que stubbea `obtenerTasaBcv`. */
function conTasa(promedio: number): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { fuente: 'oficial', promedio, fechaActualizacion: '2026-11-26T00:00:00-04:00' }
      ]
    })
  )
}

let container: HTMLDivElement
let root: Root
let avisos: Aviso[] = []
let bajarAvisos: (() => void) | null = null

async function montar(): Promise<void> {
  vi.mocked(listarTabulador).mockResolvedValue(FILAS)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(<TabuladorPaquetesPage />)
  })
}

async function desmontar(): Promise<void> {
  await act(async () => {
    root.unmount()
  })
  container.remove()
}

/** Escribe en un input como lo hace el usuario (setter nativo + input). */
async function escribir(input: HTMLInputElement, valor: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, valor)
  await act(async () => {
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const texto = () => container.textContent ?? ''
/** El modal vive en un portal: se lee del body, no del contenedor. */
const textoModal = () => document.body.textContent ?? ''

function boton(buscado: string): HTMLButtonElement {
  const b = [...container.querySelectorAll('button')].find((x) => x.textContent?.trim() === buscado)
  expect(b).toBeTruthy()
  return b as HTMLButtonElement
}

/** Cambia la vista de moneda por su botón. */
async function verVista(etiqueta: string): Promise<void> {
  const b = [...container.querySelectorAll('button')].find(
    (x) => x.textContent?.trim() === etiqueta
  )
  expect(b).toBeTruthy()
  await act(async () => {
    b!.click()
  })
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  avisos = []
  bajarAvisos = suscribirAvisos((a) => avisos.push(a))
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('sin red')))
  window.localStorage.clear()
})

afterEach(() => {
  bajarAvisos?.()
  bajarAvisos = null
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.localStorage.clear()
  container?.remove()
})

describe('tabulador de paquetes · las tres vistas', () => {
  it('carga según declaración: cada cifra en SU moneda, sin convertir', async () => {
    // Hay tasa (40) y aun así NO convierte: la vista declarada es la única
    // que mira la moneda de cada columna.
    conTasa(40)
    await montar()

    const cabecera = container.querySelector('thead')?.textContent ?? ''
    expect(cabecera).toContain('Salario (BS)')
    expect(cabecera).toContain('Bono traslado (BS)')
    expect(cabecera).toContain('Bono asistencia (USD)')
    expect(cabecera).toContain('Cestatickets (USD)')
    expect(cabecera).toContain('Paquete aprobado (USD)')
    expect(cabecera).toContain('Bono compensatorio (USD)')

    // Sin scroll: la tabla no tiene ancho mínimo y entra entera…
    expect(container.querySelector('table')?.className).not.toContain('min-w-')
    // …y las columnas de texto van juntas: código bajo el cargo y
    // dependencia bajo el departamento (por eso no son cabeceras).
    expect(cabecera).not.toContain('Código')
    expect(cabecera).not.toContain('Dependencia')
    const celdas = [...container.querySelectorAll('tbody tr')][0]?.textContent ?? ''
    expect(celdas).toContain('0150000')
    expect(celdas).toContain('CENTRAL')

    // 3650 BS siguen 3650 y 100 USD siguen 100: cero conversiones.
    expect(texto()).toContain('3.650,00')
    expect(texto()).toContain('100,00')
    expect(texto()).not.toContain('4.000,00')
    expect(texto()).toContain('2 cargos · 27 plazas')
    await desmontar()
  })

  it('«solo BS» multiplica los USD por la tasa y pinta todo en bolívares', async () => {
    conTasa(40)
    await montar()

    await verVista('Solo BS')

    const cabecera = container.querySelector('thead')?.textContent ?? ''
    expect(cabecera).toContain('Salario (BS)')
    expect(cabecera).toContain('Bono asistencia (BS)')
    expect(cabecera).not.toContain('(USD)')

    // 100 USD × 40 = 4000 BS y 50 × 40 = 2000; el salario ya estaba en BS.
    expect(texto()).toContain('4.000,00')
    expect(texto()).toContain('2.000,00')
    expect(texto()).toContain('3.650,00')
    await desmontar()
  })

  it('«solo USD» divide los BS por la tasa y pinta todo en dólares', async () => {
    conTasa(40)
    await montar()

    await verVista('Solo USD')

    const cabecera = container.querySelector('thead')?.textContent ?? ''
    expect(cabecera).toContain('Salario (USD)')
    expect(cabecera).not.toContain('(BS)')

    // 3650 BS ÷ 40 = 91,25 USD; las cifras USD se quedan igual.
    expect(texto()).toContain('91,25')
    expect(texto()).toContain('100,00')
    await desmontar()
  })

  it('el bono compensatorio se calcula en la tabla y no se pide en el formulario', async () => {
    conTasa(40)
    await montar()

    // 400 − (3650 + 730) / 40 − 100 − 50 = 140,50 USD
    const fila = [...container.querySelectorAll('tr')].find((tr) =>
      tr.textContent?.includes('ASISTENTE DE GERENCIA')
    )
    expect(fila?.textContent).toContain('140,50')

    // En el formulario SÍ está el paquete que aprueba Talento Humano…
    await act(async () => {
      boton('Nueva fila').click()
    })
    expect(document.querySelector('input[aria-label="Paquete aprobado (USD)"]')).toBeTruthy()
    // …y NO un campo para el compensatorio: es la resta de las demás.
    expect(document.querySelector('input[aria-label="Bono compensatorio (USD)"]')).toBeFalsy()
    expect(textoModal()).toContain('Bono compensatorio (calculado, no se guarda)')
    await desmontar()
  })

  it('sin tasa NO hay conversión: aviso y «—» en las columnas convertidas', async () => {
    // El fetch stubbeado del beforeEach falla: no hay tasa.
    await montar()
    await verVista('Solo BS')

    expect(texto()).toContain('Sin tasa de cambio')
    // …y hay forma de cargar una a mano, aunque no haya habido ninguna.
    expect(boton('Cargar la tasa de cambio')).toBeTruthy()
    // Las BS declaradas siguen visibles…
    expect(texto()).toContain('3.650,00')
    // …y las USD sin convertir quedan «—», nunca un número inventado.
    const fila = [...container.querySelectorAll('tr')].find((tr) =>
      tr.textContent?.includes('ASISTENTE DE GERENCIA')
    )
    expect(fila?.textContent).toContain('—')
    expect(fila?.textContent).not.toContain('100,00')
    await desmontar()
  })

  it('la búsqueda acota por cargo o código', async () => {
    await montar()

    const buscar = container.querySelector<HTMLInputElement>('input[aria-label="Buscar por cargo o código"]')
    expect(buscar).toBeTruthy()
    await escribir(buscar!, '0037000')

    expect(texto()).toContain('AUXILIAR DE PRECIOS')
    expect(texto()).not.toContain('ASISTENTE DE GERENCIA')
    expect(texto()).toContain('1 cargo · 26 plazas')
    await desmontar()
  })
})

describe('tabulador de paquetes · el alta y la edición', () => {
  it('no deja guardar sin cargo: valida en el cliente', async () => {
    await montar()

    await act(async () => {
      boton('Nueva fila').click()
    })
    expect(textoModal()).toContain('Nueva fila')

    await act(async () => {
      ;[...document.querySelectorAll('button')].find((b) => b.textContent === 'Crear fila')!.click()
    })

    expect(guardarFila).not.toHaveBeenCalled()
    expect(avisos[avisos.length - 1]?.texto).toMatch(/cargo/i)
    await desmontar()
  })

  it('edita una fila y guarda en su moneda declarada, sin importar la vista', async () => {
    await montar()
    await verVista('Solo USD')

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Editar ASISTENTE DE GERENCIA"]')!
        .click()
    })

    // El formulario abre con lo GUARDADO: 3650 BS, no su conversión.
    const salario = document.querySelector<HTMLInputElement>('input[aria-label="Salario (BS)"]')
    expect(salario?.value).toBe('3650')
    const asistencia = document.querySelector<HTMLInputElement>('input[aria-label="Bono asistencia (USD)"]')
    expect(asistencia?.value).toBe('100')

    await escribir(asistencia!, '120,5')
    await act(async () => {
      ;[...document.querySelectorAll('button')].find((b) => b.textContent === 'Guardar cambios')!.click()
    })

    expect(guardarFila).toHaveBeenCalledTimes(1)
    const entrada = vi.mocked(guardarFila).mock.calls[0][0]
    expect(entrada.id).toBe('aaa')
    expect(entrada.bono_asistencia_usd).toBe(120.5)
    // El resto de la fila se reenvía tal cual.
    expect(entrada.salario_bs).toBe(3650)
    await desmontar()
  })

  it('borrar pide confirmación y recién ahí escribe', async () => {
    await montar()

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Borrar AUXILIAR DE PRECIOS"]')!
        .click()
    })
    expect(eliminarFila).not.toHaveBeenCalled()

    await act(async () => {
      ;[...document.querySelectorAll('button')].find((b) => b.textContent === 'Sí, borrar')!.click()
    })
    expect(eliminarFila).toHaveBeenCalledWith('bbb')
    await desmontar()
  })
})
