// Host the Docker panel wasm in a VS Code webview.
//
// The webview owns no Docker logic: it paints the scene the module emits, forwards pointer input to
// the module, and relays the module's request lines to the extension, which runs the Docker CLI.

import { WasmGuest } from "./guest";
import { renderScene, type Scene } from "./scene";

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

interface Theme {
  background: Rgba;
  surface: Rgba;
  surface_raised: Rgba;
  border: Rgba;
  text: Rgba;
  muted: Rgba;
  accent: Rgba;
  on_accent: Rgba;
  ok: Rgba;
  warn: Rgba;
  error: Rgba;
  selection: Rgba;
  code: Rgba;
  font: number;
  small: number;
  headings: number[];
  line_h: number;
  row_h: number;
  pad: number;
  radius: number;
}

const vscode = acquireVsCodeApi();
const canvas = document.getElementById("screen") as HTMLCanvasElement;
const context = canvas.getContext("2d");
const errorBox = document.getElementById("error") as HTMLElement | null;
const wasmUri = canvas.dataset.wasm ?? "";

let guest: WasmGuest | undefined;
let width = 0;
let height = 0;
let dpr = window.devicePixelRatio || 1;
let lastPointer: { x: number; y: number } | undefined;

if (context === null) {
  showError("This webview has no 2D canvas.");
} else {
  start().catch((reason: unknown) => {
    showError(`The Docker panel could not start: ${String(reason)}`);
  });
}

async function start(): Promise<void> {
  const response = await fetch(wasmUri);
  if (!response.ok) {
    throw new Error(`fetching ${wasmUri} failed with ${response.status}`);
  }
  guest = await WasmGuest.load(await response.arrayBuffer());
  sendTheme();
  resize();
  observeTheme();
  addInputListeners();
  vscode.postMessage({ type: "ready" });
}

function addInputListeners(): void {
  canvas.addEventListener("click", (event) => {
    const point = position(event);
    applyInput({ op: "click", x: point.x, y: point.y });
  });

  canvas.addEventListener("pointerdown", () => canvas.focus());

  canvas.addEventListener("pointermove", (event) => {
    const point = position(event);
    if (
      lastPointer !== undefined &&
      Math.abs(point.x - lastPointer.x) < 2 &&
      Math.abs(point.y - lastPointer.y) < 2
    ) {
      return;
    }
    lastPointer = point;
    applyInput({ op: "mouseMove", x: point.x, y: point.y });
  });

  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      let dy = -event.deltaY;
      if (event.deltaMode === 1) {
        dy *= 16;
      } else if (event.deltaMode === 2) {
        dy *= height;
      }
      applyInput({ op: "scroll", dy });
    },
    { passive: false },
  );

  window.addEventListener("resize", () => resize());

  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(() => resize()).observe(canvas);
  }
}

