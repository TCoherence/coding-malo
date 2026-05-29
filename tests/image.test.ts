import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { Jimp } from "jimp";
import { afterEach, describe, expect, it } from "vitest";

import { renderImageHalfBlocks } from "../src/ui/image";

let p = "";
afterEach(() => {
  if (p && fs.existsSync(p)) fs.rmSync(p);
});

describe("renderImageHalfBlocks", () => {
  it("renders an image into half-block lines (2 px per text row)", async () => {
    p = path.join(os.tmpdir(), `omcb-img-${process.pid}.png`);
    const img = new Jimp({ width: 8, height: 8, color: 0xff8800ff });
    await img.write(p as `${string}.png`);
    const lines = await renderImageHalfBlocks(p, 8);
    expect(lines).toHaveLength(4); // 8 px tall → 4 rows of ▀
    expect(lines.every((l) => l.includes("▀"))).toBe(true);
  });

  it("scales the width down to maxCols", async () => {
    p = path.join(os.tmpdir(), `omcb-img2-${process.pid}.png`);
    const img = new Jimp({ width: 40, height: 40, color: 0x00ff00ff });
    await img.write(p as `${string}.png`);
    const lines = await renderImageHalfBlocks(p, 10);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.length).toBeLessThanOrEqual(6); // ~10px tall → ~5 rows
  });
});
