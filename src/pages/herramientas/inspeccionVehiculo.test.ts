import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Pruebas de fuente, como las de `ItemRenderer.test.tsx`: el proyecto no tiene
 * `@testing-library/react` y el `renderToStaticMarkup` (SSR) no ejecuta
 * `useEffect`. Acá se cubre el cableado —clave, ruta, menú, borrador y PDF—
 * que es lo que se rompe sin que ningún test de lógica lo note.
 */
const fuente = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

const CLAVE_ESPERADA = 'INSPECCION_VEHICULO'

describe('Inspección de vehículo · la clave de la herramienta', () => {
  it('es la misma en el helper, la pantalla y la semilla SQL', () => {
    const helper = fuente('../../lib/inspeccionVehiculo.ts')
    expect(helper).toContain(`CLAVE_INSPECCION = '${CLAVE_ESPERADA}'`)
    // La pantalla la lee del helper: si alguien la escribiera a mano adentro,
    // el módulo de la BD y el de la pantalla dejarían de ser el mismo.
    expect(fuente('./InspeccionVehiculo.tsx')).toContain('CLAVE_INSPECCION')
    const sql = fuente('../../../supabase/inspeccion-vehiculo.sql')
    expect(sql).toContain(`where herramienta = '${CLAVE_ESPERADA}'`)
    expect(sql).toContain(`'${CLAVE_ESPERADA}'`)
  })

  it('la semilla no toca el esquema: reaprovecha lo de la pre-entrega', () => {
    const sql = fuente('../../../supabase/inspeccion-vehiculo.sql')
    expect(sql).toContain('revision_pre_entrega')
    expect(sql).not.toMatch(/create table/i)
    expect(sql).not.toMatch(/add column/i)
  })
})

describe('Inspección de vehículo · acceso', () => {
  it('la ruta está dentro de la consola y sólo admite Líder y evaluador', () => {
    const app = fuente('../../App.tsx')
    expect(app).toContain('path="/herramientas/inspeccion-vehiculo"')
    expect(app).toMatch(/roles={\['EVALUADOR', 'LIDER'\]}/)
    // Dentro del bloque de ConsoleLayout (que es el menú que la invoca).
    expect(app.indexOf('path="/herramientas/inspeccion-vehiculo"')).toBeGreaterThan(
      app.indexOf('ConsoleLayout />')
    )
  })

  it('el menú lateral sólo se la muestra a quien puede evaluar', () => {
    const layout = fuente('../../components/layouts/ConsoleLayout.tsx')
    expect(layout).toContain("to: '/herramientas/inspeccion-vehiculo'")
    expect(layout).toContain("'/herramientas/inspeccion-vehiculo': {")
    // Sin permiso no hay entrada: la ruta le negaría el paso y el menú no
    // puede prometer una pantalla a la que no se puede entrar.
    expect(layout).toMatch(/= puedeEvaluar\s*\n?\s*\? \[/)
  })
})

describe('Inspección de vehículo · borrador local', () => {
  it('se retoma filtrando por herramienta, para no mezclar con otra pre-entrega', () => {
    const db = fuente('../../lib/offline/db.ts')
    expect(db).toMatch(/moduloId\?: string \| null/)
    expect(db).toMatch(/\(moduloId == null \|\| r\.modulo_id === moduloId\)/)
    const pagina = fuente('./InspeccionVehiculo.tsx')
    // El registro sólo se arma cuando el módulo ya llegó: guarda su id.
    expect(pagina).toContain('getPreEntregaAbierta(profile.id, modulo.id)')
  })

  it('el formulario se limpia cuando cambia la sucursal', () => {
    const pagina = fuente('./InspeccionVehiculo.tsx')
    expect(pagina).toMatch(/function cambiarSucursal[\s\S]*?vehiculo: \{\}/)
  })
})

describe('Inspección de vehículo · el PDF', () => {
  const pagina = fuente('./InspeccionVehiculo.tsx')
  const pdf = fuente('../../lib/pdf/exportarRevisionPreEntrega.ts')

  it('habla de propietario y trae el sistema de combustible del vehículo', () => {
    expect(pagina).toContain("etiquetaPersona: 'propietario'")
    expect(pagina).toContain('personaCampos: [')
    expect(pagina).toContain('combustible:')
    expect(pdf).toContain('Sistema de combustible')
    expect(pdf).toContain('etiquetaPersona')
  })

  it('abre una banda por sección sobre sus filas', () => {
    expect(pagina).toMatch(/grupo: g\.seccion \?\? 'Dictamen'/)
    expect(pdf).toContain('colspan="2"')
    expect(pdf).toContain('filasTabla(')
  })

  it('imprime las evidencias con su pie y las toma de las dos procedencias', () => {
    expect(pdf).toContain('Evidencias fotográficas')
    expect(pagina).toContain('createSignedUrls(paths, 3600)')
    expect(pagina).toMatch(/getPhotos\(ev\.photoIds\)/)
    // Se revocan: si no, cada exportación deja blob: colgados en la pestaña.
    expect(pagina).toMatch(/for \(const u of creadas\) URL\.revokeObjectURL\(u\)/)
  })

  it('el export no exige firma (la inspección puede hacerse sin el dueño)', () => {
    expect(pagina).toMatch(/const puedeExportar = Boolean\([\s\S]*?persona\.nombre\.trim\(\)/)
    expect(pagina).not.toMatch(/puedeExportar[\s\S]{0,120}chofer_firma/)
  })
})
