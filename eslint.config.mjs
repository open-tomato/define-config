import eslint from '@eslint/js';
import markdown from '@eslint/markdown';
import stylistic from '@stylistic/eslint-plugin';
import * as tsParser from '@typescript-eslint/parser';
import { defineConfig } from 'eslint/config';
import importPlugin from 'eslint-plugin-import';
import jsonc from 'eslint-plugin-jsonc';
import globals from 'globals';
import * as jsoncParser from 'jsonc-eslint-parser';
import { configs as tsLintConfig } from 'typescript-eslint';

import sharedRules from './sharedRules.mjs';

const fenceProcessor = markdown.processors.markdown;

/**
 * The `markdown/markdown` processor, extended to lint the Markdown file
 * itself as well as its fences. The stock processor returns only the
 * fenced blocks, so a `.md` file it runs on is never linted as Markdown
 * and `markdown/recommended` goes silent over it, whether the processor
 * sits in the same config object or in its own. ESLint lints a string
 * block with the file's own config (the `markdown/commonmark` language
 * here), so the whole text goes first and its messages come back
 * unchanged; the fence messages go through the stock `postprocess`,
 * which maps them back onto the file.
 *
 * @type {import("eslint").Linter.Processor} */
const markdownWithFences = {
  meta: { name: 'markdown-with-fences' },
  supportsAutofix: true,
  preprocess: (text, filename) => [text, ...fenceProcessor.preprocess(text, filename)],
  postprocess: ([fileMessages = [], ...fenceMessages], filename) => [
    ...fileMessages,
    ...fenceProcessor.postprocess(fenceMessages, filename),
  ],
};

/**
 * ESLint flat config for this single library package: `src/`, `scripts/`
 * and the root-level files. Copied from the open-tomato/rafa checkout and
 * trimmed to library scope (Node and Bun globals only, one tsconfig).
 *
 * @type {import("eslint").Linter.Config[]} */
export default defineConfig([
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      // Agent-harness prose (vendored skills and agents) is not a lint
      // target.
      '.claude/**',
      // Loop state, gitignored.
      '.rafa/**',
    ],
  },
  importPlugin.flatConfigs.recommended,
  importPlugin.flatConfigs.typescript,
  {
    files: ['**/*.js', '**/*.mjs', '**/*.ts'],
    extends: [
      eslint.configs.recommended,
      tsLintConfig.recommended,
    ],
    plugins: {
      '@stylistic': stylistic,
    },
    languageOptions: {
      globals: {
        ...globals.node,
        Bun: 'readonly',
      },
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: {
      ...sharedRules,
    },
    settings: {
      'import/parsers': {
        '@typescript-eslint/parser': ['.ts', '.d.ts'],
      },
      'import/resolver': {
        typescript: {
          project: ['./tsconfig.json'],
        },
      },
    },
  },
  {
    files: ['**/*.md'],
    plugins: {
      markdown,
    },
    extends: ['markdown/recommended'],
    processor: markdownWithFences,
    rules: {
      'markdown/no-missing-label-refs': 'off',
    },
  },
  {
    // The `ts` and `js` fences of a Markdown file, as virtual children
    // (`README.md/0.ts`, …). The block above already gives them the
    // TypeScript rule set; a fence in any other language matches no
    // config and is not linted.
    files: ['**/*.md/*.ts', '**/*.md/*.js'],
    rules: {
      // The package's own name resolves to `dist/` only after a build,
      // and CI lints before it builds.
      'import/no-unresolved': ['error', { ignore: ['^bun:', '^@open-tomato/define-config$'] }],
    },
    settings: {
      // Without `dist/` the package's own name is unresolved and would
      // sort as external; pin it to internal so the order of a block's
      // imports does not depend on whether a build has run.
      'import/internal-regex': '^@open-tomato/define-config$',
    },
  },
  {
    files: ['**/*.json'],
    languageOptions: {
      parser: jsoncParser,
    },
    plugins: {
      jsonc,
      '@stylistic': stylistic,
    },
    rules: {
      'jsonc/indent': ['error', 2],
      '@stylistic/no-multiple-empty-lines': ['error', { 'max': 0, 'maxEOF': 0 }],
    },
  },
]);
