import js from '@eslint/js';
export default [
  js.configs.recommended,
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        window:'readonly', document:'readonly', console:'readonly', localStorage:'readonly', sessionStorage:'readonly',
        setTimeout:'readonly', clearTimeout:'readonly', setInterval:'readonly', clearInterval:'readonly',
        requestAnimationFrame:'readonly', cancelAnimationFrame:'readonly', matchMedia:'readonly',
        alert:'readonly', confirm:'readonly', crypto:'readonly', Image:'readonly', URL:'readonly', Blob:'readonly', navigator:'readonly',
        queueMicrotask:'readonly', performance:'readonly', firebase:'readonly', QRCode:'readonly',
      },
    },
    // The point of linting here is no-undef: it proves nothing is left dangling
    // across a module boundary. Stylistic rules are off so the refactor does not
    // start rewriting the original author's code.
    rules: {
      'no-undef': 'error',
      'no-unused-vars': 'off',
      'no-empty': 'off',
      'no-useless-escape': 'off',
      'no-cond-assign': 'off',
    },
  },
];
