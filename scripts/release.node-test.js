import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { isPublished, parsePackedPackage, validateRelease } from './release.js';

const manifest = {
  name: '@huddle-ai/auth', version: '0.1.0',
  publishConfig: { access: 'public', registry: 'https://registry.npmjs.org' },
};

test('package metadata supports npm 11 and npm 12 pack output', () => {
  const packed = { name: manifest.name, version: manifest.version, filename: 'huddle-ai-auth-0.1.0.tgz', files: [] };
  assert.deepEqual(parsePackedPackage(JSON.stringify([packed])), packed);
  assert.deepEqual(parsePackedPackage(JSON.stringify({ [manifest.name]: packed })), packed);
  assert.throws(() => parsePackedPackage('[]'), /exactly one/);
  assert.throws(() => parsePackedPackage('{}'), /exactly one/);
  assert.throws(() => parsePackedPackage(JSON.stringify([packed, packed])), /exactly one/);
  assert.throws(() => parsePackedPackage('not JSON'), SyntaxError);
});

test('release tags must match the public package and point to main history', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'huddle-auth-release-'));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
  try {
    git('init', '--initial-branch=main');
    git('-c', 'user.name=Release Test', '-c', 'user.email=release@example.com', 'commit', '--allow-empty', '-m', 'initial');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    const context = { cwd, refType: 'tag', tag: 'v0.1.0' };
    assert.doesNotThrow(() => validateRelease(manifest, context));
    for (const tag of ['v0.2.0', 'v0.1.0-beta.0', 'v0.1.0+build', 'v00.1.0', '0.1.0', 'v1.2', 'v1.2.3\n']) {
      assert.throws(() => validateRelease(manifest, { ...context, tag }));
    }
    assert.throws(() => validateRelease(manifest, { ...context, refType: 'branch' }));
    assert.throws(() => validateRelease({ ...manifest, name: '@practicaljs/react-oauth' }, context));
    assert.throws(() => validateRelease({ ...manifest, private: true }, context));
    assert.throws(() => validateRelease({ ...manifest, publishConfig: { access: 'restricted' } }, context));
    git('checkout', '-b', 'unmerged');
    git('-c', 'user.name=Release Test', '-c', 'user.email=release@example.com', 'commit', '--allow-empty', '-m', 'unmerged');
    assert.throws(() => validateRelease(manifest, context), /reachable/);
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    assert.doesNotThrow(() => validateRelease(manifest, context));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('an existing version skips publication; only HTTP 404 allows a new publish', async () => {
  let requested;
  const existing = await isPublished(manifest, async (url) => {
    requested = url;
    return Response.json({ name: manifest.name, version: manifest.version });
  });
  assert.equal(requested, 'https://registry.npmjs.org/%40huddle-ai%2Fauth/0.1.0');
  assert.equal(existing, true);
  assert.equal(await isPublished(manifest, async () => new Response(null, { status: 404 })), false);
  for (const status of [401, 403, 429, 500, 503]) {
    await assert.rejects(isPublished(manifest, async () => new Response(null, { status })), /lookup failed/);
  }
  await assert.rejects(isPublished(manifest, async () => { throw new Error('network failure'); }), /network failure/);
  await assert.rejects(isPublished(manifest, async () => new Response('invalid JSON')), SyntaxError);
  await assert.rejects(isPublished(manifest, async () => Response.json({ name: manifest.name, version: '0.2.0' })), /unexpected version/);
  await assert.rejects(isPublished(manifest, async () => Response.json({ name: '@another/package', version: manifest.version })), /unexpected package/);
});
