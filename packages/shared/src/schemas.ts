import { z } from "zod";
import {
  CYCLE_OPTIONS,
  GAME_SETTING_LIMITS,
  PRECISION_TARGET_OPTIONS,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  TIME_OPTIONS,
} from "./types";

const visibleText = (minimum: number, maximum: number) =>
  z
    .string()
    .trim()
    .refine((value) => Array.from(value).length >= minimum, "too_short")
    .refine((value) => Array.from(value).length <= maximum, "too_long")
    .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value), "control_character");

const integerBetween = (minimum: number, maximum: number) =>
  z.number().int().min(minimum).max(maximum);

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
  .refine(
    (value) => value.length === ROOM_CODE_LENGTH &&
      Array.from(value).every((character) => ROOM_CODE_ALPHABET.includes(character)),
    "invalid_room_code",
  );

export const participantRoleSchema = z.enum(["player", "spectator"]);
export const localeSchema = z.enum(["ko", "en"]);
export const gameModeSchema = z.enum(["classic", "spy", "precision"]);

export const createRoomSchema = z.object({
  nickname: nicknameSchema,
  role: participantRoleSchema,
});

export const joinRoomSchema = createRoomSchema.extend({
  roomCode: roomCodeSchema,
});

export const updateRoleSchema = z.object({
  role: participantRoleSchema,
});

export const kickPlayerSchema = z.object({
  participantId: z.string().uuid(),
});

export const sessionResumeSchema = z.object({
  roomCode: roomCodeSchema,
  token: z.string().min(20).max(128),
});

export const settingsSchema = z.object({
  mode: gameModeSchema,
  guessSeconds: z.union(TIME_OPTIONS.map((value) => z.literal(value)) as [z.ZodLiteral<30>, z.ZodLiteral<45>, z.ZodLiteral<60>, z.ZodLiteral<90>]),
  pickerSeconds: z.union(TIME_OPTIONS.map((value) => z.literal(value)) as [z.ZodLiteral<30>, z.ZodLiteral<45>, z.ZodLiteral<60>, z.ZodLiteral<90>]),
  cycles: z.union(CYCLE_OPTIONS.map((value) => z.literal(value)) as [z.ZodLiteral<1>, z.ZodLiteral<2>, z.ZodLiteral<3>]),
  spyRounds: integerBetween(
    GAME_SETTING_LIMITS.spyRounds.minimum,
    GAME_SETTING_LIMITS.spyRounds.maximum,
  ),
  spyHintSeconds: integerBetween(
    GAME_SETTING_LIMITS.seconds.minimum,
    GAME_SETTING_LIMITS.seconds.maximum,
  ),
  spyDiscussionSeconds: integerBetween(
    GAME_SETTING_LIMITS.seconds.minimum,
    GAME_SETTING_LIMITS.seconds.maximum,
  ),
  spyVoteSeconds: integerBetween(
    GAME_SETTING_LIMITS.seconds.minimum,
    GAME_SETTING_LIMITS.seconds.maximum,
  ),
  spyGuessSeconds: integerBetween(
    GAME_SETTING_LIMITS.seconds.minimum,
    GAME_SETTING_LIMITS.seconds.maximum,
  ),
  precisionTargetAccuracy: integerBetween(
    GAME_SETTING_LIMITS.precisionTargetAccuracy.minimum,
    GAME_SETTING_LIMITS.precisionTargetAccuracy.maximum,
  ),
  precisionMaxAttempts: integerBetween(
    GAME_SETTING_LIMITS.precisionMaxAttempts.minimum,
    GAME_SETTING_LIMITS.precisionMaxAttempts.maximum,
  ),
  precisionAttemptSeconds: integerBetween(
    GAME_SETTING_LIMITS.seconds.minimum,
    GAME_SETTING_LIMITS.seconds.maximum,
  ),
  precisionTargets: z.union(PRECISION_TARGET_OPTIONS.map((value) => z.literal(value)) as [z.ZodLiteral<1>, z.ZodLiteral<2>, z.ZodLiteral<3>]),
});

export const pickerSubmitSchema = z.object({
  targetHex: hexColorSchema,
  hint: hintSchema,
});

export const guessSchema = z.object({
  color: hexColorSchema,
});

export const spyHintSchema = z.object({
  hint: hintSchema,
});

export const spyVoteSchema = z.object({
  choice: z.union([z.string().uuid(), z.literal("abstain")]),
});

export const revealPauseSchema = z.object({
  paused: z.boolean(),
});
