import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function parsePackedPackage(output) {
  const result = JSON.parse(output);
  // npm 11 returns an array; npm 12 keys the results by package name.
  const packages = Array.isArray(result) ? result : Object.values(result);
  assert.equal(packages.length, 1, 'Expected exactly one packed package.');
  return packages[0];
}

export function validateRelease(manifest, { refType, tag, cwd = process.cwd() }) {
  assert.equal(refType, 'tag', 'Publishing requires a version tag.');
  assert.match(tag ?? '', /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, 'Only stable vX.Y.Z tags may publish.');
  assert.equal(tag, `v${manifest.version}`, 'The tag must match package.json version.');
  assert.equal(manifest.name, '@huddle-ai/auth', 'Unexpected package name.');
  assert.notEqual(manifest.private, true, 'The package must be publishable.');
  assert.equal(manifest.publishConfig?.access, 'public', 'The package must be public.');
  assert.equal(manifest.publishConfig?.registry, 'https://registry.npmjs.org', 'Unexpected npm registry.');

  const ancestry = spawnSync('git', ['merge-base', '--is-ancestor', 'HEAD', 'refs/remotes/origin/main'], { cwd, encoding: 'utf8' });
  if (ancestry.error) throw ancestry.error;
  assert.equal(ancestry.status, 0, 'The tagged commit must be reachable from origin/main.');
}

export async function isPublished(manifest, request = fetch) {
  const url = `https://registry.npmjs.org/${encodeURIComponent(manifest.name)}/${encodeURIComponent(manifest.version)}`;
  const response = await request(url, { signal: AbortSignal.timeout(30_000) });
  if (response.status === 404) return false;
  if (!response.ok) throw new Error(`npm registry lookup failed with HTTP ${response.status}.`);
  const published = await response.json();
  assert.equal(published.name, manifest.name, 'The registry returned an unexpected package.');
  assert.equal(published.version, manifest.version, 'The registry returned an unexpected version.');
  return true;
}

async function main() {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
  switch (process.argv[2]) {
    case 'validate': {
      validateRelease(manifest, { refType: process.env.GITHUB_REF_TYPE, tag: process.env.GITHUB_REF_NAME });
      const npmVersion = spawnSync('npm', ['--version'], { encoding: 'utf8' });
      if (npmVersion.error) throw npmVersion.error;
      assert.equal(npmVersion.status, 0, 'Cannot determine npm version.');
      const [major, minor, patch] = npmVersion.stdout.trim().split('.').map(Number);
      assert.ok(major > 11 || (major === 11 && (minor > 5 || (minor === 5 && patch >= 1))), 'Trusted publishing requires npm >=11.5.1.');
      console.log(`Validated ${manifest.name}@${manifest.version} on ${process.env.GITHUB_REF_NAME}.`);
      break;
    }
    case 'check-published': {
      const published = await isPublished(manifest);
      const message = published
        ? `${manifest.name}@${manifest.version} already exists; skipping publication.`
        : `${manifest.name}@${manifest.version} is ready to publish.`;
      console.log(message);
      if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `published=${published}\n`);
      if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
      break;
    }
    default:
      throw new Error('Usage: node scripts/release.mjs validate|check-published');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
