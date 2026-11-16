import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readClips, planMix, ensureMix, hyperframesSound, onMixReady, HF_MIX_DIR } from './c0-hyperframes-audio.js';
import { liveInfo } from './live.js';
import { probe } from './util.js';

const fixtures = path.resolve('server', 'fixtures', 'hyperframes');
const example = path.resolve('examples', 'hello-film');
const tmp = path.resolve('.test-tmp', 'c0-hf-audio');

// a WAV written by hand: 16-bit PCM at 48 kHz (mono, or stereo) with a constant level, so the mix can be read back sample by sample
function wav(file, seconds, level, channels = 1) {
  const rate = 48000, n = Math.round(seconds * rate) * channels, data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(level * 32767), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2 * channels, 28); h.writeUInt16LE(2 * channels, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([h, data]));
}

// left-channel RMS (0..1) of each window of a WAV written by the mix (walks the RIFF chunks; 16-bit stereo)
function windows(file, size) {
  const b = fs.readFileSync(file);
  let at = 12, ch = 0, bits = 0, rate = 0, dataAt = -1, dataLen = 0;
  while (at + 8 <= b.length) {
    const id = b.toString('ascii', at, at + 4), len = b.readUInt32LE(at + 4);
    if (id === 'fmt ') { ch = b.readUInt16LE(at + 10); rate = b.readUInt32LE(at + 12); bits = b.readUInt16LE(at + 22); }
    if (id === 'data') { dataAt = at + 8; dataLen = Math.min(len, b.length - dataAt); break; }
    at += 8 + len + (len & 1);
  }
  assert.equal(bits, 16);
  const frame = 2 * ch, frames = Math.floor(dataLen / frame), per = Math.round(size * rate);
  const out = [];
  for (let w = 0; w * per < frames; w++) {
    let s = 0, n = 0;
    for (let i = w * per; i < Math.min(frames, (w + 1) * per); i++) { const v = b.readInt16LE(dataAt + i * frame) / 32768; s += v * v; n++; }
    out.push(Math.sqrt(s / n));
  }
  return { rate, frames, windows: out };
}

function film(name) {
  const root = path.join(tmp, name + '-' + crypto.randomBytes(3).toString('hex'));
  const dir = path.join(root, 'film');
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  return { id: crypto.randomBytes(6).toString('hex'), name, path: dir, root, outputs: [] };
}

// a HyperFrames page with a 3 s composition and the given markup after its clip
const page = (body = '', length = 3) => `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root" data-composition-id="sound-3s" data-width="640" data-height="360" data-duration="${length}"><section class="clip" data-start="0" data-duration="${length}">A</section>${body}</div></body></html>`;

// the two clips of the synthetic draft: a.wav (1 s, level .5) trimmed to 0.5 s at 0 s; b.wav (1 s, level .5) at 1.5 s, volume .5
function soundFilm(name) {
  const p = film(name);
  wav(path.join(p.path, 'assets', 'a.wav'), 1, 0.5);
  wav(path.join(p.path, 'assets', 'b.wav'), 1, 0.5);
  const html = page('<audio id="a" src="assets/a.wav" data-start="0" data-duration="0.5"></audio><audio id="b" src="assets/b.wav" data-start="1.5" data-volume="0.5"></audio>');
  fs.writeFileSync(path.join(p.path, 'index.html'), html);
  fs.writeFileSync(path.join(p.path, 'hyperframes.json'), JSON.stringify({ width: 640, height: 360, fps: 30 }));
  return { p, html };
}

test('the repo samples carry no clips: both read as silent, nothing refused', () => {
  for (const name of ['intro-2s', 'montage-5s']) {
    const dir = path.join(fixtures, name);
    const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
    assert.deepEqual(readClips(html, dir, dir), { clips: [], refused: [] }, name);
  }
  const hello = fs.readFileSync(path.join(example, 'index.html'), 'utf8');
  assert.deepEqual(readClips(hello, example, example), { clips: [], refused: [] });
});

test('a page shaped like the channel intro (one audio clip at 0 s with a duration) reads one clip', () => {
  const p = film('intro');
  wav(path.join(p.path, 'assets', 'channel-intro-2s.wav'), 2, 0.3);
  const html = page('<audio id="sound" src="assets/channel-intro-2s.wav" data-start="0" data-duration="2"></audio>', 2);
  const { clips, refused } = readClips(html, p.path, p.path);
  assert.deepEqual(refused, []);
  assert.equal(clips.length, 1);
  assert.equal(clips[0].rel, 'assets/channel-intro-2s.wav');
  assert.equal(clips[0].start, 0);
  assert.equal(clips[0].dur, 2);
  assert.equal(clips[0].volume, 1);
  assert.equal(clips[0].video, false);
});

