import baseConfig from '@open-tomato/eslint-config';
import markdownFencesConfig from '@open-tomato/eslint-config/markdown-fences';

/**
 * ESLint flat config: the shared open-tomato base and its Markdown-fences
 * flavor, plus what is this library's own.
 *
 * @type {import("eslint").Linter.Config[]} */
export default [
  ...baseConfig,
  ...markdownFencesConfig,
  {
    files: ['**/*.md'],
    rules: {
      'markdown/no-missing-label-refs': 'off',
    },
  },
  {
    // The package's own name resolves to `dist/` only after a build, and
    // CI lints before it builds.
    files: ['**/*.md/*.ts', '**/*.md/*.js'],
    rules: {
      'import/no-unresolved': ['error', { ignore: ['^bun:', '^@open-tomato/define-config$'] }],
    },
    settings: {
      // Pin the package's own name to internal, so the order of a block's
      // imports does not depend on whether a build has run.
      'import/internal-regex': '^@open-tomato/define-config$',
    },
  },
];
