import "server-only";

type Level = "debug" | "info" | "warn" | "error";
type Fields = Record<string, unknown>;

// Keys whose values must never reach logs.
const REDACT = /pass|secret|token|code|key|authorization|cookie|email|body|text/i;
// …except these, which are safe identifiers / machine codes.
const ALLOW = new Set(["status", "error_code"]);

function scrub(fields: Fields): Fields {
  const out: Fields = {};
  for (const [k, v] of Object.entries(fields)) {
    if (REDACT.test(k) && !ALLOW.has(k)) out[k] = "[redacted]";
    else if (v instanceof Error) out[k] = { name: v.name, message: v.message };
    else out[k] = v;
  }
  return out;
}

function emit(level: Level, event: string, fields: Fields = {}) {
  if (level === "debug" && process.env.NODE_ENV === "production") return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...scrub(fields) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/** Structured JSON logger. Pass ids and machine codes, never user content or secrets. */
export const log = {
  debug: (event: string, fields?: Fields) => emit("debug", event, fields),
  info: (event: string, fields?: Fields) => emit("info", event, fields),
  warn: (event: string, fields?: Fields) => emit("warn", event, fields),
  error: (event: string, fields?: Fields) => emit("error", event, fields),
};
