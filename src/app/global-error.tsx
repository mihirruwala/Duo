"use client";

/** Last resort when the root layout itself fails: must render its own <html>/<body>. */
export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          background: "#1a1420",
          color: "#fff4e6",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <main role="alert" style={{ textAlign: "center", padding: 24 }}>
          <h1 style={{ fontSize: 28 }}>DUO hit a snag</h1>
          <p style={{ opacity: 0.75 }}>Please try again in a moment.</p>
          <button
            type="button"
            onClick={() => retry()}
            style={{
              marginTop: 12,
              padding: "10px 18px",
              borderRadius: 12,
              border: 0,
              background: "#ff8a6e",
              color: "#140f19",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
