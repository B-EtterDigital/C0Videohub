// C0VIBE: the sound of HyperFrames drafts in the live preview (fork-only file; patch debt in c0/PATCH-DEBT.md).
// A HyperFrames page keeps its sound in <audio data-start> and <video data-start> elements whose src is relative to the
// page. The hub mixes those clips once into a WAV in its own data folder (never the film's folder). The cache key covers
// the page text, each clip's path, size and mtime, and the composition length, so an edited draft gets a new mix and an
// unchanged one reuses the file. The mix is built in the background: until it is ready the live preview answers without
// audio, and a finished mix is announced through onMixReady (the hub tells the open review).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR, TOOLS, run, isInside } from './util.js';
import { hyperframesInfo } from './c0-hyperframes.js';

export const HF_MIX_DIR = path.join(DATA_DIR, 'c0-hf-mix');
const VERSION = 1;        // bump when the mix changes (filters, format), so older mixes are not reused
const RATE = 48000;
const KEEP = 3;           // mixes kept per project: the newest
const TAG = /<(audio|video)\b[^>]*>/gi;
const URL_SRC = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;   // http:, data:, blob:, file:, protocol-relative: never read

// an attribute's value, quoted or bare; null when absent
function getAttr(tag, name) {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i'));
  return m ? (m[1] ?? m[2] ?? m[3]) : null;
}
const num = v => (v === null || !v.trim()) ? NaN : Number(v);
const pos = v => { const n = num(v); return Number.isFinite(n) && n >= 0 ? n : NaN; };

