import { jsPDF } from 'jspdf'
import html2canvas from 'html2canvas'
import { logoPie } from './marcaPie'

export interface DatosChofer {
  cedula?: string | null
  nombre?: string | null
  apellido?: string | null
  cargo?: string | null
  firma?: string | null
}

export interface DatosVehiculo {
  placa?: string | null
  marca?: string | null
  modelo?: string | null
  color?: string | null
  anio?: string | null
  flota?: string | null
  kilometraje?: string | null
  /** Sistema de combustible: «GNV (Gas vehicular)» en los vehículos particulares. */
  combustible?: string | null
  [key: string]: unknown
}

/** Un campo de la ficha de la persona, para poder renombrarlo por herramienta. */
export interface CampoPersona {
  etiqueta: string
  valor?: string | number | null
}

export interface FotoPdf {
  /** data: o blob: URL — `html2canvas` las volca igual. */
  src: string
  /** Pie impreso bajo la foto: qué se miró. */
  pie?: string | null
}

export interface DatosRevision {
  titulo?: string
  numeroRevision?: string | null
  fecha?: string | null
  sucursal?: string | null
  evaluador?: string | null
  observaciones?: string | null
  vehiculo?: DatosVehiculo | null
  chofer?: DatosChofer | null
  /** «Chofer» (pre-entrega) o «Propietario» (inspección de particulares). */
  etiquetaPersona?: string
  /** Si se pasa, sustituye los campos de la ficha de la persona. */
  personaCampos?: CampoPersona[]
  /**
   * Filas de la tabla. `grupo` abre una banda con el nombre de la sección
   * (Estética / Mecánica / Gas vehicular) cada vez que cambia.
   */
  items?: Array<{ etiqueta: string; valor: string | null; grupo?: string | null }>
  /** Evidencias fotográficas, en la grilla que va debajo del checklist. */
  fotos?: FotoPdf[]
}

function formatearFecha(f?: string | null): string {
  if (!f) return new Date().toLocaleDateString('es-ES')
  const d = new Date(f)
  if (Number.isNaN(d.getTime())) return f
  return d.toLocaleDateString('es-ES')
}