test('clips: start offsets and volume are read, URLs and sources outside the film are refused, missing or muted clips are left out', () => {
  const p = film('clips');
  wav(path.join(p.path, 'assets', 'a.wav'), 1, 0.5);
  wav(path.join(p.path, 'assets', 'b.wav'), 1, 0.5);
  wav(path.join(p.path, 'assets', 'quiet.wav'), 1, 0.5);
  wav(path.join(p.root, 'outside.wav'), 1, 0.5);   // exists, but beside the film folder, not inside it
  const html = page(
    '<audio src="assets/a.wav" data-start="0" data-duration="1"></audio>' +
    '<audio src=\'assets/b.wav\' data-start=\'1.5\' data-volume=".5"></audio>' +
    '<audio src="../outside.wav" data-start="0"></audio>' +
    '<audio src="https://example.com/x.wav" data-start="0"></audio>' +
    '<audio src="assets/missing.wav" data-start="0"></audio>' +
    '<audio src="assets/quiet.wav" data-start="0" muted></audio>' +
    '<audio src="assets/a.wav"></audio>');
  const { clips, refused } = readClips(html, p.path, p.path);
  assert.deepEqual(clips.map(c => [c.rel, c.start, c.dur, c.volume]), [['assets/a.wav', 0, 1, 1], ['assets/b.wav', 1.5, 0, 0.5]]);
  assert.deepEqual(refused, ['../outside.wav', 'https://example.com/x.wav']);
  assert.ok(clips.every(c => path.resolve(c.file).startsWith(path.resolve(p.path) + path.sep)));
});

test('a src in a subfolder page resolves beside that page, and a leading slash means the film root', () => {
  const p = film('subpage');
  fs.mkdirSync(path.join(p.path, 'scenes'), { recursive: true });
  wav(path.join(p.path, 'scenes', 'x.wav'), 0.2, 0.5);
  wav(path.join(p.path, 'top.wav'), 0.2, 0.5);
  const html = page('<audio src="x.wav" data-start="0"></audio><audio src="/top.wav" data-start="0"></audio>');
  const { clips } = readClips(html, path.join(p.path, 'scenes'), p.path);
  assert.deepEqual(clips.map(c => c.rel), ['scenes/x.wav', 'top.wav']);
});

test('the cache key is stable for an unchanged draft and changes with the page, a clip, or the length', () => {
  const { p, html } = soundFilm('key');
  const a = planMix(p, 'index.html', html);
  const b = planMix(p, 'index.html', html);
  assert.equal(a.file, b.file, 'unchanged draft: same mix');
  assert.equal(path.dirname(a.file), HF_MIX_DIR, 'the mix goes to the hub data folder');
  assert.ok(path.relative(p.path, a.file).startsWith('..'), 'never inside the film folder');
  assert.ok(path.basename(a.file).startsWith(p.id + '-'));
  // a clip rewritten (new size and mtime): new mix
  wav(path.join(p.path, 'assets', 'a.wav'), 1.25, 0.5);
  const c = planMix(p, 'index.html', html);
  assert.notEqual(c.file, a.file, 'clip changed');
  // the page text changed (a clip moved): new mix
  const moved = planMix(p, 'index.html', html.replace('data-start="1.5"', 'data-start="1.75"'));
  assert.notEqual(moved.file, c.file, 'page changed');
  // the composition length changed: new mix
  const longer = planMix(p, 'index.html', html.replace('data-height="360" data-duration="3"', 'data-height="360" data-duration="4"'));
  assert.notEqual(longer.file, c.file, 'length changed');
});

test('a page without clips has no plan and stays silent; the repo fixtures are silent in the live preview', async () => {
  const p = film('silent');
  const html = page('');
  fs.writeFileSync(path.join(p.path, 'index.html'), html);
  assert.equal(planMix(p, 'index.html', html), null);
  assert.equal(hyperframesSound(p, 'index.html', html), null);
  // the repo's intro sample, copied into a scratch film (liveInfo reads and may write the film's folder)
  const sample = film('intro-sample');
  for (const f of ['index.html', 'hyperframes.json']) fs.copyFileSync(path.join(fixtures, 'intro-2s', f), path.join(sample.path, f));
  const info = await liveInfo(sample);
  assert.equal(info.ok, true);
  assert.equal(info.audio, null);
  assert.equal(info.audioName, null);
});

