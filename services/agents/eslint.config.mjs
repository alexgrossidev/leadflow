import tseslint from "typescript-eslint";

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
