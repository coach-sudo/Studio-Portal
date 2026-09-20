import eslint from "@eslint/js";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

const asWarnings = (rules = {}) =>
  Object.fromEntries(
    Object.entries(rules).map(([name, setting]) => [
      name,
      Array.isArray(setting) ? ["warn", ...setting.slice(1)] : "warn",
    ]),
  );

const typescriptWarnings = Object.assign(
  {},
  ...tseslint.configs.recommended.map((config) => asWarnings(config.rules)),
);

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      ".netlify/**",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
      "src/types/database.generated.ts",
      "*.tsbuildinfo",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs}"],
    rules: asWarnings(eslint.configs.recommended.rules),
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        ...globals.browser,
        ...globals.node,
        Netlify: "readonly",
      },
    },
    plugins: {
      "jsx-a11y": jsxA11y,
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      "no-unused-vars": "off",
      ...asWarnings(eslint.configs.recommended.rules),
      ...typescriptWarnings,
      ...asWarnings(jsxA11y.configs.recommended.rules),
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },
  {
    files: ["**/*.test.{ts,tsx}", "e2e/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "react-hooks/rules-of-hooks": "off",
    },
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-unused-expressions": "off",
      "@typescript-eslint/no-require-imports": "off",
    },
  },
);
