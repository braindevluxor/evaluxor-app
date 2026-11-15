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
      'round1',
      'round2',
      'round3',
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
    // (su "INSCRÍBETE" de la sección de inscripción sigue ahí).
    const hero = landing.slice(landing.indexOf('<!-- HERO BANNER -->'), landing.indexOf('<!-- PRESENTADO POR'))
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
    expect(landing).toContain('img/round-1.jpg')
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
