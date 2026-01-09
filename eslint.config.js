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
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        Buffer: 'readonly',
        NodeJS: 'readonly',
        describe: 'readonly',
        it: 'readonly',
        suite: 'readonly',
        test: 'readonly'
      }
    },
    rules: {
      // Updated rules to match what's available in the new version
      ...typescript.configs.recommended.rules,
      '@typescript-eslint/naming-convention': 'off',
      'semi': 'off',
      'curly': 'off',
      'eqeqeq': 'warn',
      'no-throw-literal': 'warn',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      'no-empty': 'off',
      'no-unreachable': 'off'
    }
  },
  {
    ignores: ['out/**', 'dist/**', '**/*.d.ts']
  }
];