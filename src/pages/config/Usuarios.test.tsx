// @vitest-environment jsdom
/**
 * Config → Usuarios: CREAR USUARIOS y REINICIAR CONTRASEÑAS.
 *
 * El data layer se MOCKEA —la creación pasa por GoTrue y la reiniciación por
 * la función `desbloquear_usuario`, que vive en la base y exige LÍDER—.
 *
 *  - El alta ya NO pasa por invitaciones: se llena el formulario, se crean
 *    las credenciales y quedan a la vista para mandárselas a la persona.
 *  - La reiniciación se prueba con DOS usuarios, uno bloqueado y otro no:
 *    que el botón aparezca en las DOS filas, que las dos contraseñas tengan
 *    que coincidir antes de tocar la base y que al coincidir se llame al
 *    data layer con la clave nueva.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { UsuariosPage } from './Usuarios'
import { actualizarUsuario, crearUsuario, reiniciarContrasena } from '../../lib/data/usuarios'

vi.mock('../../lib/data/usuarios', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../lib/data/usuarios')>()
  return { ...original, crearUsuario: vi.fn(), reiniciarContrasena: vi.fn(), actualizarUsuario: vi.fn() }
})

// La página lee profiles / sucursales directo de PostgREST: se stubbea la
// cadena `from().select().order()` con la foto de DOS filas.
vi.mock('../../lib/supabase', () => {
  const perfiles = [
    {
      id: 'u1',
      nombre: 'Ana Líder',
      usuario: 'ana',
      email: 'ana@luxor.test',
      rol: 'LIDER',
      activo: true,
      bloqueado: false,
      intentos_fallidos: 0,
      sucursal: { id: 's1', nombre: 'Oficina Central' },
      ultima_sync: null,
      created_at: '2026-01-01T00:00:00Z'
    },
    {
      id: 'u2',
      nombre: 'Juan Evaluador',
      usuario: 'juan',
      email: 'juan@luxor.test',
      rol: 'EVALUADOR',
      activo: true,
      bloqueado: true,
      intentos_fallidos: 5,
      sucursal: null,
      ultima_sync: null,
      created_at: '2026-01-02T00:00:00Z'
    },
    {
      // La tercera fila ya está CONGELADA: es la que ofrece «Descongelar».
      id: 'u3',
      nombre: 'Carla Gerente',
      usuario: 'carla',
      email: 'carla@luxor.test',
      rol: 'GERENTE_S',
      activo: false,
      bloqueado: false,
      intentos_fallidos: 0,
      sucursal: null,
      ultima_sync: null,
      created_at: '2026-01-03T00:00:00Z'
    }
  ]
  return {
    supabase: {
      from: (tabla: string) => ({
        select: () => ({
          order: () => Promise.resolve({ data: tabla === 'profiles' ? perfiles : [], error: null })
        })
      })
    }
  }
})

let container: HTMLDivElement
let root: Root

async function montar(): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(<UsuariosPage />)
  })
}

async function desmontar(): Promise<void> {
  await act(async () => {
    root.unmount()
  })
  container.remove()
  document.body.innerHTML = ''
}

/** Escribe en un input como lo hace el usuario (setter nativo + input). */
async function escribir(input: HTMLInputElement, valor: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, valor)
  await act(async () => {
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/** El formulario del modal, sin depender del atributo `form` de los botones. */
async function enviar(formId: string): Promise<void> {
  const form = document.getElementById(formId) as HTMLFormElement | null
  expect(form).toBeTruthy()
  await act(async () => {
    form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
}

/** Un campo del modal abierto, buscado por su placeholder. */
async function llenar(placeholder: string, valor: string): Promise<void> {
  const input = document.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`)
  expect(input).toBeTruthy()
  await escribir(input!, valor)
}

const botonesReiniciar = () => [
  ...container.querySelectorAll<HTMLButtonElement>('button[aria-label="Reiniciar contraseña"]')
]

/** Un botón de la página, por su texto exacto. */
function boton(texto: string): HTMLButtonElement {
  const b = [...container.querySelectorAll('button')].find((x) => x.textContent?.trim() === texto)
  expect(b).toBeTruthy()
  return b as HTMLButtonElement
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.mocked(reiniciarContrasena).mockResolvedValue(undefined)
  vi.mocked(crearUsuario).mockResolvedValue({
    usuario: 'jperez',
    email: 'jperez@luxor.test',
    password: 'Eva2026Temp',
    confirmacionPendiente: false
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  container?.remove()
  document.body.innerHTML = ''
})

describe('usuarios · reiniciar contraseña', () => {
  it('la acción está en TODAS las filas, bloqueado o no', async () => {
    await montar()

    const botones = botonesReiniciar()
    // Tres filas: la activa, la bloqueada y la ya congelada.
    expect(botones).toHaveLength(3)
    // La fila bloqueada y la que simplemente olvidó su clave: las dos.
    expect(container.textContent).toContain('Ana Líder')
    expect(container.textContent).toContain('Juan Evaluador')
    await desmontar()
  })

  it('no toca la base si las dos contraseñas no coinciden', async () => {
    await montar()

    await act(async () => {
      botonesReiniciar()[0].click()
    })
    const inputs = [...document.querySelectorAll<HTMLInputElement>('input')]
    expect(inputs).toHaveLength(2)

    await escribir(inputs[0], 'Eva2026Temp')
    await escribir(inputs[1], 'Eva2026Diferente')
    await enviar('form-reiniciar')

    expect(reiniciarContrasena).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('no coinciden')
    await desmontar()
  })

  it('reinicia con la clave nueva y deja el aviso para compartirla', async () => {
    await montar()

    // La fila de Juan, que está BLOQUEADO: reiniciar también lo desbloquea.
    await act(async () => {
      botonesReiniciar()[1].click()
    })
    const inputs = [...document.querySelectorAll<HTMLInputElement>('input')]
    await escribir(inputs[0], 'Eva2026Temp')
    await escribir(inputs[1], 'Eva2026Temp')
    await enviar('form-reiniciar')

    await act(async () => {})
    expect(reiniciarContrasena).toHaveBeenCalledTimes(1)
    expect(reiniciarContrasena).toHaveBeenCalledWith('u2', 'Eva2026Temp')
    expect(document.body.textContent).toContain('Contraseña reiniciada')
    expect(document.body.textContent).toContain('bloqueo y los intentos fallidos')
    // Las claves quedan a la vista para copiarlas y compartirlas.
    expect(inputs[0].value).toBe('Eva2026Temp')
    await desmontar()
  })

  it('si la función falla, el error queda en el modal', async () => {
    vi.mocked(reiniciarContrasena).mockRejectedValue(new Error('Solo el lider puede desbloquear usuarios.'))
    await montar()

    await act(async () => {
      botonesReiniciar()[0].click()
    })
    const inputs = [...document.querySelectorAll<HTMLInputElement>('input')]
    await escribir(inputs[0], 'Eva2026Temp')
    await escribir(inputs[1], 'Eva2026Temp')
    await enviar('form-reiniciar')

    await act(async () => {})
    expect(document.body.textContent).toContain('Solo el lider puede desbloquear usuarios.')
    await desmontar()
  })
})

describe('usuarios · crear la cuenta sin invitaciones', () => {
  it('la pantalla ya no ofrece invitaciones: el alta es directa', async () => {
    await montar()

    const etiquetas = [...container.querySelectorAll('button')].map((b) => b.textContent?.trim())
    expect(etiquetas).toContain('＋ Crear usuario')
    expect(container.textContent).not.toContain('Invitar usuario')
    expect(container.textContent).not.toContain('Invitaciones sin usar')
    await desmontar()
  })

  it('no crea la cuenta si las dos contraseñas no coinciden', async () => {
    await montar()

    await act(async () => {
      boton('＋ Crear usuario').click()
    })
    await llenar('nombre@empresa.com', 'jperez@luxor.test')
    await llenar('Ej: jperez', 'jperez')
    await llenar('Mínimo 6 caracteres', 'Eva2026Temp')
    await llenar('La misma de nuevo', 'Eva2026Otra')
    await enviar('form-crear-usuario')

    expect(crearUsuario).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('no coinciden')
    await desmontar()
  })

  it('crea la cuenta y deja las credenciales para mandarlas', async () => {
    await montar()

    await act(async () => {
      boton('＋ Crear usuario').click()
    })
    await llenar('Ej: María Pérez', 'María Pérez')
    await llenar('nombre@empresa.com', 'jperez@luxor.test')
    await llenar('Ej: jperez', 'jperez')
    await llenar('Mínimo 6 caracteres', 'Eva2026Temp')
    await llenar('La misma de nuevo', 'Eva2026Temp')
    await enviar('form-crear-usuario')
    await act(async () => {})

    expect(crearUsuario).toHaveBeenCalledTimes(1)
    expect(crearUsuario).toHaveBeenCalledWith({
      email: 'jperez@luxor.test',
      usuario: 'jperez',
      password: 'Eva2026Temp',
      nombre: 'María Pérez',
      rol: 'EVALUADOR',
      sucursal_id: null
    })

    // Las credenciales quedan a la vista con el recordatorio del cambio de clave.
    expect(document.body.textContent).toContain('Cuenta creada')
    expect(document.body.textContent).toContain('jperez')
    expect(document.body.textContent).toContain('jperez@luxor.test')
    expect(document.body.textContent).toContain('Eva2026Temp')
    expect(document.body.textContent).toContain('Configuración → Cambiar contraseña')
    await desmontar()
  })
})

describe('usuarios · congelar y descongelar', () => {
  const porEtiqueta = (etiqueta: string) => [
    ...container.querySelectorAll<HTMLButtonElement>(`button[aria-label="${etiqueta}"]`)
  ]

  it('las activas ofrecen Congelar y la congelada ofrece Descongelar', async () => {
    await montar()

    expect(porEtiqueta('Congelar')).toHaveLength(2)
    expect(porEtiqueta('Descongelar')).toHaveLength(1)
    // La congelada se ve como tal en la columna de Estado.
    const fila = [...container.querySelectorAll('tbody tr')].find((tr) =>
      tr.textContent?.includes('Carla Gerente')
    )
    expect(fila?.textContent).toContain('Congelado')
    await desmontar()
  })

  it('congelar pide confirmación y recién ahí apaga el activo', async () => {
    await montar()

    await act(async () => {
      porEtiqueta('Congelar')[0].click()
    })
    // Aún no se tocó la base: el modal de confirmación está en el medio.
    expect(actualizarUsuario).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('¿Congelar a Ana Líder?')

    const confirmar = [...document.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Congelar'
    )
    expect(confirmar).toBeTruthy()
    await act(async () => {
      confirmar!.click()
    })

    expect(actualizarUsuario).toHaveBeenCalledTimes(1)
    expect(actualizarUsuario).toHaveBeenCalledWith('u1', { activo: false })
    await desmontar()
  })

  it('descongelar va directo, sin confirmación', async () => {
    await montar()

    await act(async () => {
      porEtiqueta('Descongelar')[0].click()
    })

    expect(actualizarUsuario).toHaveBeenCalledTimes(1)
    expect(actualizarUsuario).toHaveBeenCalledWith('u3', { activo: true })
    expect(document.body.textContent).not.toContain('¿Congelar a')
    await desmontar()
  })
})
