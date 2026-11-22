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

  it('la página publica lo que la landing ARENA sí pinta', () => {
    // DOS bloques: la bajada del hero y el carrusel de Cosechas Pasadas —
    // lo único de la tabla que la landing nueva pinta.
    expect(pagina).toContain('Portada')
    expect(pagina).toContain('Cosechas Pasadas')
    expect(pagina).toContain('cargarContenidoPagina')
    expect(pagina).toContain('guardarContenidoPagina')
    expect(pagina).toContain('subirMediaCarrusel')
    expect(pagina).toContain('validarContenido')
    expect(pagina).toContain('PortalCabecera')
    expect(pagina).toContain('avisar(')
    // «Ver página» abre la landing en otra pestaña.
    expect(pagina).toContain('href="/gran-cosecha.html"')
    // Lo que la landing ya no pinta (fechas, fondo, premios) no se edita.
    expect(pagina).not.toContain('Agregar premio')
    expect(pagina).not.toContain('Fondo estático')
  })

  it('el carrusel de Cosechas Pasadas se edita con su conversión en pantalla', () => {
    expect(pagina).toContain('Cosechas Pasadas')
    expect(pagina).toContain('subirMediaCarrusel')
    // La barra de avance: convertir un archivo tarda lo que dura el proceso.
    expect(pagina).toContain('convirtiendo')
    expect(pagina).toContain('moverSlide')
    // SÓLO fotos: el carrusel de la landing pinta imágenes — un video
    // quedaría publicado y no pintado.
    expect(pagina).toContain('accept="image/*"')
    expect(pagina).not.toContain('accept="image/*,video/*"')
    // Cada foto lleva el texto que la landing pinta a su lado.
    expect(pagina).toContain('cambiarCampoSlide')
    expect(pagina).toContain('label="Título"')
    expect(pagina).toContain('label="Pie de foto"')
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

  it('el Podio y el «¿QUÉ ES?» llevan la retícula de fondo.svg', () => {
    // La misma textura de la landing clásica, pintada SOBRE el fondo de
    // cada sección: el Podio sobre su navy y el «¿QUÉ ES?» apilada sobre
    // sus puntos de papel (que siguen debajo).
    expect(landing).toMatch(/<section id="podio" class="[^"]*\btextura-cruces\b/)
    expect(landing).toMatch(/<section id="que-es" class="[^"]*\btextura-cruces\b/)
    expect(landing).toContain("url('fondo.svg')")
    expect(landing).toContain('#que-es.textura-cruces')
    // La trama queda quieta mientras la página scrollea, como antes.
    expect(landing).toMatch(/\.textura-cruces \{[^}]*background-attachment: fixed/)
  })

  it('las tres piezas del programa: dos categorías para proyectos y el premio', () => {
    // Las tres tarjetas siguen contando el programa…
    for (const pieza of ['Cosecha en Equipo', 'Cultivando Ideas', 'Premiamos tu Compra']) {
      expect(landing, pieza).toContain(pieza)
    }
    expect(landing).toContain('luxor-card')
    expect(landing).toContain('function filterByModalityFromCard(')
    // El botón de la tarjeta filtra y baja hasta la galería.
    expect(landing).toContain("scrollIntoView({ behavior: 'smooth' })")
    // SÓLO las dos categorías de proyecto filtran: «Cosecha en Equipo» es
    // el PREMIO por KPI — su tarjeta baja con «Todas» y su chip ya no
    // existe, porque ningún proyecto puede tener esa categoría.
    expect(landing).toContain("filterByModalityFromCard('Cultivando Ideas')")
    expect(landing).toContain("filterByModalityFromCard('Premiamos tu Compra')")
    expect(landing).toContain("filterByModalityFromCard('Todos')")
    expect(landing).not.toContain("filterByModalityFromCard('Cosecha en Equipo')")
    expect(landing).not.toContain('data-filter="Cosecha en Equipo"')
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
    // Tu voto y las fotos de cosechas viven en el equipo (dos llaves
    // versionadas en localStorage); los proyectos NO — vienen de la consola.
    expect(landing).toContain('luxor_oficial_liked_v4')
    expect(landing).toContain('luxor_oficial_carousel_v3')
    expect(landing).not.toContain('luxor_oficial_projects')
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

  it('la ficha se abre en modal y la postulación se envía directo por FormSubmit', () => {
    expect(landing).toContain('id="detail-modal"')
    expect(landing).toContain('function openDetailModal(')
    expect(landing).toContain('id="toast"')
    // El formulario de postulación: título, integrantes con cédula y PDF…
    expect(landing).toContain('id="postulacion-modal"')
    expect(landing).toContain('function handlePostulacion(')
    expect(landing).toContain('id="post-titulo"')
    expect(landing).toContain('id="post-integrantes"')
    expect(landing).toContain('id="post-pdf"')
    // …que hace un POST multipart directo a FormSubmit (sin cliente de
    // correo local): destino, copias a las dos gerencias, plantilla y
    // redirección de vuelta a la página en #gracias.
    expect(landing).toContain('action="https://formsubmit.co/coordinacion.evaluacion@supermercadoluxor.com"')
    expect(landing).toContain('enctype="multipart/form-data"')
    expect(landing).toContain('gerencia.mercadeo@supermercadoluxor.com')
    expect(landing).toContain('gerencia.talentohumano@supermercadoluxor.com')
    expect(landing).toContain('name="_next"')
    expect(landing).toContain("'#gracias'")
    // El modal explica, al abrirse, qué debe contener la postulación y
    // muestra los correos (destino y copias) a la vista.
    expect(landing).toContain('Qué debe contener tu postulación')
    expect(landing).toContain('mínimo 3')
    // La validación corta el envío si falta algo, y respeta el límite de
    // 10 MB de FormSubmit antes de mandar.
    expect(landing).toContain('e.preventDefault()')
    expect(landing).toContain('integrantes.length < 3')
    expect(landing).toContain('pdf.size > 10 * 1024 * 1024')
    // Los requisitos del PDF dentro de la caja de la postulación.
    expect(landing).toContain('método SMART')
    expect(landing).toContain('Presupuesto detallado')
    // Sin restos de la dirección vieja con la «r» extra.
    expect(landing).not.toContain('croordinacion')
    // SIN modal de guardado local y SIN mailto: esto no escribe en la base
    // ni depende del cliente de correo de quien postula.
    expect(landing).not.toContain('id="submit-modal"')
    expect(landing).not.toContain('function handleProjectSubmit(')
    expect(landing).not.toContain('mailto:')
    // Los DOS botones de la página abren el formulario.
    expect((landing.match(/openPostulacion\(\)/g) || []).length).toBeGreaterThanOrEqual(2)
    expect(landing).not.toContain('href="/gran-cosecha/proyectos"')
  })

  it('no hay semilla estática: los proyectos los manda la consola', () => {
    // La semilla hardcodeada se fue del HTML y el estado local ya no
    // guarda proyectos — sólo TUS apoyos, con los uuids reales.
    expect(landing).not.toContain('initialProjects')
    expect(landing).not.toContain('luxor_oficial_projects')
    expect(landing).toContain('luxor_oficial_liked_v4')
    // Los proyectos llegan del RPC (`participantes`) mapeados a la forma
    // de la galería: categoría, área, nota del avance y epoch.
    expect(landing).toContain('Array.isArray(contenido.participantes)')
    expect(landing).toContain('category: p.categoria')
    expect(landing).toContain('likes: Number(p.riegos || 0)')
    // Los ids son uuids: los handlers inline los llevan entrecomillados
    // (sin comillas, `toggleLike(3f8a…)` es sintaxis inválida).
    expect(landing).not.toMatch(/onclick="toggleLike\(\$\{/)
    // Los proyectos sin categoría se filtran con su propio chip.
    expect(landing).toContain("document.getElementById('filter-sin-categoria')")
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

  it('la landing lee la portada y las cosechas que publica la consola', () => {
    // La RPC pública con la config del build, siempre fresca…
    expect(landing).toContain('ver_contenido_gran_cosecha')
    expect(landing).toContain('__SUPABASE_URL__')
    expect(landing).toContain('__SUPABASE_ANON_KEY__')
    expect(landing).toContain("cache: 'no-store'")
    // …y sin config el script ni siquiera pide nada.
    expect(landing).toContain("URL_BASE.charAt(0) === '_'")
    // La bajada pinta el párrafo del hero…
    expect(landing).toContain('id="heroBajada"')
    expect(landing).toContain("texto('heroBajada'")
    // …y el carrusel publicado manda sobre la semilla/local del navegador.
    expect(landing).toContain('carouselSlides = mapeados')
    expect(landing).toContain('renderCarousel()')
    // El mapeo: el item de la consola {tipo, url…} se convierte en la forma
    // de la pista (image/edition/title/…) — sólo las FOTOS entran.
    expect(landing).toContain('image: m.url')
    expect(landing).toContain("m.tipo === 'imagen'")
    // Lo que la landing ARENA no pinta sigue fuera: equipos, premios y el
    // pintor viejo del contenido.
    expect(landing).not.toContain('pintarParticipantes')
    expect(landing).not.toContain('pintarPremios')
    expect(landing).not.toContain('id="equipos"')
    expect(landing).not.toContain('id="inscripcion"')
  })

  it('el carrusel navega sin reconstruir la pista (sin recarga de fotos)', () => {
    // El bug: cada salto del autoplay rehacía el innerHTML entero y las
    // fotos se volvían a pedir en bucle cada 5,5 s. Ahora navegar sólo
    // mueve el translateX y marca el punto / miniatura activos.
    expect(landing).toContain('function updateCarouselActive(')
    expect(landing).not.toMatch(/function nextCarouselSlide\(\) \{[\s\S]{0,120}renderCarousel\(\)/)
    expect(landing).toMatch(
      /function nextCarouselSlide\(\) \{[\s\S]{0,120}updateCarouselPosition\(\)/
    )
    // Y el onerror nunca entra en bucle: se desengancha ANTES de pintar el
    // respaldo (el de las miniaturas pedía `undefined` y no paraba de
    // reintentar).
    expect((landing.match(/this\.onerror=null/g) || []).length).toBeGreaterThanOrEqual(2)
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
