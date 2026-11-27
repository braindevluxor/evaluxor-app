import { describe, expect, it } from 'vitest'
import {
  COLORES_PROVEEDOR,
  COLORES_ESTADO,
  colorDe,
  colorLibre,
  diasDelMes,
  enMora,
  estadoEspacio,
  fechasDeCobro,
  haySolape,
  neon,
  nombreMes,
  porcentaje,
  porcentajeAnillo,
  usd,
  vigente
} from './acuerdos'

/**
 * Acuerdos Comerciales: las reglas puras del módulo —de qué fechas se
 * cobra, cuándo hay mora, si dos contratos se cruzan y qué porcentaje
 * está rentado—. Nada de esto toca la base, así que se prueba acá.
 */

describe('fechasDeCobro', () => {
  it('mensual: una fecha por mes, incluyendo el día final', () => {
    expect(fechasDeCobro('2026-01-01', '2026-04-01', 'Mensual')).toEqual([
      '2026-01-01',
      '2026-02-01',
      '2026-03-01',
      '2026-04-01'
    ])
  })

  it('quincenal: cada 15 días', () => {
    expect(fechasDeCobro('2026-01-01', '2026-02-01', 'Quincenal')).toEqual([
      '2026-01-01',
      '2026-01-16',
      '2026-01-31'
    ])
  })

  it('trimestral y semestre salen cada 3 y cada 6 meses', () => {
    expect(fechasDeCobro('2026-01-15', '2026-12-31', 'Trimestral')).toEqual([
      '2026-01-15',
      '2026-04-15',
      '2026-07-15',
      '2026-10-15'
    ])
    expect(fechasDeCobro('2026-01-15', '2026-12-31', 'Semestre')).toEqual(['2026-01-15', '2026-07-15'])
  })

  it('una opción nueva del catálogo cae en el paso mensual (por defecto)', () => {
    expect(fechasDeCobro('2026-01-01', '2026-03-01', 'Bimestral')).toEqual([
      '2026-01-01',
      '2026-02-01',
      '2026-03-01'
    ])
  })

  it('sin fechas, invertidas o absurdas: nada (y no un bucle eterno)', () => {
    expect(fechasDeCobro('', '2026-04-01', 'Mensual')).toEqual([])
    expect(fechasDeCobro('2026-05-01', '2026-04-01', 'Mensual')).toEqual([])
    expect(fechasDeCobro('2020-01-01', '2060-01-01', 'Quincenal').length).toBeLessThanOrEqual(200)
  })
})

describe('la mora', () => {
  it('es una fecha pasada SIN cobrar: ni la futura ni la cobrada', () => {
    expect(enMora('2026-11-01', false, '2026-11-27')).toBe(true)
    expect(enMora('2026-11-01', true, '2026-11-27')).toBe(false)
    expect(enMora('2026-12-01', false, '2026-11-27')).toBe(false)
    // El día mismo todavía no es mora.
    expect(enMora('2026-11-27', false, '2026-11-27')).toBe(false)
  })
})

