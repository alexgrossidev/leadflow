import tseslint from "typescript-eslint";
import { createRequire } from 'module';

var require = createRequire(import.meta.url);
var module = { exports: {} };

export default tseslint.config({
  files: ["src/**/*.ts", "scripts/**/*.ts"],
  plugins: { "@typescript-eslint": tseslint.plugin },
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: {
      project: true,
      tsconfigRootDir: import.meta.dirname,
    },
  },
  rules: {
    "@typescript-eslint/no-floating-promises": "error",
  },
});
