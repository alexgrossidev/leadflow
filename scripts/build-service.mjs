// Bundles one service into a single `dist/main.js`.
//
// Workspace packages (@leadflow/*) are compiled into the bundle straight from
// their TypeScript sources (the "development" export condition), so a service
// image never needs the packages pre-built. Third-party dependencies stay
// external and are resolved from node_modules at runtime.
//
// Usage (from a service directory): node ../../scripts/build-service.mjs src/app.ts
import { build } from "esbuild";
import { readFileSync } from "node:fs";

const entry = process.argv[2];
if (!entry) {
  console.error("usage: build-service.mjs <entry.ts>");
  process.exit(1);
}

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const isEsm = pkg.type === "module";

const externalizeThirdParty = {
  name: "externalize-third-party",
  setup(b) {
    // Bare specifiers that are not workspace packages or `#` subpath imports.
    b.onResolve({ filter: /^[^./#]/ }, (args) =>
      args.path.startsWith("@leadflow/") ? undefined : { path: args.path, external: true },
    );
  },
};

try {
  await build({
    entryPoints: [entry],
    outfile: "dist/main.js",
    bundle: true,
    platform: "node",
    target: "node22",
    format: isEsm ? "esm" : "cjs",
    conditions: ["development"],
    sourcemap: true,
    plugins: [externalizeThirdParty],
    logLevel: "info",
  });
} catch {
  // esbuild has already printed the diagnostics.
  process.exit(1);
}
