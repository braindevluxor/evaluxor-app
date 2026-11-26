import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error('Falta VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY en el entorno.')
}

export const supabase = createClient(url, anonKey)

/**
 * Un cliente NUEVO con su propia memoria de sesión.
 *
 * Sirve para llamar a `signUp` desde ADENTRO de la sesión del Líder: el alta
 * de una cuenta crea sesión para el usuario nuevo, y en el cliente principal
 * eso dejaría deslogueado a quien la está creando. Éste no persiste nada ni
 * refresca solo: la sesión nacida acá se descarta apenas se usa.
 */
export function crearClienteAislado(): ReturnType<typeof createClient> {
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  })
}