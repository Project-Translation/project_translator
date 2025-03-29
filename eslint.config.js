const typescript = require('@typescript-eslint/eslint-plugin');
const typescriptParser = require('@typescript-eslint/parser');
const js = require('@eslint/js');

module.exports = [
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