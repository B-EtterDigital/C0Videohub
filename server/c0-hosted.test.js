import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tokenRefused, hostedConfigPatch, hostedEnv, assertScriptInside, hostedCopyTo } from './c0-hosted.js';

const tmp = path.resolve('.test-tmp', 'c0-hosted');

test('a hub started without hosted mode keeps every behaviour', () => {
  assert.equal(tokenRefused({ headers: {} }, ''), null);
  const patch = { roots: [{ path: '/' }], render: { confirmCommands: false } };
  assert.deepEqual(hostedConfigPatch(patch, false), patch);
});

test('the token is required once the host sets one', () => {
  assert.equal(tokenRefused({ headers: {} }, 'secret'), 'token');
  assert.equal(tokenRefused({ headers: { 'x-videohub-token': 'wrong' } }, 'secret'), 'token');
  assert.equal(tokenRefused({ headers: { 'x-videohub-token': 'secret' } }, 'secret'), null);
});

test('settings that decide what runs or what is read stay with the host', () => {
  const out = hostedConfigPatch({ roots: [{ path: '/' }], studioDir: '/tmp/x', outputsDir: '/', port: 1, theme: 'dark', render: { confirmCommands: false, encoder: 'x264' } }, true);
  assert.deepEqual(out, { theme: 'dark', render: { encoder: 'x264' } });
});

test('render settings cannot set variables that change how programs load code', () => {
  const out = hostedEnv({ DUR: 10, CH: '60', ONLY: '3,4', NODE_OPTIONS: '--require /x.js', LD_PRELOAD: '/x.so', PATH: '/x', ELECTRON_RUN_AS_NODE: '1', 'bad name': 1, VIDEOHUB_TOKEN: 'x', PYTHONPATH: '/x' });
  assert.deepEqual(out, { DUR: '10', CH: '60', ONLY: '3,4' });
});

test('a render script must live inside the film folder', () => {
  const film = path.join(tmp, 'film');
  fs.mkdirSync(film, { recursive: true });
  fs.writeFileSync(path.join(film, 'render.js'), '');
  assert.doesNotThrow(() => assertScriptInside(film, 'render.js'));
  assert.throws(() => assertScriptInside(film, '../../evil.js'), /inside the film folder/);
  assert.throws(() => assertScriptInside(film, '/etc/passwd'), /inside the film folder/);
});

test('a render copy goes inside the outputs folder', () => {
  const outputs = path.join(tmp, 'outputs');
  fs.mkdirSync(outputs, { recursive: true });
  assert.equal(hostedCopyTo(path.join(outputs, 'a'), outputs), path.join(outputs, 'a'));
  assert.throws(() => hostedCopyTo('/etc', outputs), /inside the outputs folder/);
});
