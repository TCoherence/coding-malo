import { Jimp } from "jimp";

const ESC = String.fromCharCode(27);

type RGBA = [number, number, number, number];

/**
 * Render an image as "half-block" text: each character cell is `▀` whose foreground is the top
 * pixel and background is the bottom pixel — so one text row encodes two pixel rows. Each returned
 * line is a string with embedded truecolor ANSI escapes, ready to drop into an Ink <Text>.
 * Transparent pixels fall through to the terminal background.
 */
export async function renderImageHalfBlocks(path: string, maxCols = 18): Promise<string[]> {
  const img = await Jimp.read(path);
  img.resize({ w: maxCols }); // height auto-scales to keep aspect ratio
  const { width, height, data } = img.bitmap;

  const at = (x: number, y: number): RGBA => {
    if (y >= height) return [0, 0, 0, 0];
    const i = (y * width + x) * 4;
    return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0, data[i + 3] ?? 0];
  };

  const lines: string[] = [];
  for (let r = 0; r < Math.ceil(height / 2); r++) {
    let line = "";
    for (let x = 0; x < width; x++) {
      const [tr, tg, tb, ta] = at(x, r * 2);
      const [br, bg, bb, ba] = at(x, r * 2 + 1);
      if (ta < 32 && ba < 32) {
        line += " ";
      } else if (ba < 32) {
        line += `${ESC}[38;2;${tr};${tg};${tb}m▀${ESC}[0m`;
      } else if (ta < 32) {
        line += `${ESC}[38;2;${br};${bg};${bb}m▄${ESC}[0m`;
      } else {
        line += `${ESC}[38;2;${tr};${tg};${tb}m${ESC}[48;2;${br};${bg};${bb}m▀${ESC}[0m`;
      }
    }
    lines.push(line);
  }
  return lines;
}
