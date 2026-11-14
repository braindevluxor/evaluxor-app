import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

/**
 * La landing pública de Gran Cosecha y su editor: el cableado.
 *
 * Las reglas de datos tienen sus propios tests (`granCosechaPublico-sql.test.ts`
 * para el SQL y `data/concursoPublico.test.ts` para lo del cliente); éste
 * mira lo que ninguno ve: que /concurso siga SIN cuenta, que el editor siga
 * detrás de JUEZ/LÍDER y que la página siga avisando cuando muestra datos de
 * ejemplo —si alguien quita el aviso, la vista previa se leería como real.
 */
describe('gran cosecha · la landing pública', () => {
  const app = fuente('../App.tsx')
  const pagina = fuente('../pages/publico/ConcursoPublico.tsx')

  it('la ruta /concurso está afuera de la consola y sin RequireAuth', () => {
    // Va con las otras pantallas de invitado: antes del grupo que renderiza
    // `ConsoleLayout` (que es el que trae `RequireAuth`).
    const publica = app.indexOf('path="/concurso"')
    const consola = app.indexOf('<ConsoleLayout />')
    expect(publica).toBeGreaterThan(-1)
    expect(consola).toBeGreaterThan(-1)
    expect(publica, '/concurso no puede estar dentro del grupo de la consola').toBeLessThan(consola)

    // Y con lazy, como el resto de las pantallas que sólo se descargan
    // quien abre el enlace.
    expect(app).toContain("import('./pages/publico/ConcursoPublico')")
  })

  it('lee por la función pública, no tocando supabase directo', () => {
    // anon no tiene privilegio de tabla: si la página llamara a
    // `.from(...)` directo, no leería nada. Todo pasa por el data layer.
    expect(pagina).toContain('obtenerConcursoPublico')
    expect(pagina).not.toContain("from('gran_cosecha")
    expect(pagina).not.toContain('supabase.rpc')
  })

  it('cuando no hay datos reales lo dice, y no es un detalle de estilo', () => {
    // El ejemplo sólo aparece si la RPC falló (bloque sin aplicar o sin red).
    // Sin este aviso, la vista previa se leería como el concurso de verdad.
    expect(pagina).toContain('Vista previa con datos de ejemplo')
    expect(pagina).toContain('role="status"')
  })
})

describe('gran cosecha · el editor del contenido', () => {
  const app = fuente('../App.tsx')
  const menu = fuente('../components/layouts/ConsoleLayout.tsx')
  const editor = fuente('../pages/GranCosechaContenido.tsx')

  it('la ruta está adentro de la consola y pide JUEZ o LÍDER', () => {
    const consola = app.indexOf('<ConsoleLayout />')
    const ruta = app.indexOf('path="/gran-cosecha/contenido"')
    expect(ruta).toBeGreaterThan(consola)

    // La misma cerradura que la RLS de `gran_cosecha_contenido`
    // (`puede_gran_cosecha`): si el `RequireRol` se ampliara, la base igual
    // no dejaría guardar — pero el usuario vería un formulario que falla.
    const bloque = app.slice(ruta, ruta + 400)
    expect(bloque).toContain('RequireRol')
    expect(bloque).toContain("roles={['JUEZ', 'LIDER']}")
    expect(app).toContain("import('./pages/GranCosechaContenido')")
  })

  it('está en el menú, SÓLO para JUEZ y LÍDER', () => {
    expect(menu).toContain("to: '/gran-cosecha/contenido'")
    expect(menu).toContain("roles: ['JUEZ', 'LIDER']")
    // Y con su título en la cabecera, como el resto de las vistas.
    expect(menu).toContain("'/gran-cosecha/contenido'")
    expect(menu).toContain('Contenido del concurso')

    // `seccionesDe` es la que filtra por rol: sin ese filtro el enlace se le
    // mostraría a cualquiera y la ruta lo rebotaría.
    expect(menu).toMatch(/function seccionesDe\(/)
    expect(menu).toContain('s.items.filter((i) => !i.roles || i.roles.includes(rol')
  })

  it('escribe y lee por el data layer, y avisa lo que pasa', () => {
    expect(editor).toContain('leerContenidoEditor')
    expect(editor).toContain('guardarContenido')
    expect(editor).toContain("import { avisar }")
    // Nada de SQL ni de supabase directo en la pantalla.
    expect(editor).not.toContain('supabase')
  })

  it('las seis secciones de la landing se pueden editar acá', () => {
    // Si a una sección le falta su entrada, la página se quedaría sin forma
    // de publicarla y nadie se daría cuenta hasta buscarla en /concurso.
    for (const clave of ['bases', 'calendario', 'premios', 'jurado', 'faq', 'ganadores']) {
      expect(editor, `falta la sección ${clave}`).toContain(`clave: '${clave}'`)
    }
  })
})
