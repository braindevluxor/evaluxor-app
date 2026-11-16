import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Descripcion } from '../../components/Descripcion'
import { etiquetaPeriodo, periodoDe, ESTADOS } from '../../lib/data/granCosecha'
import {
  contenidoDe,
  diasHasta,
  ejemploPara,
  fechaLarga,
  obtenerConcursoPublico,
  estadoHito,
  type ConcursoPublico,
  type HitoCalendario,
  type PremioContenido
} from '../../lib/data/concursoPublico'
import './concurso.css'

/**
 * GRAN COSECHA LUXOR: LA LANDING PÚBLICA DEL CONCURSO (/concurso)
 * ---------------------------------------------------------------
 * Se comparte por WhatsApp y se abre SIN cuenta, así que sale entera de la
 * función `ver_concurso_publico` (bloque gran-cosecha-publico.sql): anon no
 * tiene privilegio de tabla sobre nada.
 *
 * Mientras ese bloque no esté aplicado en la base, la RPC falla y la página
 * cae en `ejemploPara()` — datos de ejemplo que SE AVISAN con una franja arriba
 * de todo. Nunca se muestran como reales: si la franja no está, los datos
 * vinieron de la base.
 *
 * Las secciones sin contenido cargado muestran su estado vacío en vez de
 * inventar texto: el contenido lo carga el equipo del concurso desde la
 * pantalla de Contenido (rol JUEZ/LÍDER).
 */

/** La clase del chip de estado, según el pastel del sistema. */
const CHIP: Record<string, string> = {
  cumple: 'concurso-chip concurso-chip--cumple',
  riesgo: 'concurso-chip concurso-chip--riesgo',
  sinDato: 'concurso-chip concurso-chip--sindato',
  noCumple: 'concurso-chip concurso-chip--nocumple'
}

