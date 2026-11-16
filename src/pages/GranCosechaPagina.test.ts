import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { CONTENIDO_BASE, validarContenido } from '../lib/data/granCosechaPagina'

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

const pagina = fuente('./GranCosechaPagina.tsx')
const datos = fuente('../lib/data/granCosechaPagina.ts')
const app = fuente('../App.tsx')
const consola = fuente('../components/layouts/ConsoleLayout.tsx')
const landing = fuente('../../public/gran-cosecha.html')
const vite = fuente('../../vite.config.ts')

describe('gran cosecha · la página en la consola', () => {
  it('la ruta es de sólo Líder, con su guard y su lazy', () => {
    expect(app).toContain("import('./pages/GranCosechaPagina')")
    // El guard tiene que estar en ESTA ruta y no sólo en el archivo.
    expect(app).toMatch(/path="\/gran-cosecha\/contenido"[\s\S]{0,160}?<SoloLider>/)
  })

  it('el menú se lo muestra sólo al Líder, y tiene su cabecera', () => {
    expect(consola).toContain("to: '/gran-cosecha/contenido'")
    expect(consola).toContain('soloLider: true')
    // El filtro de `seccionesDe`: sin esto el item se vería con cualquier rol.
    expect(consola).toContain("!i.soloLider || rol === 'LIDER'")
    expect(consola).toContain("'/gran-cosecha/contenido': {")
    expect(consola).toContain("titulo: 'Página de la Gran Cosecha'")
  })

  it('la página toca las cuatro secciones de la landing', () => {
    for (const bloque of ['Hero', 'Premios', 'Equipos participantes', 'Imágenes']) {
      expect(pagina, bloque).toContain(bloque)
    }
    expect(pagina).toContain('cargarContenidoPagina')
    expect(pagina).toContain('guardarContenidoPagina')
    expect(pagina).toContain('subirFotoPagina')
    expect(pagina).toContain('validarContenido')
    expect(pagina).toContain('PortalCabecera')
    expect(pagina).toContain('avisar(')
    // «Ver página» abre la landing en otra pestaña.
    expect(pagina).toContain('href="/gran-cosecha.html"')
  })

  it('el carrusel del hero se edita con su conversión en pantalla', () => {
    expect(pagina).toContain('Carrusel del hero')
    expect(pagina).toContain('subirMediaCarrusel')
    // La barra de avance: convertir un video tarda lo que dura el clip.
    expect(pagina).toContain('convirtiendo')
    expect(pagina).toContain('moverSlide')
    // El selector acepta lo que traiga el navegador: la conversión es de la app.
    expect(pagina).toContain('accept="image/*,video/*"')
  })
})

describe('gran cosecha · el módulo de datos', () => {
  it('lee la tabla con la sesión, no por la RPC pública', () => {
    expect(datos).toContain("from('gran_cosecha_pagina')")
    expect(datos).toContain(".eq('id', true)")
    expect(datos).toContain('maybeSingle')
    // La RPC (`ver_contenido_gran_cosecha`) es el camino de la LANDING, que
    // corre sin sesión. Si la consola la llamara, el test de permisos le
    // exigiría el grant a `authenticated` en el bloque de permisos.
    expect(datos).not.toContain('supabase.rpc(')
  })

  it('guarda la única fila con upsert', () => {
    expect(datos).toContain("onConflict: 'id'")
    expect(datos).toContain('actualizado_en')
  })

  it('las fotos suben al bucket público de la página', () => {
    expect(datos).toContain("const BUCKET = 'gran-cosecha'")
    expect(datos).toContain('getPublicUrl')
    // La ruta sale del SLOT y no del archivo: no acumula copias en el bucket.
    expect(datos).toContain('pagina/${')
  })

  it('todo lo que sube se convierte antes de subirlo', () => {
    expect(datos).toContain('convertirImagenAWebP')
    expect(datos).toContain('convertirParaCarrusel')
    // Los slots fijos quedan en .webp; el carrusel, en su carpeta con uuid
    // (no tiene cupos fijos, así que no hay nada que reemplazar).
    expect(datos).toContain('pagina/${slot}.webp')
    expect(datos).toContain('pagina/carrusel/${')
    expect(datos).not.toContain('EXTENSIONES')
  })

  it('el hero arranca sin carrusel y lo normaliza al cargar', () => {
    expect(CONTENIDO_BASE.hero.carrusel).toEqual([])
    // Una fila guardada antes del carrusel no lo trae: no puede romper la consola.
    expect(datos).toContain('if (!Array.isArray(hero.carrusel)) hero.carrusel = []')
  })

  it('los valores por defecto pasan la validación', () => {
    expect(validarContenido(CONTENIDO_BASE)).toBeNull()
  })

  it('explica cada problema en pantalla, con la fila', () => {
    const sinLema = structuredClone(CONTENIDO_BASE)
    sinLema.hero.lema = '  '
    expect(validarContenido(sinLema)).toMatch(/lema/)

    const sinPremios = structuredClone(CONTENIDO_BASE)
    sinPremios.premios = []
    expect(validarContenido(sinPremios)).toMatch(/al menos un premio/)

    const premioRoto = structuredClone(CONTENIDO_BASE)
    premioRoto.premios[1].descripcion = ''
    expect(validarContenido(premioRoto)).toMatch(/premio 2/)

    const equipoSinNombre = structuredClone(CONTENIDO_BASE)
    equipoSinNombre.equipos = [{ nombre: ' ', sucursal: 'Luxor Central' }]
    expect(validarContenido(equipoSinNombre)).toMatch(/equipo 1/)

    const sinFecha = structuredClone(CONTENIDO_BASE)
    sinFecha.hero.fechaHastaMes = ''
    expect(validarContenido(sinFecha)).toMatch(/fecha de cierre/)

    const slideRoto = structuredClone(CONTENIDO_BASE)
    slideRoto.hero.carrusel = [{ tipo: 'imagen', url: '   ' }]
    expect(validarContenido(slideRoto)).toMatch(/carrusel/)
  })
})

