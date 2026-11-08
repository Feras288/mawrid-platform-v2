import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/.next/**", "**/dist/**", "**/coverage/**", "**/playwright-report/**", "**/test-results/**", "**/migrations/**", "**/next-env.d.ts"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "error",
      "no-console": ["warn", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "always", { null: "ignore" }],
    },
  },
  {
    // Module boundaries: other modules are only reachable through their public index.
    files: ["packages/modules/src/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [{ group: ["../*/*", "!../*/index"], message: "Import another module only via its public index (../<module>)." }] }],
    },
  },
  {
    files: ["apps/web/**/*.tsx", "apps/web/**/*.ts"],
    plugins: { "react-hooks": reactHooks },
    rules: { "react-hooks/rules-of-hooks": "error", "react-hooks/exhaustive-deps": "warn" },
  },
  {
    files: ["**/cli/**/*.ts", "scripts/**/*.ts", "apps/worker/**/*.ts", "tests/**/*.ts", "**/test/**/*.ts", "**/e2e/**/*.ts"],
    rules: { "no-console": "off" },
  },
);
