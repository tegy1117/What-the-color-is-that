import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, ROOM_CODE_LENGTH } from "./types";
import { roomCodeSchema, settingsSchema, spyVoteSchema } from "./schemas";

describe("roomCodeSchema", () => {
  it("accepts exactly eight unambiguous characters", () => {
    expect(ROOM_CODE_LENGTH).toBe(8);
    expect(roomCodeSchema.parse("abc23456")).toBe("ABC23456");
    expect(roomCodeSchema.safeParse("ABC234").success).toBe(false);
    expect(roomCodeSchema.safeParse("ABCI2345").success).toBe(false);
    expect(roomCodeSchema.safeParse("ABCO2345").success).toBe(false);
  });
});

describe("mode settings", () => {
  it("accepts the complete default settings and bounded natural numbers", () => {
    expect(settingsSchema.parse(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
    expect(settingsSchema.safeParse({ ...DEFAULT_SETTINGS, spyRounds: 20 }).success).toBe(true);
    expect(settingsSchema.safeParse({ ...DEFAULT_SETTINGS, precisionAttemptSeconds: 5 }).success).toBe(true);
  });

  it("rejects out-of-range mode settings", () => {
    expect(settingsSchema.safeParse({ ...DEFAULT_SETTINGS, spyRounds: 0 }).success).toBe(false);
    expect(settingsSchema.safeParse({ ...DEFAULT_SETTINGS, spyHintSeconds: 301 }).success).toBe(false);
    expect(settingsSchema.safeParse({ ...DEFAULT_SETTINGS, precisionTargetAccuracy: 101 }).success).toBe(false);
    expect(settingsSchema.safeParse({ ...DEFAULT_SETTINGS, precisionMaxAttempts: 21 }).success).toBe(false);
  });

  it("accepts self-targetable participant votes and abstention", () => {
    expect(spyVoteSchema.safeParse({ choice: "abstain" }).success).toBe(true);
    expect(spyVoteSchema.safeParse({ choice: "d9428888-122b-11e1-b85c-61cd3cbb3210" }).success).toBe(true);
    expect(spyVoteSchema.safeParse({ choice: "not-a-player" }).success).toBe(false);
  });
});
