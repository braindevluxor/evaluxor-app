import { describe, expect, it } from 'vitest'
import { etiquetaDispositivo, etiquetaPantalla, perfilesConectados, totalConectados, type EstadoCanal } from './presencia'

const CATALOGO = {
  sucursales: [
    { id: 's1', nombre: 'Norte' },
    { id: 's2', nombre: 'Centro' }
  ],
  departamentos: [{ id: 'd1', nombre: 'Mercadeo' }],
  modulos: [{ id: 'm1', nombre: 'Inventario' }]
}

describe('presencia · nombre de la pantalla', () => {
  it('resuelve las rutas del evaluador con el nombre de la sucursal', () => {
    expect(etiquetaPantalla('/')).toBe('Inicio')
    expect(etiquetaPantalla('/evaluar')).toBe('Mis evaluaciones')
    expect(etiquetaPantalla('/evaluar/historial')).toBe('Historial de evaluaciones')
    expect(etiquetaPantalla('/evaluar/s1', CATALOGO)).toBe('Evaluando · Sucursal Norte')
    expect(etiquetaPantalla('/evaluar/s2/resumen', CATALOGO)).toBe('Resumen · Sucursal Centro')
  })

  it('no confunde /evaluar/historial con una sucursal llamada "historial"', () => {
    // Sin el catálogo, `/evaluar/historial` sigue siendo el historial y no "evaluando".
    expect(etiquetaPantalla('/evaluar/historial')).toBe('Historial de evaluaciones')
  })

  it('las rutas de departamento se leen como departamento, no como sucursal', () => {
    // /evaluar/departamento/:id es otra rama: si se leyera como sucursal diría
    // "evaluando" o inventaría un nombre de tienda.
    expect(etiquetaPantalla('/evaluar/departamento/d1', CATALOGO)).toBe('Evaluando · Departamento Mercadeo')
    expect(etiquetaPantalla('/evaluar/departamento/d1/resumen', CATALOGO)).toBe('Resumen · Departamento Mercadeo')
    expect(etiquetaPantalla('/evaluar/departamento/d2', CATALOGO)).toBe('Evaluando')
    expect(etiquetaPantalla('/evaluar/departamento/d1')).toBe('Evaluando')
  })

  it('cae a una etiqueta genérica cuando el catálogo aún no cargó', () => {
    expect(etiquetaPantalla('/evaluar/s1')).toBe('Evaluando')
    expect(etiquetaPantalla('/evaluar/s1/resumen')).toBe('Resumen · una sucursal')
    expect(etiquetaPantalla('/evaluar/no-existe', CATALOGO)).toBe('Evaluando')
  })

  it('resuelve detalle de evaluación, dashboard y configuración', () => {
    expect(etiquetaPantalla('/evaluaciones/e1')).toBe('Detalle de evaluación')
    expect(etiquetaPantalla('/evaluaciones/e1/conciliacion')).toBe('Conciliación')
    expect(etiquetaPantalla('/dashboard')).toBe('Dashboard')
    expect(etiquetaPantalla('/dashboard/historial')).toBe('Historial')
    expect(etiquetaPantalla('/dashboard/comparativas')).toBe('Comparativas')
    expect(etiquetaPantalla('/dashboard/modulo/m1', CATALOGO)).toBe('Módulo Inventario')
    expect(etiquetaPantalla('/dashboard/modulo/m9', CATALOGO)).toBe('Módulo')
    expect(etiquetaPantalla('/config/usuarios')).toBe('Usuarios')
    expect(etiquetaPantalla('/config/items')).toBe('Ítems')
    expect(etiquetaPantalla('/config/departamentos')).toBe('Departamentos')
    expect(etiquetaPantalla('/config/cualquier-cosa')).toBe('Configuración')
    expect(etiquetaPantalla('/proyectos/biometrico')).toBe('Biométrico')
    expect(etiquetaPantalla('/proyectos/p1')).toBe('Proyectos')
  })

  it('ignora query y hash, y nunca muestra un path crudo', () => {
    expect(etiquetaPantalla('/evaluar/s1?tab=2', CATALOGO)).toBe('Evaluando · Sucursal Norte')
    expect(etiquetaPantalla('/ruta/desconocida/mas')).toBe('En la app')
    expect(etiquetaPantalla('///')).toBe('Inicio')
  })
})

describe('presencia · tipo de dispositivo', () => {
  it('distingue celular, tablet y notebook', () => {
    expect(etiquetaDispositivo('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15 Mobile')).toBe('Celular')
    expect(etiquetaDispositivo('Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit Chrome Mobile')).toBe('Celular')
    expect(etiquetaDispositivo('Mozilla/5.0 (iPad; CPU OS 17_0) AppleWebKit Safari')).toBe('Tablet')
    expect(etiquetaDispositivo('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120')).toBe('Notebook')
    expect(etiquetaDispositivo('')).toBe('Notebook')
  })
})

describe('presencia · agrupación por usuario', () => {
  const usuario = (over: Partial<Record<string, unknown>>) => ({
    id: 'u1',
    nombre: 'Ana',
    usuario: 'ana',
    rol: 'EVALUADOR',
    ruta: '/evaluar/s1',
    pantalla: 'Evaluando · Sucursal Norte',
    dispositivo: 'Celular',
    sucursal_id: 's1',
    visto: 1000,
    ...over
  })

  it('agrupa los dos dispositivos de una misma persona', () => {
    const estado: EstadoCanal = {
      'u1:d1': [usuario({ dispositivo: 'Celular', visto: 1000, pantalla: 'Evaluando · Sucursal Norte' })] as never,
      'u1:d2': [usuario({ dispositivo: 'Notebook', visto: 2000, pantalla: 'Usuarios' })] as never
    }
    const out = perfilesConectados(estado)
    expect(Object.keys(out)).toEqual(['u1'])
    expect(out.u1.dispositivos).toBe(2)
    // Gana la pantalla del dispositivo más reciente.
    expect(out.u1.pantalla).toBe('Usuarios')
    expect(out.u1.dispositivo).toBe('Notebook')
  })

  it('ignora anuncios sin id y cuenta personas distintas, no dispositivos', () => {
    const estado: EstadoCanal = {
      'u1:d1': [usuario({})] as never,
      'u2:d1': [usuario({ id: 'u2', nombre: 'Luis', visto: 5 })] as never,
      roto: [{ id: undefined }] as never,
      vacio: [] as never
    }
    const out = perfilesConectados(estado)
    expect(totalConectados(out)).toBe(2)
    expect(out.u2.nombre).toBe('Luis')
    expect(out.ruido).toBeUndefined()
  })

  it('sin presencia, nadie conectado', () => {
    expect(perfilesConectados({})).toEqual({})
    expect(totalConectados({})).toBe(0)
  })
})
