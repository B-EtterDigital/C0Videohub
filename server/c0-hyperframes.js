// C0VIBE: HyperFrames drafts in the live preview (fork-only file; patch debt in c0/PATCH-DEBT.md).
// A HyperFrames page is an index.html whose root element has data-composition-id, or any page with a hyperframes.json
// beside it. Such a page has no window.renderOut of its own, so the hub adds ui/c0-hyperframes.js to it while serving
// /live/<id>/... The film's folder is never written. Size, length and frame rate come from the page's root element and
// from hyperframes.json.
import fs from 'node:fs';
import path from 'node:path';

export const ADAPTER_SRC = '/c0-hyperframes.js';   // the hub's UI folder, served at the root
const COMPOSITION = /<[a-z][^>]*\sdata-composition-id\s*=\s*["'][^"']*["'][^>]*>/i;   // the root element's opening tag

const attr = (tag, name) => { const m = tag.match(new RegExp('\\sdata-' + name + '\\s*=\\s*["\']([^"\']*)["\']', 'i')); return m ? m[1] : null; };
const positive = v => { const n = parseFloat(v); return Number.isFinite(n) && n > 0 ? n : 0; };
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

// a HyperFrames page: its root has data-composition-id, or its folder has a hyperframes.json
export function isHyperFrames(html, dir) {
  return COMPOSITION.test(html) || fs.existsSync(path.join(dir, 'hyperframes.json'));
}

// size, length and frame rate of a HyperFrames page: the root's data-width/data-height/data-duration first, then
// hyperframes.json (fps 30 when it has none). Zero means "not known" and the caller keeps its own default.
export function hyperframesInfo(html, dir) {
  if (!isHyperFrames(html, dir)) return null;
  const cfg = readJson(path.join(dir, 'hyperframes.json')) || {};
  const root = html.match(COMPOSITION)?.[0] || '';
  return {
    w: positive(attr(root, 'width')) || positive(cfg.width),
    h: positive(attr(root, 'height')) || positive(cfg.height),
    dur: positive(attr(root, 'duration')) || positive(cfg.duration),
    fps: positive(cfg.fps) || 30,
  };
}

// the page as the hub serves it: one script before </body>, unless the page brings its own renderOut. The composition's
// size rides on the tag: without it the review takes the page's largest canvas (a 640 px particle canvas) as the film.
export function withAdapter(html, dir) {
  if (html.includes('renderOut') || !isHyperFrames(html, dir)) return html;
  const { w, h } = hyperframesInfo(html, dir);
  const size = w && h ? ` data-width="${w}" data-height="${h}"` : '';
  const tag = `<script src="${ADAPTER_SRC}"${size}></script>`;
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, tag + '</body>') : html + tag;
}