/** Fecha corta para la bitácora: `8/11/2026`, sin depender del locale. */
function fechaCorta(iso: string): string {
  const f = new Date(iso)
  if (Number.isNaN(f.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(f.getDate())}/${p(f.getMonth() + 1)}/${f.getFullYear()}`
}

export function ConcursoPublico() {
  const periodo = periodoDe()
  const [paquete, setPaquete] = useState<ConcursoPublico | null>(null)
  const [ejemplo, setEjemplo] = useState(false)
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    const tituloAnterior = document.title
    document.title = 'Gran Cosecha Luxor — Concurso trimestral de proyectos'
    let vivo = true
    void obtenerConcursoPublico(periodo).then((datos) => {
      if (!vivo) return
      if (datos) {
        setPaquete(datos)
        setEjemplo(false)
      } else {
        setPaquete(ejemploPara(periodo))
        setEjemplo(true)
      }
      setCargando(false)
    })
    return () => {
      vivo = false
      document.title = tituloAnterior
    }
  }, [periodo])

  if (cargando || !paquete) {
    return (
      <div className="concurso">
        <div className="concurso-carga" role="status">
          <div className="concurso-carga-rueda" aria-hidden="true" />
          Cargando el concurso…
        </div>
      </div>
    )
  }

  const periodoActivo = paquete.periodo
  const proyectos = [...paquete.proyectos].sort(
    (a, b) => b.avance - a.avance || a.created_at.localeCompare(b.created_at)
  )
  const top3 = proyectos.slice(0, 3)
  const premios = contenidoDe(paquete.contenido, 'premios', periodoActivo)?.items ?? []
  const calendario = [...(contenidoDe(paquete.contenido, 'calendario', periodoActivo)?.hitos ?? [])].sort(
    (a: HitoCalendario, b: HitoCalendario) => a.fecha.localeCompare(b.fecha)
  )
  const bases = contenidoDe(paquete.contenido, 'bases', periodoActivo)?.texto ?? null
  const jurado = contenidoDe(paquete.contenido, 'jurado', periodoActivo)?.items ?? []
  const faq = contenidoDe(paquete.contenido, 'faq', periodoActivo)?.items ?? []
  const ganadores = contenidoDe(paquete.contenido, 'ganadores', periodoActivo)?.items ?? []
  // El próximo hito es el primero que todavía no pasó: es el que lleva el
  // badge de "faltan N días"; los demás sólo dicen Hecho o van sin badge.
  const indiceProximo = calendario.findIndex((h) => estadoHito(h.fecha) !== 'pasado')

  return (
    <div className="concurso">
      {ejemplo ? (
        <div className="concurso-aviso" role="status">
          Vista previa con datos de ejemplo — el contenido real aparece cuando el concurso se publique en
          Supabase.
        </div>
      ) : null}

      {/* --- Nav --- */}
      <header className="concurso-nav">
        <img src="/completo.webp" alt="EvaLuxor" className="concurso-logo" />
        <nav className="concurso-nav-links" aria-label="Secciones del concurso">
          <a href="#bases">Bases</a>
          <a href="#calendario">Calendario</a>
          <a href="#proyectos">Proyectos</a>
          <a href="#premios">Premios</a>
          <a href="#faq">FAQ</a>
        </nav>
        <Link to="/gran-cosecha" className="concurso-nav-cta">
          Presentá tu proyecto
        </Link>
      </header>

      {/* --- Hero: la vitrina de premios --- */}
      <section className="concurso-hero">
        <div className="concurso-hero-izq">
          <p className="concurso-eyebrow">Concurso trimestral de proyectos · {etiquetaPeriodo(periodoActivo)}</p>
          <h1 className="concurso-h1">
            Gran Cosecha
            <br />
            <em>Luxor</em>
          </h1>
          <p className="concurso-sub">
            Armá un equipo de tres, presentá tu proyecto y ganalo: tres meses de desarrollo, seguimiento de los
            jueces y premios para los mejores.
          </p>
          <div className="concurso-acciones">
            <Link to="/gran-cosecha" className="concurso-btn concurso-btn--primario">
              Presentá tu proyecto
            </Link>
            <a href="#bases" className="concurso-btn concurso-btn--secundario">
              Ver bases
            </a>
          </div>
        </div>
        <Vitrina premios={premios} />
      </section>

      {/* --- Posiciones en vivo (el primer vistazo) --- */}
      <section className="concurso-franja" aria-label="Posiciones en vivo">
        <p className="concurso-franja-titulo">Posiciones en vivo</p>
        {top3.length === 0 ? (
          <p className="concurso-franja-vacia">Todavía no hay proyectos presentados en este trimestre.</p>
        ) : (
          top3.map((p, i) => (
            <div className="concurso-fila" key={p.id}>
              <div className="concurso-fila-pos">{i + 1}</div>
              <div className="concurso-fila-info">
                <div className="concurso-fila-nombre">{p.titulo}</div>
                <div className="concurso-barra">
                  <i style={{ width: `${p.avance}%`, animationDelay: `${i * 0.12}s` }} />
                </div>
              </div>
              <div className="concurso-fila-pct">{p.avance}%</div>
            </div>
          ))
        )}
      </section>

      <a className="concurso-peek" href="#como-funciona">
        Cómo funciona <span aria-hidden="true">→</span>
      </a>

      {/* --- Cómo funciona --- */}
      <section className="concurso-seccion concurso-seccion--blanco" id="como-funciona">
        <div className="concurso-contenedor">
          <h2 className="concurso-h2">Cómo funciona</h2>
          <p className="concurso-linea concurso-subtitulo">
            Tres pasos, un trimestre y todo el seguimiento a la vista de la empresa.
          </p>
          <div className="concurso-pasos">
            <div className="concurso-paso">
              <div className="concurso-paso-num">1</div>
              <h3>Armá tu equipo</h3>
              <p>
                Tres personas mínimo, de cualquier área o sucursal. El equipo se arma dentro de EvaLuxor, en la
                pantalla Gran Cosecha.
              </p>
            </div>
            <div className="concurso-paso">
              <div className="concurso-paso-num">2</div>
              <h3>Presentá tu proyecto</h3>
              <p>
                Una ficha con qué resuelve, cómo se mide y quién lo hace. Se presenta en el trimestre y queda
                publicada acá para toda la empresa.
              </p>
            </div>
            <div className="concurso-paso">
              <div className="concurso-paso-num">3</div>
              <h3>Avanzá hasta el cierre</h3>
              <p>
                Reportás avances con porcentaje y nota, los jueces dan seguimiento y las posiciones se
                actualizan solas en esta página.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* --- Proyectos participantes --- */}
      <section className="concurso-seccion" id="proyectos">
        <div className="concurso-contenedor">
          <h2 className="concurso-h2">Proyectos participantes</h2>
          <p className="concurso-linea concurso-subtitulo">
            Las fichas de los equipos inscriptos en {etiquetaPeriodo(periodoActivo)}, con su avance y su
            historial completo.
          </p>
          {proyectos.length === 0 ? (
            <div className="concurso-vacio">
              Todavía no hay proyectos presentados para {etiquetaPeriodo(periodoActivo)}.
            </div>
          ) : (
            <div className="concurso-grilla">
              {proyectos.map((p) => {
                const estado = ESTADOS[p.estado]
                return (
                  <article className="concurso-ficha" key={p.id}>
                    <div className="concurso-ficha-cabeza">
                      <h3>{p.titulo}</h3>
                      <span className={CHIP[estado.chip]}>{estado.etiqueta}</span>
                    </div>
                    <p className="concurso-ficha-equipo">Equipo: {p.miembros.join(' · ')}</p>
                    <p>{p.descripcion}</p>
                    <div className="concurso-ficha-avance">
                      <div className="concurso-barra">
                        <i style={{ width: `${p.avance}%` }} />
                      </div>
                      <b>{p.avance}%</b>
                    </div>
                    {p.avance_nota ? <p className="concurso-ficha-nota">Último avance: {p.avance_nota}</p> : null}
                    <details className="concurso-detalles">
                      <summary>Ver historial de avances ({p.avances.length})</summary>
                      {p.avances.map((a, i) => (
                        <div className="concurso-avance-fila" key={`${p.id}-${i}`}>
                          <time dateTime={a.created_at}>{fechaCorta(a.created_at)}</time>
                          <b>{a.porcentaje}%</b>
                          <span>{a.detalle}</span>
                        </div>
                      ))}
                    </details>
                  </article>
                )
              })}
            </div>
          )}
        </div>
      </section>

      {/* --- Posiciones completas --- */}
      <section className="concurso-seccion concurso-seccion--blanco" id="posiciones">
        <div className="concurso-contenedor">
          <h2 className="concurso-h2">Posiciones</h2>
          <p className="concurso-linea concurso-subtitulo">
            El ranking del trimestre ordenado por avance reportado. Se actualiza con cada avance de los equipos.
          </p>
          {proyectos.length === 0 ? (
            <div className="concurso-vacio">El ranking se arma cuando haya proyectos presentados.</div>
          ) : (
            <div className="concurso-tabla-wrap">
              <table className="concurso-tabla">
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">Proyecto</th>
                    <th scope="col">Equipo</th>
                    <th scope="col">Avance</th>
                    <th scope="col">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {proyectos.map((p, i) => (
                    <tr key={p.id}>
                      <td className="num">{i + 1}</td>
                      <td className="fuerte">{p.titulo}</td>
                      <td className="equipo">{p.miembros.join(' · ')}</td>
                      <td className="avance-celda">
                        <div>
                          <div className="concurso-barra">
                            <i style={{ width: `${p.avance}%` }} />
                          </div>
                          <b>{p.avance}%</b>
                        </div>
                      </td>
                      <td>
                        <span className={CHIP[ESTADOS[p.estado].chip]}>{ESTADOS[p.estado].etiqueta}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* --- Calendario --- */}
      <section className="concurso-seccion" id="calendario">
        <div className="concurso-contenedor">
          <h2 className="concurso-h2">Calendario del trimestre</h2>
          <p className="concurso-linea concurso-subtitulo">
            Los hitos oficiales de {etiquetaPeriodo(periodoActivo)}: inscripción, avances, cierre y premiación.
          </p>
          {calendario.length === 0 ? (
            <div className="concurso-vacio">El calendario del trimestre se publica en breve.</div>
          ) : (
            <ol className="concurso-timeline">
              {calendario.map((h, i) => {
                const estado = estadoHito(h.fecha)
                const proximo = i === indiceProximo
                const quedan = diasHasta(h.fecha)
                return (
                  <li
                    className={`concurso-hito${estado === 'pasado' ? ' concurso-hito--pasado' : ''}${
                      proximo ? ' concurso-hito--proximo' : ''
                    }`}
                    key={`${h.fecha}-${h.titulo}`}
                  >
                    <div className="concurso-hito-fecha">{fechaLarga(h.fecha)}</div>
                    <h3>{h.titulo}</h3>
                    {h.detalle ? <p>{h.detalle}</p> : null}
                    {proximo ? (
                      <span className="concurso-hito-badge">
                        {quedan <= 0 ? 'Es hoy' : `Faltan ${quedan} días`}
                      </span>
                    ) : null}
                    {estado === 'pasado' ? <span className="concurso-hito-badge">Hecho</span> : null}
                  </li>
                )
              })}
            </ol>
          )}
        </div>
      </section>

      {/* --- Premios --- */}
      <section className="concurso-seccion concurso-seccion--blanco" id="premios">
        <div className="concurso-contenedor">
          <h2 className="concurso-h2">Premios</h2>
          <p className="concurso-linea concurso-subtitulo">Lo que se llevan los equipos ganadores del trimestre.</p>
          {premios.length === 0 ? (
            <div className="concurso-vacio">Los premios del trimestre se publican en breve.</div>
          ) : (
            <div className="concurso-premios">
              {premios.map((premio: PremioContenido, i: number) => (
                <article className="concurso-premio" key={`${premio.puesto}-${i}`}>
                  <div className="concurso-medalla" aria-hidden="true" />
                  <p className="concurso-premio-puesto">{premio.puesto}</p>
                  <h3>{premio.titulo}</h3>
                  {premio.detalle ? <p>{premio.detalle}</p> : null}
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* --- Bases --- */}
      <section className="concurso-seccion" id="bases">
        <div className="concurso-contenedor">
          <h2 className="concurso-h2">Bases y reglamento</h2>
          <p className="concurso-linea concurso-subtitulo">Cómo se participa y cómo se evalúa.</p>
          {bases ? (
            <div className="concurso-prose">
              <Descripcion texto={bases} />
            </div>
          ) : (
            <div className="concurso-vacio">Las bases del concurso se publican en breve.</div>
          )}
        </div>
      </section>

      {/* --- Jurado --- */}
      <section className="concurso-seccion concurso-seccion--blanco" id="jurado">
        <div className="concurso-contenedor">
          <h2 className="concurso-h2">Jurado</h2>
          <p className="concurso-linea concurso-subtitulo">
            Quiénes dan seguimiento a los equipos y resuelven el veredicto del trimestre.
          </p>
          {jurado.length === 0 ? (
            <div className="concurso-vacio">El jurado del trimestre se presenta en breve.</div>
          ) : (
            <div className="concurso-jurado">
              {jurado.map((j, i) => (
                <div className="concurso-juez" key={`${j.nombre}-${i}`}>
                  <div className="concurso-inicial" aria-hidden="true">
                    {j.nombre.slice(0, 1).toUpperCase()}
                  </div>
                  <div>
                    <b>{j.nombre}</b>
                    <span>{j.cargo}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* --- Ganadores anteriores --- */}
      <section className="concurso-seccion" id="ganadores">
        <div className="concurso-contenedor">
          <h2 className="concurso-h2">Ganadores anteriores</h2>
          <p className="concurso-linea concurso-subtitulo">Los equipos que ya se llevaron la cosecha.</p>
          {ganadores.length === 0 ? (
            <div className="concurso-vacio">
              Todavía no hay ganadores registrados. El primero se anuncia al cerrar este trimestre.
            </div>
          ) : (
            <div className="concurso-ganadores">
              {ganadores.map((g, i) => (
                <div className="concurso-ganador" key={`${g.periodo}-${i}`}>
                  <span className="concurso-ganador-periodo">{g.periodo}</span>
                  <b>{g.proyecto}</b>
                  {g.equipo ? <span>{g.equipo}</span> : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* --- FAQ --- */}
      <section className="concurso-seccion concurso-seccion--blanco" id="faq">
        <div className="concurso-contenedor">
          <h2 className="concurso-h2">Preguntas frecuentes</h2>
          <p className="concurso-linea concurso-subtitulo">Las dudas que más llegan a los equipos.</p>
          {faq.length === 0 ? (
            <div className="concurso-vacio">Las preguntas frecuentes se publican en breve.</div>
          ) : (
            <div className="concurso-faq">
              {faq.map((f, i) => (
                <details key={`${f.pregunta}-${i}`}>
                  <summary>{f.pregunta}</summary>
                  <p>{f.respuesta}</p>
                </details>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* --- CTA final --- */}
      <section className="concurso-cta-final">
        <h2>¿Listo para presentar el tuyo?</h2>
        <p>
          Entrá a EvaLuxor con tu usuario, abrí Gran Cosecha y armá la ficha de tu equipo. Toda la empresa va a
          ver cómo avanza.
        </p>
        <Link to="/gran-cosecha" className="concurso-btn concurso-btn--primario">
          Presentá tu proyecto
        </Link>
      </section>

      <footer className="concurso-footer">
        <img src="/completo.webp" alt="EvaLuxor" className="concurso-logo" />
        <nav aria-label="Enlaces del pie">
          <a href="#bases">Bases</a>
          <a href="#calendario">Calendario</a>
          <a href="#faq">FAQ</a>
        </nav>
        <span>EvaLuxor · Gran Cosecha Luxor · {etiquetaPeriodo(periodoActivo)}</span>
      </footer>
    </div>
  )
}

/**
 * La vitrina: las tres placas de premios del hero. El oro (1er puesto) va al
 * centro elevado —es el que mira la página— y los otros dos a los lados.
 * Sin premios cargados, la vitrina queda con su mensaje en vez de inventar
 * placas: lo único que decora acá es contenido real.
 */
function Vitrina({ premios }: { premios: PremioContenido[] }) {
  if (premios.length === 0) {
    return (
      <div className="concurso-vitrina">
        <div className="concurso-repisa" aria-hidden="true" />
        <p className="concurso-vitrina-vacia">Los premios de este trimestre se publican pronto.</p>
      </div>
    )
  }

  const [primero, segundo, tercero] = premios

  return (
    <div className="concurso-vitrina">
      <div className="concurso-repisa" aria-hidden="true" />
      {segundo ? (
        <div className="concurso-placa-env" style={{ animationDelay: '0s' }}>
          <div className="concurso-placa">
            <div className="concurso-medalla" aria-hidden="true" />
            <b>{segundo.puesto}</b>
            <i>{segundo.titulo}</i>
          </div>
        </div>
      ) : null}
      <div className="concurso-placa-env" style={{ animationDelay: '0.26s' }}>
        <div className="concurso-placa concurso-placa--oro">
          <div className="concurso-medalla" aria-hidden="true" />
          <b>{primero.puesto}</b>
          <i>{primero.titulo}</i>
        </div>
      </div>
      {tercero ? (
        <div className="concurso-placa-env" style={{ animationDelay: '0.13s' }}>
          <div className="concurso-placa">
            <div className="concurso-medalla" aria-hidden="true" />
            <b>{tercero.puesto}</b>
            <i>{tercero.titulo}</i>
          </div>
        </div>
      ) : null}
    </div>
  )
}
