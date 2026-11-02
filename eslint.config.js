import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Apagada a propósito: avisa que Fast Refresh no puede hacer recarga
      // parcial de un archivo que exporta componentes junto con hooks o
      // helpers (los contextos exportan su `useXxx()`, `ui.tsx` su `cn`).
      // Es sólo experiencia de desarrollo —sin efecto en producción— y el
      // patrón Provider + hooks en el mismo archivo es el canónico de React.
      // Dividir los archivos rompería los tests que leen su fuente.
      'react-refresh/only-export-components': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/purity': 'off'
    }
  }
)