"use client";

/**
 * React-rendered placeholder for the 7th beat (closing frame) shown in the
 * dashboard when no closing file is uploaded. The same layout is reproduced on
 * canvas by lib/overlay.ts:makeClosingSlide() for the actual rendered video.
 */
export default function ClosingSlide({ scale = 0.14 }: { scale?: number }) {
  const W = 1080 * scale;
  const H = 1920 * scale;
  return (
    <div
      style={{
        width: W,
        height: H,
        borderRadius: 16,
        background:
          "radial-gradient(circle at 50% 38%, rgba(29,185,84,0.22), rgba(11,13,15,0) 60%), #0B0D0F",
        border: "2px solid var(--emerald)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        padding: 16,
        textAlign: "center",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: "55%",
          aspectRatio: "1 / 1",
          border: "2px dashed var(--emerald)",
          borderRadius: 10,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--medium-gray)",
          fontSize: 9,
          fontWeight: 700,
          background: "rgba(255,255,255,0.04)",
        }}
      >
        [ LOGO HERE ]
      </div>
      <div style={{ fontWeight: 900, fontSize: 13, color: "#fff" }}>
        [ DEALERSHIP NAME ]
      </div>
      <div
        className="badge-solid"
        style={{ fontSize: 8, borderRadius: 50, padding: "5px 12px" }}
      >
        BOOK A STRATEGY CALL
      </div>
      <div style={{ fontSize: 8, color: "#C7CCD4" }}>[ Phone · Website ]</div>
    </div>
  );
}
