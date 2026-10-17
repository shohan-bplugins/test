/*
 * There was no ESLint config in the repo at all, so `npm run lint` fell back to
 * ESLint's defaults — ES5 parsing, no environment — and reported a parse error
 * on every file that uses modern syntax, including the vendored egjs-view3d
 * bundle. A lint that always fails is a lint nobody reads, which is why the
 * script had stopped being useful.
 *
 * Three distinct dialects live in this repo and they need different settings:
 *
 *   app/**            TypeScript + JSX, ES modules, runs on the server and in
 *                     the browser.
 *   extensions/**     Hand-written ES5 for the storefront. Deliberately ES5: it
 *                     ships to whatever browser a shopper brings, unbundled and
 *                     untranspiled.
 *   *.pkgd.min.js     Vendored build output. Never linted.
 */
module.exports = {
  root: true,
  ignorePatterns: [
    "build/",
    ".react-router/",
    "node_modules/",
    // Vendored egjs-view3d + three.js build output.
    "extensions/**/*.min.js",
  ],
  env: { browser: true, es2022: true, node: true },
  parserOptions: { ecmaVersion: 2022, sourceType: "module" },
  extends: ["eslint:recommended"],
  rules: {
    /*
     * `try { ... } catch (e) {}` is a deliberate, repeated idiom here — the
     * teardown and disposal paths (ViewerPreview, the extension's
     * releaseInstance) release several independent resources in a row, and one
     * refusing to release must not stop the rest. There is nothing to log and
     * nothing to recover.
     */
    "no-empty": ["error", { allowEmptyCatch: true }],
    /*
     * Flags a `function` declared inside a block. That was a genuine hazard
     * under ES5 hoisting rules; under ES2015+ block scoping it is well-defined,
     * and it is how several of the loaders here keep a helper next to its only
     * caller.
     */
    "no-inner-declarations": "off",
  },
  overrides: [
    {
      files: ["**/*.ts", "**/*.tsx"],
      parser: "@typescript-eslint/parser",
      plugins: ["@typescript-eslint"],
      extends: [
        "plugin:@typescript-eslint/recommended",
        "plugin:react/recommended",
        "plugin:react-hooks/recommended",
      ],
      settings: { react: { version: "detect" } },
      rules: {
        // The React Router / Vite setup uses the automatic JSX runtime, so React
        // does not have to be in scope and JSX does not have to be "used".
        "react/react-in-jsx-scope": "off",
        "react/jsx-uses-react": "off",
        // Shopify's GraphQL responses are untyped `any` by design here; the code
        // narrows them at the point of use.
        "@typescript-eslint/no-explicit-any": "off",
        "@typescript-eslint/no-unused-vars": [
          "warn",
          { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
        ],
        /*
         * App Bridge augments the real <button> element: inside a <ui-save-bar>
         * the save and discard actions are plain buttons carrying `variant` and
         * `loading`, which App Bridge reads off the DOM node. @shopify/app-bridge-types
         * declares them on React.ButtonHTMLAttributes, so TypeScript accepts
         * them — this rule only knows the stock HTML attribute list and would
         * otherwise reject the documented API.
         */
        "react/no-unknown-property": [
          "error",
          { ignore: ["variant", "loading"] },
        ],
      },
    },
    {
      // Storefront scripts: ES5 on purpose. `var`, no arrow functions, no
      // template literals — the linter should hold that line rather than
      // suggesting syntax an older shopper's browser cannot parse.
      files: ["extensions/**/*.js"],
      /*
       * ES2018 rather than 5, even though the code is written in ES5 style (var,
       * no arrows, string concatenation instead of templates). The one thing it
       * does use beyond ES5 is trailing commas in call arguments, which is
       * ES2017 syntax — under ecmaVersion 5 the parser stops dead on the first
       * one and reports nothing else about the file.
       *
       * The ES5 discipline is a convention, not something a parser version can
       * enforce: this file ships to the storefront unbundled and untranspiled,
       * so it must parse in whatever browser a shopper brings.
       */
      parserOptions: { ecmaVersion: 2018, sourceType: "script" },
      env: { browser: true, node: false },
    },
  ],
};
