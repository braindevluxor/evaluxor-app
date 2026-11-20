import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

/**
 * Gran Cosecha: el cableado del módulo.
 *
 * Las reglas de negocio y el RLS tienen sus propios tests
 * (`granCosecha-sql.test.ts`); éste mira lo que ningún test de comportamiento
 * ve: que el módulo siga en el MENÚ de la consola, que la RUTA siga
 * adentro del layout (con barra y menú) y que el rol JUEZ siga existiendo
 * como número de teléfono de la RLS —si alguien saca la entrada del menú o
 * cambia los roles, falla acá y no en producción.
 */
describe('gran cosecha · el módulo está en el menú', () => {
  const menu = fuente('../components/layouts/ConsoleLayout.tsx')
  const app = fuente('../App.tsx')

  it('la consola ofrece «Proyectos» a todos los que entran', () => {
    // Va en su propia sección y no dentro de «Resultados»: es un concurso al
    // que entra toda la empresa, no una pantalla de indicadores.
    expect(menu).toContain("to: '/gran-cosecha/proyectos'")
    expect(menu).toContain("{ seccion: 'Gran Cosecha'")
    expect(menu).toContain('label: \'Proyectos\'')

    // Y con su título en la cabecera, igual que el resto de las vistas.
    expect(menu).toContain("'/gran-cosecha/proyectos'")
    expect(menu).toContain('Gran Cosecha')
    expect(menu).toContain('Concurso trimestral de proyectos')
  })

  it('la dirección /gran-cosecha (sin .html) manda a la LANDING pública', () => {
    // Ésa era la confusión entre las dos rutas de la cosecha: la dirección
    // obvia tiene que terminar en la página pública estática, y la consola
    // del concurso vive en /gran-cosecha/proyectos, junto a sus editors.
    expect(app).toContain('<Route path="/gran-cosecha" element={<IrALandingGranCosecha />} />')
    expect(app).toContain("window.location.replace('/gran-cosecha.html')")
    // Navegación REAL: el HTML estático está fuera del router de React, así
    // que un <Navigate> dejaría la SPA pintando en una URL que no le toca.
    expect(app).not.toContain('<Navigate to="/gran-cosecha.html"')
  })

  it('al JUEZ sólo se le ofrece Gran Cosecha: las demás vistas lo rebotarían', () => {
    // Las rutas de Resultados piden `RequireRol` con roles que no incluyen a
    // JUEZ, así que un enlace ahí lo mandaría de vuelta a su propia casa.
    expect(menu).toContain("rol === 'JUEZ'")
    expect(menu).toContain('Gran Cosecha')
    // La función que arma el menú por rol tiene que seguir existiendo.
    expect(menu).toMatch(/function seccionesDe\(/)
  })

  it('la ruta está adentro del grupo de la consola y sin RequireRol', () => {
    // Sin `RequireRol`: la crean los trabajadores y la siguen los jueces. El
    // grupo ya trae `RequireAuth`, que es quien manda al SIN_ROL a /pendiente.
    expect(app).toContain('<Route path="/gran-cosecha/proyectos" element={<GranCosechaPage />} />')

    const grupo = app.indexOf('<ConsoleLayout />')
    const ruta = app.indexOf('path="/gran-cosecha/proyectos"')
    expect(grupo).toBeGreaterThan(-1)
    expect(ruta).toBeGreaterThan(grupo)
    // Y con lazy, como el resto de las pantallas de la consola.
    expect(app).toContain("import('./pages/GranCosecha')")
  })

  it('el riego se ofrece UNA sola vez, en la tarjeta, por el data layer', () => {
    const pagina = fuente('../pages/GranCosecha.tsx')
    const datos = fuente('./data/granCosecha.ts')

    // La pantalla usa las DOS piezas del riego: el conteo y el botón…
    expect(pagina).toContain('riegosDeLaCosecha')
    expect(pagina).toContain('regarProyecto')
    expect(pagina).toContain('function RiegoProyecto')
    // …sólo EN LA TARJETA: en el detalle se quitó porque quedaba duplicado
    // pegado al mismo chip, uno al lado del otro.
    expect(pagina.match(/<RiegoProyecto/g) ?? []).toHaveLength(1)

    // El dato pasa por el data layer: la pantalla no arma llamadas sueltas.
    expect(datos).toContain("supabase.rpc('regar_proyecto'")
    expect(datos).toContain("supabase.rpc('riegos_de_la_cosecha'")
    expect(pagina).not.toContain('supabase.rpc(')
  })

  it('las fotos del participante se cargan en el PROYECTO, no en la Página', () => {
    const paginaProyecto = fuente('../pages/GranCosecha.tsx')
    const datosProyecto = fuente('./data/granCosecha.ts')
    const editorPagina = fuente('../pages/GranCosechaPagina.tsx')

    // El formulario del proyecto (alta y edición) ofrece las dos fotos…
    expect(paginaProyecto).toContain('Imagen del proyecto')
    expect(paginaProyecto).toContain('Foto del equipo')
    expect(paginaProyecto).toContain('subirFotoProyecto')
    // …subidas por el data layer al prefijo `proyectos/` del bucket…
    expect(datosProyecto).toContain('subirFotoProyecto')
    expect(datosProyecto).toContain('proyectos/')
    // …y el editor de la Página ya no las toca: ese dato lo manda Proyectos.
    expect(editorPagina).not.toContain('Imagen del proyecto')
    expect(editorPagina).not.toContain('subirFotoEquipo')
    expect(editorPagina).toContain('CampoFoto')
    // El detalle del proyecto las ofrece con subida directa (sin el form)…
    expect(paginaProyecto).toContain('Se guardan solas al subirlas')
  })

  it('el equipo acepta trabajadores sin cuenta, de cualquier sucursal', () => {
    const pagina = fuente('../pages/GranCosecha.tsx')
    const datos = fuente('./data/granCosecha.ts')

    // El selector busca también en la nómina — al servidor y con debounce,
    // porque son miles de filas— por nombre o cédula…
    expect(pagina).toContain('listarTrabajadoresEquipo')
    expect(datos).toContain("supabase.rpc('listar_trabajadores_equipo'")
    expect(pagina).toContain('placeholder="Buscar por nombre, usuario o cédula"')
    // …los distingue en la lista…
    expect(pagina).toContain('>Trabajador</Badge>')
    // …y la identidad de cada integrante es su usuario O su cédula: dos
    // trabajadores sin cuenta no pueden colisionar en el usuario vacío.
    expect(pagina).toContain('claveDeMiembro')
    expect(datos).toContain('claveDeMiembro')
    expect(datos).toContain('listarTrabajadoresEquipo')
  })

  it('borrar un proyecto: botón con confirmación y todo por el data layer', () => {
    const pagina = fuente('../pages/GranCosecha.tsx')
    const datos = fuente('./data/granCosecha.ts')

    // Nunca de un toque: el borrado saca la bitácora y los riegos en
    // cascada, así que siempre pasa por el `Confirmar`…
    expect(pagina).toContain('<Confirmar')
    expect(pagina).toContain('setABorrar(')
    expect(pagina).toContain('textoConfirmar="Sí, borrar"')
    // …y sólo para quien puede editar, que es la MISMA regla que la
    // política `delete` de la base.
    expect(pagina).toMatch(/puedeEditar\(p\)[\s\S]{0,900}setABorrar\(p\)/)

    // La consulta vive en el data layer, con el control de que el borrado
    // haya pasado de verdad: un `delete` filtrado por RLS no da error,
    // devuelve cero filas, y sin ese chequeo el aviso mentiría.
    expect(pagina).toContain('eliminarProyecto')
    expect(datos).toContain('export async function eliminarProyecto')
    expect(datos).toContain('.delete()')
    expect(datos).toContain(".select('id')")
    expect(pagina).not.toContain('.delete()')
  })

  it('las fotos del participante se previsualizan CUADRADAS y el equipo va en tabla', () => {
    const pagina = fuente('../pages/GranCosecha.tsx')
    const ui = fuente('../components/ui.tsx')

    // La tarjeta de la landing es cuadrada (`aspect-ratio: 1/1`), así que la
    // vista previa enseña lo mismo y no un recorte sorpresa. `CampoFoto`
    // conserva su banda ancha por defecto —la usa el fondo del hero— y sólo
    // las CUATRO fotos del proyecto la piden cuadrada (detalle y form).
    expect(ui).toContain('cuadrada ? ')
    expect(pagina.match(/cuadrada/g) ?? []).toHaveLength(4)

    // El equipo, como TABLA: tres nombres largos en píldoras se apilan, y la
    // identidad de cada uno (cédula o cuenta) quedaba sólo en un `title`
    // invisible.
    expect(pagina).toContain('<table className="w-full text-sm">')
    expect(pagina).toContain('Identificación')
    expect(pagina).toContain('identidadDe')
    expect(pagina).not.toContain('rounded-full bg-white px-3 py-1')
  })
})

describe('gran cosecha · el rol que lo sostiene', () => {
  const roles = fuente('../lib/roles.ts')
  const tipos = fuente('../lib/types.ts')

  it('JUEZ es un rol de la app, con etiqueta, editable y como casa el concurso', () => {
    // El `check` de `profiles` en la base lo lista igual: si el tipo se queda
    // corto, el INSERT del juez ni siquiera llega al RLS.
    expect(tipos).toContain("'JUEZ'")
    expect(roles).toContain("JUEZ: 'Juez de Gran Cosecha'")
    expect(roles).toContain("'JUEZ'")
    // Sin esto el Líder no podría asignarle el rol desde Usuarios.
    expect(roles).toMatch(/ROLES_EDITABLES[\s\S]*?'JUEZ'/)
    // Y al entrar, su casa es el concurso: `RequireAuth` lo manda al home
    // de su rol, que para un juez no puede ser el dashboard.
    expect(roles).toMatch(/case 'JUEZ':[\s\S]{0,300}?return '\/gran-cosecha\/proyectos'/)
  })
})