function escapeHtml(s?: string | null): string {
  if (!s) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

interface Encabezado {
  titulo: string
  numero: string
  fecha: string
}

/**
 * Título, número y fecha de la hoja. Se resuelve una sola vez por exportación
 * para que el número impreso y el del nombre del archivo sean el mismo.
 */
function encabezadoDe(datos: DatosRevision): Encabezado {
  return {
    titulo: datos.titulo || 'Revisión Pre-Entrega',
    numero:
      datos.numeroRevision ||
      new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + Math.floor(Math.random() * 1000),
    fecha: formatearFecha(datos.fecha)
  }
}

/**
 * El HTML de la hoja completa, sin tocar el DOM: es lógica pura y por eso se
 * puede probar sola (mismo motivo que `preguntasRevision`). `exportarRevisionPreEntrega`
 * no hace más que volcar esto en un contenedor off-screen y rasterizarlo.
 */
export function htmlRevision(datos: DatosRevision, enc: Encabezado = encabezadoDe(datos)): string {
  const { titulo, numero, fecha } = enc
  // La persona que firma: el chofer al entregar, el propietario al inspeccionar.
  const etiquetaPersona = datos.etiquetaPersona || 'chofer'
  const personaCampos = datos.personaCampos

  return `
    <div style="display:flex;flex-direction:column;gap:24px">
      <header style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0f766e;padding-bottom:16px">
        <div>
          <h1 style="margin:0;font-size:20px;font-weight:800;color:#0f766e;letter-spacing:-0.2px">${escapeHtml(titulo)}</h1>
          <p style="margin:4px 0 0 0;font-size:11px;color:#475569">N° de revisión: ${escapeHtml(numero)}</p>
        </div>
        <div style="text-align:right">
          <p style="margin:0;font-weight:600">Fecha: ${fecha}</p>
          ${datos.sucursal ? `<p style="margin:2px 0 0 0;color:#475569">${escapeHtml(datos.sucursal)}</p>` : ''}
          ${datos.evaluador ? `<p style="margin:2px 0 0 0;color:#475569">Evaluador: ${escapeHtml(datos.evaluador)}</p>` : ''}
        </div>
      </header>

      <section>
        <h2 style="margin:0 0 8px 0;font-size:14px;font-weight:700;color:#0f766e;border-left:4px solid #0f766e;padding-left:8px">Datos del vehículo</h2>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px 16px;padding:12px;border:1px solid #e2e8f0;border-radius:12px;background:#f8fafc">
          ${renderCampo('Placa', datos.vehiculo?.placa)}
          ${renderCampo('Marca', datos.vehiculo?.marca)}
          ${renderCampo('Modelo', datos.vehiculo?.modelo)}
          ${renderCampo('Color', datos.vehiculo?.color)}
          ${renderCampo('Año', datos.vehiculo?.anio)}
          ${renderCampo('Sistema de combustible', datos.vehiculo?.combustible)}
          ${renderCampo('Kilometraje (km)', datos.vehiculo?.kilometraje)}
          ${datos.vehiculo?.flota ? renderCampo('Tipo de flota', datos.vehiculo.flota) : ''}
        </div>
      </section>

      <section>
        <h2 style="margin:0 0 8px 0;font-size:14px;font-weight:700;color:#0f766e;border-left:4px solid #0f766e;padding-left:8px">Datos del ${escapeHtml(etiquetaPersona)}</h2>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px 16px;padding:12px;border:1px solid #e2e8f0;border-radius:12px;background:#f8fafc">
          ${
            (personaCampos ?? [
              { etiqueta: 'Cédula', valor: datos.chofer?.cedula },
              { etiqueta: 'Nombre', valor: datos.chofer?.nombre },
              { etiqueta: 'Apellido', valor: datos.chofer?.apellido },
              { etiqueta: 'Cargo', valor: datos.chofer?.cargo }
            ])
              .map((c) => renderCampo(c.etiqueta, c.valor))
              .join('')
          }
        </div>
      </section>

      ${
        datos.items && datos.items.length > 0
          ? `
      <section>
        <h2 style="margin:0 0 8px 0;font-size:14px;font-weight:700;color:#0f766e;border-left:4px solid #0f766e;padding-left:8px">Inspección / Checklist</h2>
        <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
          <thead>
            <tr style="background:#0f766e;color:#ffffff">
              <th style="padding:8px 10px;text-align:left;font-size:11px;font-weight:700">Ítem</th>
              <th style="padding:8px 10px;text-align:left;font-size:11px;font-weight:700">Valor / Estado</th>
            </tr>
          </thead>
          <tbody>
            ${filasTabla(datos.items ?? [])}
          </tbody>
        </table>
      </section>
      `
          : ''
      }

      ${
        datos.fotos && datos.fotos.length > 0
          ? `
      <section>
        <h2 style="margin:0 0 8px 0;font-size:14px;font-weight:700;color:#0f766e;border-left:4px solid #0f766e;padding-left:8px">Evidencias fotográficas</h2>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">
          ${datos.fotos
            .map(
              (f) => `
          <figure style="margin:0;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;background:#ffffff">
            <img src="${f.src}" alt="${escapeHtml(f.pie ?? 'Evidencia')}" style="display:block;width:100%;height:150px;object-fit:cover" />
            <figcaption style="padding:6px 8px;font-size:10px;line-height:1.35;color:#475569">${escapeHtml(f.pie ?? '')}</figcaption>
          </figure>`
            )
            .join('')}
        </div>
      </section>
      `
          : ''
      }

      ${
        datos.observaciones
          ? `
      <section>
        <h2 style="margin:0 0 8px 0;font-size:14px;font-weight:700;color:#0f766e;border-left:4px solid #0f766e;padding-left:8px">Observaciones</h2>
        <div style="padding:12px;border:1px solid #e2e8f0;border-radius:12px;white-space:pre-wrap;background:#f8fafc">${escapeHtml(datos.observaciones)}</div>
      </section>
      `
          : ''
      }

      <section style="margin-top:auto;display:flex;justify-content:space-between;align-items:flex-end;gap:24px">
        <div style="flex:1">
          <p style="margin:0 0 6px 0;font-size:11px;font-weight:600;color:#475569">Firma del ${escapeHtml(etiquetaPersona)}</p>
          <div style="border:1px dashed #cbd5e1;border-radius:12px;padding:8px;min-height:90px;display:flex;align-items:center;justify-content:center;background:#ffffff">
            ${
              datos.chofer?.firma
                ? `<img src="${datos.chofer.firma}" alt="Firma del ${escapeHtml(etiquetaPersona)}" style="max-width:100%;max-height:90px;object-fit:contain"/>`
                : `<span style="color:#94a3b8;font-size:11px">Sin firma</span>`
            }
          </div>
          <p style="margin:6px 0 0 0;font-size:10px;color:#64748b">Acepto las condiciones y el resultado de esta revisión.</p>
        </div>
        <div style="text-align:right;min-width:180px">
          <div style="border-top:1px solid #1f2937;margin-top:40px;padding-top:6px">
            <p style="margin:0;font-size:11px;font-weight:600">Firma y sello del evaluador</p>
          </div>
        </div>
      </section>

      <!-- La misma marca al pie que en los informes: a la izquierda y al lado
           del texto, para que los tres reportes se lean como una familia. -->
      <footer style="margin-top:16px;display:flex;align-items:center;gap:12px;font-size:10px;color:#94a3b8">
        <img src="${logoPie}" alt="EvaLuxor" style="width:104px;height:auto;flex:none" />
        <span>Generado automáticamente por EvaLuxor · ${fecha}</span>
      </footer>
    </div>
  `
}

export async function exportarRevisionPreEntrega(datos: DatosRevision): Promise<void> {
  const enc = encabezadoDe(datos)

  const contenedor = document.createElement('div')
  contenedor.style.position = 'absolute'
  contenedor.style.left = '-9999px'
  contenedor.style.top = '0'
  contenedor.style.width = '794px'
  contenedor.style.background = '#ffffff'
  contenedor.style.padding = '40px'
  contenedor.style.fontFamily = 'Arial, Helvetica, sans-serif'
  contenedor.style.color = '#111827'
  contenedor.style.fontSize = '12px'
  contenedor.style.lineHeight = '1.5'

  contenedor.innerHTML = htmlRevision(datos, enc)
  document.body.appendChild(contenedor)

  try {
    const canvas = await html2canvas(contenedor, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff'
    })
    const imgData = canvas.toDataURL('image/png')
    const pdf = new jsPDF('p', 'mm', 'a4')
    const pdfWidth = pdf.internal.pageSize.getWidth()
    const pdfHeight = (canvas.height * pdfWidth) / canvas.width
    pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight)
    const nombreArchivo = `${enc.titulo.replace(/\s+/g, '_')}_${enc.numero}.pdf`
    pdf.save(nombreArchivo)
  } finally {
    document.body.removeChild(contenedor)
  }
}

