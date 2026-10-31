/**
 * ID of the unpacked DUO Control extension. Deterministic: derived from the public key in
 * extension/manifest-key.txt. A Chrome Web Store build gets a different ID: set
 * NEXT_PUBLIC_DUO_EXTENSION_ID to override.
 */
export const DEFAULT_EXTENSION_ID = "kkdnhedcgfkimkdoabkegnkjdfnknpph";

export function extensionId(): string {
  return process.env.NEXT_PUBLIC_DUO_EXTENSION_ID || DEFAULT_EXTENSION_ID;
}
