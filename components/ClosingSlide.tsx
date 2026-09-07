"use client";

/**
 * Thumbnail of the 7th beat (closing frame) shown when no closing file is
 * uploaded. The same layout is reproduced on canvas by
 * lib/overlay.ts:makeClosingSlide() for the actual rendered video, and again in
 * Pillow by the render service — this is the preview of that.
 */
export default function ClosingSlide({ scale = 0.062 }: { scale?: number }) {
  const W = 1080 * scale;
  const H = 1920 * scale;
  return (
    <div
      style={{
        width: W,
        height: H,
        background:
          "radial-gradient(circle at 50% 38%, rgba(29,185,84,0.2), rgba(11,13,15,0) 62%), #0B0D0F",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        padding: 8,
        textAlign: "center",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: "56%",
          aspectRatio: "1 / 1",
          border: "1px dashed rgba(29,185,84,0.7)",
          borderRadius: 4,
          background: "rgba(255,255,255,0.03)",
        }}
      />
      <div style={{ fontWeight: 600, fontSize: 6, color: "#fff", letterSpacing: "0.02em" }}>
        [ DEALERSHIP ]
      </div>
      <div
        style={{
          background: "var(--emerald)",
          color: "#06210f",
          fontSize: 4.5,
          fontWeight: 700,
          borderRadius: 50,
          padding: "3px 8px",
        }}
      >
        BOOK A CALL
      </div>
    </div>
  );
}
