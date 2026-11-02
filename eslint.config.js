import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist', '**/coverage', '**/node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // Core must run on Node, browsers and Hermes (Expo): no Node modules, no APIs Hermes lacks.
    files: ['packages/gbfs-core/src/**/*.ts'],
    languageOptions: { globals: {} },
    rules: {
      'no-restricted-imports': ['error', { patterns: ['node:*'] }],
      'no-restricted-globals': [
        'error',
        { name: 'structuredClone', message: 'Not available on Hermes.' },
        { name: 'TextDecoder', message: 'Not available on Hermes.' },
        { name: 'process', message: 'Core is runtime-agnostic.' },
        { name: 'Buffer', message: 'Core is runtime-agnostic.' },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'AbortSignal',
          property: 'timeout',
          message: 'Use setTimeout + AbortController.',
        },
        { object: 'AbortSignal', property: 'any', message: 'Not available on Hermes.' },
      ],
    },
  },
  {
    // stdout carries MCP protocol messages only.
    files: ['apps/mcp/src/**/*.ts'],
    rules: { 'no-console': ['error', { allow: ['error'] }] },
  },
);
