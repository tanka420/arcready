import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    bin: "src/bin.ts",
    "prevrandao-analysis": "rules/shared/prevrandao-analysis.ts"
  },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  external: ["typescript", "@solidity-parser/parser"]
});
