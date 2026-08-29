import { defineConfig, globalIgnores } from 'eslint/config';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

/**
 * Lint rules that encode CLAUDE.md. The architecture boundaries in §2.1 are also
 * asserted by tests/architecture/*.test.ts — lint catches them in the editor, the
 * tests catch them in CI. Neither is redundant.
 */
export default defineConfig([
  globalIgnores(['dist/**', 'node_modules/**', '**/*.fixture']),

  {
    files: ['**/*.ts', '**/*.js'],
    extends: [
      js.configs.recommended,
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
      prettier,
    ],
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['eslint.config.js'] },
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.browser },
    },
    rules: {
      // CLAUDE.md §3.1 — the bans that keep the type system honest.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-ignore': true, 'ts-expect-error': 'allow-with-description' },
      ],
      '@typescript-eslint/consistent-type-definitions': 'off',

      // CLAUDE.md §5.2 — nesting and function shape.
      'max-depth': ['error', 2],
      'max-params': ['error', 3],
    },
  },

  {
    // CLAUDE.md §2.1 — /sim is pure: no Phaser, no rendering layers, no ambient
    // clock or randomness. GDD §20.1 calls this non-negotiable.
    files: ['src/sim/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['phaser', 'phaser/*', '**/ui/**', '**/scenes/**', '**/run/**'],
              message: 'CLAUDE.md §2.1: /sim must not import Phaser or any rendering/run layer.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: 'CLAUDE.md §2.1: /sim has no wall clock. Use Tick (GDD §2 P6).' },
        { name: 'performance', message: 'CLAUDE.md §2.1: /sim has no wall clock.' },
        { name: 'setTimeout', message: 'CLAUDE.md §2.1: /sim has no wall clock.' },
        { name: 'setInterval', message: 'CLAUDE.md §2.1: /sim has no wall clock.' },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'CLAUDE.md §4.5: randomness is injected as Rng, never ambient.',
        },
        { object: 'Date', property: 'now', message: 'CLAUDE.md §2.1: /sim has no wall clock.' },
      ],
    },
  },

  {
    files: ['tests/**/*.ts', 'src/sim-harness/**/*.ts', '*.config.ts', 'eslint.config.js'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      // The architecture guards deliberately name the things they forbid.
      'no-restricted-globals': 'off',
      'no-restricted-properties': 'off',
    },
  },
]);
