import typescript from '@typescript-eslint/eslint-plugin';
import typescriptParser from '@typescript-eslint/parser';
import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
    files: ['**/*.ts'],
    plugins: {
      '@typescript-eslint': typescript
    },
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module'
      }
    },
    rules: {
      // Updated rules to match what's available in the new version
      '@typescript-eslint/naming-convention': 'warn',
      'semi': 'off',
      'curly': 'warn',
      'eqeqeq': 'warn',
      'no-throw-literal': 'warn',
      ...typescript.configs.recommended.rules
    }
  },
  {
    ignores: ['out/**', 'dist/**', '**/*.d.ts']
  }
];