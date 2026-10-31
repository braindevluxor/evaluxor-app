import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { MemoryRouter } from 'react-router-dom'
import { LoginPage } from './LoginPage'

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

/**
 * El acceso tiene tres caras —recuperación, TOTP y login— y este test cubre el
 * aspecto de cada una. La autenticación se mockea entera: acá no se prueba la
 * red, se prueba qué se pinta.
 */
const auth = vi.hoisted(() => ({
  estado: { recuperando: false, totpPendiente: false } as { recuperando: boolean; totpPendiente: boolean }
}))

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    session: null,
    profile: null,
    loading: false,
    perfilListo: true,
    totpPendiente: auth.estado.totpPendiente,
    recuperando: auth.estado.recuperando,
    signIn: async () => ({}),
    signUp: async () => ({}),
    signOut: async () => {},
    refreshProfile: async () => {},
    updateNombre: async () => {},
    cambiarPassword: async () => ({}),
    verificarTotp: async () => ({}),
    recuperarAcceso: async () => ({}),
    definirNuevaContrasena: async () => ({})
  })
}))

function pintar(): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>
  )
}

describe('LoginPage · el aspecto del ingreso', () => {
  it('abre con Bienvenido y su bajada, como en el diseño', () => {
    const html = pintar()
    expect(html).toContain('Bienvenido')
    expect(html).toContain('Ingresa a tu cuenta para continuar')
  })

  it('el campo es de correo con su placeholder, y acepta el usuario también', () => {
    const html = pintar()
    expect(html).toContain('Correo electrónico')
    expect(html).toContain('tu@email.com')

    // Las dos formas de identidad en el mismo campo: el correo es la de
    // Supabase y el usuario es su alias de la casa.
    const src = fuente('./LoginPage.tsx')
    expect(src).toContain('autoComplete="username"')
    expect(src).toContain('inputMode="email"')
  })

  it('la contraseña lleva el enlace de recuperación en su renglón y el ojo para verla', () => {
    const html = pintar()
    expect(html).toContain('¿Olvidaste tu contraseña?')
    expect(html).toContain('aria-label="Mostrar contraseña"')
    expect(html).toContain('Recordarme')
    expect(html).toContain('Iniciar sesión')
  })
})

describe('LoginPage · las otras caras', () => {
  it('con el enlace de recuperación abierto pide la contraseña nueva y esconde el login', () => {
    auth.estado.recuperando = true
    const html = pintar()
    expect(html).toContain('Nueva contraseña')
    expect(html).toContain('Elegí una contraseña nueva para tu cuenta.')
    expect(html).toContain('Guardar contraseña')
    expect(html).not.toContain('Iniciar sesión')
    auth.estado.recuperando = false
  })

  it('el paso de dos factores sigue pidiendo el código', () => {
    auth.estado.totpPendiente = true
    const html = pintar()
    expect(html).toContain('Verificación en dos pasos')
    expect(html).toContain('Código')
    auth.estado.totpPendiente = false
  })
})
