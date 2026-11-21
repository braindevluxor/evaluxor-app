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
    expect(app).toMatch(/path="\/gran-cosecha\/pagina"[\s\S]{0,160}?<SoloLider>/)
  })

  it('el menú se lo muestra sólo al Líder, y tiene su cabecera', () => {
    expect(consola).toContain("to: '/gran-cosecha/pagina'")
    expect(consola).toContain('soloLider: true')
    // El filtro de `seccionesDe`: sin esto el item se vería con cualquier rol.
    expect(consola).toContain("!i.soloLider || rol === 'LIDER'")
    expect(consola).toContain("'/gran-cosecha/pagina': {")
    expect(consola).toContain("titulo: 'Página de la Gran Cosecha'")
  })

  it('la página toca las cuatro secciones de la landing', () => {
    for (const bloque of ['Hero', 'Premios']) {
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

    const sinFecha = structuredClone(CONTENIDO_BASE)
    sinFecha.hero.fechaHastaMes = ''
    expect(validarContenido(sinFecha)).toMatch(/fecha de cierre/)

    const slideRoto = structuredClone(CONTENIDO_BASE)
    slideRoto.hero.carrusel = [{ tipo: 'imagen', url: '   ' }]
    expect(validarContenido(slideRoto)).toMatch(/carrusel/)
  })
})

describe('gran cosecha · la landing (Arena)', () => {
  it('la landing es la ARENA: secciones de una sola página con su nav', () => {
    // Una sola página con anclas: qué es, cosechas, categorías, podio y
    // proyectos — cada una con su enlace en la barra y en el menú móvil.
    for (const ancla of ['inicio', 'que-es', 'carrusel-cosechas', 'categorias', 'podio', 'proyectos']) {
      expect(landing, ancla).toContain(`id="${ancla}"`)
      expect(landing, ancla).toContain(`href="#${ancla}"`)
    }
    expect(landing).toContain('<title>GRAN COSECHA LUXOR')
    expect(landing).toContain('GRAN COSECHA')
  })

  it('las tres categorías, cada una con su tarjeta y su filtro', () => {
    for (const categoria of ['Cosecha en Equipo', 'Cultivando Ideas', 'Premiamos tu Compra']) {
      expect(landing, categoria).toContain(categoria)
    }
    expect(landing).toContain('luxor-card')
    expect(landing).toContain('function filterByModalityFromCard(')
    // El botón de la tarjeta filtra y baja hasta la galería.
    expect(landing).toContain("scrollIntoView({ behavior: 'smooth' })")
    expect(landing).toContain("filterByModalityFromCard('Cosecha en Equipo')")
  })

  it('el podio sale del ranking de votos, con el 1° en el centro elevado', () => {
    expect(landing).toContain('function renderPodium(')
    expect(landing).toContain('id="podium-container"')
    // Orden visual: 2° a la izquierda, 1° al centro (y más alto), 3° a la derecha.
    expect(landing).toContain('order-1 lg:order-2 lg:-translate-y-4')
    expect(landing).toContain('1° LUGAR • LÍDER')
    expect(landing).toContain('2° LUGAR')
    expect(landing).toContain('3° LUGAR')
  })

  it('votar es un like con confeti y memoria local', () => {
    expect(landing).toContain('function toggleLike(')
    // El pop del botón y el confeti con los cinco colores de la paleta.
    expect(landing).toContain('animate-vote-pop')
    expect(landing).toContain('function triggerLuxorConfetti(')
    expect(landing).toContain("['#F4B915', '#F39200', '#C41E2E', '#182348', '#FFFFFF']")
    // Votos, apoyos y fotos de cosechas viven en el equipo (tres llaves
    // versionadas en localStorage).
    expect(landing).toContain('luxor_oficial_projects_v3')
    expect(landing).toContain('luxor_oficial_liked_v3')
    expect(landing).toContain('luxor_oficial_carousel_v3')
    // El like alterna: también se puede retirar el apoyo.
    expect(landing).toContain('Has retirado tu apoyo')
  })

  it('la galería se filtra, busca y ordena', () => {
    expect(landing).toContain('function setFilter(')
    expect(landing).toContain('function handleSearch(')
    expect(landing).toContain('function handleSort(')
    expect(landing).toContain('class="filter-btn')
    expect(landing).toContain('id="search-input"')
    expect(landing).toContain('id="sort-select"')
    // Estado vacío con la salida de vuelta a todos los proyectos.
    expect(landing).toContain('id="empty-state"')
    expect(landing).toContain('function resetFilters(')
  })

  it('los modales de ficha e inscripción, con su toast', () => {
    expect(landing).toContain('id="detail-modal"')
    expect(landing).toContain('id="submit-modal"')
    expect(landing).toContain('function handleProjectSubmit(')
    expect(landing).toContain('id="toast"')
    // Inscribir crea el proyecto con el primer voto del propio autor.
    expect(landing).toContain('likes: 1')
  })

  it('el hero trae la marca y sus marcadores en vivo', () => {
    // La marca en tres bloques (GRAN / COSECHA / LUXOR) y los contadores
    // que `updateStats` refresca al vuelo con cada voto.
    expect(landing).toContain('>GRAN<')
    expect(landing).toContain('>COSECHA<')
    expect(landing).toContain('>LUXOR<')
    expect(landing).toContain('id="hero-project-count"')
    expect(landing).toContain('id="hero-total-likes"')
    expect(landing).toContain('function updateStats(')
    // Fondo con la textura de papel de la marca (sin partículas: esa
    // versión no llegó al archivo final).
    expect(landing).toContain('paper-texture-ivory')
  })

  it('la landing ya NO lee el contenido de la consola', () => {
    // La Arena trae sus propios datos (semilla + localStorage): ni la RPC
    // pública de la página ni los píntores del contenido viejo existen.
    expect(landing).not.toContain('ver_contenido_gran_cosecha')
    expect(landing).not.toContain('__SUPABASE_URL__')
    expect(landing).not.toContain('pintarParticipantes')
    expect(landing).not.toContain('pintarPremios')
    expect(landing).not.toContain('premiosCarrusel')
    expect(landing).not.toContain('id="equipos"')
    expect(landing).not.toContain('id="inscripcion"')
  })

  it('el editor ya no ofrece participantes: esos datos salen de Proyectos', () => {
    // La sección entera se retiró: ni la tarjeta en la consola…
    expect(pagina).not.toContain('titulo="Equipos participantes"')
    expect(pagina).not.toContain('subirFotoEquipo')
    // …ni el campo ni su helper en el data layer.
    expect(datos).not.toContain('EquipoPagina')
    expect(datos).not.toContain('subirFotoEquipo')
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