function renderCampo(etiqueta: string, valor?: string | number | null): string {
  const v = valor == null || valor === '' ? '-' : String(valor)
  return `
    <div>
      <p style="margin:0;font-size:10px;font-weight:600;color:#475569">${escapeHtml(etiqueta)}</p>
      <p style="margin:2px 0 0 0;font-size:11px;font-weight:600;word-break:break-word">${escapeHtml(v)}</p>
    </div>
  `
}

/**
 * Las filas de la tabla, con la banda de sección delante de cada grupo.
 *
 * Sin la banda hay que adivinar de qué parte del vehículo habla cada fila: en
 * un checklist de treinta renglones (Estética / Mecánica / Gas vehicular) la
 * banda es lo único que hace legible la hoja impresa.
 */
function filasTabla(items: NonNullable<DatosRevision['items']>): string {
  let grupoActual: string | null = null
  let fila = 0
  return items
    .map((it) => {
      const grupo = it.grupo ?? null
      const banda =
        grupo && grupo !== grupoActual
          ? `<tr><td colspan="2" style="padding:7px 10px;background:#ccfbf1;border-top:1px solid #e2e8f0;font-size:11px;font-weight:700;color:#0f766e;letter-spacing:0.4px;text-transform:uppercase">${escapeHtml(grupo)}</td></tr>`
          : ''
      grupoActual = grupo
      const fondo = fila % 2 === 0 ? '#ffffff' : '#f8fafc'
      fila++
      return `${banda}
              <tr style="background:${fondo}">
                <td style="padding:8px 10px;border-top:1px solid #f1f5f9;font-size:11px">${escapeHtml(it.etiqueta)}</td>
                <td style="padding:8px 10px;border-top:1px solid #f1f5f9;font-size:11px;font-weight:600">${escapeHtml(it.valor || '-')}</td>
              </tr>`
    })
    .join('')
}
