/**
 * Smoke test for the built package. Building is too slow to run per test, so this file only
 * checks an existing `dist/`: run `npm run build` first. CI builds before `npm test`, so the
 * checks are live there.
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { VERSION } from "../src/index.js";

const built = existsSync(new URL("../dist/index.cjs", import.meta.url));

describe.skipIf(!built)(
  built ? "built package" : "built package (skipped: run npm run build first)",
  () => {
    it("the CJS build loads under require", () => {
      const cjs = createRequire(import.meta.url)("../dist/index.cjs") as {
        FraudNova: unknown;
        VERSION: string;
      };
      expect(typeof cjs.FraudNova).toBe("function");
      expect(cjs.VERSION).toBe(VERSION);
      expect(cjs.VERSION).toBe("1.0.0");
    });

    it("the ESM build loads under import", async () => {
      const esm = (await import("../dist/index.js")) as { FraudNova: unknown; VERSION: string };
      expect(typeof esm.FraudNova).toBe("function");
      expect(esm.VERSION).toBe("1.0.0");
    });
  },
);
