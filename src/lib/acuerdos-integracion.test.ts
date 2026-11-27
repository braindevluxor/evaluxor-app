import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { bloqueSql } from './supabaseSql'

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

/**
 * Acuerdos Comerciales: el cableado.
 *
 * Las reglas puras (`acuerdos.test.ts`) y el RLS (`acuerdos-sql.test.ts`)
 * tienen sus propios tests; éste mira lo que ninguno ve: que la pantalla
 * exista con SU ruta y SU menú, que los TRES roles estén en la misma
 * terna en los tres lugares (menú, ruta y base), y que la pantalla pida
 * los permisos que la base realmente aplica.
 */
describe('acuerdos comerciales · la ruta y el menú', () => {
  const app = fuente('../App.tsx')
  const consola = fuente('../components/layouts/ConsoleLayout.tsx')

  it('la ruta está dentro de la consola y pide los TRES roles del módulo', () => {
    expect(app).toContain('<ConsoleLayout />')
    // `/*`: cada vista del módulo es su propia ruta hija (el menú lateral
    // enlaza a todas y recargar no pierde la pantalla).
    expect(app).toMatch(
      /path="\/acuerdos\/\*"[\s\S]{0,240}roles=\{\[\s*'LIDER',\s*'COOR_ACU',\s*'AUD_EX'\s*\]}/
    )
    expect(app).toContain("import('./pages/acuerdos/AcuerdosComerciales')")
  })

  it('el menú ofrece el módulo a los tres roles y sólo a ellos', () => {
    // Las SEIS vistas del módulo, como submenús de «Comercial».
    for (const ruta of [
      '/acuerdos',
      '/acuerdos/planos',
      '/acuerdos/proveedores',
      '/acuerdos/acuerdos',
      '/acuerdos/calendario',
      '/acuerdos/historial'
    ]) {
      expect(consola).toContain(`to: '${ruta}'`)
    }
    // La raíz se marca sólo en la raíz (`end`), si no quedaría activa siempre.
    expect(consola).toContain("{ to: '/acuerdos', label: 'Dashboard', end: true")
    expect(consola).toContain("'/acuerdos': {")
    expect(consola).toContain('Acuerdos comerciales')

    const item = /to: '\/acuerdos\/planos'[\s\S]{0,200}roles: \[([^\]]+)\]/.exec(consola)
    expect(item).toBeTruthy()
    const roles = item![1]
    expect(roles).toContain("'LIDER'")
    expect(roles).toContain("'COOR_ACU'")
    expect(roles).toContain("'AUD_EX'")
    expect(roles).not.toContain("'GERENTE_S'")

    // Y para el Coordinador y el Auditor esa sección es TODO lo que ven.
    expect(consola).toContain(
      "if (rol === 'COOR_ACU' || rol === 'AUD_EX') return visibles.filter((s) => s.seccion === 'Comercial')"
    )
  })

  it('cada vista tiene su título en la barra superior', () => {
    for (const ruta of [
      '/acuerdos/planos',
      '/acuerdos/proveedores',
      '/acuerdos/acuerdos',
      '/acuerdos/calendario',
      '/acuerdos/historial'
    ]) {
      expect(consola).toContain(`'${ruta}': {`)
    }
  })
})

describe('acuerdos comerciales · los permisos de la pantalla', () => {
  const pagina = fuente('../pages/acuerdos/AcuerdosComerciales.tsx')

  it('gestionar y cobrar salen de los mismos cortes que en RLS', () => {
    expect(pagina).toContain('gestionaAcuerdos(rol)')
    expect(pagina).toContain('cobraAcuerdos(rol)')
    // El Líder entra a mirar pero no le aparece el alta ni el botón nuevo.
    expect(pagina).toContain('puedeGestionar && vista')
    expect(pagina).toContain('puedeCobrar={puedeCobrar}')
    expect(pagina).toContain('puedeGestionar={puedeGestionar}')
  })

  it('las fechas de cobro y la mora se calculan, no se guardan', () => {
    const logica = fuente('./acuerdos.ts')
    expect(logica).toContain('export function fechasDeCobro')
    expect(logica).toContain('export function enMora')

    // El calendario las usa y la base sólo guarda lo cobrado.
    const calendario = fuente('../pages/acuerdos/CalendarioAcuerdos.tsx')
    expect(calendario).toContain('fechasDeCobro')
    expect(calendario).toContain('enMora')
    expect(pagina).toContain('registrarCobro')
  })
})

describe('acuerdos comerciales · el bloque en el esquema', () => {
  it('existe, con sus tablas, sus tres funciones de permiso y el bucket', () => {
    const sql = bloqueSql('acuerdos-comerciales.sql')

    for (const tabla of [
      'acuerdo_tipo_espacio',
      'acuerdo_catalogo',
      'acuerdo_proveedor',
      'acuerdo_plano',
      'acuerdo_espacio',
      'acuerdo_comercial',
      'acuerdo_cobro'
    ]) {
      expect(sql).toContain(`create table if not exists public.${tabla}`)
    }

    expect(sql).toContain('create or replace function public.es_coordinador_acu()')
    expect(sql).toContain('create or replace function public.es_aud_ex()')
    expect(sql).toContain('create or replace function public.puede_ver_acuerdos()')
    expect(sql).toContain("values ('acuerdos', 'acuerdos', false)")

    // Los checks de rol de los dos roles nuevos.
    expect(sql).toContain("'COOR_ACU','AUD_EX'")
  })
})
