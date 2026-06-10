/**
 * Design tokens derived from DESIGN.md (A3 Brands design system).
 * Single source of truth for colors, type, spacing, radii, and shadows so both
 * the dashboard UI and the canvas-rendered video overlays stay on-brand.
 */

export const colors = {
  emerald: "#1DB954",
  charcoal: "#2C3038",
  darkNavy: "#0B0D0F",
  nearBlack: "#111214",
  white: "#FFFFFF",
  lightGray: "#F8F9FA",
  veryLightGray: "#F0F1F3",
  paleGray: "#E5E7EB",
  stoneGray: "#5A6170",
  mediumGray: "#8A919C",
  error: "#EF4444",
} as const;

export const shadows = {
  subtle: "rgba(0, 0, 0, 0.08) 0px 4px 16px 0px",
  raised: "rgba(0, 0, 0, 0.12) 0px 8px 24px 0px",
  elevated: "rgba(0, 0, 0, 0.3) 0px 4px 30px 0px",
  floating: "rgba(29, 185, 84, 0.3) 0px 4px 24px 0px",
  floatingHover: "rgba(29, 185, 84, 0.4) 0px 6px 28px 0px",
} as const;

export const radii = {
  sm: "4px",
  md: "8px",
  lg: "16px",
  pill: "50px",
} as const;

export const fontStack =
  'Sora, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

// Spacing scale (4px base unit) from DESIGN.md.
export const space = {
  1: "4px",
  2: "8px",
  3: "12px",
  4: "16px",
  5: "20px",
  6: "24px",
  7: "28px",
  8: "32px",
  10: "40px",
  12: "48px",
  14: "56px",
  16: "64px",
} as const;
