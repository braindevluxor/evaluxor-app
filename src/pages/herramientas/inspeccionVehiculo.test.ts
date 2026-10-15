import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Pruebas de fuente, como las de `ItemRenderer.test.tsx`: el proyecto no tiene
 * `@testing-library/react` y el `renderToStaticMarkup` (SSR) no ejecuta
 * `useEffect`. Acá se cubre el cableado —clave, ruta, tarjeta de entrada,
 * borrador y PDF— que es lo que se rompe sin que ningún test de lógica lo note.
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

  it('se sostiene sola: trae el andamiaje de la pre-entrega con sus guardas', () => {
    const sql = fuente('../../../supabase/inspeccion-vehiculo.sql')
    // En una base donde revision-pre-entrega.sql nunca se corrió no existen ni
    // la columna ni la tabla: sin esto, el archivo muere en la primera línea.
    expect(sql).toContain('add column if not exists herramienta')
    expect(sql).toContain('create table if not exists public.revision_pre_entrega')
    expect(sql).toContain('pre-entrega/')
    // Cada política se declara tras su `drop policy if exists`: poder correrla
    // en cualquier orden respecto de la otra semilla, sin duplicados ni choques.
    const creadas = [...sql.matchAll(/create policy (\w+)/g)].map((m) => m[1])
    expect(creadas.length).toBeGreaterThanOrEqual(8)
    for (const nombre of creadas) {
      expect(sql).toContain(`drop policy if exists ${nombre}`)
    }
  })
})

describe('Inspección de vehículo · acceso', () => {
  it('la ruta vive en /evaluar, junto a la evaluación, y sólo admite Líder y evaluador', () => {
    const app = fuente('../../App.tsx')
    expect(app).toContain('path="/evaluar/inspeccion-vehiculo"')
    expect(app).toMatch(/roles={\['EVALUADOR', 'LIDER'\]}/)
    // Se llena desde el teléfono, así que va en el bloque móvil que precede a
    // ConsoleLayout, no detrás de la consola de escritorio.
    const ruta = app.indexOf('path="/evaluar/inspeccion-vehiculo"')
    expect(ruta).toBeGreaterThan(-1)
    expect(ruta).toBeLessThan(app.indexOf('<ConsoleLayout />'))
    // La entrada vieja en la consola ya no existe.
    expect(app).not.toContain('/herramientas/inspeccion-vehiculo')
  })

  it('se entra desde la tarjeta de EvaluarHome, visible sin evaluación abierta', () => {
    const home = fuente('../evaluar/EvaluarHome.tsx')
    expect(home).toContain('to="/evaluar/inspeccion-vehiculo"')
    // La tarjeta queda después de los EmptyState: se puede inspeccionar aunque
    // el Líder no haya abierto ninguna unidad (no es evaluación).
    const vacio = home.indexOf('No hay evaluaciones abiertas')
    expect(vacio).toBeGreaterThan(-1)
    expect(home.indexOf('to="/evaluar/inspeccion-vehiculo"')).toBeGreaterThan(vacio)
  })

  it('ya no figura en el menú ni en los títulos de la consola', () => {
    const layout = fuente('../../components/layouts/ConsoleLayout.tsx')
    expect(layout).not.toContain('inspeccion-vehiculo')
    expect(layout).not.toContain('Car ')
  })
})

