import { z } from "zod";
import { CYCLE_OPTIONS, TIME_OPTIONS } from "./types";

const visibleText = (minimum: number, maximum: number) =>
  z
    .string()
    .trim()
    .refine((value) => Array.from(value).length >= minimum, "too_short")
    .refine((value) => Array.from(value).length <= maximum, "too_long")
    .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value), "control_character");

export const nicknameSchema = visibleText(1, 12);
export const hintSchema = visibleText(1, 80);
export const hexColorSchema = z
  .string()
  .regex(/^#[0-9a-f]{6}$/iu)
  .transform((value) => value.toUpperCase());

export const roomCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-HJ-NP-Z2-9]{6}$/u);

export const participantRoleSchema = z.enum(["player", "spectator"]);
export const localeSchema = z.enum(["ko", "en"]);

export const createRoomSchema = z.object({
  nickname: nicknameSchema,
  role: participantRoleSchema,
});

export const joinRoomSchema = createRoomSchema.extend({
  roomCode: roomCodeSchema,
});

export const sessionResumeSchema = z.object({
  roomCode: roomCodeSchema,
  token: z.string().min(20).max(128),
});

export const settingsSchema = z.object({
  guessSeconds: z.union(TIME_OPTIONS.map((value) => z.literal(value)) as [z.ZodLiteral<30>, z.ZodLiteral<45>, z.ZodLiteral<60>, z.ZodLiteral<90>]),
  pickerSeconds: z.union(TIME_OPTIONS.map((value) => z.literal(value)) as [z.ZodLiteral<30>, z.ZodLiteral<45>, z.ZodLiteral<60>, z.ZodLiteral<90>]),
  cycles: z.union(CYCLE_OPTIONS.map((value) => z.literal(value)) as [z.ZodLiteral<1>, z.ZodLiteral<2>, z.ZodLiteral<3>]),
});

export const pickerSubmitSchema = z.object({
  targetHex: hexColorSchema,
  hint: hintSchema,
});

export const guessSchema = z.object({
  color: hexColorSchema,
});

export const revealPauseSchema = z.object({
  paused: z.boolean(),
});

