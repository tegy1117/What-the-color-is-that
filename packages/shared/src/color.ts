import type { GuessResult } from "./types";

interface Rgb {
  r: number;
  g: number;
  b: number;
}

interface Oklab {
  l: number;
  a: number;
  b: number;
}

const clamp = (value: number, minimum = 0, maximum = 1) =>
  Math.min(maximum, Math.max(minimum, value));

const srgbToLinear = (channel: number) =>
  channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;

const linearToSrgb = (channel: number) =>
  channel <= 0.0031308
    ? 12.92 * channel
    : 1.055 * channel ** (1 / 2.4) - 0.055;

export function hexToRgb(hex: string): Rgb {
  const normalized = hex.replace("#", "");
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16) / 255,
    g: Number.parseInt(normalized.slice(2, 4), 16) / 255,
    b: Number.parseInt(normalized.slice(4, 6), 16) / 255,
  };
}

export function rgbToHex(rgb: Rgb): string {
  const toHex = (channel: number) =>
    Math.round(clamp(channel) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`.toUpperCase();
}

export function rgbToOklab(rgb: Rgb): Oklab {
  const red = srgbToLinear(rgb.r);
  const green = srgbToLinear(rgb.g);
  const blue = srgbToLinear(rgb.b);
  const l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
  const m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
  const s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

function oklabToRgb(lab: Oklab): Rgb {
  const lRoot = lab.l + 0.3963377774 * lab.a + 0.2158037573 * lab.b;
  const mRoot = lab.l - 0.1055613458 * lab.a - 0.0638541728 * lab.b;
  const sRoot = lab.l - 0.0894841775 * lab.a - 1.291485548 * lab.b;
  const l = lRoot ** 3;
  const m = mRoot ** 3;
  const s = sRoot ** 3;
  return {
    r: linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  };
}

function oklchToHex(lightness: number, chroma: number, hue: number): string {
  const radians = (hue * Math.PI) / 180;
  let fittedChroma = chroma;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const rgb = oklabToRgb({
      l: lightness,
      a: fittedChroma * Math.cos(radians),
      b: fittedChroma * Math.sin(radians),
    });
    if ([rgb.r, rgb.g, rgb.b].every((channel) => channel >= 0 && channel <= 1)) {
      return rgbToHex(rgb);
    }
    fittedChroma *= 0.94;
  }
  return rgbToHex(oklabToRgb({ l: lightness, a: 0, b: 0 }));
}

export function deltaEOK(firstHex: string, secondHex: string): number {
  const first = rgbToOklab(hexToRgb(firstHex));
  const second = rgbToOklab(hexToRgb(secondHex));
  return (
    Math.sqrt(
      (first.l - second.l) ** 2 +
        (first.a - second.a) ** 2 +
        (first.b - second.b) ** 2,
    ) * 100
  );
}

export function calculateAccuracy(deltaE: number): number {
  const similarity = Math.max(0, 1 - deltaE / 50);
  return Math.round(100 * similarity ** 2);
}

export function calculateRawTime(
  submittedAt: number | null,
  startedAt: number,
  deadline: number,
): number {
  if (submittedAt === null || deadline <= startedAt) return 0;
  const remaining = clamp((deadline - submittedAt) / (deadline - startedAt));
  return Math.round(remaining * 100);
}

export function calculateGuessScore(accuracy: number, rawTime: number) {
  const effectiveSpeed = (rawTime * accuracy) / 100;
  const accuracyPoints = Math.round(accuracy * 0.7);
  const speedPoints = Math.round(effectiveSpeed * 0.3);
  return {
    effectiveSpeed,
    accuracyPoints,
    speedPoints,
    roundScore: Math.min(100, Math.round(accuracy * 0.7 + effectiveSpeed * 0.3)),
  };
}

export function calculatePickerScore(accuracies: number[]): number {
  if (accuracies.length === 0) return 0;
  const average = accuracies.reduce((total, value) => total + value, 0) / accuracies.length;
  return Math.min(150, Math.round(average * 1.5));
}

export function scoreGuess(input: {
  participantId: string;
  nickname: string;
  color: string;
  targetHex: string;
  confirmedAt: number | null;
  startedAt: number;
  deadline: number;
}): GuessResult {
  const deltaE = deltaEOK(input.color, input.targetHex);
  const accuracy = calculateAccuracy(deltaE);
  const rawTime = calculateRawTime(input.confirmedAt, input.startedAt, input.deadline);
  const score = calculateGuessScore(accuracy, rawTime);
  return {
    participantId: input.participantId,
    nickname: input.nickname,
    color: input.color,
    confirmed: true,
    deltaE: Math.round(deltaE * 10) / 10,
    accuracy,
    rawTime,
    accuracyPoints: score.accuracyPoints,
    speedPoints: score.speedPoints,
    roundScore: score.roundScore,
    autoSubmitted: input.confirmedAt === null,
  };
}

export function generateCandidateColors(random: () => number = Math.random): string[] {
  const colors: string[] = [];
  const ranges = [
    [0.05, 0.12],
    [0.05, 0.12],
    [0.13, 0.24],
    [0.13, 0.24],
  ] as const;

  for (const [minimumChroma, maximumChroma] of ranges) {
    let candidate = "#808080";
    for (let attempt = 0; attempt < 240; attempt += 1) {
      const lightness = 0.38 + random() * 0.44;
      const chroma = minimumChroma + random() * (maximumChroma - minimumChroma);
      const hue = random() * 360;
      candidate = oklchToHex(lightness, chroma, hue);
      if (colors.every((color) => deltaEOK(color, candidate) >= 12)) break;
    }
    colors.push(candidate);
  }
  return colors;
}

