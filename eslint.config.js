import js from "@eslint/js";
import globals from "globals";
export default [
  {
    ignores: ["data/**", "dist/**", "assets/projection.js", "node_modules/**"],
  },
  js.configs.recommended,
  { files: ["*.js"], languageOptions: { globals: globals.browser } },
  {
    files: ["scripts/*.mjs", "tests/*.mjs", "eslint.config.js"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
