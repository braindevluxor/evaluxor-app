// @vitest-environment jsdom
/**
 * La foto referencial del CHECKLIST se amplía en el VISOR (`ModalImagen`),
 * no en una pestaña nueva: se monta el ítem con una foto, se toca la
 * miniatura y el visor se abre con la imagen adentro — y sin tocar, sigue
 * cerrado.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// jsdom no trae IndexedDB y `PhotoCapture` lo abre en un efecto de montaje:
// sin esto la prueba tira un rechazo fuera de banda y contamina el resultado.
import 'fake-indexeddb/auto'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ItemRenderer } from './ItemRenderer'
import type { Item } from '../lib/types'

const ITEM: Item = {
  id: 'it-cortes',
  modulo_id: 'm1',
  tipo: 'CHECKLIST',
  texto: 'Cortes de carne, res y pollo.',
  opciones: [
    { id: 'o1', etiqueta: 'Tomahawk', foto: 'https://fotos.test/items/tomahawk.webp' },
    { id: 'o2', etiqueta: 'Bife fino' }
  ],
  orden: 0,
  requerido: false,
  activo: true,
  puntaje: 1,
  created_at: ''
}

let container: HTMLDivElement
let root: Root

async function montar(): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(<ItemRenderer item={ITEM} valor={undefined} index={0} total={1} onChange={() => {}} />)
  })
}

async function desmontar(): Promise<void> {
  await act(async () => {
    root.unmount()
  })
  container.remove()
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  container?.remove()
})

describe('ItemRenderer · la foto referencial abre el visor', () => {
  it('sin tocar la foto, el visor está cerrado', async () => {
    await montar()
    expect(document.body.textContent).not.toContain('Vista previa de imagen')
    // La miniatura SÍ está, junto al punto.
    expect(container.querySelector('img[src*="tomahawk.webp"]')).toBeTruthy()
    await desmontar()
  })

  it('al tocar la foto se abre ModalImagen con la imagen adentro', async () => {
    await montar()
    const boton = container.querySelector<HTMLButtonElement>(
      'button[aria-label^="Ampliar foto referencial"]'
    )
    expect(boton).toBeTruthy()
    await act(async () => {
      boton!.click()
    })

    // El visor del repo (portal al body) con la foto y su título.
    expect(document.body.textContent).toContain('Vista previa de imagen')
    const ampliada = [...document.querySelectorAll('img')].find((i) =>
      i.src.includes('tomahawk.webp')
    )
    expect(ampliada).toBeTruthy()
    await desmontar()
  })
})
