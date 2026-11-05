import { ImageResponse } from "next/og";

/** The card chat apps show when someone pastes a DUO link (including invites). */
export const alt = "DUO: a private space for two";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "0 96px",
        background:
          "radial-gradient(circle at 12% 0%, rgba(255,138,110,0.30), transparent 55%), radial-gradient(circle at 100% 20%, rgba(165,147,255,0.32), transparent 55%), #120e18",
        color: "#fff4e6",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
        <div style={{ display: "flex", position: "relative", width: 150, height: 96 }}>
          <div
            style={{ position: "absolute", left: 0, top: 0, width: 96, height: 96, borderRadius: 48, background: "#ff8a6e" }}
          />
          <div
            style={{
              position: "absolute",
              left: 54,
              top: 0,
              width: 96,
              height: 96,
              borderRadius: 48,
              background: "rgba(165,147,255,0.92)",
            }}
          />
        </div>
        <div style={{ fontSize: 120, fontWeight: 800, letterSpacing: -4 }}>duo</div>
      </div>
      <div style={{ marginTop: 40, fontSize: 64, fontWeight: 800, letterSpacing: -1.5 }}>A private space for two.</div>
      <div style={{ marginTop: 18, fontSize: 32, color: "#c9bfd2" }}>
        Encrypted calls, chat, watching together, and a hand on the other mouse.
      </div>
    </div>,
    size,
  );
}
