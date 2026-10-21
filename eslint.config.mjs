// Root flat config: TypeScript rules for the API and shared packages.
// apps/mobile and apps/dashboard carry their own framework configs.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**', '**/dist/**', '**/.next/**', '**/.expo/**',
      '.scratch/**', 'services/ai/**', 'apps/mobile/**', 'apps/dashboard/**',
      '**/*.config.js', '**/*.config.cjs',
      'services/api/src/generated/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['**/*.{js,mjs,ts}'], languageOptions: { globals: { ...globals.node } } },
  // CommonJS helpers (e.g. Jest global setup) use require/module.exports by design.
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
);