describe('el semáforo del plano', () => {
  const acuerdo = {
    fecha_inicio: '2026-11-01',
    fecha_fin: '2026-12-31',
    frecuencia: 'Mensual'
  }

  it('sin acuerdo vigente el espacio está DISPONIBLE (rojo)', () => {
    expect(estadoEspacio(null, [], '2026-11-27')).toBe('disponible')
    // Con fechas fuera de hoy tampoco cuenta.
    expect(
      estadoEspacio({ ...acuerdo, fecha_fin: '2026-11-10' }, ['2026-11-01'], '2026-11-27')
    ).toBe('disponible')
    // Baja lógica también.
    expect(estadoEspacio({ ...acuerdo, activo: false }, ['2026-11-01'], '2026-11-27')).toBe('disponible')
  })

  it('ocupado y al día con lo vencido → OCUPADO (verde)', () => {
    // Sólo la fecha pasada (01/11) tiene que estar cobrada; la de 01/12
    // todavía no venció, así que no cuenta como pendiente.
    expect(estadoEspacio(acuerdo, ['2026-11-01'], '2026-11-27')).toBe('ocupado')
    // Día exacto del cobro: todavía no es deuda.
    expect(estadoEspacio(acuerdo, [], '2026-11-01')).toBe('ocupado')
  })

  it('ocupado con un vencido sin pagar → PENDIENTE (amarillo)', () => {
    expect(estadoEspacio(acuerdo, [], '2026-11-27')).toBe('pendiente')
    // Cobró una de las dos vencidas, le falta la otra.
    expect(estadoEspacio(acuerdo, ['2026-12-01'], '2026-12-15')).toBe('pendiente')
    // Cuando paga todo lo vencido, vuelve a verde.
    expect(estadoEspacio(acuerdo, ['2026-11-01', '2026-12-01'], '2026-12-15')).toBe('ocupado')
  })

  it('acepta un Set o un arreglo de fechas cobradas', () => {
    expect(estadoEspacio(acuerdo, new Set(['2026-11-01']), '2026-11-27')).toBe('ocupado')
    expect(estadoEspacio(acuerdo, ['2026-11-01'], '2026-11-27')).toBe('ocupado')
  })

  it('los tres colores del semáforo existen y son distintos', () => {
    expect(COLORES_ESTADO.disponible).toBe('#dc2626')
    expect(COLORES_ESTADO.ocupado).toBe('#16a34a')
    expect(COLORES_ESTADO.pendiente).toBe('#eab308')
    expect(new Set(Object.values(COLORES_ESTADO)).size).toBe(3)
  })

  it('el neón lleva el color del estado en tres capas, con halo blanco por afuera', () => {
    const n = neon('#16a34a')
    // Tres capas del MISMO color, de corta a difusa: 3px → 14px → 34px.
    expect(n.match(/#16a34a/g)).toHaveLength(3)
    expect(n).toBe('#ffffff 0 0 0 2px, #16a34a 0 0 3px, #16a34a 0 0 14px, #16a34a 0 0 34px')
    // El blanco es el anillo que separa el halo del fondo de la foto.
    expect(n.startsWith('#ffffff')).toBe(true)
  })
})

describe('los solapes y la vigencia', () => {  const base = { id: 'a1', espacio_id: 'e1', fecha_inicio: '2026-01-01', fecha_fin: '2026-06-30' }

  it('dos acuerdos del mismo espacio no pueden cruzarse en el tiempo', () => {
    expect(haySolape([base], 'e1', '2026-06-01', '2026-12-31')).toBe(true)
    expect(haySolape([base], 'e1', '2026-01-15', '2026-03-01')).toBe(true)
    // Se tocan en el borde: también es solape (el mismo día no cabe dos veces).
    expect(haySolape([base], 'e1', '2026-06-30', '2026-12-31')).toBe(true)
    // Antes y después: no.
    expect(haySolape([base], 'e1', '2026-07-01', '2026-12-31')).toBe(false)
    expect(haySolape([base], 'e1', '2025-01-01', '2025-12-31')).toBe(false)
    // Otro espacio no molesta.
    expect(haySolape([base], 'e2', '2026-01-15', '2026-03-01')).toBe(false)
    // Al editar, el propio acuerdo se excluye.
    expect(haySolape([base], 'e1', '2026-01-15', '2026-03-01', 'a1')).toBe(false)
  })

  it('vigente: activo, con hoy adentro', () => {
    expect(vigente({ fecha_inicio: '2026-01-01', fecha_fin: '2026-12-31' }, '2026-11-27')).toBe(true)
    expect(vigente({ fecha_inicio: '2026-01-01', fecha_fin: '2026-12-31', activo: false }, '2026-11-27')).toBe(false)
    expect(vigente({ fecha_inicio: '2027-01-01', fecha_fin: '2027-12-31' }, '2026-11-27')).toBe(false)
    expect(vigente({ fecha_inicio: '2025-01-01', fecha_fin: '2025-12-31' }, '2026-11-27')).toBe(false)
  })
})

describe('los números del dashboard', () => {
  it('porcentaje: sin espacios no hay NaN', () => {
    expect(porcentaje(0, 0)).toBe(0)
    expect(porcentaje(3, 4)).toBe(75)
    expect(porcentaje(1, 3)).toBe(33)
  })

  it('usd formatea con dos decimales y el guion de vacío', () => {
    expect(usd(1234.5)).toBe('1.234,50')
    expect(usd(null)).toBe('—')
  })

  it('la paleta: color válido se respeta, el inválido cae en la primera', () => {
    expect(colorDe('#0f766e')).toBe('#0f766e')
    expect(colorDe('rojo')).toBe(COLORES_PROVEEDOR[0])
    expect(colorDe(null)).toBe(COLORES_PROVEEDOR[0])
    // El libre es el primero que nadie está usando.
    expect(colorLibre([COLORES_PROVEEDOR[0], COLORES_PROVEEDOR[1]])).toBe(COLORES_PROVEEDOR[2])
    expect(colorLibre([])).toBe(COLORES_PROVEEDOR[0])
  })
})

describe('el medidor curvo (porcentajeAnillo)', () => {
  it('el % es el valor sobre SU base, sin techoar el número', () => {
    expect(porcentajeAnillo(50, 100)).toBe(0.5)
    expect(porcentajeAnillo(0, 100)).toBe(0)
    // Más de lo negociado (plata de contratos viejos): da > 1 y el
    // número lo muestra; el ARCO es quien se techa al 100 %.
    expect(porcentajeAnillo(150, 100)).toBe(1.5)
  })

  it('sin base no hay porcentaje: null (la leyenda pone «—»)', () => {
    expect(porcentajeAnillo(100, 0)).toBeNull()
    expect(porcentajeAnillo(100, -5)).toBeNull()
    expect(porcentajeAnillo(0, 0)).toBeNull()
  })

  it('nunca da negativo', () => {
    expect(porcentajeAnillo(-10, 100)).toBe(0)
  })
})

describe('diasDelMes', () => {
  it('empieza en lunes y trae todos los días', () => {
    // Noviembre 2026 arranca un domingo: 6 huecos antes del día 1.
    const dias = diasDelMes(2026, 10)
    expect(dias.slice(0, 6)).toEqual(['', '', '', '', '', ''])
    expect(dias[6]).toBe('2026-11-01')
    expect(dias[dias.length - 1]).toBe('2026-11-30')
    expect(dias.filter(Boolean)).toHaveLength(30)
  })
})

describe('nombreMes (el rótulo del filtro de fecha)', () => {
  it('traduce YYYY-MM al mes corto con el año', () => {
    expect(nombreMes('2026-11')).toBe('Nov 2026')
    expect(nombreMes('2026-01')).toBe('Ene 2026')
    expect(nombreMes('2026-12')).toBe('Dic 2026')
  })

  it('un valor raro se devuelve tal cual, sin romper el selector', () => {
    expect(nombreMes('')).toBe('')
    expect(nombreMes('noviembre')).toBe('noviembre')
    expect(nombreMes('2026-13')).toBe('2026-13')
    expect(nombreMes('2026-00')).toBe('2026-00')
    expect(nombreMes(' 2026-07 ')).toBe('Jul 2026')
  })
})
