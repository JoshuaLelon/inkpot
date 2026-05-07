// CSS properties → Tailwind v4 utility classes (with arbitrary values).
//
// Returns { classes, remaining }. `remaining` is for properties that don't have a clean
// Tailwind mapping; callers can render those as inline styles if needed.

export type CssProps = Record<string, string | number>;

interface ConvertResult {
  classes: string[];
  remaining: CssProps;
}

const FONT_WEIGHT_NAMES: Record<number, string> = {
  100: "font-thin",
  200: "font-extralight",
  300: "font-light",
  400: "font-normal",
  500: "font-medium",
  600: "font-semibold",
  700: "font-bold",
  800: "font-extrabold",
  900: "font-black",
};

function normalizeLength(v: string | number): string {
  if (typeof v === "number") {
    // Avoid floating-point noise like "811.9999999999999px"
    const rounded = Math.round(v * 100) / 100;
    return Number.isInteger(rounded) ? `${rounded}px` : `${rounded}px`;
  }
  return String(v).trim();
}

function spacesToUnderscore(s: string): string {
  return s.replace(/\s+/g, "_");
}

function fontWeightClass(v: string | number): string {
  const num = typeof v === "number" ? v : parseInt(String(v), 10);
  return FONT_WEIGHT_NAMES[num] ?? `font-[${num}]`;
}

function textDecorationClass(v: string): string {
  if (v === "none") return "no-underline";
  if (v.includes("underline")) return "underline";
  if (v.includes("line-through")) return "line-through";
  return `[text-decoration:${spacesToUnderscore(v)}]`;
}

function rgbaOrHex(v: string | number): string {
  return String(v).trim();
}

const MAPPINGS: Array<{ key: string; cls: (v: string | number) => string }> = [
  // Layout
  { key: "position", cls: (v) => String(v) },
  { key: "display", cls: (v) => String(v) },
  { key: "overflow", cls: (v) => `overflow-${v}` },
  { key: "left", cls: (v) => `left-[${normalizeLength(v)}]` },
  { key: "top", cls: (v) => `top-[${normalizeLength(v)}]` },
  { key: "right", cls: (v) => `right-[${normalizeLength(v)}]` },
  { key: "bottom", cls: (v) => `bottom-[${normalizeLength(v)}]` },
  { key: "width", cls: (v) => `w-[${normalizeLength(v)}]` },
  { key: "height", cls: (v) => `h-[${normalizeLength(v)}]` },
  // Color
  { key: "backgroundColor", cls: (v) => `bg-[${rgbaOrHex(v)}]` },
  { key: "color", cls: (v) => `text-[${rgbaOrHex(v)}]` },
  // Borders
  { key: "borderRadius", cls: (v) => `rounded-[${normalizeLength(v)}]` },
  { key: "borderTopLeftRadius", cls: (v) => `rounded-tl-[${normalizeLength(v)}]` },
  { key: "borderTopRightRadius", cls: (v) => `rounded-tr-[${normalizeLength(v)}]` },
  { key: "borderBottomLeftRadius", cls: (v) => `rounded-bl-[${normalizeLength(v)}]` },
  { key: "borderBottomRightRadius", cls: (v) => `rounded-br-[${normalizeLength(v)}]` },
  { key: "borderColor", cls: (v) => `border-[${rgbaOrHex(v)}]` },
  { key: "borderWidth", cls: (v) => `border-[${normalizeLength(v)}]` },
  { key: "borderStyle", cls: (v) => `border-${v}` },
  // Typography
  { key: "fontSize", cls: (v) => `text-[${normalizeLength(v)}]` },
  { key: "fontWeight", cls: (v) => fontWeightClass(v) },
  { key: "fontFamily", cls: (v) => `font-[${spacesToUnderscore(String(v))}]` },
  { key: "fontStyle", cls: (v) => (String(v) === "italic" ? "italic" : "not-italic") },
  { key: "letterSpacing", cls: (v) => `tracking-[${String(v).trim()}]` },
  { key: "lineHeight", cls: (v) => `leading-[${normalizeLength(v)}]` },
  { key: "textAlign", cls: (v) => `text-${v}` },
  { key: "textTransform", cls: (v) => String(v) },
  { key: "textDecoration", cls: (v) => textDecorationClass(String(v)) },
  // Effects
  { key: "opacity", cls: (v) => `opacity-[${v}]` },
  { key: "boxShadow", cls: (v) => `shadow-[${spacesToUnderscore(String(v))}]` },
  // Spacing
  { key: "padding", cls: (v) => `p-[${normalizeLength(v)}]` },
  { key: "paddingTop", cls: (v) => `pt-[${normalizeLength(v)}]` },
  { key: "paddingRight", cls: (v) => `pr-[${normalizeLength(v)}]` },
  { key: "paddingBottom", cls: (v) => `pb-[${normalizeLength(v)}]` },
  { key: "paddingLeft", cls: (v) => `pl-[${normalizeLength(v)}]` },
];

export function cssToTailwind(style: CssProps): ConvertResult {
  const classes: string[] = [];
  const remaining: CssProps = {};
  for (const [key, val] of Object.entries(style)) {
    if (val === undefined || val === null || val === "") continue;
    const m = MAPPINGS.find((x) => x.key === key);
    if (m) classes.push(m.cls(val));
    else remaining[key] = val;
  }
  return { classes, remaining };
}

// Helper: build a className string from layout + visual + base classes.
export function joinClasses(...groups: Array<string | string[] | undefined>): string {
  const all: string[] = [];
  for (const g of groups) {
    if (!g) continue;
    if (typeof g === "string") all.push(...g.split(/\s+/).filter(Boolean));
    else all.push(...g);
  }
  // De-dupe last-wins for prefix conflicts (e.g. multiple bg-[...]).
  const byPrefix = new Map<string, string>();
  for (const c of all) {
    const prefix = c.replace(/\[[^\]]*\]$/, "").replace(/-\d+$/, "").replace(/-(thin|light|normal|medium|semibold|bold|extrabold|black|extralight)$/, "-FONTW");
    byPrefix.set(prefix || c, c);
  }
  return Array.from(byPrefix.values()).join(" ");
}