describe('Inspección de vehículo · sin sucursal', () => {
  const pagina = fuente('./InspeccionVehiculo.tsx')

  it('el registro se abre solo, sin selector ni unidad que elegir', () => {
    // La inspección no es de ninguna unidad: no se elige sucursal y el registro
    // nace apenas hay perfil y módulo (antes un perfil sin sucursal dejaba la
    // pantalla en un estado muerto sin forma de salir).
    expect(pagina).toContain('sucursal_id: null')
    expect(pagina).not.toContain('cambiarSucursal')
    expect(pagina).not.toContain('sucursalActual')
    expect(pagina).not.toContain('Elige una sucursal')
    // Sin registro todavía sólo se espera: nunca hay pantalla a la que llegar.
    expect(pagina).toMatch(/if \(!reg\) \{[\s\S]{0,400}<Spinner/)
  })

  it('sin checklist no se queda esperando en el spinner', () => {
    // El módulo sólo llega con el catálogo; si no existe, esperar el registro
    // es esperar para siempre.
    expect(pagina).toContain('if (!cargado || (cargando && !!modulo))')
  })

  it('el servidor la acepta sin sucursal en instalaciones ya creadas', () => {
    // La tabla la creó la pre-entrega como NOT NULL: hay que soltarla aparte,
    // porque `create table if not exists` no cambia una tabla que ya existe.
    const sql = fuente('../../../supabase/inspeccion-vehiculo.sql')
    expect(sql).toContain('alter column sucursal_id drop not null')
    expect(sql).not.toMatch(/sucursal_id uuid not null/)
    expect(fuente('../../lib/types.ts')).toMatch(
      /interface RevisionPreEntrega \{[\s\S]{0,400}sucursal_id: string \| null/
    )
    expect(fuente('../../lib/offline/db.ts')).toMatch(
      /interface PreEntregaRecord \{[\s\S]{0,400}sucursal_id: string \| null/
    )
  })

  it('se llena con MobileLayout y su botón de volver', () => {
    expect(pagina).toContain('<MobileLayout titulo="Inspección de vehículo"')
    expect(pagina).toMatch(/navigate\(-1\)/)
    expect(pagina).toContain('<ArrowLeft className="mr-1 h-4 w-4" />')
  })
})

describe('Inspección de vehículo · los imports del cableado', () => {
  it('importa cada hook y componente que llama en el cuerpo', () => {
    // Un import borrado pasó todas las puertas: `tsc --noEmit -p tsconfig.json`
    // no revisa ningún archivo (tsconfig.json es un proyecto de referencias con
    // `files: []`) y ESLint no aplica `no-undef` en TS (eso lo cubre el
    // compilador). El resultado fue una pantalla que revienta en caliente con
    // «useCatalog is not defined». Este test cierra esa puerta.
    const pagina = fuente('./InspeccionVehiculo.tsx')
    const importados = new Set(
      [...pagina.matchAll(/import\s+(?:type\s+)?\{([\s\S]*?)\}\s+from\s+'/g)].flatMap((m) =>
        m[1]
          .split(',')
          .map((s) => s.replace(/\btype\b/g, '').trim().split(/\s+as\s+/)[0].trim())
          .filter(Boolean)
      )
    )
    const usados = new Set(
      [...pagina.matchAll(/\b(use[A-Z]\w*|MobileLayout|ItemRenderer|FirmaCanvas|EmptyState|Spinner)\(/g)].map(
        (m) => m[1]
      )
    )
    expect(usados.size).toBeGreaterThan(5)
    for (const nombre of usados) {
      expect(importados.has(nombre), `falta importar ${nombre}`).toBe(true)
    }
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
    // «Nueva inspección» no depende de ninguna unidad: sólo de perfil y módulo.
    expect(pagina).toMatch(/function nuevaInspeccion\(\) \{[\s\S]{0,160}registroVacio\(profile\.id, modulo\.id\)/)
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
    // Sin sucursal no hay renglón de unidad en la hoja (ni en la llamada).
    expect(pagina).not.toMatch(/^\s+sucursal: /m)
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

  it('pagina la hoja: ninguna A4 se corta con el contenido entero dentro', () => {
    // Síntoma real: un PDF de una sola página, cortado a la altura de A4.
    // jsPDF no parte la imagen que se le pega, la recorta, así que la hoja
    // larga hay que partirla antes.
    expect(pdf).toContain('cortesDePagina(')
    expect(pdf).toContain('pdf.addPage()')
    expect(pdf).not.toContain('pdfWidth, pdfHeight)')
    // Y los cortes se pegan a los bordes de fila/foto para no partirlos.
    expect(fuente('../../lib/pdf/paginarRevision.ts')).toContain('limitesPx')
  })

  it('el export no exige firma (la inspección puede hacerse sin el dueño)', () => {
    expect(pagina).toMatch(/const puedeExportar = Boolean\([\s\S]*?persona\.nombre\.trim\(\)/)
    expect(pagina).not.toMatch(/puedeExportar[\s\S]{0,120}chofer_firma/)
  })
})
