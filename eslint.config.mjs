import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      complexity: ['error', 10],
    },
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@src/*'],
              message:
                'The @src alias is for tests. tsc does not rewrite it on emit, so an import through it inside src/ builds and then fails at container start.',
            },
          ],
        },
      ],
    },
  },
);