describe('gran cosecha · la landing', () => {
  it('trae los ids que el script de contenido pinta', () => {
    for (const id of [
      'heroLema',
      'heroBajada',
      'heroCarrusel',
      'premiosLista',
      'equiposLista'
    ]) {
      expect(landing, id).toContain(`id="${id}"`)
    }
  })

  it('la sección de equipos nace oculta: sin equipos publicados no aparece', () => {
    expect(landing).toMatch(/<section id="equipos" class="[^"]*\bhidden\b/)
    // Y el script la muestra sólo si hay equipos con nombre.
    expect(landing).toContain("seccion.classList.remove('hidden')")
  })

  it('el hero tiene su carrusel, con velo y videos en mudo', () => {
    expect(landing).toContain('id="heroCarrusel"')
    expect(landing).toContain('function pintarCarrusel(')
    expect(landing).toContain('pintarCarrusel(hero.carrusel)')
    // Mudo y con playsinline: autoplay de fondo en cualquier navegador.
    expect(landing).toContain('muted loop playsinline')
    // El velo navy que hace legible el texto blanco sobre cualquier medio.
    expect(landing).toContain('rgba(6,18,56,0.55)')
    // Un medio que no se pueda reproducir se oculta en vez de girar en negro.
    expect(landing).toContain("paso.classList.add('hidden')")
  })

  it('el hero está en cero: sin título, fechas ni botón, sólo huecos', () => {
    // Sólo el bloque del hero: el resto de la página tiene su propio copy
    // (su "INSCRÍBETE" de la sección de inscripción sigue ahí). El corte
    // es el primer </section> después del inicio del hero — el hero no
    // tiene secciones anidadas—: cortar por un comentario era frágil.
    const inicio = landing.indexOf('<!-- HERO BANNER -->')
    const hero = landing.slice(inicio, landing.indexOf('</section>', inicio))
    // Se quitó todo el texto para rediseñar el hero desde cero.
    expect(hero).not.toContain('id="heroGran"')
    expect(hero).not.toContain('INSCRÍBETE AHORA')
    expect(hero).not.toContain('heroFechaDesde')
    // Los huecos de lema y bajada existen pero SIN contenido en el HTML:
    // los llena la consola al Guardar (sin JS o sin conexión, el hero
    // sale vacío a propósito, a diferencia del resto de la página).
    expect(hero).toMatch(/<p id="heroLema"[^>]*><\/p>/)
    expect(hero).toMatch(/<p id="heroBajada"[^>]*><\/p>/)
    // Y la sección no se colapsa mientras no hay nada adentro.
    expect(hero).toContain('min-h-[60vh]')
  })

  it('el formulario de inscripción es un modal que se abre con :target', () => {
    // Los enlaces de la página apuntan a #inscripcion: con CSS puro el
    // modal se abre sin JavaScript y el botón "atrás" lo cierra.
    expect(landing).toContain('href="#inscripcion"')
    expect(landing).toContain('#inscripcion:target')
    // Ya no es una sección en el flujo de la página.
    expect(landing).not.toMatch(/<section id="inscripcion"/)
    // Diálogo con su nombre para lectores de pantalla, su cierre con la X
    // y Escape (primero el modal de información si está encima).
    expect(landing).toMatch(/id="inscripcion"[^>]*role="dialog"/)
    expect(landing).toContain('id="cerrarInscripcion"')
    expect(landing).toContain("e.key !== 'Escape'")
    // El cierre apaga el modal con display inline: medido en Chrome,
    // replaceState vacía el hash pero NO recalcula `:target`, y con un
    // id en la regla ninguna clase le gana. El bloqueo del fondo va
    // por el mismo JS (sin :has, que habría quedado trabado igual).
    expect(landing).toContain("inscripcion.style.display = 'none'")
    expect(landing).toContain("document.body.style.overflow = bloqueado ? 'hidden' : ''")
    expect(landing).not.toContain('body:has(')
  })

  it('los regalos de premios se abren al pasar el mouse', () => {
    // Cada caja cerrada sabe cuál es su abierta (regalo-N ↔ open-N)…
    expect((landing.match(/data-regalo="/g) || []).length).toBe(4)
    // …el swap va por delegación en la lista y no por listener en cada
    // imagen: así también aplica a los premios que pintarPremios rehace
    // desde la base al Guardar desde la consola.
    expect(landing).toContain("addEventListener('mouseover'")
    expect(landing).toContain("'open-' + img.dataset.regalo + '.png'")
    expect(landing).toContain("'regalo-' + img.dataset.regalo + '.png'")
    // Pequeño zoom al pasar el mouse: en las tres imágenes estáticas y
    // en las que pinta pintarPremios (misma clase en las cuatro).
    expect((landing.match(/transition-transform duration-300 hover:scale-110/g) || []).length).toBeGreaterThanOrEqual(4)
    expect(landing).toContain(`data-regalo="' + (i + 1) + '"`)
  })

  it('la sección de premios lleva el carrusel de las gráficas 13…18', () => {
    // El marquee de "PREMIOS" se fue con su CSS y sus keyframes.
    expect(landing).not.toContain('animate-marquee')
    expect(landing).not.toContain('premios-watermark')
    expect(landing).not.toContain('marqueeScroll')
    // Las seis gráficas convertidas a WebP (13…18)…
    const fotos = landing.match(/evidencia\/premios-\d+\.webp/g) || []
    expect(fotos.length).toBe(6)
    expect(landing).toContain('id="premiosCarrusel"')
    // …girando solas con fundido, por clase de opacidad.
    expect(landing).toContain("slides[slideActual].classList.replace('opacity-100', 'opacity-0')")
  })

  it('el CTA dice INSCRÍBETE AHORA y late de forma constante', () => {
    expect(landing).not.toContain('INICIAR INSCRIPCIÓN')
    // Dos botones con el texto, pero el pulso sólo en el de «cómo
    // participar», que es el que pide la animación.
    expect((landing.match(/INSCRÍBETE AHORA/g) || []).length).toBe(2)
    expect(landing).toMatch(/<a href="#inscripcion"[^>]*cta-inscripcion[^>]*>[\s\S]{0,40}INSCRÍBETE AHORA/)
    expect(landing).toContain('@keyframes pulsoCta')
    // Sin hover:scale en el animado —la animación lo pisa— y respetando
    // a quien pidió menos movimiento en el sistema.
    expect(landing).not.toMatch(/cta-inscripcion[^"]*hover:scale/)
    expect(landing).toContain('prefers-reduced-motion')
  })

  it('el bloque «¿QUÉ ES?» va sobre fondo vinotinto y sin logos', () => {
    // Vinotinto liso — sin textura (el tono salió de la imagen de
    // referencia: crimson, más oscuro y frío que el rojo de marca).
    expect(landing).toContain('bg-[#a81e3e] py-12 sm:py-16')
    // El texto va en blanco: navy sobre rojo no pasa AA en el párrafo.
    expect(landing).toMatch(/<h2 class="font-display glitch-title[^"]*text-white/)
    // Se fueron los tres lockups con el nombre de la marca (navbar,
    // este bloque y footer). La etiqueta "PRESENTADO POR" volvió después,
    // con el logo real de la marca en su propio test.
    expect(landing).not.toContain('>SUPERMERCADOS<')
    // El navbar queda sólo con links, alineados a la derecha.
    expect(landing).toContain('items-center justify-end px-4 py-2.5')
  })

  it('la sección ¿QUÉ ES? presenta la marca: etiqueta arriba y logo debajo', () => {
    // La etiqueta sobre el logo, y ambos ANTES del título.
    expect(landing).toMatch(/PRESENTADO POR[\s\S]{0,400}supermercados-luxor\.png[\s\S]{0,400}¿QUÉ ES/)
    expect(landing).toContain('alt="Supermercados Luxor"')
    // El logo va sobre chip blanco: el PNG trae letras rojas que sobre
    // el vinotinto de la sección se perderían.
    expect(landing).toMatch(/rounded-2xl bg-white[\s\S]{0,160}supermercados-luxor\.png/)
  })

  it('los separadores entre segmentos son una onda de dos curvas, sin cuadros', () => {
    // Se fueron los bordes de cuadros tipo creayera.
    expect(landing).not.toContain('pixel-border')
    // Los tres que quedan —la dinámica se eliminó— llevan DOS paths (el
    // cerrado con relleno y la línea): la curva aparece seis veces.
    const ondas = landing.match(/C200,0 400,0 600,20 C800,40 1000,40 1200,20/g) || []
    expect(ondas.length).toBe(6)
    // Todos cierran hasta las esquinas inferiores y se rellenan con el
    // color de la sección de ABAJO (rojo→amarillo, amarillo→blanco y
    // hero→vinotinto).
    for (const relleno of ['#a81e3e', '#facc15', '#ffffff']) {
      expect(landing, relleno).toContain(`L1200,40 L0,40 Z" fill="${relleno}"`)
    }
    // Los tres absolutos al fondo de su sección con -1px, y con
    // w-full: el svg es un elemento reemplazado y con sólo inset-x-0
    // no estira —usa su tamaño intrínseco— y la línea no llegaba
    // de lado a lado.
    expect((landing.match(/absolute inset-x-0 -bottom-px h-10 w-full/g) || []).length).toBe(3)
    // El grosor no se deforma con el estiramiento horizontal.
    expect((landing.match(/vector-effect="non-scaling-stroke"/g) || []).length).toBe(3)
    // La línea va en un color que se lea en cada frontera.
    expect(landing).toContain('stroke="#ffffff"')
    expect(landing).toContain('stroke="#0a1e5e"')
    expect(landing).not.toContain('stroke="#facc15"')
  })

  it('se fueron los botones flotantes de guía operativa y soporte', () => {
    expect(landing).not.toContain('data-modal="itch"')
    expect(landing).not.toContain('data-modal="discord"')
    // Y sus contenidos, que ya no tienen botón que los abra (términos
    // y privacidad siguen, desde el menú, el footer y el formulario).
    expect(landing).not.toContain('Guía operativa')
    expect(landing).not.toContain('Soporte y Coordinación')
    expect(landing).toContain("data-modal=\"terms\"")
    expect(landing).toContain("data-modal=\"privacy\"")
  })

  it('el hero ya no tiene los círculos bokeh', () => {
    expect(landing).not.toContain('bokeh-dot')
    expect(landing).not.toContain('Decorative Bokeh Circles')
  })

  it('la sección de dinámica se eliminó, con sus enlaces y acordeones', () => {
    expect(landing).not.toContain('id="dinamica"')
    expect(landing).not.toContain('href="#dinamica"')
    expect(landing).not.toContain('Dinámica del concurso')
    // Los acordeones sólo vivían ahí: se fueron con su CSS y su JS.
    expect(landing).not.toContain('accordion')
  })

  it('los tres premios muestran su caja de regalo, en el HTML y en el script', () => {
    // Una imagen por puesto, en el HTML estático…
    for (const n of [1, 2, 3]) expect(landing).toContain(`src="regalo-${n}.png"`)
    // …y en pintarPremios, que rehace la lista desde la base: sin la
    // misma imagen ahí, al cargar el contenido guardado las cajas
    // volverían a ser trofeos.
    expect(landing).toContain('i < 3')
    expect(landing).toContain("regalo-' + (i + 1) + '.png")
    // Un premio 4° en adelante se queda con el trofeo de colores.
    expect(landing).toContain('trofeo(i)')
  })

  it('lee el contenido por la RPC pública, con la config del build', () => {
    expect(landing).toContain('ver_contenido_gran_cosecha')
    expect(landing).toContain('__SUPABASE_URL__')
    expect(landing).toContain('__SUPABASE_ANON_KEY__')
    expect(landing).toContain('apikey')
    // Siempre fresca: el contenido cambia desde la consola.
    expect(landing).toContain("cache: 'no-store'")
  })

  it('sin JavaScript o sin conexión, sigue mostrando sus valores', () => {
    // Los mismos que `CONTENIDO_BASE`: si cambia uno, cambian los dos.
    // (El hero queda fuera: está en cero a propósito, ver el test de arriba.)
    for (const premio of CONTENIDO_BASE.premios) expect(landing).toContain(premio.descripcion)
    // (Las fotos de rounds se eliminaron con la sección de dinámica.)
    // Y lo que viene de la base se escapa antes de pintarlo.
    expect(landing).toContain('function esc(')
  })
})

describe('gran cosecha · el build', () => {
  it('vite reemplaza los marcadores de la landing en dev y en build', () => {
    expect(vite).toContain("fileName: 'gran-cosecha.html'")
    expect(vite).toContain("'__SUPABASE_URL__', valorEntorno('VITE_SUPABASE_URL')")
    expect(vite).toContain("'__SUPABASE_ANON_KEY__', valorEntorno('VITE_SUPABASE_ANON_KEY')")
    // En dev la sirve un middleware; en build, el asset emitido.
    expect(vite).toContain('configureServer')
    expect(vite).toContain('gran-cosecha.html')
  })
})
