import { Jimp } from "jimp";

const ESC = String.fromCharCode(27);

type RGBA = [number, number, number, number];

export interface HalfBlockOptions {
  /** Target width in terminal columns; height auto-scales to keep aspect ratio. */
  maxCols?: number;
  /**
   * Drop near-white background to transparent: any pixel whose R,G,B are all ≥ this value (and
   * which isn't strongly colored) becomes transparent, so a white photo backdrop falls through to
   * the terminal background instead of rendering as white blocks. 0/undefined disables it.
   */
  bgThreshold?: number;
}

/**
 * Render an image as "half-block" text: each character cell is `▀` whose foreground is the top
 * pixel and background is the bottom pixel — so one text row encodes two pixel rows. Each returned
 * line is a string with embedded truecolor ANSI escapes, ready to drop into an Ink <Text>.
 * Transparent pixels (and dropped white background) fall through to the terminal background.
 */
export async function renderImageHalfBlocks(file: string, opts: HalfBlockOptions = {}): Promise<string[]> {
  const maxCols = opts.maxCols ?? 18;
  const bg = opts.bgThreshold ?? 0;
  const img = await Jimp.read(file);
  img.resize({ w: maxCols }); // height auto-scales to keep aspect ratio
  const { width, height, data } = img.bitmap;

  const at = (x: number, y: number): RGBA => {
    if (y >= height) return [0, 0, 0, 0];
    const i = (y * width + x) * 4;
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    let a = data[i + 3] ?? 0;
    // White-ish background → transparent. Require all channels bright AND near-neutral (so we don't
    // erase bright-but-colored areas like a yellow face): max-min channel spread must be small.
    if (bg > 0 && a >= 32 && r >= bg && g >= bg && b >= bg) {
      const spread = Math.max(r, g, b) - Math.min(r, g, b);
      if (spread <= 24) a = 0;
    }
    return [r, g, b, a];
  };

  const lines: string[] = [];
  for (let r = 0; r < Math.ceil(height / 2); r++) {
    let line = "";
    for (let x = 0; x < width; x++) {
      const [tr, tg, tb, ta] = at(x, r * 2);
      const [br, bg2, bb, ba] = at(x, r * 2 + 1);
      if (ta < 32 && ba < 32) {
        line += " ";
      } else if (ba < 32) {
        line += `${ESC}[38;2;${tr};${tg};${tb}m▀${ESC}[0m`;
      } else if (ta < 32) {
        line += `${ESC}[38;2;${br};${bg2};${bb}m▄${ESC}[0m`;
      } else {
        line += `${ESC}[38;2;${tr};${tg};${tb}m${ESC}[48;2;${br};${bg2};${bb}m▀${ESC}[0m`;
      }
    }
    lines.push(line);
  }
  return lines;
}
