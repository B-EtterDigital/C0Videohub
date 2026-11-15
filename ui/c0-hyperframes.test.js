import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Runs the real adapter in a light DOM shim: timelines, clips with data-start, media and document.images.
// Browser behaviour that matters here (headless Chromium frame capture) is proven outside the suite.
const source = fs.readFileSync(new URL('./c0-hyperframes.js', import.meta.url), 'utf8');

function element(tag, attrs = {}) {
  const listeners = {};
  return {
    tagName: tag.toUpperCase(), attrs, style: { display: '' }, pauses: 0, currentTime: 0, readyState: 4, error: null, preload: 'auto', complete: true,
    getAttribute(name) { return name in this.attrs ? this.attrs[name] : null; },
    pause() { this.pauses++; },
    querySelector() { return null; },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    removeEventListener(type, fn) { listeners[type] = (listeners[type] || []).filter(f => f !== fn); },
    fire(type) { for (const fn of [...(listeners[type] || [])]) fn(); },
    listenerCount(type) { return (listeners[type] || []).length; },
  };
}

function timeline(log) {
  return {
    onUpdate: null,
    pause() { log.push(['pause']); },
    totalTime(t, suppressEvents) { log.push(['totalTime', t, suppressEvents]); this.time = t; if (!suppressEvents && this.onUpdate) this.onUpdate(t); },
  };
}

function harness({ elements = [], images = [], timelines = {}, own = false, fontsReady = true, tag = null } = {}) {
  const timers = [];
  const doc = {
    images,
    fonts: { ready: fontsReady ? Promise.resolve() : new Promise(() => {}) },
    querySelectorAll: sel => (sel === '[data-start]' ? elements.filter(e => 'data-start' in e.attrs) : []),
    currentScript: tag ? { dataset: tag } : null,
  };
  const sandbox = {
    document: doc,
    setTimeout: fn => { timers.push(fn); return timers.length; },
    Promise, WeakMap, Math, Number, parseFloat, Object, Array, Infinity, Event: class {},
    __timelines: timelines,
  };
  sandbox.window = sandbox;
  if (own) sandbox.renderOut = () => 'page';
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  const runTimers = () => { for (const fn of timers.splice(0)) fn(); };
  const settle = async () => { for (let i = 0; i < 5; i++) { await new Promise(r => setImmediate(r)); runTimers(); } };
  return { sandbox, settle, timers, runTimers };
}

test('a page that brings its own renderOut keeps it', () => {
  const { sandbox } = harness({ own: true });
  assert.equal(sandbox.renderOut(), 'page');
});

test('READY waits for a timeline, complete images and fonts; it does not come early', async () => {
  const tl = timeline([]);
  const img = element('img', { src: 'x.svg' }); img.complete = false;
  const { sandbox, settle } = harness({ images: [img], timelines: {} });
  await settle();
  assert.equal(sandbox.READY, undefined, 'no timeline yet');
  sandbox.__timelines.a = tl;
  await settle();
  assert.equal(sandbox.READY, undefined, 'image still loading');
  img.complete = true;
  await settle();
  assert.equal(sandbox.READY, true);
});

test('READY waits for media metadata, and does not wait for media that has no source', async () => {
  const log = [];
  const withSrc = element('audio', { 'data-start': '0', src: 'a.wav' }); withSrc.readyState = 0;
  const noSrc = element('audio', { 'data-start': '0' }); noSrc.readyState = 0;
  const { sandbox, settle } = harness({ elements: [withSrc, noSrc], timelines: { a: timeline(log) } });
  await settle();
  assert.equal(sandbox.READY, undefined, 'the sound is still loading');
  withSrc.readyState = 4;
  await settle();
  assert.equal(sandbox.READY, true);
});

test('READY needs the fonts; a font that never loads blocks it', async () => {
  const { sandbox, settle } = harness({ timelines: { a: timeline([]) }, fontsReady: false });
  await settle();
  assert.equal(sandbox.READY, undefined);
});

test('renderOut pauses every timeline and seeks it with events on, so onUpdate callbacks draw the frame', () => {
  const log = [];
  const tl = timeline(log);
  let drawn = null;
  tl.onUpdate = t => { drawn = t; };
  const { sandbox } = harness({ timelines: { a: tl } });
  sandbox.renderOut(1.5);
  assert.deepEqual(log, [['pause'], ['totalTime', 1.5, false]]);
  assert.equal(drawn, 1.5);
});

