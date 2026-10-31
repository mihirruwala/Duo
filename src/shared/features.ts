/**
 * Single source of truth for what is actually shipped. UI that depends on an unfinished
 * feature must check this and either hide itself or show "Coming soon": never a dead button.
 * Flip a flag only when the milestone's gate has been verified.
 */
export const FEATURES = {
  rooms: true, // M1
  video: true, // M2
  screenShare: true, // M2
  chat: false, // M3
  remoteControl: false, // M4
  studio: false, // M5
} as const;

export type FeatureKey = keyof typeof FEATURES;
