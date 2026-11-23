// @vitest-environment jsdom
/**
 * El Tabulador de paquetes montado de verdad (jsdom + createRoot).
 *
 * El data layer se MOCKEA —la tabla vive en Supabase y exige sesión—, y la
 * pantalla se prueba con una foto de dos hojas: que cargue, que la cabecera
 * muestre las cifras del encabezado del archivo, que la búsqueda y las
 * pestañas acoten, y que al tocar una fila el detalle rotule cada
 * componente con LA ETIQUETA DEL IMPORT (las dos hojas no traen las mismas
 * columnas, y ése es el contrato que no cubre ningún test de texto).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { TabuladorPaquetesPage } from './TabuladorPaquetes'
import { listarTabulador, type Tabulador } from '../../lib/data/tabuladorPaquetes'

vi.mock('../../lib/data/tabuladorPaquetes', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../lib/data/tabuladorPaquetes')>()
  return { ...original, listarTabulador: vi.fn() }
})

const DATOS: Tabulador = {
  filas: [
    {
      id: 1,
      hoja: 'OFICINA',
      codigo: '0150000',
      cargo: 'ASISTENTE DE GERENCIA',
      departamento: 'ADMINISTRACION',
      dependencia: 'CENTRAL',
      plantilla: 1,
      salario: 457.23,
      paquete: 995.64,
      componentes: { bci: 396063.18, observaciones: 'Revisión en enero' }
    },
    {
      id: 2,
      hoja: 'OFICINA',
      codigo: '0121000',
      cargo: 'CHOFER EJECUTIVO',
      departamento: 'ADMINISTRACION',
      dependencia: 'CENTRAL',
      plantilla: 1,
      salario: 160.27,
      paquete: 389.26,
      componentes: {}
    },
    {
      id: 3,
      hoja: 'SUCURSALES',
      codigo: '0037000',
      cargo: 'AUXILIAR DE PRECIOS',
      departamento: 'ALMACEN',
      dependencia: 'PLANTA',
      plantilla: 26,
      salario: 143.46,
      paquete: 309.83,
      componentes: { diario: 7202.07 }
    }
  ],
  config: {
    columnas: [
      { hoja: 'OFICINA', key: 'bci', etiqueta: 'BCI QUINCENAL' },
      { hoja: 'OFICINA', key: 'observaciones', etiqueta: 'OBSERVAVCIONES' },
      { hoja: 'SUCURSALES', key: 'diario', etiqueta: 'diario' }
    ],
    fecha_archivo: '2026-11-10',
    tasa_cambio: 899.27,
    tasa_cupon: 26
  }
}

let container: HTMLDivElement
let root: Root

async function montar(): Promise<void> {
  vi.mocked(listarTabulador).mockResolvedValue(DATOS)
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
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value'
  )?.set
  setter?.call(input, valor)
  await act(async () => {
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const texto = () => container.textContent ?? ''
/** El modal vive en un portal: se lee del body, no del contenedor. */
const textoModal = () => document.body.textContent ?? ''

function botones(buscado: string): HTMLButtonElement[] {
  return [...container.querySelectorAll('button')].filter(
    (b) => b.textContent?.trim() === buscado
  )
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  vi.restoreAllMocks()
  container?.remove()
})

describe('tabulador de paquetes · la consulta', () => {
  it('carga con las cifras del encabezado y muestra sólo la hoja Oficina', async () => {
    await montar()

    // Lo que trae el archivo: fecha y tasas del corte, en la cabecera.
    expect(texto()).toContain('Archivo al 10/11/2026')
    expect(texto()).toContain('Tasa de cambio: 899,27')
    expect(texto()).toContain('Tasa de cupón: 26,00')
    expect(texto()).toContain('2 cargos · 2 plazas')

    // Sólo OFICINA: la de Sucursales espera en su pestaña.
    expect(texto()).toContain('ASISTENTE DE GERENCIA')
    expect(texto()).toContain('995,64')
    expect(texto()).not.toContain('AUXILIAR DE PRECIOS')
    await desmontar()
  })

  it('la búsqueda acota por cargo y la pestaña cambia de hoja', async () => {
    await montar()

    const buscar = container.querySelector<HTMLInputElement>(
      'input[aria-label="Buscar por cargo o código"]'
    )
    expect(buscar).toBeTruthy()
    await escribir(buscar!, 'chofer')
    expect(texto()).toContain('CHOFER EJECUTIVO')
    expect(texto()).not.toContain('ASISTENTE DE GERENCIA')
    expect(texto()).toContain('1 cargo · 1 plaza')

    await escribir(buscar!, '')
    const sucursales = botones('Sucursales')[0]
    await act(async () => {
      sucursales.click()
    })
    expect(texto()).toContain('AUXILIAR DE PRECIOS')
    expect(texto()).not.toContain('ASISTENTE DE GERENCIA')
    expect(texto()).toContain('1 cargo · 26 plazas')
    await desmontar()
  })

  it('tocar una fila abre el detalle con las etiquetas del import', async () => {
    await montar()

    const fila = [...container.querySelectorAll('tr')].find((tr) =>
      tr.textContent?.includes('ASISTENTE DE GERENCIA')
    )
    expect(fila).toBeTruthy()
    await act(async () => {
      fila!.click()
    })

    // El desglose rotula con la ETIQUETA del archivo (no con la clave)…
    expect(textoModal()).toContain('ASISTENTE DE GERENCIA')
    expect(textoModal()).toContain('BCI QUINCENAL')
    expect(textoModal()).toContain('396.063,18')
    expect(textoModal()).toContain('OBSERVAVCIONES')
    expect(textoModal()).toContain('Revisión en enero')
    expect(textoModal()).toContain('Paquete aprobado (USD)')
    expect(textoModal()).toContain('995,64')
    await desmontar()
  })

  it('la tabla principal no muestra ni Plazas ni Salario: sólo el detalle', async () => {
    await montar()

    const cabecera = container.querySelector('thead')?.textContent ?? ''
    expect(cabecera).toContain('Paquete aprobado (USD)')
    expect(cabecera).not.toContain('Plazas')
    expect(cabecera).not.toContain('Salario')
    await desmontar()
  })
})
