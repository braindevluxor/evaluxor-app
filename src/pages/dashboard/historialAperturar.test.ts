import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

/**
 * Dónde vive cada acción de la cabecera del dashboard.
 *
 * Antes la tarjeta «Aperturar evaluación» ocupaba el alto de la pantalla
 * empujando la tabla hacia abajo, y «Ir a evaluaciones» viajaba en la barra
 * superior. Ahora el formulario se abre en modal desde un botón que la página
 * cuelga junto a «Filtros», y la salida hacia /evaluar vive en el menú lateral.
 *
 * Montar la pantalla exige router, offline, catálogo y Supabase, así que ésta
 * cubre lo que sólo se rompe con un cambio de una línea del fuente.
 */
describe('historial · aperturar en modal, gatillo en la cabecera', () => {
  const pagina = fuente('./Historial.tsx')
  const consola = fuente('../../components/layouts/ConsoleLayout.tsx')

  it('el formulario ya no es una tarjeta: es un modal', () => {
    expect(pagina).toContain('const [aperturando, setAperturando] = useState(false)')
    expect(pagina).toContain('open={aperturando}')
    expect(pagina).toContain('onClose={() => setAperturando(false)}')
    // La tarjeta vieja, con su propio encabezado dentro de la página.
    expect(pagina).not.toContain('font-bold text-primary-900">Aperturar evaluación')
    // Se cierra sola cuando la creación salió bien, para ver la fila nueva.
    expect(pagina).toContain('setAperturando(false)')
    // Mismo texto y misma lógica de botón que antes: hoy = activa, futuro = programada.
    expect(pagina).toContain('fechaAbrir === hoy ?')
    expect(pagina).toContain('Aperturar ahora')
  })

  it('el gatillo se cuelga en la cabecera, junto a Filtros', () => {
    // El portal es compartido (Historial, Unidades); acá sólo se usa.
    expect(pagina).toContain("from '../../components/PortalCabecera'")
    expect(pagina).toContain('<PortalCabecera>')
    expect(pagina).toContain('aria-haspopup="dialog"')
    // Sólo Líder, como siempre lo fue la tarjeta.
    expect(pagina).toMatch(/\{esLider \? \(\s*<PortalCabecera>/)
    // El hueco en el que se cuelga, al lado del botón de filtros.
    expect(consola).toContain('id="acciones-vista"')
    expect(consola).toContain('aria-controls="dashboard-filters-panel"')
    // La pieza que hace el portal: lee ese hueco y monta ahí a sus hijos.
    const portal = fuente('../../components/PortalCabecera.tsx')
    expect(portal).toContain("document.getElementById('acciones-vista')")
    expect(portal).toContain('createPortal(children, destino)')
  })
})

describe('consola · Ir a evaluaciones se muda al menú lateral', () => {
  const consola = fuente('../../components/layouts/ConsoleLayout.tsx')

  it('la barra superior queda sin ese botón', () => {
    // El botón viejo navegaba a mano (`navigate`) y se ocultaba en el
    // teléfono: si esas dos marcas siguen, el botón sigue en la cabecera.
    expect(consola).not.toContain('navigate(')
    expect(consola).not.toContain('useNavigate')
    expect(consola).not.toContain('hidden rounded-full bg-primary px-4')
  })

  it('el menú lateral lo ofrece a quien puede evaluar', () => {
    expect(consola).toContain('title="Ir a evaluaciones"')
    expect(consola).toContain('to="/evaluar"')
    // El mismo gate que antes decidía si el botón de cabecera hacía algo.
    expect(consola).toContain('{puedeEvaluar ? (')
    // Menú compactado: sólo queda el icono, con el texto escondido en lg.
    expect(consola).toContain("colapsado && 'lg:justify-center lg:px-0'")
    expect(consola).toContain("colapsado && 'lg:hidden'")
  })
})
