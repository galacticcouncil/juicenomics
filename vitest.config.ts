import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: { environment: "node", include: ["test/**/*.test.ts"], testTimeout: 120_000 },
  resolve: {
    // node loads the wasm through the package's commonjs build
    alias: {
      "@galacticcouncil/math-stableswap": fileURLToPath(
        new URL("./node_modules/@galacticcouncil/math-stableswap/build/index.cjs", import.meta.url),
      ),
    },
  },
});
