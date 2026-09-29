import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ItemRenderer } from './ItemRenderer'
import type { Item } from '../lib/types'

function itemDe(texto: string, repetible?: boolean | null): Item {
  return {
    id: 'it-1',
    modulo_id: 'm1',
    tipo: 'UNIDAD_CHECKLIST',
    texto,
    opciones: [
      { id: 'o1', etiqueta: 'Requerimiento A' },
      { id: 'o2', etiqueta: 'Requerimiento B' }
    ],
    orden: 0,
    requerido: true,
    activo: true,
    puntaje: 10,
    repetible,
    created_at: ''
  }
}

describe('ItemRenderer · UNIDAD_CHECKLIST repetible', () => {
  it('por defecto (repetible) muestra la caja para agregar varias unidades', () => {
    const html = renderToStaticMarkup(<ItemRenderer item={itemDe('Dormis')} valor={undefined} index={0} total={1} onChange={() => {}} />)
    expect(html).toContain('Agregar unidad')
    expect(html).toContain('Valor alfanumérico')
  })

  it('con repetible=false muestra el checklist una sola vez (sin caja de agregar unidad)', () => {
    const html = renderToStaticMarkup(<ItemRenderer item={itemDe('Dormis', false)} valor={undefined} index={0} total={1} onChange={() => {}} />)
    expect(html).toContain('Checklist (una sola carga)')
    expect(html).toContain('Requerimiento A')
    expect(html).toContain('Requerimiento B')
    expect(html).not.toContain('Agregar unidad')
    expect(html).not.toContain('Valor alfanumérico')
  })

  it('con repetible=false y selección parcial muestra el estado y sigue sin colapsar por unidad', () => {
    const valor = { unidades: [{ codigo: 'Única', selected: ['o1'] }] }
    const html = renderToStaticMarkup(<ItemRenderer item={itemDe('Dormis', false)} valor={valor} index={0} total={1} onChange={() => {}} />)
    expect(html).toContain('1/2 requerimientos')
    expect(html).toContain('Incompleto')
    expect(html).not.toContain('Agregar unidad')
  })

  it('con repetible=false y checklist completo marca que cumple', () => {
    const valor = { unidades: [{ codigo: 'Única', selected: ['o1', 'o2'] }] }
    const html = renderToStaticMarkup(<ItemRenderer item={itemDe('Dormis', false)} valor={valor} index={0} total={1} onChange={() => {}} />)
    expect(html).toContain('2/2 requerimientos')
    expect(html).toContain('Cumple')
  })
})

function itemPlano(requerido = true): Item {
  return {
    id: 'it-2',
    modulo_id: 'm1',
    tipo: 'PLANO_XY',
    texto: 'Layout del piso de venta',
    opciones: [],
    orden: 0,
    requerido: requerido,
    activo: true,
    puntaje: 20,
    created_at: ''
  }
}