function position(event: MouseEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function applyInput(event: unknown): void {
  if (guest === undefined) {
    return;
  }
  const effects = guest.input(event);
  if (effects.cursor !== undefined) {
    canvas.style.cursor = effects.cursor;
  }
  if (effects.repaint) {
    frame();
  }
}

function resize(): void {
  dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const nextWidth = Math.max(1, Math.floor(rect.width));
  const nextHeight = Math.max(1, Math.floor(rect.height));
  if (nextWidth === width && nextHeight === height && canvas.width === Math.floor(width * dpr)) {
    return;
  }
  width = nextWidth;
  height = nextHeight;
  canvas.width = Math.max(1, Math.floor(width * dpr));
  canvas.height = Math.max(1, Math.floor(height * dpr));
  frame();
}

function frame(): void {
  if (guest === undefined || context === null || width <= 0 || height <= 0) {
    return;
  }
  const json = guest.frame(width, height);
  if (json === null) {
    return;
  }
  let scene: Scene;
  try {
    scene = JSON.parse(json) as Scene;
  } catch {
    return;
  }
  renderScene(context, scene, dpr);
  for (const line of scene.logs ?? []) {
    vscode.postMessage({ type: "request", line });
  }
}

let lastTheme = "";

function sendTheme(): void {
  if (guest === undefined) {
    return;
  }
  const theme = currentTheme();
  const json = JSON.stringify(theme);
  if (json === lastTheme) {
    return;
  }
  lastTheme = json;
  const effects = guest.input({ op: "theme", theme });
  if (effects.repaint) {
    frame();
  }
}

/**
 * The VS Code theme's own colours, read from the `--vscode-*` variables the host publishes.
 *
 * The desktop Advance host imports a VS Code theme file; a webview cannot read that file, but the
 * same colours are already on `document.documentElement`, which is what makes this panel follow the
 * user's theme (including custom and high-contrast themes) instead of a hardcoded light/dark pair.
 * The presets remain as the fallback for a variable a theme does not define.
 */
function currentTheme(): Theme {
  const style = getComputedStyle(document.documentElement);
  const value = (key: string): string =>
    style.getPropertyValue(`--vscode-${key.replace(/\./g, "-")}`).trim();

  const color = (...keys: string[]): Rgba | undefined => {
    for (const key of keys) {
      const parsed = parseColor(value(key));
      if (parsed !== undefined) {
        return parsed;
      }
    }
    return undefined;
  };

  const background = color("editor.background", "sideBar.background", "panel.background");
  const base =
    background !== undefined
      ? luminance(background) > LIGHT_BACKGROUND_LUMINANCE
        ? lightTheme()
        : darkTheme()
      : isLight()
        ? lightTheme()
        : darkTheme();

  const theme: Theme = { ...base, headings: [...base.headings] };
  if (background !== undefined) {
    theme.background = composite(background, base.background);
  }

  const over = (...keys: string[]): Rgba | undefined => {
    const found = color(...keys);
    return found === undefined ? undefined : composite(found, theme.background);
  };
  const readable = (...keys: string[]): Rgba | undefined => {
    const found = over(...keys);
    return found === undefined ? undefined : readableOn(found, theme.surface);
  };

  theme.surface =
    over("sideBar.background", "panel.background", "editorGroupHeader.tabsBackground") ?? theme.surface;
  theme.surface_raised =
    over("editorWidget.background", "input.background", "dropdown.background", "tab.activeBackground") ??
    theme.surface_raised;
  theme.border =
    over(
      "panel.border",
      "editorGroup.border",
      "sideBar.border",
      "widget.border",
      "tab.border",
      "window.activeBorder",
    ) ?? theme.border;
  theme.text = over("editor.foreground", "foreground", "sideBar.foreground") ?? theme.text;
  theme.muted =
    over(
      "descriptionForeground",
      "editorLineNumber.foreground",
      "input.placeholderForeground",
      "tab.inactiveForeground",
    ) ?? theme.muted;

  theme.accent =
    readable(
      "button.background",
      "activityBarBadge.background",
      "progressBar.background",
      "textLink.foreground",
      "focusBorder",
    ) ?? theme.accent;
  theme.on_accent = over("button.foreground") ?? theme.on_accent;
  theme.ok =
    readable("editorGutter.addedBackground", "terminal.ansiGreen", "charts.green") ?? theme.ok;
  theme.warn =
    readable("editorWarning.foreground", "terminal.ansiYellow", "charts.yellow") ?? theme.warn;
  theme.error =
    readable("errorForeground", "editorError.foreground", "terminal.ansiRed", "charts.red") ??
    theme.error;
  theme.selection =
    over(
      "list.activeSelectionBackground",
      "list.focusBackground",
      "editor.selectionBackground",
      "editor.findMatchBackground",
    ) ?? theme.selection;
  theme.code = over("textCodeBlock.background", "editorWidget.background") ?? theme.code;

  const font = pixels(value("font-size")) ?? base.font;
  theme.font = font;
  theme.small = Math.max(9, font - 1);
  theme.headings = [font + 9, font + 6, font + 3, font + 1.5, font + 0.5, font];
  theme.line_h = Math.round(font * 1.46);
  theme.row_h = Math.round(font * 1.69);
  return theme;
}

function isLight(): boolean {
  const kind = document.body.dataset.vscodeThemeKind ?? "";
  if (kind !== "") {
    return kind === "vscode-light" || kind === "vscode-high-contrast-light";
  }
  if (
    document.body.classList.contains("vscode-light") ||
    document.body.classList.contains("vscode-high-contrast-light")
  ) {
    return true;
  }
  if (
    document.body.classList.contains("vscode-dark") ||
    document.body.classList.contains("vscode-high-contrast")
  ) {
    return false;
  }
  return window.matchMedia?.("(prefers-color-scheme: light)")?.matches ?? false;
}

function observeTheme(): void {
  // A theme change replaces the body class, the theme-kind data attribute, and the whole set of
  // `--vscode-*` properties on the document element, so watch all three.
  const options: MutationObserverInit = {
    attributes: true,
    attributeFilter: ["class", "style", "data-vscode-theme-kind", "data-vscode-theme-id"],
  };
  const observer = new MutationObserver(() => sendTheme());
  observer.observe(document.body, options);
  observer.observe(document.documentElement, options);
  window.matchMedia?.("(prefers-color-scheme: dark)")?.addEventListener("change", () => sendTheme());
}

const LIGHT_BACKGROUND_LUMINANCE = 0.35;
const MIN_TEXT_CONTRAST = 3;

function pixels(value: string): number | undefined {
  const match = /^(\d+(?:\.\d+)?)px$/i.exec(value);
  if (match === null) {
    return undefined;
  }
  const size = Number(match[1]);
  return Number.isFinite(size) && size > 0 ? size : undefined;
}

function parseColor(text: string): Rgba | undefined {
  const value = text.trim().toLowerCase();
  if (value.startsWith("#")) {
    const hex = value.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      const r = hexByte(hex[0] + hex[0]) / 255;
      const g = hexByte(hex[1] + hex[1]) / 255;
      const b = hexByte(hex[2] + hex[2]) / 255;
      const a = hex.length === 4 ? hexByte(hex[3] + hex[3]) / 255 : 1;
      return validColor(r, g, b, a);
    }
    if (hex.length === 6 || hex.length === 8) {
      const r = hexByte(hex.slice(0, 2)) / 255;
      const g = hexByte(hex.slice(2, 4)) / 255;
      const b = hexByte(hex.slice(4, 6)) / 255;
      const a = hex.length === 8 ? hexByte(hex.slice(6, 8)) / 255 : 1;
      return validColor(r, g, b, a);
    }
    return undefined;
  }

  const match = /^rgba?\(([^)]+)\)$/.exec(value);
  if (match === null) {
    return undefined;
  }
  const parts = match[1].split(/[\s,/]+/).filter((part) => part.length > 0);
  if (parts.length < 3) {
    return undefined;
  }
  const channel = (part: string): number =>
    part.endsWith("%") ? Number(part.slice(0, -1)) / 100 : Number(part) / 255;
  const alpha = (part: string): number =>
    part.endsWith("%") ? Number(part.slice(0, -1)) / 100 : Number(part);
  return validColor(
    channel(parts[0]),
    channel(parts[1]),
    channel(parts[2]),
    parts.length > 3 ? alpha(parts[3]) : 1,
  );
}

