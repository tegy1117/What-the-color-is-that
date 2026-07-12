import { describe, expect, it } from "vitest";
import { ROOM_CODE_LENGTH } from "./types";
import { roomCodeSchema } from "./schemas";

describe("roomCodeSchema", () => {
  it("accepts exactly eight unambiguous characters", () => {
    expect(ROOM_CODE_LENGTH).toBe(8);
    expect(roomCodeSchema.parse("abc23456")).toBe("ABC23456");
    expect(roomCodeSchema.safeParse("ABC234").success).toBe(false);
    expect(roomCodeSchema.safeParse("ABCI2345").success).toBe(false);
    expect(roomCodeSchema.safeParse("ABCO2345").success).toBe(false);
  });
});
