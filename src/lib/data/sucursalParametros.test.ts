import { describe, expect, it } from 'vitest'
import { planificarGuardado, paraGuardar, estadoPermiso, DIAS_AVISO_VENCIMIENTO, type FilaEditada } from './sucursalParametros'
import type { SucursalPermiso } from '../types'

type Permiso = Pick<SucursalPermiso, 'id' | 'nombre' | 'numero' | 'vigente' | 'emision' | 'vence' | 'observacion'>

const sinTabla = (p: Partial<Permiso> & { id?: string }): FilaEditada<Permiso> => ({
  id: p.id,
  nombre: p.nombre ?? 'Sanitario',
  numero: p.numero ?? null,
  vigente: p.vigente ?? true,
  emision: p.emision ?? null,
  vence: p.vence ?? null,
  observacion: p.observacion ?? null
})

const enTabla = (p: Partial<Permiso> & { id: string }): Permiso => sinTabla(p) as Permiso

const CAMPOS: (keyof Permiso)[] = ['nombre', 'numero', 'vigente', 'emision', 'vence', 'observacion']

describe('planificarGuardado', () => {
  it('las filas nuevas se insertan y no aparecen como actualización', () => {
    const plan = planificarGuardado<Permiso>([], [sinTabla({ nombre: 'Bomberos' })], CAMPOS)

    expect(plan.insertar).toHaveLength(1)
    expect(plan.insertar[0]).not.toHaveProperty('id')
    expect(plan.actualizar).toEqual([])
    expect(plan.eliminar).toEqual([])
  })

  it('las filas que se quitaron de la pantalla se borran de la nube', () => {
    const plan = planificarGuardado<Permiso>([enTabla({ id: 'a' }), enTabla({ id: 'b' })], [sinTabla({ id: 'a' })], CAMPOS)

    expect(plan.eliminar).toEqual(['b'])
    expect(plan.actualizar).toEqual([])
  })

  it('una fila intocada no genera ninguna operación', () => {
    const plan = planificarGuardado<Permiso>([enTabla({ id: 'a', vence: '2027-01-01' })], [sinTabla({ id: 'a', vence: '2027-01-01' })], CAMPOS)

    expect(plan.insertar).toEqual([])
    expect(plan.actualizar).toEqual([])
    expect(plan.eliminar).toEqual([])
  })

  it('al cambiar un campo se manda sólo ese campo', () => {
    const plan = planificarGuardado<Permiso>(
      [enTabla({ id: 'a', nombre: 'Sanitario', numero: 'RES-12', vence: '2026-01-01' })],
      [sinTabla({ id: 'a', nombre: 'Sanitario', numero: 'RES-45', vence: '2026-01-01' })],
      CAMPOS
    )

    expect(plan.actualizar).toEqual([{ id: 'a', cambios: { numero: 'RES-45' } }])
  })

  it('el texto vacío de la pantalla es el null de la tabla: no es un cambio', () => {
    const plan = planificarGuardado<Permiso>(
      [enTabla({ id: 'a', numero: null, observacion: null })],
      [sinTabla({ id: 'a', numero: '', observacion: '   ' })],
      CAMPOS
    )

    expect(plan.actualizar).toEqual([])
  })

  it('vaciar un campo que tenía dato sí es un cambio', () => {
    const plan = planificarGuardado<Permiso>(
      [enTabla({ id: 'a', numero: 'RES-12' })],
      [sinTabla({ id: 'a', numero: '' })],
      CAMPOS
    )

    expect(plan.actualizar).toEqual([{ id: 'a', cambios: { numero: null } }])
  })
})

describe('paraGuardar', () => {
  it('pasa el texto vacío a null sin tocar cantidad, vigencia ni tipo', () => {
    const fila = paraGuardar({ nombre: '  ', numero: '', cantidad: 2, vigente: false, tipo: 'OPERATIVO' })

    expect(fila).toEqual({ nombre: null, numero: null, cantidad: 2, vigente: false, tipo: 'OPERATIVO' })
  })
})

describe('estadoPermiso', () => {
  it('sin fecha de vencimiento no se puede vencer', () => {
    expect(estadoPermiso(null, '2026-03-01')).toBe('SIN_FECHA')
  })

  it('lo que venció está vencido', () => {
    expect(estadoPermiso('2026-02-28', '2026-03-01')).toBe('VENCIDO')
  })

  it('el día del vencimiento todavía es vigente, pero ya avisa', () => {
    expect(estadoPermiso('2026-03-01', '2026-03-01')).toBe('POR_VENCER')
  })

  it(`avisa con ${DIAS_AVISO_VENCIMIENTO} días de anticipación, cruza mes y año`, () => {
    expect(estadoPermiso('2026-03-20', '2026-03-01')).toBe('POR_VENCER')
    expect(estadoPermiso('2026-04-01', '2026-03-01')).toBe('VIGENTE')
    // 2027-01-10 está a 31 días de 2026-12-10: en el umbral justo queda vigente.
    expect(estadoPermiso('2027-01-09', '2026-12-10')).toBe('POR_VENCER')
    expect(estadoPermiso('2027-01-10', '2026-12-10')).toBe('VIGENTE')
  })
})
