import { describe, expect, it } from "vitest";
import {
  calculateAccuracy,
  calculateGuessScore,
  calculatePickerScore,
  calculateRawTime,
  deltaEOK,
  generateCandidateColors,
  scoreGuess,
} from "./color";

describe("color scoring", () => {
  it("awards full accuracy to an exact match", () => {
    expect(deltaEOK("#2A7FFF", "#2A7FFF")).toBe(0);
    expect(calculateAccuracy(0)).toBe(100);
  });

  it("reduces accuracy to zero for very distant colors", () => {
    expect(calculateAccuracy(deltaEOK("#000000", "#FFFFFF"))).toBe(0);
  });

  it("maps perceptual distance to a human-readable similarity percentage", () => {
    expect([0, 10, 20, 40, 100].map(calculateAccuracy)).toEqual([100, 94, 78, 37, 0]);
  });

  it("uses the displayed similarity percentage in round scoring", () => {
    expect(scoreGuess({
      participantId: "p1",
      nickname: "민지",
      color: "#6699CC",
      targetHex: "#336699",
      confirmedAt: null,
      startedAt: 0,
      deadline: 60_000,
    })).toMatchObject({
      accuracy: 84,
      accuracyPoints: 59,
      speedPoints: 0,
      roundScore: 59,
    });
  });

  it("gates speed by accuracy", () => {
    expect(calculateGuessScore(100, 100).roundScore).toBe(100);
    expect(calculateGuessScore(50, 100).roundScore).toBe(50);
    expect(calculateGuessScore(50, 0).roundScore).toBe(35);
  });

  it("gives no time score to an automatic submission", () => {
    expect(calculateRawTime(null, 0, 60_000)).toBe(0);
    expect(scoreGuess({
      participantId: "p1",
      nickname: "민지",
      color: "#336699",
      targetHex: "#336699",
      confirmedAt: null,
      startedAt: 0,
      deadline: 60_000,
    }).speedPoints).toBe(0);
  });

  it("caps the picker score at 150", () => {
    expect(calculatePickerScore([100, 100])).toBe(150);
    expect(calculatePickerScore([60, 80])).toBe(105);
  });

  it("generates four distinct playable candidates", () => {
    let state = 17;
    const random = () => {
      state = (state * 16807) % 2147483647;
      return (state - 1) / 2147483646;
    };
    const colors = generateCandidateColors(random);
    expect(colors).toHaveLength(4);
    for (let index = 0; index < colors.length; index += 1) {
      for (let other = index + 1; other < colors.length; other += 1) {
        expect(deltaEOK(colors[index]!, colors[other]!)).toBeGreaterThanOrEqual(12);
      }
    }
  });
});
