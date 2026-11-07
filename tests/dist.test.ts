/**
 * Smoke test for the built package. Building is too slow to run per test, so this file only
 * checks an existing `dist/`: run `npm run build` first. CI builds before `npm test`, so the
 * checks are live there. The ESM build is loaded through a computed specifier so that
 * `npm run typecheck` still passes on a fresh checkout without `dist/`.
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { VERSION } from "../src/version.js";

const cjsUrl = new URL("../dist/index.cjs", import.meta.url);
const esmUrl = new URL("../dist/index.js", import.meta.url);
const built = existsSync(cjsUrl) && existsSync(esmUrl);

function exportsOf(mod: unknown): { FraudNova: unknown; VERSION: unknown } {
  if (typeof mod !== "object" || mod === null) throw new Error("module did not load");
  const record = mod as Record<string, unknown>;
  return { FraudNova: record.FraudNova, VERSION: record.VERSION };
}

describe.skipIf(!built)(
  built ? "built package" : "built package (skipped: run npm run build first)",
  () => {
    it("the CJS build loads under require", () => {
      const cjs = exportsOf(createRequire(import.meta.url)(fileURLToPath(cjsUrl)));
      expect(typeof cjs.FraudNova).toBe("function");
      expect(cjs.VERSION).toBe(VERSION);
    });

    it("the ESM build loads under import", async () => {
      const esm = exportsOf(await import(/* @vite-ignore */ esmUrl.href));
      expect(typeof esm.FraudNova).toBe("function");
      expect(esm.VERSION).toBe(VERSION);
    });
  },
);
