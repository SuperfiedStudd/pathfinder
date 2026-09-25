import { maskValue } from "./redact";

export const CANDIDATE_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  "[role=button]",
  "[role=link]",
  "[role=tab]",
  "[role=checkbox]",
  "[role=radio]",
  "[contenteditable=true]",
  "h1",
  "h2",
  "h3",
  "label",
  "[data-pf-include]",
].join(",");

const HEADING_SELECTOR = "h1,h2,h3";
const WIDGET_ROOT = "[data-pf-widget]";
const MAX_ELEMENTS = 120;
const MAX_CONTENT_CHARS = 1500;
const MAX_CHANGES = 12;

export interface Snapshot {
  text: string;
  count: number;
}

const idMap = new WeakMap<Element, number>();
let nextId = 1;
let previousFlags: Map<number, string> | null = null;
let previousUrl: string | null = null;

function idFor(el: Element): number {
  let id = idMap.get(el);
  if (id === undefined) {
    id = nextId++;
    idMap.set(el, id);
  }
  el.setAttribute("data-pf-id", String(id));
  return id;
}

export function getElementById(id: number): Element | null {
  return document.querySelector(`[data-pf-id="${id}"]`);
}

// Fallback lookup for when a model's target_id no longer resolves (the page
// changed since the snapshot). Same candidate pool and visibility rules as
// the extractor, matched on accessible name instead of id.
export function findByName(name: string): Element | null {
  const wanted = name.replace(/\s+/g, " ").trim().toLowerCase();
  const candidates = Array.from(document.querySelectorAll(CANDIDATE_SELECTOR)).filter(isVisible);
  for (const el of candidates) {
    if (accessibleName(el).replace(/\s+/g, " ").trim().toLowerCase() === wanted) return el;
  }
  return null;
}

export function isVisible(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.closest(WIDGET_ROOT)) return false;
  if (el.closest("[aria-hidden=true]")) return false;
  if (el instanceof HTMLInputElement && el.type === "hidden") return false;
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  return true;
}

function inViewport(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  const h = window.innerHeight || document.documentElement.clientHeight;
  const w = window.innerWidth || document.documentElement.clientWidth;
  return rect.bottom > 0 && rect.top < h && rect.right > 0 && rect.left < w;
}

function escapeSelector(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/["\\]/g, "\\$&");
}

function clean(text: string | null | undefined, max = 80): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max) + "..." : t;
}

export function accessibleName(el: Element): string {
  const aria = el.getAttribute("aria-label");
  if (aria && aria.trim()) return clean(aria);

  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const parts = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");
    if (parts.trim()) return clean(parts);
  }

  if (el.id) {
    const forLabel = document.querySelector(`label[for="${escapeSelector(el.id)}"]`);
    if (forLabel && forLabel.textContent?.trim()) return clean(forLabel.textContent);
  }

  const wrapping = el.closest("label");
  if (wrapping && wrapping !== el) {
    const cloneText = Array.from(wrapping.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE || (n as Element).tagName !== el.tagName)
      .map((n) => n.textContent ?? "")
      .join(" ");
    if (cloneText.trim()) return clean(cloneText);
  }

  const placeholder = el.getAttribute("placeholder");
  if (placeholder && placeholder.trim()) return clean(placeholder);

  if (el instanceof HTMLElement && el.innerText && el.innerText.trim()) return clean(el.innerText);

  const title = el.getAttribute("title");
  if (title && title.trim()) return clean(title);

  const alt = el.querySelector("img[alt]")?.getAttribute("alt");
  if (alt && alt.trim()) return clean(alt);

  if (el instanceof HTMLInputElement && el.value && (el.type === "submit" || el.type === "button")) return clean(el.value);

  return "";
}

function tagLabel(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const role = el.getAttribute("role");
  if (el instanceof HTMLInputElement) return `input(${el.type || "text"})`;
  if (tag === "a") return "a";
  if (role && !["button", "link"].includes(role)) return `${tag}[${role}]`;
  if (role === "button" && tag !== "button") return "button";
  if (role === "link" && tag !== "a") return "a";
  return tag;
}

