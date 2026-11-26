// @vitest-environment jsdom
/**
 * Config → Usuarios: REINICIAR CONTRASEÑAS.
 *
 * El data layer se MOCKEA —la función `desbloquear_usuario` vive en la base
 * y exige LÍDER—, y la pantalla se prueba con DOS usuarios, uno bloqueado y
 * otro no: que el botón aparezca en las DOS filas (antes sólo aparecía en la
 * bloqueada, que es justamente la que menos lo necesita), que las dos
 * contraseñas tengan que coincidir antes de tocar la base, y que al coincidir
 * se llame al data layer con la clave nueva.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { UsuariosPage } from './Usuarios'
import { reiniciarContrasena } from '../../lib/data/usuarios'

vi.mock('../../lib/data/usuarios', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../lib/data/usuarios')>()
  return { ...original, reiniciarContrasena: vi.fn() }
})

// La página lee profiles / invitaciones / sucursales directo de PostgREST:
// se stubbea la cadena `from().select().order()` con la foto de DOS filas.
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
async function enviar(): Promise<void> {
  const form = document.getElementById('form-reiniciar') as HTMLFormElement | null
  expect(form).toBeTruthy()
  await act(async () => {
    form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
}

const botonesReiniciar = () => [
  ...container.querySelectorAll<HTMLButtonElement>('button[aria-label="Reiniciar contraseña"]')
]

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.mocked(reiniciarContrasena).mockResolvedValue(undefined)
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
    expect(botones).toHaveLength(2)
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
    await enviar()

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
    await enviar()

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
    await enviar()

    await act(async () => {})
    expect(document.body.textContent).toContain('Solo el lider puede desbloquear usuarios.')
    await desmontar()
  })
})
