import { describe, expect, it } from 'vitest'
import {
  describirBitacora,
  estadoDe,
  nombresVacios,
  rotuloTabla,
  type FilaBitacora,
  type NombresBitacora
} from './bitacora'

/**
 * `describirBitacora` es el traductor de ids a frase. Se prueba con filas
 * ARMADAS A MANO en vez de contra la base: es la única forma de cubrir las
 * cuatro tablas y las tres acciones sin montar un Postgres por caso.
 *
 * Lo que se cuida acá no es la gramática sino las dos trampas del dominio:
 *
 *  1. La app NO borra filas al desasignar: hace `update activa = false`. Ese
 *     flip true→false es el cambio que más duele no ver, y es justamente el
 *     que `estadoDe` tiene que devolver como `Baja`.
 *  2. Un CREADO no tiene orilla previa y un ELIMINADO no tiene la siguiente.
 *     Si se leyera `datos_previos.activa` sin mirar la acción, los dos
 *     terminarían diciendo algo inventado.
 */

const MODULO = 'mod-1'
const SUCURSAL = 'suc-1'
const DEPTO = 'dep-1'
const PERSONA = 'per-1'

/** Catálogo resuelto: si el id está, devuelve el nombre; si no, el mapa falla. */
const nombres: NombresBitacora = {
  modulos: new Map([[MODULO, 'Inspección de vehículo']]),
  sucursales: new Map([[SUCURSAL, 'Eva Centro']]),
  departamentos: new Map([[DEPTO, 'Taller Automotriz']]),
  personas: new Map([[PERSONA, 'Juan Pérez']])
}

function fila(parcial: Partial<FilaBitacora>): FilaBitacora {
  return {
    id: 'f-1',
    tabla: 'sucursal_modulos',
    registro_id: 'r-1',
    accion: 'CREADO',
    datos_previos: null,
    datos_nuevos: null,
    actor: PERSONA,
    created_at: '2026-11-02T10:00:00.000Z',
    ...parcial
  }
}

describe('describirBitacora · módulo por sucursal', () => {
  it('una alta dice quién habilitó qué y dónde', () => {
    const f = fila({
      accion: 'CREADO',
      datos_nuevos: { sucursal_id: SUCURSAL, modulo_id: MODULO, activa: true }
    })
    expect(describirBitacora(f, nombres)).toBe('Se habilitó «Inspección de vehículo» en Eva Centro')
  })

  it('el update que la app hace al desasignar se lee como baja', () => {
    // Así lo escribe configurarSucursalModulos: no borra, apaga.
    const f = fila({
      accion: 'MODIFICADO',
      datos_previos: { sucursal_id: SUCURSAL, modulo_id: MODULO, activa: true },
      datos_nuevos: { sucursal_id: SUCURSAL, modulo_id: MODULO, activa: false }
    })
    expect(describirBitacora(f, nombres)).toBe('Se deshabilitó «Inspección de vehículo» en Eva Centro')
    expect(estadoDe(f)).toBe('Baja')
  })

  it('re-habilitar es alta de nuevo, no una baja', () => {
    const f = fila({
      accion: 'MODIFICADO',
      datos_previos: { sucursal_id: SUCURSAL, modulo_id: MODULO, activa: false },
      datos_nuevos: { sucursal_id: SUCURSAL, modulo_id: MODULO, activa: true }
    })
    expect(describirBitacora(f, nombres)).toBe('Se habilitó «Inspección de vehículo» en Eva Centro')
    expect(estadoDe(f)).toBe('Alta')
  })

  it('un borrado dice de qué unidad salió', () => {
    const f = fila({
      accion: 'ELIMINADO',
      datos_previos: { sucursal_id: SUCURSAL, modulo_id: MODULO, activa: false }
    })
    expect(describirBitacora(f, nombres)).toBe('Se eliminó «Inspección de vehículo» de Eva Centro')
    // Una eliminación no es alta ni baja: es otra cosa, y el chip lo dice.
    expect(estadoDe(f)).toBeNull()
  })
})

describe('describirBitacora · módulo por departamento', () => {
  it('la baja del Taller Automotriz se nombra con su unidad', () => {
    const f = fila({
      tabla: 'departamento_modulos',
      accion: 'MODIFICADO',
      datos_previos: { departamento_id: DEPTO, modulo_id: MODULO, activa: true },
      datos_nuevos: { departamento_id: DEPTO, modulo_id: MODULO, activa: false }
    })
    expect(describirBitacora(f, nombres)).toBe(
      'Se deshabilitó «Inspección de vehículo» en Taller Automotriz'
    )
  })
})