function stateFlags(el: Element): string[] {
  const flags: string[] = [];
  const role = el.getAttribute("role");
  if (role === "checkbox" || role === "radio" || role === "tab") {
    const checked = el.getAttribute("aria-checked") ?? el.getAttribute("aria-selected") ?? el.getAttribute("aria-pressed");
    flags.push(`checked=${checked ?? "false"}`);
    if ((el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") flags.push("disabled");
    return flags;
  }
  if (el instanceof HTMLInputElement) {
    if (el.type === "checkbox" || el.type === "radio") {
      flags.push(`checked=${el.checked}`);
    } else if (el.type !== "submit" && el.type !== "button" && el.type !== "file") {
      flags.push(`value="${maskValue(el)}"`);
    } else if (el.type === "file") {
      flags.push(el.files && el.files.length > 0 ? "file-selected" : "no-file");
    }
    if (el.disabled) flags.push("disabled");
    if (el.required) flags.push("required");
  } else if (el instanceof HTMLTextAreaElement) {
    flags.push(`value="${maskValue(el)}"`);
    if (el.disabled) flags.push("disabled");
  } else if (el instanceof HTMLSelectElement) {
    const opt = el.selectedOptions[0];
    flags.push(`selected="${clean(opt?.text ?? "", 40)}"`);
    if (el.disabled) flags.push("disabled");
  } else if (el instanceof HTMLButtonElement) {
    flags.push(el.disabled || el.getAttribute("aria-disabled") === "true" ? "disabled" : "enabled");
  } else if (el instanceof HTMLAnchorElement) {
    try {
      const url = new URL(el.href, window.location.href);
      flags.push(`href=${url.pathname}${url.search}`);
    } catch {
      // ignore malformed hrefs
    }
  }
  return flags;
}

function nearestHeading(el: Element, headings: Element[]): string {
  let best: Element | null = null;
  for (const h of headings) {
    const pos = h.compareDocumentPosition(el);
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) best = h;
    else break;
  }
  return best ? clean(best.textContent, 60) : "";
}

function visibleContent(): string {
  const main = document.querySelector("main");
  let text = "";
  if (main instanceof HTMLElement) {
    text = main.innerText;
  } else {
    const parts: string[] = [];
    for (const child of Array.from(document.body.children)) {
      if (!(child instanceof HTMLElement)) continue;
      if (child.matches("nav,footer,header,script,style") || child.matches(WIDGET_ROOT)) continue;
      parts.push(child.innerText);
    }
    text = parts.join(" ");
  }
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > MAX_CONTENT_CHARS ? collapsed.slice(0, MAX_CONTENT_CHARS) + "..." : collapsed;
}

interface Entry {
  el: Element;
  id: number;
  line: string;
  flagKey: string;
  visible: boolean;
  inView: boolean;
  isHeading: boolean;
  isLink: boolean;
}

export function snapshot(): Snapshot {
  const candidates = Array.from(document.querySelectorAll(CANDIDATE_SELECTOR)).filter(isVisible);
  const headings = Array.from(document.querySelectorAll(HEADING_SELECTOR)).filter(isVisible);

  const entries: Entry[] = candidates.map((el) => {
    const id = idFor(el);
    const name = accessibleName(el);
    const flags = stateFlags(el);
    const inView = inViewport(el);
    flags.push("visible");
    if (inView) flags.push("in-viewport");
    const tag = tagLabel(el);
    const isHeading = /^h[123]$/.test(el.tagName.toLowerCase());
    const line = isHeading ? `[${id}] ${tag} "${name}"` : `[${id}] ${tag} "${name}" ${flags.join(" ")}`.trim();
    return {
      el,
      id,
      line,
      flagKey: flags.filter((f) => f !== "in-viewport").join("|"),
      visible: true,
      inView,
      isHeading,
      isLink: el.tagName.toLowerCase() === "a",
    };
  });

  // Cap: keep in-viewport first, then drop extra headings, then off-screen links.
  let kept = entries;
  if (kept.length > MAX_ELEMENTS) {
    let headingCount = 0;
    kept = kept.filter((e) => {
      if (e.isHeading) {
        headingCount++;
        return headingCount <= 10;
      }
      return true;
    });
  }
  if (kept.length > MAX_ELEMENTS) {
    kept = kept.filter((e) => !(e.isLink && !e.inView));
  }
  if (kept.length > MAX_ELEMENTS) {
    const inView = kept.filter((e) => e.inView);
    const rest = kept.filter((e) => !e.inView);
    kept = [...inView, ...rest].slice(0, MAX_ELEMENTS);
    kept.sort((a, b) => a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
  }

  // Group under section headings in document order.
  const lines: string[] = [];
  let currentSection = "";
  for (const e of kept) {
    if (e.isHeading) {
      lines.push(e.line);
      continue;
    }
    const section = nearestHeading(e.el, headings);
    if (section && section !== currentSection) {
      lines.push(`SECTION "${section}"`);
      currentSection = section;
    }
    lines.push(e.line);
  }

  const url = window.location.pathname + window.location.search;
  const header = `URL ${url}   TITLE ${clean(document.title, 100)}`;
  const content = visibleContent();

  // Change summary against the previous snapshot.
  const currentFlags = new Map<number, string>();
  for (const e of kept) currentFlags.set(e.id, e.flagKey);
  const changes: string[] = [];
  if (previousFlags) {
    for (const [id, key] of currentFlags) {
      if (!previousFlags.has(id)) changes.push(`+[${id}]`);
      else if (previousFlags.get(id) !== key) changes.push(`~[${id}] ${key.split("|").slice(0, 2).join(" ")}`);
    }
    for (const id of previousFlags.keys()) {
      if (!currentFlags.has(id)) changes.push(`-[${id}]`);
    }
    if (previousUrl !== null && previousUrl !== url) changes.push("url changed");
  }
  previousFlags = currentFlags;
  previousUrl = url;

  const changeLine =
    changes.length === 0
      ? "CHANGES SINCE LAST STEP: none"
      : `CHANGES SINCE LAST STEP: ${changes.slice(0, MAX_CHANGES).join("; ")}${changes.length > MAX_CHANGES ? "; ..." : ""}`;

  const text = [header, ...lines, `CONTENT: ${content}`, changeLine].join("\n");
  return { text, count: kept.length };
}

export function resetSnapshotMemory(): void {
  previousFlags = null;
  previousUrl = null;
}
