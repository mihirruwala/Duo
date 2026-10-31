import { Fragment } from "react";

// http(s) only; javascript:, data:, etc. are never turned into links.
const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+[^\s<>"'`.,;:!?)\]}]/gi;

/**
 * Renders plain text with clickable http(s) links. Everything else is React text
 * (auto-escaped), so user content can never inject markup.
 */
export function Linkified({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    const start = match.index ?? 0;
    if (start > last) parts.push(text.slice(last, start));
    let href: URL | null = null;
    try {
      href = new URL(match[0]);
    } catch {
      href = null;
    }
    if (href && (href.protocol === "https:" || href.protocol === "http:")) {
      parts.push(
        <a
          key={start}
          href={href.toString()}
          target="_blank"
          rel="noopener noreferrer nofollow ugc"
          className="font-medium underline decoration-current/40 underline-offset-2 hover:decoration-current"
        >
          {match[0]}
        </a>,
      );
    } else {
      parts.push(match[0]);
    }
    last = start + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={i}>{p}</Fragment>
      ))}
    </>
  );
}