describe('describirBitacora · asignación de evaluador', () => {
  it('asignar una persona a una sucursal', () => {
    const f = fila({
      tabla: 'asignaciones',
      accion: 'CREADO',
      datos_nuevos: { evaluador_id: PERSONA, sucursal_id: SUCURSAL, activa: true }
    })
    expect(describirBitacora(f, nombres)).toBe('Se asignó Juan Pérez a Eva Centro')
  })

  it('quitar a la persona se lee como quitar, no como deshabilitar', () => {
    const f = fila({
      tabla: 'asignaciones',
      accion: 'MODIFICADO',
      datos_previos: { evaluador_id: PERSONA, sucursal_id: SUCURSAL, activa: true },
      datos_nuevos: { evaluador_id: PERSONA, sucursal_id: SUCURSAL, activa: false }
    })
    expect(describirBitacora(f, nombres)).toBe('Se quitó Juan Pérez de Eva Centro')
    expect(estadoDe(f)).toBe('Baja')
  })

  it('asignarle un módulo a un evaluador', () => {
    const f = fila({
      tabla: 'asignaciones_modulos',
      accion: 'CREADO',
      datos_nuevos: { evaluador_id: PERSONA, modulo_id: MODULO, activa: true }
    })
    expect(describirBitacora(f, nombres)).toBe(
      'Se asignó a Juan Pérez el módulo «Inspección de vehículo»'
    )
  })
})

describe('describirBitacora · lo que ya no existe', () => {
  it('un módulo borrado se llama «registro eliminado» y no un uuid', () => {
    const f = fila({
      accion: 'CREADO',
      datos_nuevos: { sucursal_id: SUCURSAL, modulo_id: 'borrado-1', activa: true }
    })
    expect(describirBitacora(f, nombres)).toBe('Se habilitó «registro eliminado» en Eva Centro')
  })

  it('una persona borrada se distingue de un id desconocido', () => {
    const f = fila({
      tabla: 'asignaciones',
      accion: 'CREADO',
      datos_nuevos: { evaluador_id: 'nadie', sucursal_id: SUCURSAL, activa: true }
    })
    expect(describirBitacora(f, nombres)).toBe('Se asignó persona eliminada a Eva Centro')
  })

  it('un actor borrado no inventa un responsable', () => {
    const f = fila({
      tabla: 'asignaciones',
      accion: 'CREADO',
      datos_nuevos: { evaluador_id: PERSONA, sucursal_id: SUCURSAL, activa: true },
      actor: null
    })
    // La frase no lleva al actor (va en su columna), pero el mapa vacío no
    // debe romperla: es el caso de abrir la pantalla sin catálogo cargado.
    expect(describirBitacora(f, nombresVacios())).toBe(
      'Se asignó persona eliminada a registro eliminado'
    )
    expect(describirBitacora(f, nombres)).toContain('Juan Pérez')
  })
})

describe('describirBitacora · el rótulo de la tabla', () => {
  it('las cuatro tablas del alcance tienen rótulo propio', () => {
    expect(rotuloTabla('asignaciones')).toBe('Evaluador por sucursal')
    expect(rotuloTabla('asignaciones_modulos')).toBe('Módulo por evaluador')
    expect(rotuloTabla('sucursal_modulos')).toBe('Módulo por sucursal')
    expect(rotuloTabla('departamento_modulos')).toBe('Módulo por departamento')
  })

  it('una tabla desconocida cae al nombre crudo y no a un hueco', () => {
    expect(rotuloTabla('tabla_futura')).toBe('tabla_futura')
  })
})

describe('describirBitacora · el chip de estado', () => {
  it('un CREADO es alta aunque no traiga orilla previa', () => {
    const f = fila({
      accion: 'CREADO',
      datos_nuevos: { sucursal_id: SUCURSAL, modulo_id: MODULO, activa: true }
    })
    expect(estadoDe(f)).toBe('Alta')
  })

  it('un cambio que no toca `activa` no lleva chip', () => {
    // Dos guardados seguidos con el mismo valor: el trigger ni lo registra,
    // pero si llegara, no hay alta ni baja que mostrar.
    const f = fila({
      accion: 'MODIFICADO',
      datos_previos: { sucursal_id: SUCURSAL, modulo_id: MODULO, activa: true },
      datos_nuevos: { sucursal_id: SUCURSAL, modulo_id: MODULO, activa: true }
    })
    expect(estadoDe(f)).toBeNull()
    expect(describirBitacora(f, nombres)).toBe('Se habilitó «Inspección de vehículo» en Eva Centro')
  })
})
