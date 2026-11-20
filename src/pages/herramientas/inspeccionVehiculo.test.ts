import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { bloqueSql } from '../../lib/supabaseSql'

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
    const sql = bloqueSql('inspeccion-vehiculo.sql')
    expect(sql).toContain(`where herramienta = '${CLAVE_ESPERADA}'`)
    expect(sql).toContain(`'${CLAVE_ESPERADA}'`)
  })

  it('se sostiene sola: trae el andamiaje de la pre-entrega con sus guardas', () => {
    const sql = bloqueSql('inspeccion-vehiculo.sql')
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
    const sql = bloqueSql('inspeccion-vehiculo.sql')
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
  // La máquina del documento se mudó a un módulo propio (la comparte el
  // historial): ahí vive el pedido, las filas y las fotos.
  const exportador = fuente('../../lib/pdf/exportarInspeccion.ts')

  it('habla de conductor, trae el sistema de combustible y el nombre en MAYÚSCULAS', () => {
    expect(exportador).toContain("etiquetaPersona: 'conductor'")
    expect(exportador).toContain('personaCampos: [')
    expect(exportador).toContain('combustible:')
    // MAYÚSCULAS: es lo que se firma en papel.
    expect(exportador).toContain('mayus(p.persona.nombre)')
    expect(exportador).toContain('mayus(p.persona.apellido)')
    expect(pdf).toContain('Sistema de combustible')
    expect(pdf).toContain('etiquetaPersona')
    // Sin sucursal no hay renglón de unidad en la hoja (ni en la llamada).
    expect(exportador).not.toMatch(/^\s+sucursal: /m)
  })

  it('las firmas van en CADA hoja, vacías, dibujadas con jsPDF', () => {
    // El HTML se rasteriza una sola vez y se corta: el bloque no puede vivir
    // ahí si tiene que repetirse en todas las hojas.
    expect(pdf).toContain('function pintarFirmas(')
    expect(pdf).toContain('pintarFirmas(pdf, pdfWidth, pdfHeight, etiqueta, pie)')
    // La ventana se achica por la banda: el contenido deja libre el pie.
    expect(pdf).toContain('ALTO_BANDA_FIRMA_MM')
    // Y la firma capturada en la app no se imprime: se firma en papel.
    expect(pdf).not.toContain('datos.chofer?.firma')
  })

  it('la ficha es del CONDUCTOR y se autocompleta por cédula con la nómina', () => {
    // El rótulo: era «Propietario».
    expect(pagina).toContain('>Conductor</h2>')
    expect(pagina).toContain('Firma del conductor (opcional)')
    expect(pagina).toContain('nombre del conductor para exportar')
    expect(pagina).not.toContain('del propietario')

    // Autocompletar: al salir del campo, contra la API de TRABAJADORES, que
    // recorre TODA la nómina — le es indiferente el cargo y la sucursal.
    expect(pagina).toContain('autocompletarConductor')
    expect(pagina).toContain('listarTrabajadoresEquipo')
    expect(pagina).toContain('onBlur={() => void autocompletarConductor()}')
    expect(pagina).toContain('digitos.length < 6')
  })

  it('abre una banda por sección sobre sus filas', () => {
    expect(exportador).toMatch(/grupo: g\.seccion \?\? 'Dictamen'/)
    // TRES columnas: Ítem, Valor/Estado y Observación (la del punto, en su fila).
    expect(pdf).toContain('Observación')
    expect(pdf).toContain('colspan="3"')
    expect(pdf).toContain('filasTabla(')
  })

  it('no imprime las evidencias: lleva el QR al detalle público', () => {
    // El papel no es el mejor lugar para mirar fotos. El PDF dejó de pegarlas
    // y en su lugar lleva el enlace público al detalle completo (tabla,
    // comentarios y material visual), que se arma ANTES de generar la hoja.
    expect(pdf).not.toContain('Evidencias fotográficas')
    expect(pdf).toContain('Detalle completo en línea')
    expect(pdf).toContain('datos.qr')
    expect(pdf).toContain('datos.urlDetalle')
    expect(exportador).toContain('enlaceDelDetalle(')
    expect(exportador).toContain('urlDetalle')
    // Si el enlace no se puede crear, el documento sale igual y se avisa:
    // un problema con el QR no puede dejar a nadie sin su inspección.
    expect(exportador).toContain('El PDF sale sin QR')
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

describe('Inspección de vehículo · reabrir y descargar otra vez', () => {
  const pagina = fuente('./InspeccionVehiculo.tsx')
  const exportador = fuente('../../lib/pdf/exportarInspeccion.ts')

  it('una finalizada puede volver a descargar su PDF sin abrir otra nueva', () => {
    // Síntoma real: al finalizar, el botón de PDF desaparecía y sólo quedaba
    // «Nueva inspección», sin forma de recuperar el PDF de esa inspección.
    expect(pagina).toContain("'Descargar PDF'")
    expect(pagina).toContain('Volver a descargar el PDF de esta inspección')
    expect(pagina).toContain('Nueva inspección')
    // Los dos botones conviven en la rama finalizada.
    expect(pagina).toMatch(/reg\.estado === 'FINALIZADA' \? \{?[\s\S]*?Descargar PDF[\s\S]*?Nueva inspección/)
  })

  it('el historial puede pedir una inspección concreta y ésta se abre', () => {
    expect(pagina).toContain("params.get('registro')")
    expect(pagina).toContain('getPreEntrega(registroBuscado)')
    // Si ya no está en el equipo (las finalizadas subidas se borran de local),
    // se trae la fila del servidor y con ella se regenera el PDF.
    expect(pagina).toContain('obtenerRevisionPreEntrega(registroBuscado)')
    // Al abrir, la carpeta del bucket se lista para rehidratar las `paths`:
    // las filas subidas antes guardaron `photoIds` locales, que en otro equipo
    // no significan nada (ver `rehidratarEvidencias`).
    expect(pagina).toContain('registroDesdeServidor(fila, await nombresEnCarpeta(fila.id)')
    expect(exportador).toContain('async function nombresEnCarpeta(')
    // Sólo se abre si es una inspección: un id de otra herramienta no secuestra
    // la pantalla, que sigue su flujo normal.
    expect(pagina).toContain('registro.modulo_id === modulo.id')
    // Mientras el historial manda un id, la retomada automática no se entromete.
    expect(pagina).toContain('if (!cargado || !profile || !modulo || registroBuscado) return')
  })

  it('«Nueva inspección» suelta el id del historial sin duplicar registros', () => {
    expect(pagina).toMatch(/async function nuevaInspeccion\(\)/)
    // El registro nuevo queda escrito antes de limpiar el `?registro=`: si se
    // limpiara primero, la carga crearía una segunda inspección vacía.
    expect(pagina).toMatch(/await putPreEntrega\(nueva\)[\s\S]{0,80}setParams\(\{\}, \{ replace: true \}\)/)
  })
})

describe('Inspección de vehículo · el historial', () => {
  const pagina = fuente('./InspeccionVehiculo.tsx')
  const historial = fuente('./InspeccionHistorial.tsx')
  const app = fuente('../../App.tsx')

  it('su ruta vive en /evaluar con la misma puerta que la herramienta', () => {
    expect(app).toContain('path="/evaluar/inspeccion-vehiculo/historial"')
    expect(app).toMatch(
      /path="\/evaluar\/inspeccion-vehiculo\/historial"[\s\S]{0,220}roles={\['EVALUADOR', 'LIDER'\]}/
    )
    // También en el bloque móvil, antes de la consola de escritorio.
    expect(app.indexOf('path="/evaluar/inspeccion-vehiculo/historial"')).toBeLessThan(
      app.indexOf('<ConsoleLayout />')
    )
  })

  it('se entra desde un botón en la propia pantalla de la inspección', () => {
    expect(pagina).toContain('navigate(RUTA_HISTORIAL)')
    expect(pagina).toContain('<History className="mr-1 h-4 w-4" />')
  })

  it('junta lo del equipo con lo del servidor, y sólo lo de esta herramienta', () => {
    expect(historial).toContain('listarPreEntregas()')
    expect(historial).toContain('listarRevisionesPreEntrega()')
    // Las dos orillas se filtran por módulo: el mismo equipo guarda también el
    // borrador de otras herramientas.
    expect(historial.match(/r\.modulo_id === modulo\.id/g)?.length).toBe(2)
    expect(historial).toContain('fusionarHistorial(')
  })

  it('tocar una fila reabre esa inspección en su pantalla', () => {
    expect(historial).toContain('${RUTA_INSPECCION}?registro=${f.id}')
  })

  it('cada fila descarga el PDF en el acto, sin pasar por la pantalla', () => {
    // El botón no navega: arma el documento con el MISMO pipeline que la
    // herramienta (una sola versión del PDF) y se queda en la lista.
    expect(historial).toContain('<FileDown className="h-4 w-4" />')
    expect(historial).toContain('descargarPdf(f)')
    expect(historial).toContain('exportarInspeccion({')
    expect(historial).not.toContain('&pdf=1')

    // Las dos pantallas llaman al exportador compartido.
    expect(pagina).toContain('void exportarPDF()')
    expect(pagina).toContain('exportarInspeccion({')
  })

  it('cada fila tiene papelera y pide confirmación antes de borrar', () => {
    // El borrado es de las dos orillas: el equipo (con sus fotos) y el servidor.
    expect(historial).toContain('eliminarPreEntrega(')
    expect(historial).toContain('eliminarRevisionPreEntrega(')
    expect(historial).toContain('deletePhoto(')
    // Sin confirmación no se borra nada: la papelera abre el modal, no borra.
    expect(historial).toContain('setABorrar(')
    expect(historial).toContain('<Confirmar')
    expect(historial).toContain('textoConfirmar={borrando')
    // El servidor sólo se toca con conexión, y si rechaza se avisa en vez de
    // fingir que la inspección desapareció.
    expect(historial).toContain('if (online)')
    expect(historial).toMatch(/avisar\('Se borró de este equipo[^']*', 'error'\)/)
  })

  it('la carga vive en un useCallback para poder refrescar tras borrar', () => {
    expect(historial).toContain('const recargar = useCallback(')
    expect(historial).toContain('await recargar()')
    expect(historial).toMatch(/useEffect\(\(\) => \{\s*void recargar\(\)/)
  })
})
