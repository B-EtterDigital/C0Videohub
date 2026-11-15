// C0VIBE: HyperFrames drafts in the live preview (fork-only file). The hub adds this one script to a HyperFrames page
// (server/c0-hyperframes.js) when the page has no window.renderOut of its own. It defines window.renderOut(t):
//  - every GSAP timeline in window.__timelines is paused and seeked to t, with events on, so onUpdate callbacks draw;
//  - every element with data-start is shown only inside [start, start + data-duration) (no duration: until the end);
//  - every <video>/<audio> with data-start is set to t - start and paused; the returned promise waits for its seek.
// window.READY turns true once a timeline is registered, images and media have data and the fonts are ready.
(function () {
  if (typeof window.renderOut === 'function') return;
  // the film's size, from the hub's tag: the review would otherwise take the page's largest canvas for the film
  const tag = document.currentScript && document.currentScript.dataset;
  if (tag && +tag.width && +tag.height && !window.__config) window.__config = { width: +tag.width, height: +tag.height };
  const EPS = 1e-6;   // the page's own times carry float noise (1.3800000000000001): no one-frame gap between clips
  const MEDIA = /^(VIDEO|AUDIO)$/;
  const shown = new WeakMap();   // an element's own inline display, restored when its clip shows again
  const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
  const clips = () => document.querySelectorAll('[data-start]');

  function timelines() {
    const all = window.__timelines || {};
    return Object.keys(all).map(k => all[k]).filter(tl => tl && typeof tl.totalTime === 'function');
  }
  function span(el) {
    const start = num(el.getAttribute('data-start')) ?? 0, len = num(el.getAttribute('data-duration'));
    return { start, end: len === null ? Infinity : start + len };
  }
  const inside = (s, t) => t >= s.start - EPS && t < s.end - EPS;
  function show(el, on) {
    if (!shown.has(el)) shown.set(el, el.style.display);
    el.style.display = on ? (shown.get(el) || '') : 'none';
  }
  // a media element's moment: its seek, when it needs one, resolves on 'seeked' (or 'error')
  function seekMedia(el, t, s) {
    el.pause();
    const target = Math.max(0, t - s.start);
    if (Math.abs(el.currentTime - target) < 1e-4) return null;
    return new Promise(done => {
      const end = () => { el.removeEventListener('seeked', end); el.removeEventListener('error', end); done(); };
      el.addEventListener('seeked', end); el.addEventListener('error', end);
      el.currentTime = target;
    });
  }
  const hasMedia = el => MEDIA.test(el.tagName) && (el.getAttribute('src') || el.querySelector('source'));
  const mediaLoading = el => hasMedia(el) && el.readyState < 1 && !el.error;

  window.renderOut = function renderOut(t) {
    const at = Math.max(0, +t || 0), seeks = [];
    for (const tl of timelines()) { tl.pause(); tl.totalTime(at, false); }
    for (const el of clips()) {
      const s = span(el), on = inside(s, at);
      show(el, on);
      if (MEDIA.test(el.tagName)) {
        el.pause();
        const pending = on ? seekMedia(el, at, s) : null;
        if (pending) seeks.push(pending);
      }
    }
    return Promise.all(seeks).then(() => undefined);
  };

  // ready: a timeline exists (a page may register it after an image loads), images are complete, media has metadata
  function loaded() {
    if (!timelines().length) return false;
    for (const im of document.images) if (!im.complete) return false;
    for (const el of clips()) if (mediaLoading(el)) return false;
    return true;
  }
  function boot() {
    if (!loaded()) { setTimeout(boot, 50); return; }
    const fonts = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    fonts.then(() => { window.READY = true; }, () => { window.READY = true; });
  }
  for (const el of clips()) if (MEDIA.test(el.tagName) && el.preload === 'none') el.preload = 'auto';   // media must load to be ready
  boot();
})();
