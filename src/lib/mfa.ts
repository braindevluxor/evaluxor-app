import { supabase } from './supabase'
import { limpiarMfaCache } from './mfaEstado'

export interface FactorTotp {
  id: string
  friendlyName: string | null
  createdAt: string
}

export async function factorsTotpActivos(): Promise<FactorTotp[]> {
  const { data, error } = await supabase.auth.mfa.listFactors()
  if (error) return []
  const all = data?.all ?? []
  return all
    .filter((f) => f.factor_type === 'totp' && f.status === 'verified')
    .map((f) => ({ id: f.id, friendlyName: f.friendly_name ?? null, createdAt: f.created_at }))
}

export async function iniciarConfigTotp(): Promise<{ factorId: string; secret: string; qr: string; uri: string }> {
  // Sólo puede existir UN factor llamado 'EvaLuxor': si ya está, enrollar
  // otro tira "A factor with the friendly name ... already exists". Dos
  // casos posibles:
  //  - VERIFICADA: ya está activa y no hay nada que configurar (la caché
  //    de estado decía lo contrario: se limpia antes de avisar);
  //  - SIN VERIFICAR: se abandonó el QR de un intento anterior. El secreto
  //    viejo no se puede recuperar, así que se borra el factor y se
  //    inscribe uno nuevo con su QR.
  const { data: listado, error: errListados } = await supabase.auth.mfa.listFactors()
  if (errListados) throw new Error(mensajeTotp(errListados.message))
  const existente = (listado?.all ?? []).find(
    (f) => f.factor_type === 'totp' && (f.friendly_name ?? '') === 'EvaLuxor'
  )
  if (existente) {
    if (existente.status === 'verified') {
      limpiarMfaCache()
      throw new Error('La verificación en dos pasos ya está activa en esta cuenta.')
    }
    const { error: errBorrar } = await supabase.auth.mfa.unenroll({ factorId: existente.id })
    if (errBorrar) throw new Error(mensajeTotp(errBorrar.message))
  }

  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'EvaLuxor' })
  if (error) throw new Error(mensajeTotp(error.message))
  const qr = data.totp.qr_code.startsWith('data:')
    ? data.totp.qr_code
    : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(data.totp.qr_code)}`
  return { factorId: data.id, secret: data.totp.secret, qr, uri: data.totp.uri }
}

export async function confirmarConfigTotp(factorId: string, code: string): Promise<void> {
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code })
  if (error) {
    throw new Error('El código no es válido. Verifica que esté sincronizado o vuelve a escanear el QR.')
  }
  // La cuenta pasó a tener TOTP verificado: el estado cacheado dice lo contrario.
  limpiarMfaCache()
}

export async function desactivarTotp(code: string): Promise<void> {
  const activos = await factorsTotpActivos()
  const factor = activos[0]
  if (!factor) throw new Error('No hay verificación en dos pasos activa.')
  const { error: verr } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code })
  if (verr) throw new Error('El código no es válido o expiró.')
  const { error } = await supabase.auth.mfa.unenroll({ factorId: factor.id })
  if (error) throw new Error(mensajeTotp(error.message))
  // Ya no hay MFA en esta cuenta: la caché seguiría pidiendo TOTP.
  limpiarMfaCache()
}

function mensajeTotp(msg: string): string {
  const m = (msg || '').toLowerCase()
  if (
    m.includes('not enabled') ||
    m.includes('invalid jwt') ||
    m.includes('apikey') ||
    m.includes('not found') ||
    m.includes('88 character')
  ) {
    return 'Tu proyecto de Supabase aún no tiene habilitado el TOTP. Usa la Anon Key nueva (sb_publishable_...) y verifica que MFA TOTP esté activo.'
  }
  if (m.includes('aal')) return 'Vuelve a iniciar sesión para cambiar esta opción de seguridad.'
  return msg
}