test('the mix has the composition length, places each clip at its start, trims it, and sums it at its volume', async () => {
  const { p, html } = soundFilm('mix');
  const plan = planMix(p, 'index.html', html);
  assert.equal(await ensureMix(plan), true);
  assert.ok(fs.existsSync(plan.file));
  const info = await probe(plan.file);
  assert.ok(Math.abs(info.dur - 3) < 0.05, 'length ' + info.dur);
  assert.equal(info.audio, true);
  // 0.25 s windows: a.wav 0-0.5 s at .5; b.wav 1.5-2.5 s at .5 x .5 = .25; everything else silent
  const { windows: w, rate, frames } = windows(plan.file, 0.25);
  assert.equal(rate, 48000);
  assert.ok(Math.abs(frames / rate - 3) < 0.05);
  const want = [0.5, 0.5, 0, 0, 0, 0, 0.25, 0.25, 0.25, 0.25, 0, 0];
  assert.equal(w.length, want.length);
  w.forEach((v, i) => {
    if (want[i] === 0) assert.ok(v < 0.01, `window ${i} quiet, got ${v.toFixed(3)}`);
    else assert.ok(Math.abs(v - want[i]) < 0.02, `window ${i} ${want[i]}, got ${v.toFixed(3)}`);
  });
});

test('a stereo clip keeps its level in the mix, and a mono clip is not quieter than its source', async () => {
  const p = film('stereo');
  wav(path.join(p.path, 'assets', 's.wav'), 1, 0.5, 2);
  wav(path.join(p.path, 'assets', 'm.wav'), 1, 0.5, 1);
  const html = page('<audio src="assets/s.wav" data-start="0" data-duration="1"></audio><audio src="assets/m.wav" data-start="2" data-duration="1"></audio>');
  const plan = planMix(p, 'index.html', html);
  assert.equal(await ensureMix(plan), true);
  const { windows: w } = windows(plan.file, 0.5);
  // 0.5 s windows: the stereo clip fills 0-1 s, silence 1-2 s, the mono clip fills 2-3 s
  const want = [0.5, 0.5, 0, 0, 0.5, 0.5];
  assert.equal(w.length, want.length);
  want.forEach((v, i) => {
    if (v === 0) assert.ok(w[i] < 0.01, `window ${i} quiet, got ${w[i].toFixed(3)}`);
    else assert.ok(Math.abs(w[i] - v) < 0.02, `window ${i} ${v}, got ${w[i].toFixed(3)}`);
  });
});

test('the mix is announced once it exists, and the live preview names the clips and serves the mix after that', async () => {
  const { p, html } = soundFilm('live');
  const events = [];
  const off = onMixReady(ev => events.push(ev));
  try {
    const first = hyperframesSound(p, 'index.html', html);
    assert.equal(first.path, null, 'not ready: answers without audio');
    assert.equal(first.names, 'assets/a.wav, assets/b.wav');
    await ensureMix(planMix(p, 'index.html', html));
    assert.deepEqual(events, [{ project: p.id }]);
    const info = await liveInfo(p);
    assert.equal(info.ok, true);
    assert.equal(info.durFrom, 'page');
    assert.equal(info.dur, 3);
    assert.equal(info.audioName, 'assets/a.wav, assets/b.wav');
    assert.ok(info.audio.startsWith('/media?p='));
    const file = decodeURIComponent(info.audio.slice('/media?p='.length));
    assert.equal(file, info.audioPath);
    assert.equal(path.dirname(file), HF_MIX_DIR);
  } finally { off(); }
});

test('an explicit live.audio in the project still wins over the draft clips', async () => {
  const { p, html } = soundFilm('explicit');
  wav(path.join(p.path, 'audio', 'mix.wav'), 1, 0.1);
  fs.mkdirSync(path.join(p.path, '.videohub'), { recursive: true });
  fs.writeFileSync(path.join(p.path, '.videohub', 'project.json'), JSON.stringify({ live: { audio: 'audio/mix.wav' } }));
  const info = await liveInfo(p);
  assert.equal(info.audioPath, path.join(p.path, 'audio', 'mix.wav'));
});

test('a draft keeps the newest three mixes of a project, and the newest mix is never removed', async () => {
  const { p, html } = soundFilm('prune');
  for (const start of ['1.5', '1.6', '1.7', '1.8']) {
    const h = html.replace('data-start="1.5"', `data-start="${start}"`);
    assert.equal(await ensureMix(planMix(p, 'index.html', h)), true);
  }
  const mine = fs.readdirSync(HF_MIX_DIR).filter(n => n.startsWith(p.id + '-') && n.endsWith('.wav'));
  assert.equal(mine.length, 3);
  const last = planMix(p, 'index.html', html.replace('data-start="1.5"', 'data-start="1.8"'));
  assert.ok(fs.existsSync(last.file));
});
