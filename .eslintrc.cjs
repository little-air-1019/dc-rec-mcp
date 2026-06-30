// ESLint config for the dc-rec-mcp project.
// Scoped to src/ only — Craig's apps/, cook/, and scripts/ are read-only
// reference and are not linted by this project.
module.exports = {
  root: true,
  ignorePatterns: ['node_modules', 'dist', 'apps', 'cook', 'scripts', '*.js', '*.cjs'],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module'
  },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: {
    node: true,
    es2020: true
  },
  rules: {
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
  }
};
