import { defineConfig } from "tsup"

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/brain.ts",
    "src/router.ts",
    "src/temperature.ts",
    "src/ensemble.ts",
    "src/cache.ts",
    "src/prompter.ts",
  ],
  format: ["esm", "cjs"],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  minify: false,
})