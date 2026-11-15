import test from 'node:test';
import assert from 'node:assert/strict';
import { vhColor, onThemeChange } from './c0-theme.js';

// A fake page: the host's :root values live in `vars`; c0-theme only touches document/getComputedStyle/window when called.
const vars = { '--panel': ' #17181d ', '--yellow': '#e6c14d', '--text': 'rgb(232, 232, 238)', '--short': '#abc' };
globalThis.document = { documentElement: {} };
globalThis.getComputedStyle = () => ({ getPropertyValue: name => vars[name] ?? '' });
globalThis.window = new EventTarget();
const host = (next) => { Object.assign(vars, next); window.dispatchEvent(new Event('c0:theme')); };

test('vhColor reads the computed variable, trimmed, with or without the dashes', () => {
  assert.equal(vhColor('panel'), '#17181d');
  assert.equal(vhColor('--panel'), '#17181d');
});

test('vhColor with an alpha returns rgba() from hex and rgb() values', () => {
  assert.equal(vhColor('yellow', .35), 'rgba(230, 193, 77, 0.35)');
  assert.equal(vhColor('text', .5), 'rgba(232, 232, 238, 0.5)');
  assert.equal(vhColor('short', .25), 'rgba(170, 187, 204, 0.25)');
});

test('vhColor without a usable alpha returns the value unchanged', () => {
  assert.equal(vhColor('yellow', 1), '#e6c14d');
  assert.equal(vhColor('yellow', undefined), '#e6c14d');
});

test('a missing variable is a visible grey, never transparent', () => {
  assert.equal(vhColor('no-such-token'), '#888888');
});

test('values are cached until the host dispatches c0:theme', () => {
  assert.equal(vhColor('panel'), '#17181d');
  vars['--panel'] = '#ffffff';                 // the host changed the stylesheet but has not announced it yet
  assert.equal(vhColor('panel'), '#17181d');
  host({});                                    // announcement: the cache is dropped
  assert.equal(vhColor('panel'), '#ffffff');
  host({ '--panel': '#17181d' });
});

test('onThemeChange listeners run after the cache is cleared, and can unsubscribe', () => {
  const seen = [];
  const off = onThemeChange(() => seen.push(vhColor('yellow')));
  host({ '--yellow': '#7a5a00' });
  assert.deepEqual(seen, ['#7a5a00']);
  off();
  host({ '--yellow': '#e6c14d' });
  assert.deepEqual(seen, ['#7a5a00']);
});
