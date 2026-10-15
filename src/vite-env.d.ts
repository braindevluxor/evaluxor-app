/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_PRECIOS_API_KEY: string
  readonly VITE_VEHICLES_API_KEY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// Inyectadas por vite.config.ts (ver `define`): identidad de esta build.
declare const __APP_VERSION__: string
declare const __BUILD_ID__: string
declare const __BUILD_FECHA__: string