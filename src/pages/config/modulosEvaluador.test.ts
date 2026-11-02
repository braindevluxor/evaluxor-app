import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

/**
 * La sección Módulos, abierta al EVALUADOR en modo consulta.
 *
 * El evaluador necesita descargar la «explicación del módulo» (PDF de
 * metodología), así que la ruta dejó de ser de Líder. El permiso real ya
 * existía en el servidor — `modulos_select` / `items_select` dejan leer a
 * cualquier autenticado y sólo escribir al Líder —, así que ésta cubre las
 * tres piezas de UX que tenían esa puerta cerrada: la ruta, el enlace del
 * menú y las acciones de escritura de la página.
 */
describe('módulos · el evaluador entra a consultar y a descargar la explicación', () => {
  it('la ruta acepta EVALUADOR y LÍDER, y ya no es de sólo Líder', () => {
    const app = fuente('../../App.tsx')
    const ruta = app.slice(app.indexOf('path="/config/modulos"'))
    expect(ruta, 'falta la ruta /config/modulos').not.toBe('')
    // De la ruta hasta el cierre del guard: ahí vive el rol que la abre.
    const bloque = ruta.slice(0, ruta.indexOf('</RequireRol>'))
    expect(bloque).toContain("<RequireRol roles={['EVALUADOR', 'LIDER']}>")
    expect(bloque).toContain('<ModulosPage />')
    // El guard viejo, que mandaba a /evaluar a cualquiera que no fuera Líder.
    expect(app).not.toContain('<SoloLider><ModulosPage /></SoloLider>')
    // El resto de Configuración sigue siendo sólo de Líder.
    expect(app).toContain('<SoloLider><UnidadesPage /></SoloLider>')
    expect(app).toContain('<SoloLider><ItemsPage /></SoloLider>')
    expect(app).toContain('<SoloLider><UsuariosPage /></SoloLider>')
  })

  it('el menú de la consola le muestra el enlace al evaluador, en su sección', () => {
    const consola = fuente('../../components/layouts/ConsoleLayout.tsx')
    // Para el Líder sigue donde estaba, dentro de «Gestión».
    expect(consola).toContain("{ to: '/config/modulos', label: 'Módulos'")
    // Para el evaluador, una sección de sólo consulta: «Gestión» diría lo
    // contrario de lo que la pantalla le permite hacer.
    expect(consola).toContain("seccion: 'Consulta'")
    expect(consola).toContain("profile.rol === 'EVALUADOR'")
    // Y con rótulo en la cabecera, para no llegar a una vista sin título.
    expect(consola).toContain("'/config/modulos': { titulo: 'Módulos'")
  })

  it('la página se queda con la descarga y esconde la escritura', () => {
    const pagina = fuente('./Modulos.tsx')
    expect(pagina).toContain('const soloLectura = !puedeConfigurar(')
    // Lo que el evaluador vino a hacer: siempre visible.
    expect(pagina).toContain('void descargarExplicacionModulo({')
    // Acciones de Líder, detrás del mismo `soloLectura`.
    expect(pagina).toContain('{!soloLectura ? (')
    expect(pagina).toContain('title="Editar"')
    expect(pagina).toContain('title="Eliminar"')
    expect(pagina).toContain('/config/items?modulo=')
    expect(pagina).toContain('+ Nuevo módulo')
    // El texto del encabezado y del estado vacío hablan de consulta, no de alta.
    expect(pagina).toContain('descarga la explicación de cada uno')
    expect(pagina).toContain('Aún no hay módulos configurados.')
  })

  it('el servidor deja leer módulos e items y sólo al Líder escribir', () => {
    const schema = fuente('../../../supabase/schema.sql')
    // Sin estas dos lecturas el PDF de explicación saldría vacío para el
    // evaluador: ése es el permiso real, los guards de React son sólo UX.
    expect(schema).toContain('create policy modulos_select on public.modulos for select to authenticated using (true);')
    expect(schema).toContain('create policy items_select on public.items for select to authenticated using (true);')
    expect(schema).toContain('create policy modulos_lider on public.modulos for all using (public.es_lider()) with check (public.es_lider());')
    expect(schema).toContain('create policy items_lider on public.items for all using (public.es_lider()) with check (public.es_lider());')
  })
})
