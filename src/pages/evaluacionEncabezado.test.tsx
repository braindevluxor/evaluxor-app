import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

/** El trozo de código que ES la barra, en cada pantalla. */
function barra(archivo: string, desde: string, hasta: string): string {
  const codigo = fuente(archivo)
  const i = codigo.indexOf(desde)
  expect(i, `no encontré "${desde}" en ${archivo}`).toBeGreaterThan(-1)
  const f = codigo.indexOf(hasta, i)
  return codigo.slice(i, f === -1 ? undefined : f)
}

/**
 * Los tres sitios que componen la barra superior sobre azul: el detalle de
 * evaluación, la cabecera de `MobileLayout` (que es la que ve el evaluador en
 * `/evaluar`) y el botón de sincronizar que `/evaluar` le mete por `extra`.
 *
 * Con marcas de inicio finas a propósito: `MobileLayout` tiene otro botón
 * `h-9 w-9` en el cajón lateral, sobre blanco, y leer el archivo entero hacía
 * fallar el test contra un botón que no es de ninguna barra.
 */
const BARRAS = [
  {
    donde: 'el detalle de evaluación',
    archivo: './EvaluacionDetalle.tsx',
    desde: '<header className="sticky top-0 z-30 bg-primary text-white shadow-sm"',
    hasta: '</header>'
  },
  {
    donde: 'la barra de MobileLayout',
    archivo: '../components/layouts/MobileLayout.tsx',
    desde: '<header className="sticky',
    hasta: '</header>'
  },
  {
    donde: 'el botón de sincronizar de /evaluar',
    archivo: '../pages/evaluar/EvaluarSucursal.tsx',
    desde: 'const botonSync',
    hasta: '</button>'
  }
] as const

/** El `<header>` del detalle de evaluación. */
function encabezadoDetalle(): string {
  const [detalle] = BARRAS
  return barra(detalle.archivo, detalle.desde, detalle.hasta)
}

/** La clase de los botones de las barras sobre azul. Vive en ui.tsx. */
function claseBoton(): string {
  const m = /export const BOTON_CABECERA\s*=\s*\n?\s*'([^']+)'/.exec(fuente('../components/ui.tsx'))
  expect(m, 'no encontré BOTON_CABECERA en ui.tsx').toBeTruthy()
  return m![1]
}

describe('Barras de navegación sobre azul', () => {
  it('los tres sitios usan la MISMA clase de ui.tsx, sin copias locales', () => {
    // Una sola regla para las tres: si mañana cambia el tamaño o desaparece el
    // hover, tiene que cambiar en todas o en ninguna.
    for (const { archivo, donde } of BARRAS) {
      const codigo = fuente(archivo)
      expect(codigo, `falta BOTON_CABECERA en ${donde}`).toContain('BOTON_CABECERA')
      expect(codigo, `BOTON_CABECERA no viene de ui.tsx en ${donde}`).toMatch(
        /import \{[^}]*BOTON_CABECERA[^}]*\} from '[^']*ui'/
      )
      expect(codigo, `hay una copia local en ${donde}`).not.toMatch(/const BOTON_CABECERA\s*=/)
    }
  })

  it('ninguna barra conserva un disco de fondo', () => {
    for (const { archivo, desde, hasta, donde } of BARRAS) {
      const trozo = barra(archivo, desde, hasta)
      // La cuenta de pendientes sí lleva color: es una alarma, no una acción.
      // Lo que no puede volver es el disco alrededor de un botón.
      expect(trozo, `${donde}: sigue el disco`).not.toContain('bg-white/')
      expect(trozo, `${donde}: un botón con fondo`).not.toMatch(/<(button|NavLink|Link)\b[^>]*bg-/)
    }
  })

  it('los iconos van un escalón arriba del estándar de la app', () => {
    // `CLASE_ICONO` de ui.tsx es h-9 w-9 con iconos h-4 w-4. Sin disco que
    // ayude a leerlos, el icono es todo lo que hay.
    const clases = claseBoton()
    expect(clases).toContain('h-10 w-10')
    expect(clases).not.toMatch(/(^| )h-9 /)
    expect(clases).toMatch(/(^| )hover:bg-white\/10/)
    // El tinte es sólo al apuntar: en reposo no hay nada de fondo.
    expect(clases.replace(/hover:bg-white\/10/, '')).not.toMatch(/(^| )bg-/)
    for (const { archivo, desde, hasta, donde } of BARRAS) {
      const trozo = barra(archivo, desde, hasta)
      expect(trozo, `${donde}: aún quedan h-4 w-4`).not.toContain('h-4 w-4')
      expect(trozo, `${donde}: aún quedan h-9 w-9`).not.toContain('h-9 w-9')
    }
  })
})

describe('EvaluacionDetalle · el encabezado', () => {
  const cab = encabezadoDetalle

  it('todos los botones son la misma cara', () => {
    // Volver, sincronizar, editar productos y el PDF comparten la clase, y el
    // compartir la arma con la misma. Así la fila no se puede desarmar tocando
    // un botón por separado.
    const usos = (cab().match(/BOTON_CABECERA/g) ?? []).length
    expect(usos).toBeGreaterThanOrEqual(4)
    // Y ninguna variante de `Button`, que arrastra `border` en `secondary` y
    // `px-4 py-2.5 min-h-[44px]` en cualquier caso.
    expect(cab()).not.toContain('<Button')
  })

  it('el PDF y "Editar productos" son icono sólo, con el rótulo en el título', () => {
    // Sin texto visible: la barra es de iconos. El nombre de cada acción vive
    // en `title` y `aria-label`, que es donde se busca cuando no se reconoce.
    expect(cab()).not.toMatch(/>\s*(Editar productos|Descargar PDF)\s*</)
    expect(cab()).toContain('title="Editar productos"')
    expect(cab()).toContain('title="Elegir qué incluye el PDF"')
    expect(cab()).toContain('aria-label="Descargar PDF"')
  })
})

describe('MobileLayout · la barra del evaluador', () => {
  it('el menú y el acceso al dashboard van al mismo tamaño', () => {
    // El de dashboard iba en `h-4 w-4` con el de menú en `h-5 w-5`, y los dos
    // se veían distintos en la misma fila.
    const cab = barra('../components/layouts/MobileLayout.tsx', '<header className="sticky', '</header>')
    expect(cab).toContain('className={BOTON_CABECERA}')
    expect(cab).toContain('<LayoutDashboard className="h-5 w-5" />')
  })

  it('/evaluar conserva con fondo SÓLO la burbuja de progreso', () => {
    // No es una acción, es la lectura del avance: sin relleno queda un
    // "1 · 10%" suelto sobre el azul y no se sabe qué es. Se toca aparte del
    // resto de la barra.
    const evaluar = fuente('../pages/evaluar/EvaluarSucursal.tsx')
    expect(evaluar).toContain('rounded-full bg-white/15')
    expect(evaluar).toMatch(/onClick=\{\(\) => setModulosAbierta\(true\)\}/)
  })

  it('el botón de sincronizar lleva `relative`, que es lo único que cuelga', () => {
    // La cuenta de pendientes flota en la esquina. Se agrega aparte y no
    // dentro de la clase compartida, para que nadie más herede un `relative`
    // que no necesita.
    const evaluar = fuente('../pages/evaluar/EvaluarSucursal.tsx')
    expect(evaluar).toContain("cn(BOTON_CABECERA, 'relative')")
  })
})
