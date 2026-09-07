# Fonts

Drop `Sora[wght].ttf` (or the static `Sora-Black.ttf` / `Sora-Bold.ttf` /
`Sora-SemiBold.ttf` / `Sora-Medium.ttf` / `Sora-Regular.ttf` faces) here to give
**server-drawn** overlays the real brand typeface.

This is optional. The frontend rasterises overlays in the browser with the live
Sora webfont and uploads the PNGs, so the normal path is already pixel-accurate.
These files only matter when the backend draws overlays itself — a direct API
caller, or a browser where the webfont failed to load. Without them the service
falls back to DejaVu.

The Docker build downloads `Sora[wght].ttf` from Google Fonts automatically.