function hexByte(part: string): number {
  return parseInt(part, 16);
}

function validColor(r: number, g: number, b: number, a: number): Rgba | undefined {
  if ([r, g, b, a].some((value) => !Number.isFinite(value))) {
    return undefined;
  }
  return { r: clamp(r), g: clamp(g), b: clamp(b), a: clamp(a) };
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function composite(front: Rgba, back: Rgba): Rgba {
  if (front.a >= 1) {
    return front;
  }
  const mix = (a: number, b: number): number => a * front.a + b * (1 - front.a);
  return { r: mix(front.r, back.r), g: mix(front.g, back.g), b: mix(front.b, back.b), a: 1 };
}

function mix(from: Rgba, to: Rgba, fraction: number): Rgba {
  const channel = (a: number, b: number): number => a + (b - a) * fraction;
  return {
    r: channel(from.r, to.r),
    g: channel(from.g, to.g),
    b: channel(from.b, to.b),
    a: 1,
  };
}

/** WCAG relative luminance, so two colours compare the way an eye compares them. */
function luminance(color: Rgba): number {
  const linear = (channel: number): number =>
    channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
  return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b);
}

function contrast(a: Rgba, b: Rgba): number {
  const first = luminance(a);
  const second = luminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * `color` moved toward black or white until it can be read on `on`.
 *
 * The theme chooses accents and status colours for *its own* background, but here they are drawn on
 * this panel's surface, as text and as marks. Keeping the hue and moving only the lightness is a
 * smaller change than replacing the colour outright.
 */
function readableOn(color: Rgba, on: Rgba): Rgba {
  if (contrast(color, on) >= MIN_TEXT_CONTRAST) {
    return color;
  }
  const toward: Rgba = luminance(on) > 0.18 ? { r: 0, g: 0, b: 0, a: 1 } : { r: 1, g: 1, b: 1, a: 1 };
  let enough = 1;
  let notEnough = 0;
  for (let i = 0; i < 12; i += 1) {
    const fraction = (notEnough + enough) / 2;
    if (contrast(mix(color, toward, fraction), on) >= MIN_TEXT_CONTRAST) {
      enough = fraction;
    } else {
      notEnough = fraction;
    }
  }
  return mix(color, toward, enough);
}

function showError(text: string): void {
  canvas.hidden = true;
  if (errorBox !== null) {
    errorBox.hidden = false;
    errorBox.textContent = text;
  }
}

window.addEventListener("message", (event: MessageEvent) => {
  const message = event.data as { type?: string; event?: unknown } | undefined;
  if (message?.type === "input" && message.event !== undefined) {
    applyInput(message.event);
  }
});

function rgba(r: number, g: number, b: number): Rgba {
  return { r: r / 255, g: g / 255, b: b / 255, a: 1 };
}

function darkTheme(): Theme {
  return {
    background: rgba(25, 25, 37),
    surface: rgba(30, 30, 40),
    surface_raised: rgba(37, 37, 50),
    border: rgba(69, 69, 90),
    text: rgba(232, 236, 246),
    muted: rgba(122, 125, 140),
    accent: rgba(122, 162, 247),
    on_accent: rgba(255, 255, 255),
    ok: rgba(100, 191, 133),
    warn: rgba(227, 198, 65),
    error: rgba(237, 133, 133),
    selection: rgba(46, 56, 87),
    code: rgba(33, 33, 45),
    font: 13,
    small: 12,
    headings: [22, 19, 16, 14.5, 13.5, 13],
    line_h: 19,
    row_h: 22,
    pad: 12,
    radius: 6,
  };
}

function lightTheme(): Theme {
  return {
    background: rgba(246, 246, 249),
    surface: rgba(255, 255, 255),
    surface_raised: rgba(238, 238, 243),
    border: rgba(203, 205, 214),
    text: rgba(32, 35, 45),
    muted: rgba(110, 116, 132),
    accent: rgba(38, 96, 200),
    on_accent: rgba(255, 255, 255),
    ok: rgba(28, 128, 70),
    warn: rgba(158, 108, 8),
    error: rgba(184, 48, 48),
    selection: rgba(214, 225, 248),
    code: rgba(236, 238, 245),
    font: 13,
    small: 12,
    headings: [22, 19, 16, 14.5, 13.5, 13],
    line_h: 19,
    row_h: 22,
    pad: 12,
    radius: 6,
  };
}
