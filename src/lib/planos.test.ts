import { describe, expect, it } from 'vitest'
import {
  limitarPan,
  limitarZoom,
  normalizadoAPantalla,
  normalizarPunto,
  pantallaANormalizado,
  tamanoImagen,
  vistaCentradaEnPunto,
  vistaConZoomEn,
  vistaInicial,
  type Vista
} from './planos'

const NATURAL = { w: 1000, h: 500 }
const VISOR = { w: 400, h: 400 }

describe('planos · geometría del visor', () => {
  it('a zoom 1 el plano entra completo en el visor (letterbox vertical)', () => {
    const g = tamanoImagen(NATURAL, VISOR, vistaInicial)
    expect(g.w).toBe(400)
    expect(g.h).toBe(200)
    // Centrado: 100px de aire arriba y abajo.
    expect(g.ox).toBe(0)
    expect(g.oy).toBe(100)
  })

  it('el zoom multiplica el tamaño desde la vista ajustada', () => {
    const g = tamanoImagen(NATURAL, VISOR, { zoom: 2, x: 0, y: 0 })
    expect(g.w).toBe(800)
    expect(g.h).toBe(400)
  })

  it('pantalla → normalizado es inverso de normalizado → pantalla', () => {
    const vista: Vista = { zoom: 2.5, x: 30, y: -20 }
    const punto = { x: 0.62, y: 0.18 }
    const px = normalizadoAPantalla(punto, NATURAL, VISOR, vista)
    const vuelta = pantallaANormalizado(px.x, px.y, NATURAL, VISOR, vista)
    expect(vuelta).not.toBeNull()
    expect(vuelta!.x).toBeCloseTo(punto.x, 6)
    expect(vuelta!.y).toBeCloseTo(punto.y, 6)
  })

  it('un toque fuera de la imagen no devuelve punto', () => {
    // Con zoom 1 el plano ocupa la franja central: 5px arriba es el fondo.
    expect(pantallaANormalizado(200, 5, NATURAL, VISOR, vistaInicial)).toBeNull()
    expect(pantallaANormalizado(200, 200, NATURAL, VISOR, vistaInicial)).not.toBeNull()
  })

  it('sin medidas no hay punto (imagen o visor sin tamaño)', () => {
    expect(pantallaANormalizado(10, 10, { w: 0, h: 0 }, VISOR, vistaInicial)).toBeNull()
    expect(pantallaANormalizado(10, 10, NATURAL, { w: 0, h: 0 }, vistaInicial)).toBeNull()
  })

  it('el zoom se mantiene entre 1 y 6', () => {
    expect(limitarZoom(0.2)).toBe(1)
    expect(limitarZoom(3)).toBe(3)
    expect(limitarZoom(99)).toBe(6)
    expect(limitarZoom(Number.NaN)).toBe(1)
  })

  it('el paneo se limita al plano: centrado si entra, bordes si sobra', () => {
    // A zoom 1 el plano entra entero → no hay por dónde arrastrar.
    expect(limitarPan({ zoom: 1, x: 300, y: -300 }, NATURAL, VISOR)).toEqual({ zoom: 1, x: 0, y: 0 })
    // A zoom 6 el plano es mucho más grande que el visor: puedearse hasta el borde.
    const limite = limitarPan({ zoom: 6, x: 99999, y: -99999 }, NATURAL, VISOR)
    const g = tamanoImagen(NATURAL, VISOR, { zoom: 6, x: 0, y: 0 })
    expect(limite.x).toBeCloseTo((g.w - VISOR.w) / 2, 6)
    expect(limite.y).toBeCloseTo(-(g.h - VISOR.h) / 2, 6)
  })

  it('el zoom con rueda mantiene fijo el punto bajo el cursor', () => {
    const antes = tamanoImagen(NATURAL, VISOR, vistaInicial)
    const cursor = { x: 320, y: 150 }
    const u = (cursor.x - antes.ox) / antes.w
    const v = (cursor.y - antes.oy) / antes.h
    const vista = vistaConZoomEn(3, cursor.x, cursor.y, NATURAL, VISOR, vistaInicial)
    expect(vista.zoom).toBeCloseTo(3, 6)
    const despues = normalizadoAPantalla({ x: u, y: v }, NATURAL, VISOR, vista)
    expect(despues.x).toBeCloseTo(cursor.x, 4)
    expect(despues.y).toBeCloseTo(cursor.y, 4)
  })

  it('si un eje sigue entrando entero tras el zoom, ese eje queda centrado', () => {
    // A zoom 1.5 la imagen mide 600×300 en un visor de 400×400: desborda en ancho,
    // sobra en alto → se puede panear en X, no en Y.
    const vista = vistaConZoomEn(1.5, 320, 150, NATURAL, VISOR, vistaInicial)
    expect(vista.zoom).toBe(1.5)
    expect(vista.y).toBe(0)
    expect(vista.x).not.toBe(0)
  })

  it('centrar en un pin lo deja en el medio del visor', () => {
    const punto = { x: 0.85, y: 0.1 }
    const vista = vistaCentradaEnPunto(punto, NATURAL, VISOR, 3)
    const pos = normalizadoAPantalla(punto, NATURAL, VISOR, vista)
    expect(pos.x).toBeCloseTo(VISOR.w / 2, 6)
    expect(pos.y).toBeCloseTo(VISOR.h / 2, 6)
  })

  it('normalizarPunto deja el pin dentro de la imagen', () => {
    expect(normalizarPunto(1.4, -0.2)).toEqual({ x: 1, y: 0 })
    expect(normalizarPunto(0.5, 0.5)).toEqual({ x: 0.5, y: 0.5 })
  })
})