test('clips show only inside [start, start + duration); the boundary frame belongs to the next clip', () => {
  const particle = element('section', { 'data-start': '0.12', 'data-duration': '1.1600000000000001' });
  const lockup = element('section', { 'data-start': '1.28', 'data-duration': '0.72' });
  const { sandbox } = harness({ elements: [particle, lockup], timelines: { a: timeline([]) } });
  sandbox.renderOut(0);
  assert.equal(particle.style.display, 'none');
  assert.equal(lockup.style.display, 'none');
  sandbox.renderOut(0.5);
  assert.equal(particle.style.display, '');
  assert.equal(lockup.style.display, 'none');
  sandbox.renderOut(1.28);
  assert.equal(particle.style.display, 'none', 'particle ends at 1.28');
  assert.equal(lockup.style.display, '');
  sandbox.renderOut(2.0);
  assert.equal(lockup.style.display, 'none', 'lockup ends at 2.0');
});

test('float noise in the page times leaves no one-frame gap (a montage: clip ends at 1.38, next starts at 1.3800000000000001)', () => {
  const n2 = element('section', { 'data-start': '0.92', 'data-duration': '0.46' });
  const n3 = element('section', { 'data-start': '1.3800000000000001', 'data-duration': '0.46' });
  const { sandbox } = harness({ elements: [n2, n3], timelines: { a: timeline([]) } });
  sandbox.renderOut(1.38);
  assert.equal(n2.style.display, 'none');
  assert.equal(n3.style.display, '');
});

test('a clip with no duration shows until the end of the film', () => {
  const open = element('section', { 'data-start': '2' });
  const { sandbox } = harness({ elements: [open], timelines: { a: timeline([]) } });
  sandbox.renderOut(1);
  assert.equal(open.style.display, 'none');
  sandbox.renderOut(999);
  assert.equal(open.style.display, '');
});

test('a clip keeps its own inline display when it is shown again', () => {
  const clip = element('section', { 'data-start': '0', 'data-duration': '1' });
  clip.style.display = 'flex';
  const { sandbox } = harness({ elements: [clip], timelines: { a: timeline([]) } });
  sandbox.renderOut(5); assert.equal(clip.style.display, 'none');
  sandbox.renderOut(0.5); assert.equal(clip.style.display, 'flex');
});

test('audio with data-start is set to t - start and paused; the promise waits for its seek', async () => {
  const sound = element('audio', { 'data-start': '0.5', 'data-duration': '2', src: 'a.wav' });
  const { sandbox } = harness({ elements: [sound], timelines: { a: timeline([]) } });
  const pending = sandbox.renderOut(1.0);
  assert.equal(sound.currentTime, 0.5);
  assert.ok(sound.pauses > 0);
  let done = false;
  pending.then(() => { done = true; });
  await new Promise(r => setImmediate(r));
  assert.equal(done, false, 'still seeking');
  sound.fire('seeked');
  await new Promise(r => setImmediate(r));
  assert.equal(done, true);
});

test('media outside its window is hidden, paused, and not moved', () => {
  const video = element('video', { 'data-start': '0.5', 'data-duration': '1', src: 'v.mp4' });
  video.currentTime = 0.2;
  const { sandbox } = harness({ elements: [video], timelines: { a: timeline([]) } });
  sandbox.renderOut(3);
  assert.equal(video.style.display, 'none');
  assert.equal(video.currentTime, 0.2);
  assert.ok(video.pauses > 0);
});

test('a media seek that is already at its moment does not seek again', () => {
  const sound = element('audio', { 'data-start': '0', 'data-duration': '5', src: 'a.wav' });
  sound.currentTime = 1;
  const { sandbox } = harness({ elements: [sound], timelines: { a: timeline([]) } });
  sandbox.renderOut(1);
  assert.equal(sound.listenerCount('seeked'), 0, 'no wait was started: it was already there');
  assert.equal(sound.currentTime, 1);
});

test('the size from the hub tag is published as window.__config, so the review keeps the film size', () => {
  const { sandbox } = harness({ timelines: { a: timeline([]) }, tag: { width: '1920', height: '1080' } });
  assert.equal(sandbox.__config.width, 1920);
  assert.equal(sandbox.__config.height, 1080);
});

test('a page that already has a __config keeps it, and no tag publishes nothing', () => {
  const kept = harness({ timelines: { a: timeline([]) } });
  assert.equal(kept.sandbox.__config, undefined, 'no tag, no size');
  const own = harness({ timelines: { a: timeline([]) }, tag: { width: '1920', height: '1080' } });
  assert.equal(own.sandbox.__config.width, 1920);
  const pageOwn = harness({ timelines: { a: timeline([]) }, tag: { width: '1920', height: '1080' } });
  pageOwn.sandbox.__config = { width: 1280, height: 720 };
  vm.runInContext(source, pageOwn.sandbox);   // the adapter runs again: the page's own size stays
  assert.equal(pageOwn.sandbox.__config.width, 1280);
});
