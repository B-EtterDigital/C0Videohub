// C0VIBE theme bridge (ours, not upstream). The host sets the guest's colours with one stylesheet rule that
// overrides the :root variables (--bg, --panel, --text, ...) and then dispatches the window event 'c0:theme'.
// Canvas chrome cannot read CSS variables, so it asks here: vhColor reads the computed value (cached until the next
// theme change), and onThemeChange lets a canvas redraw when the colours change. No DOM work happens at import.

const FALLBACK = '#888888';   // a chrome name missing from :root: visibly grey, never silently transparent
const cache = new Map();
const listeners = new Set();
let wired = false;

function wire() {
  if (wired || typeof window === 'undefined' || !window.addEventListener) return;
  wired = true;
  window.addEventListener('c0:theme', () => {
    cache.clear();
    for (const fn of [...listeners]) fn();
  });
}

// '#rgb', '#rrggbb' or 'rgb(…)' / 'rgba(…)' → [r, g, b]; anything else → null (returned as-is, without alpha)
function rgbOf(value) {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map(c => c + c).join('') : hex[1];
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  }
  const rgb = /^rgba?\(\s*(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)/i.exec(value);
  return rgb ? [+rgb[1], +rgb[2], +rgb[3]] : null;
}

// vhColor('panel') → the current --panel; vhColor('yellow', .35) → the same colour at 35% alpha (rgba string).
// The name is a variable name from :root, with or without the leading dashes.
export function vhColor(name, alpha) {
  wire();
  const key = String(name).replace(/^--/, '');
  let base = cache.get(key);
  if (base === undefined) {
    const css = typeof document !== 'undefined' && document.documentElement && typeof getComputedStyle === 'function'
      ? getComputedStyle(document.documentElement).getPropertyValue('--' + key).trim() : '';
    base = css || FALLBACK;
    cache.set(key, base);
  }
  if (alpha == null || alpha >= 1) return base;
  const rgb = rgbOf(base);
  if (!rgb) return base;
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${Math.max(0, alpha)})`;
}

// fn() runs after every theme change (the cache is already cleared). Returns a function that unsubscribes.
export function onThemeChange(fn) {
  wire();
  listeners.add(fn);
  return () => listeners.delete(fn);
}