describe('ItemRenderer · Cumplimiento XY (PLANO_XY)', () => {
  it('sin planos cargados pide subir la imagen del layout', () => {
    const html = renderToStaticMarkup(<ItemRenderer item={itemPlano()} valor={undefined} index={0} total={1} onChange={() => {}} />)
    expect(html).toContain('Subí la imagen del layout')
    expect(html).toContain('Elegir imagen')
    // Sin pines marcados el ítem requerido no está completo.
    expect(html).toContain('Obligatorio para enviar la evaluación')
  })

  it('muestra el resumen de pines y la proporción que puntúa (11/15 = 73.33%)', () => {
    const puntos = [
      ...Array.from({ length: 11 }, (_, i) => ({ id: `ok${i}`, planoId: 'p1', x: 0.1, y: 0.1, cumple: true, comentario: `ok ${i}` })),
      ...Array.from({ length: 4 }, (_, i) => ({ id: `no${i}`, planoId: 'p1', x: 0.5, y: 0.5, cumple: false, comentario: `falta ${i}` }))
    ]
    const valor = { planos: [{ id: 'p1', nombre: 'Planta baja', paths: ['ev/1/a.jpg'] }], puntos }
    const html = renderToStaticMarkup(<ItemRenderer item={itemPlano()} valor={valor} index={0} total={1} onChange={() => {}} />)
    expect(html).toContain('15 puntos')
    expect(html).toContain('11 cumplen')
    expect(html).toContain('4 no cumplen')
    expect(html).toContain('73.33%')
    // Ya hay pines con veredicto: no marca el ítem como obligatorio pendiente.
    expect(html).not.toContain('Obligatorio para enviar la evaluación')
  })

  it('con puntos sin veredicto el ítem requerido sigue pendiente', () => {
    const valor = {
      planos: [{ id: 'p1', nombre: 'Planta baja', paths: ['ev/1/a.jpg'] }],
      puntos: [{ id: 'x', planoId: 'p1', x: 0.4, y: 0.4, cumple: null, comentario: '' }]
    }
    const html = renderToStaticMarkup(<ItemRenderer item={itemPlano()} valor={valor} index={0} total={1} onChange={() => {}} />)
    expect(html).toContain('Obligatorio para enviar la evaluación')
  })
})

function itemChecklist(): Item {
  return {
    id: 'it-3',
    modulo_id: 'm1',
    tipo: 'CHECKLIST',
    texto: 'Presentación de góndolas',
    opciones: [
      { id: 'o1', etiqueta: 'Góndola de panadería' },
      { id: 'o2', etiqueta: 'Góndola de bebidas' }
    ],
    orden: 0,
    requerido: true,
    activo: true,
    puntaje: 10,
    created_at: ''
  }
}

describe('ItemRenderer · evidencia fotográfica del checklist', () => {
  it('ofrece la cámara en todas las opciones, también en la que ya está validada', () => {
    const valor = { selected: ['o1'], informativos: [], evidencias: {} }
    const html = renderToStaticMarkup(<ItemRenderer item={itemChecklist()} valor={valor} index={0} total={1} onChange={() => {}} />)
    expect(html).toContain('Punto validado')
    expect(html.split('Tomar foto de evidencia').length - 1).toBe(2)
  })

  it('también con el punto sin cumplir', () => {
    const html = renderToStaticMarkup(<ItemRenderer item={itemChecklist()} valor={undefined} index={0} total={1} onChange={() => {}} />)
    expect(html.split('Tomar foto de evidencia').length - 1).toBe(2)
  })
})

function itemConciliacion(contraDato?: 'SOH' | 'FINAL_BASE'): Item {
  return {
    id: 'it-4',
    modulo_id: 'm1',
    tipo: 'CONCILIACION',
    texto: 'Concilia stock contra el sistema',
    opciones: [],
    orden: 0,
    requerido: true,
    activo: true,
    puntaje: 10,
    contra_dato: contraDato,
    created_at: ''
  }
}

describe('ItemRenderer · conciliación (contra dato del ítem)', () => {
  it('no muestra el selector de contra dato en la evaluación (se configura al crear el ítem)', () => {
    const html = renderToStaticMarkup(<ItemRenderer item={itemConciliacion()} valor={undefined} index={0} total={1} onChange={() => {}} />)
    expect(html).not.toContain('Calcular contra')
  })

  it('sin contra dato configurado usa SOH por defecto (etiqueta Teórica SOH)', () => {
    const html = renderToStaticMarkup(<ItemRenderer item={itemConciliacion()} valor={undefined} index={0} total={1} onChange={() => {}} />)
    expect(html).toContain('Teórica (SOH)')
    expect(html).toContain('Física')
  })

  it('con contra dato FINAL_BASE el campo teórica se etiqueta como precio', () => {
    const html = renderToStaticMarkup(<ItemRenderer item={itemConciliacion('FINAL_BASE')} valor={undefined} index={0} total={1} onChange={() => {}} />)
    expect(html).toContain('Teórica (precio)')
  })
})