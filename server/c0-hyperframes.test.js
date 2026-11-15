import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { isHyperFrames, hyperframesInfo, withAdapter, ADAPTER_SRC } from './c0-hyperframes.js';
import { liveInfo, serve, liveCapable } from './live.js';

const fixtures = path.resolve('server', 'fixtures', 'hyperframes');
const example = path.resolve('examples', 'hello-film');
const tmp = path.resolve('.test-tmp', 'c0-hyperframes');
const readSample = name => ({ html: fs.readFileSync(path.join(fixtures, name, 'index.html'), 'utf8'), dir: path.join(fixtures, name) });

// a scratch film folder holding a copy of a sample (so liveInfo and serve read real files, not the repo's fixtures)
function filmCopy(name) {
  const dir = path.join(tmp, name + '-' + Math.random().toString(36).slice(2, 8));
  fs.mkdirSync(dir, { recursive: true });
  for (const f of ['index.html', 'hyperframes.json']) fs.copyFileSync(path.join(fixtures, name, f), path.join(dir, f));
  return { id: 'a1b2c3d4e5f6', name, path: dir, outputs: [] };
}

test('both HyperFrames samples are detected as HyperFrames pages', () => {
  for (const name of ['intro-2s', 'montage-5s']) {
    const { html, dir } = readSample(name);
    assert.equal(isHyperFrames(html, dir), true, name);
  }
});

test('a page without a composition root or hyperframes.json is not a HyperFrames page', () => {
  const html = fs.readFileSync(path.join(example, 'index.html'), 'utf8');
  assert.equal(isHyperFrames(html, example), false);
  assert.equal(hyperframesInfo(html, example), null);
  assert.equal(withAdapter(html, example), html);
});

test('a hyperframes.json beside the page makes it a HyperFrames page even without a composition root', () => {
  const dir = filmCopy('montage-5s').path;
  assert.equal(isHyperFrames('<html><body><div id="x"></div></body></html>', dir), true);
});

test('size, length and frame rate come from the root element, then hyperframes.json', () => {
  const { html, dir } = readSample('intro-2s');
  assert.deepEqual(hyperframesInfo(html, dir), { w: 1920, h: 1080, dur: 2, fps: 30 });
  const { html: html2, dir: dir2 } = readSample('montage-5s');
  assert.deepEqual(hyperframesInfo(html2, dir2), { w: 1920, h: 1080, dur: 5, fps: 30 });
  // no root sizes: hyperframes.json sizes, fps 30 when none is written
  const bare = '<div data-composition-id="x"></div>';
  const dir3 = filmCopy('montage-5s').path;
  fs.writeFileSync(path.join(dir3, 'hyperframes.json'), JSON.stringify({ width: 1280, height: 720 }));
  assert.deepEqual(hyperframesInfo(bare, dir3), { w: 1280, h: 720, dur: 0, fps: 30 });
});

test('the adapter goes in once, before </body>, and never into a page that brings its own renderOut', () => {
  const { html, dir } = readSample('montage-5s');
  const out = withAdapter(html, dir);
  const tag = `<script src="${ADAPTER_SRC}" data-width="1920" data-height="1080"></script>`;
  assert.equal(out.split(tag).length - 1, 1);
  assert.ok(out.indexOf(ADAPTER_SRC) < out.lastIndexOf('</body>'));
  assert.equal(out.replace(tag, ''), html);
  const own = html.replace('</body>', '<script>window.renderOut=function(){};</script></body>');
  assert.equal(withAdapter(own, dir), own);
});

test('liveInfo reads the samples: size, length, frame rate and the live page', async () => {
  const p = filmCopy('intro-2s');
  const info = await liveInfo(p);
  assert.equal(info.ok, true);
  assert.equal(info.page, 'index.html');
  assert.equal(info.w, 1920);
  assert.equal(info.h, 1080);
  assert.equal(info.dur, 2);
  assert.equal(info.durFrom, 'page');
  assert.equal(info.fps, 30);
  assert.equal(liveCapable(p), true);
  const names = filmCopy('montage-5s');
  const info2 = await liveInfo(names);
  assert.equal(info2.dur, 5);
  assert.equal(info2.fps, 30);
});

test('a saved project length or frame rate still wins over the page', async () => {
  const p = filmCopy('montage-5s');
  fs.mkdirSync(path.join(p.path, '.videohub'), { recursive: true });
  fs.writeFileSync(path.join(p.path, '.videohub', 'project.json'), JSON.stringify({ live: { dur: 3, fps: 60 } }));
  const info = await liveInfo(p);
  assert.equal(info.dur, 3);
  assert.equal(info.durFrom, 'saved');
  assert.equal(info.fps, 60);
});

test('the route injects the adapter into a HyperFrames page and into no other page', () => {
  const sent = [];
  const res = { writeHead(code, head) { this.code = code; this.head = head; }, end(body) { sent.push({ code: this.code, body }); }, destroy() {} };
  const p = filmCopy('intro-2s');
  serve({}, res, p, 'index.html');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].code, 200);
  assert.ok(sent[0].body.includes(`<script src="${ADAPTER_SRC}" data-width="1920" data-height="1080"></script></body>`), 'adapter before </body>');
  assert.ok(sent[0].body.includes(`src="assets/gsap.min.js"`), 'relative assets stay relative');
  // the film's own file is untouched on disk
  assert.equal(fs.readFileSync(path.join(p.path, 'index.html'), 'utf8').includes('c0-hyperframes'), false);
  // hello-film is not a HyperFrames page
  const other = { id: 'b1b2c3d4e5f6', name: 'hello', path: example, outputs: [] };
  serve({}, res, other, 'index.html');
  assert.equal(sent[1].body.includes('c0-hyperframes'), false);
});