// the clips of a page: { clips: [{ file, rel, start, dur, volume, video }], refused: [src] }. src is relative to the page's
// folder, except that a leading "/" means the film's root (the live page is served from there). A URL, or a src that
// leaves the film's folder, is refused. A clip whose file is missing is skipped; a muted one is left out.
export function readClips(html, pageDir, filmDir) {
  const clips = [], refused = [];
  for (const m of html.matchAll(TAG)) {
    const tag = m[0], kind = m[1].toLowerCase();
    const start = pos(getAttr(tag, 'data-start'));
    if (!Number.isFinite(start)) continue;
    if (/\smuted(?=[\s/>=]|$)/i.test(tag)) continue;
    const raw = (getAttr(tag, 'src') || '').trim();
    if (!raw) continue;
    if (URL_SRC.test(raw)) { refused.push(raw); continue; }
    let rel = raw.split(/[?#]/)[0];
    try { rel = decodeURIComponent(rel); } catch { }
    const file = path.resolve(/^[/\\]/.test(rel) ? filmDir : pageDir, rel.replace(/^[/\\]+/, ''));
    if (!isInside(file, filmDir)) { refused.push(raw); continue; }
    let isFile = false; try { isFile = fs.statSync(file).isFile(); } catch { }
    if (!isFile) continue;
    const dur = pos(getAttr(tag, 'data-duration')), volume = pos(getAttr(tag, 'data-volume'));
    clips.push({
      file, rel: path.relative(filmDir, file).split(path.sep).join('/'), start,
      dur: Number.isFinite(dur) && dur > 0 ? dur : 0,
      volume: Number.isFinite(volume) ? Math.min(volume, 4) : 1,
      video: kind === 'video',
    });
  }
  return { clips, refused };
}

// the key covers what the mix is made from: the page text, the composition's declared length, and each clip's path,
// size, mtime and placement. The mix file is <project id>-<key>.wav in HF_MIX_DIR.
function keyOf(html, clips, declared) {
  const parts = clips.map(c => { const st = fs.statSync(c.file); return [c.rel, st.size, Math.round(st.mtimeMs), c.start, c.dur, c.volume, c.video]; });
  return crypto.createHash('sha1').update(JSON.stringify({ v: VERSION, html, declared, parts })).digest('hex').slice(0, 20);
}

// the plan for a HyperFrames page (sync, cheap): null when the page has no clips. pageDir is the page's folder.
export function planMix(p, page, html) {
  try {
    const pageDir = path.join(p.path, path.dirname(page));
    const { clips, refused } = readClips(html, pageDir, p.path);
    if (!clips.length) return null;
    const declared = hyperframesInfo(html, pageDir)?.dur || 0;
    return { projectId: p.id, file: path.join(HF_MIX_DIR, `${p.id}-${keyOf(html, clips, declared)}.wav`), clips, declared, refused, names: clips.map(c => c.rel).join(', ') };
  } catch { return null; }
}

// a clip's sound: its length, whether it has an audio stream, and its channel count (ffprobe)
async function soundOf(file) {
  const r = await run(TOOLS.ffprobe, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,channels', '-of', 'json', file]);
  try {
    const j = JSON.parse(r.stdout), a = (j.streams || []).find(s => s.codec_type === 'audio');
    return { dur: +j.format?.duration || 0, sound: !!a, channels: a ? (+a.channels || 2) : 0 };
  } catch { return { dur: 0, sound: false, channels: 0 }; }
}

// ffmpeg arguments: each clip is upmixed to stereo (a mono clip is copied to both sides at full level, not the -3 dB of
// the default conversion), trimmed to its duration, delayed to its start and scaled by its volume; the clips are summed
// without amix's level scaling, then padded and cut to the composition length
function mixArgs(clips, length, out) {
  const args = ['-v', 'error', '-y'];
  for (const c of clips) args.push('-i', c.file);
  const chains = clips.map((c, i) => {
    const f = [];
    if (c.channels === 1) f.push('pan=stereo|c0=c0|c1=c0');
    f.push(`aformat=sample_fmts=fltp:sample_rates=${RATE}:channel_layouts=stereo`);
    if (c.dur) f.push(`atrim=duration=${c.dur.toFixed(3)}`);
    if (c.start > 0) f.push(`adelay=${Math.round(c.start * 1000)}:all=1`);
    if (c.volume !== 1) f.push(`volume=${c.volume}`);
    return `[${i}:a]${f.join(',')}[a${i}]`;
  });
  chains.push(clips.map((_, i) => `[a${i}]`).join('') + `amix=inputs=${clips.length}:normalize=0:duration=longest:dropout_transition=0,apad[out]`);
  args.push('-filter_complex', chains.join(';'), '-map', '[out]', '-t', length.toFixed(3), '-ac', '2', '-ar', String(RATE), '-c:a', 'pcm_s16le', '-f', 'wav', out);
  return args;
}

// builds the mix; true when the file is written. Never rejects: a failed mix leaves the preview silent.
async function buildMix(plan) {
  try {
    const got = await Promise.all(plan.clips.map(c => soundOf(c.file)));
    const sounding = plan.clips.map((c, i) => ({ ...c, len: got[i].dur, channels: got[i].channels, sound: got[i].sound })).filter(c => c.sound);
    const length = plan.declared || Math.max(0, ...sounding.map(c => c.start + (c.dur || c.len)));
    const used = sounding.filter(c => c.start < length);
    if (!(length > 0) || !used.length) return false;
    fs.mkdirSync(HF_MIX_DIR, { recursive: true });
    const tmp = plan.file + '.' + process.pid + '.part';
    const r = await run(TOOLS.ffmpeg, mixArgs(used, length, tmp));
    if (r.code !== 0 || !fs.existsSync(tmp)) { try { fs.unlinkSync(tmp); } catch { } return false; }
    fs.renameSync(tmp, plan.file);
    return true;
  } catch { return false; }
}

// keeps the newest KEEP mixes of a project (an edited draft leaves the older mixes behind)
function prune(projectId, keep) {
  let names = []; try { names = fs.readdirSync(HF_MIX_DIR); } catch { return; }
  const mine = names.filter(n => n.startsWith(projectId + '-') && n.endsWith('.wav')).map(n => {
    const f = path.join(HF_MIX_DIR, n); try { return { f, t: fs.statSync(f).mtimeMs }; } catch { return null; }
  }).filter(Boolean).sort((a, b) => b.t - a.t);
  for (const x of mine.slice(KEEP)) if (x.f !== keep) try { fs.unlinkSync(x.f); } catch { }
}

// one build per mix file at a time. Resolves true when the mix exists afterwards.
const pending = new Map();
const listeners = new Set();
export const onMixReady = fn => { listeners.add(fn); return () => listeners.delete(fn); };
export function ensureMix(plan) {
  if (fs.existsSync(plan.file)) return Promise.resolve(true);
  if (!pending.has(plan.file)) pending.set(plan.file, buildMix(plan).then(ok => {
    pending.delete(plan.file);
    if (ok) {
      prune(plan.projectId, plan.file);
      for (const fn of listeners) try { fn({ project: plan.projectId }); } catch { }
    }
    return ok;
  }));
  return pending.get(plan.file);
}

// the sound of a HyperFrames page that has clips: { path, names }, path is null until the mix is ready (the build starts
// in the background and onMixReady announces it). null when the page has no clips: the caller keeps its own rule.
export function hyperframesSound(p, page, html) {
  const plan = planMix(p, page, html);
  if (!plan) return null;
  if (fs.existsSync(plan.file)) return { path: plan.file, names: plan.names };
  ensureMix(plan);
  return { path: null, names: plan.names };
}
