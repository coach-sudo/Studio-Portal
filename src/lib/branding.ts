import type { StudioSettings } from "../domain/model";

const minimumTextContrast = 4.5;
const canvasText = "#526258";
const defaultCanvas = "#f3f5f2";
const white = "#ffffff";
const black = "#000000";

function rgb(color: string) {
  const hex = color.trim().replace(/^#/, "");
  if (!/^(?:[a-f\d]{3}|[a-f\d]{6})$/i.test(hex)) return;
  const expanded =
    hex.length === 3
      ? [...hex].map((channel) => channel + channel).join("")
      : hex;
  return [0, 2, 4].map((index) =>
    parseInt(expanded.slice(index, index + 2), 16),
  );
}

function luminance(channels: number[]) {
  const [red, green, blue] = channels.map((channel) => {
    const scaled = channel / 255;
    return scaled <= 0.04045
      ? scaled / 12.92
      : ((scaled + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

export function colorContrast(first: string, second: string) {
  const a = rgb(first);
  const b = rgb(second);
  if (!a || !b) return 0;
  const firstLuminance = luminance(a);
  const secondLuminance = luminance(b);
  return (
    (Math.max(firstLuminance, secondLuminance) + 0.05) /
    (Math.min(firstLuminance, secondLuminance) + 0.05)
  );
}

export function brandingForeground(background: string) {
  if (!rgb(background)) return undefined;
  return colorContrast(black, background) >= colorContrast(white, background)
    ? black
    : white;
}

/** Light-mode surfaces retain the studio hue while keeping body and muted text readable. */
function readableCanvas(surface: string) {
  const color = rgb(surface);
  if (!color) return defaultCanvas;
  for (let whitePercent = 0; whitePercent <= 100; whitePercent += 5) {
    const shade =
      "#" +
      color
        .map((channel) =>
          Math.round(channel + ((255 - channel) * whitePercent) / 100)
            .toString(16)
            .padStart(2, "0"),
        )
        .join("");
    if (colorContrast(canvasText, shade) >= minimumTextContrast) return shade;
  }
  return defaultCanvas;
}

export function applyStudioBranding(
  branding?: Partial<StudioSettings["branding"]>,
) {
  if (!branding) return;
  const { style } = document.documentElement;
  const values: Array<[string, string | undefined]> = [
    ["forest", branding.primaryColor],
    ["gold", branding.secondaryColor],
    ["coral", branding.accentColor],
    ["surface", branding.surfaceColor],
  ];
  for (const [name, value] of values) {
    const foreground = value && brandingForeground(value);
    if (value && foreground) {
      style.setProperty(`--${name}`, "#" + value.trim().replace(/^#/, ""));
      style.setProperty(`--on-${name}`, foreground);
    } else {
      style.removeProperty(`--${name}`);
      style.removeProperty(`--on-${name}`);
    }
  }
  const canvas = readableCanvas(branding.surfaceColor || defaultCanvas);
  style.setProperty("--accessible-canvas", canvas);
  const primary = branding.primaryColor || "#0d322b";
  const forLightSurfaces = [canvas, white, "#f3f6f1"].every(
    (surface) => colorContrast(primary, surface) >= minimumTextContrast,
  );
  style.setProperty(
    "--brand-text-on-light",
    forLightSurfaces ? "#" + primary.trim().replace(/^#/, "") : "#17211d",
  );
  style.setProperty(
    "--primary-hover-tint",
    brandingForeground(primary) === black ? white : black,
  );
}
