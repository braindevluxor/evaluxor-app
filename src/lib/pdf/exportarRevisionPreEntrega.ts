import { jsPDF } from 'jspdf'
import html2canvas from 'html2canvas'

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
  [key: string]: unknown
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
  items?: Array<{ etiqueta: string; valor: string | null }>
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

export async function exportarRevisionPreEntrega(datos: DatosRevision): Promise<void> {
  const titulo = datos.titulo || 'Revisión Pre-Entrega'
  const fecha = formatearFecha(datos.fecha)
  const numero = datos.numeroRevision || new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + Math.floor(Math.random() * 1000)

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

  const html = `
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
          ${renderCampo('Tipo de flota', datos.vehiculo?.flota)}
          ${renderCampo('Kilometraje (km)', datos.vehiculo?.kilometraje)}
        </div>
      </section>

      <section>
        <h2 style="margin:0 0 8px 0;font-size:14px;font-weight:700;color:#0f766e;border-left:4px solid #0f766e;padding-left:8px">Datos del chofer</h2>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px 16px;padding:12px;border:1px solid #e2e8f0;border-radius:12px;background:#f8fafc">
          ${renderCampo('Cédula', datos.chofer?.cedula)}
          ${renderCampo('Nombre', datos.chofer?.nombre)}
          ${renderCampo('Apellido', datos.chofer?.apellido)}
          ${renderCampo('Cargo', datos.chofer?.cargo)}
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
            ${datos.items
              .map(
                (it, i) => `
              <tr style="background:${i % 2 === 0 ? '#ffffff' : '#f8fafc'}">
                <td style="padding:8px 10px;border-top:1px solid #f1f5f9;font-size:11px">${escapeHtml(it.etiqueta)}</td>
                <td style="padding:8px 10px;border-top:1px solid #f1f5f9;font-size:11px;font-weight:600">${escapeHtml(it.valor || '-')}</td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>
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
          <p style="margin:0 0 6px 0;font-size:11px;font-weight:600;color:#475569">Firma del chofer</p>
          <div style="border:1px dashed #cbd5e1;border-radius:12px;padding:8px;min-height:90px;display:flex;align-items:center;justify-content:center;background:#ffffff">
            ${
              datos.chofer?.firma
                ? `<img src="${datos.chofer.firma}" alt="Firma del chofer" style="max-width:100%;max-height:90px;object-fit:contain"/>`
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

      <footer style="margin-top:16px;text-align:center;font-size:10px;color:#94a3b8">
        Generado automáticamente por EvaLuxor · ${fecha}
      </footer>
    </div>
  `

  contenedor.innerHTML = html
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
    const nombreArchivo = `${titulo.replace(/\s+/g, '_')}_${numero}.pdf`
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