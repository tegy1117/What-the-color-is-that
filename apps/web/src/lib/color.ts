export interface HsvColor {
  h: number;
  s: number;
  v: number;
}

export function hsvToHex({ h, s, v }: HsvColor): string {
  const saturation = s / 100;
  const value = v / 100;
  const chroma = value * saturation;
  const section = (((h % 360) + 360) % 360) / 60;
  const x = chroma * (1 - Math.abs((section % 2) - 1));
  const [r1, g1, b1] = section < 1
    ? [chroma, x, 0]
    : section < 2
      ? [x, chroma, 0]
      : section < 3
        ? [0, chroma, x]
        : section < 4
          ? [0, x, chroma]
          : section < 5
            ? [x, 0, chroma]
            : [chroma, 0, x];
  const match = value - chroma;
  const channel = (number: number) => Math.round((number + match) * 255).toString(16).padStart(2, "0");
  return `#${channel(r1)}${channel(g1)}${channel(b1)}`.toUpperCase();
}

export function hexToHsv(hex: string): HsvColor {
  const value = hex.replace("#", "");
  const red = Number.parseInt(value.slice(0, 2), 16) / 255;
  const green = Number.parseInt(value.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(value.slice(4, 6), 16) / 255;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const delta = maximum - minimum;
  let hue = 0;
  if (delta !== 0) {
    if (maximum === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (maximum === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }
  return {
    h: (hue + 360) % 360,
    s: maximum === 0 ? 0 : (delta / maximum) * 100,
    v: maximum * 100,
  };
}

