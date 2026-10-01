import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { releaseTag } from './release-tag.js';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'huddle-release-tag-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cwd = join(root, 'checkout');
  const remote = join(root, 'origin.git');
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
  execFileSync('git', ['init', '--bare', '--initial-branch=main', remote], { stdio: 'pipe' });
  execFileSync('git', ['init', '--initial-branch=main', cwd], { stdio: 'pipe' });
  git('config', 'user.name', 'Release Test');
  git('config', 'user.email', 'release@example.com');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'tag.gpgsign', 'false');
  git('config', 'core.hooksPath', join(root, 'unused-hooks'));
  const manifest = { name: '@huddle-ai/auth', version: '0.1.0' };
  writeFileSync(join(cwd, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
  writeFileSync(join(cwd, 'package-lock.json'), JSON.stringify({ ...manifest, lockfileVersion: 3, packages: { '': manifest } }, null, 2) + '\n');
  git('add', '.');
  git('commit', '-m', 'initial');
  git('remote', 'add', 'origin', remote);
  git('push', '-u', 'origin', 'main');
  const version = () => JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')).version;
  const rejectPush = (ref) => writeFileSync(join(remote, 'hooks', 'pre-receive'), `#!/bin/sh\nwhile read old new ref; do\n  if [ "$ref" = "${ref}" ]; then exit 1; fi\ndone\n`, { mode: 0o755 });
  return { cwd, git, version, rejectPush };
}

for (const [bump, expected] of [['patch', '0.1.1'], ['minor', '0.2.0'], ['major', '1.0.0']]) {
  test(`${bump} release commits both manifests and pushes main and only its matching tag`, (t) => {
    const { cwd, git, version } = fixture(t);
    git('tag', 'v0.0.9');
    // Existing committed feature work can be included in the main push.
    git('commit', '--allow-empty', '-m', 'feature');
    const tag = releaseTag({ cwd, ...(bump === 'patch' ? {} : { bump }) });
    assert.equal(tag, `v${expected}`);
    assert.equal(version(), expected);
    const lock = JSON.parse(readFileSync(join(cwd, 'package-lock.json'), 'utf8'));
    assert.equal(lock.version, expected);
    assert.equal(lock.packages[''].version, expected);
    assert.equal(git('log', '-1', '--format=%s'), `chore: release ${expected}`);
    assert.equal(git('diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'), 'package-lock.json\npackage.json');
    assert.equal(git('status', '--porcelain'), '');
    assert.equal(git('rev-parse', `${tag}^{commit}`), git('rev-parse', 'HEAD'));
    assert.equal(git('ls-remote', '--heads', 'origin', 'main').split(/\s/)[0], git('rev-parse', 'HEAD'));
    assert.notEqual(git('ls-remote', '--tags', 'origin', `refs/tags/${tag}`), '');
    assert.equal(git('ls-remote', '--tags', 'origin', 'refs/tags/v0.0.9'), '');
  });
}

test('dirty checkouts, other branches, and invalid bumps cannot start a release', (t) => {
  const { cwd, git, version } = fixture(t);
  writeFileSync(join(cwd, 'untracked.txt'), 'work in progress');
  assert.throws(() => releaseTag({ cwd }), /Commit or stash/);
  rmSync(join(cwd, 'untracked.txt'));
  git('checkout', '-b', 'feature');
  assert.throws(() => releaseTag({ cwd }), /Switch to main/);
  git('checkout', 'main');
  assert.throws(() => releaseTag({ cwd, bump: 'prerelease' }), /patch, minor, or major/);
  assert.equal(version(), '0.1.0');
});

test('a local main behind origin is rejected before changing the version', (t) => {
  const { cwd, git, version } = fixture(t);
  git('commit', '--allow-empty', '-m', 'remote work');
  git('push', 'origin', 'main');
  git('reset', '--hard', 'HEAD~1');
  assert.throws(() => releaseTag({ cwd }), /behind or has diverged/);
  assert.equal(version(), '0.1.0');
  assert.equal(git('status', '--porcelain'), '');
});

for (const location of ['local', 'remote']) {
  test(`an existing ${location} release tag is rejected before changing the version`, (t) => {
    const { cwd, git, version } = fixture(t);
    git('tag', 'v0.1.1');
    if (location === 'remote') {
      git('push', 'origin', 'v0.1.1');
      git('tag', '-d', 'v0.1.1');
    }
    assert.throws(() => releaseTag({ cwd }), /already exists/);
    assert.equal(version(), '0.1.0');
    assert.equal(git('status', '--porcelain'), '');
  });
}

test('a rejected main push stops before creating a tag and explains recovery', (t) => {
  const { cwd, git, version, rejectPush } = fixture(t);
  rejectPush('refs/heads/main');
  assert.throws(() => releaseTag({ cwd }), (error) => {
    assert.match(error.message, /Do not rerun the version bump/);
    assert.match(error.message, /git push origin main/);
    assert.match(error.message, /git tag -a v0\.1\.1/);
    return true;
  });
  assert.equal(version(), '0.1.1');
  assert.equal(git('tag', '--list', 'v0.1.1'), '');
  assert.equal(git('ls-remote', '--tags', 'origin'), '');
});

test('a rejected tag push keeps the release commit and tag for a retry', (t) => {
  const { cwd, git, version, rejectPush } = fixture(t);
  rejectPush('refs/tags/v0.1.1');
  assert.throws(() => releaseTag({ cwd }), (error) => {
    assert.match(error.message, /git push origin refs\/tags\/v0\.1\.1/);
    assert.doesNotMatch(error.message, /git tag -a/);
    return true;
  });
  assert.equal(version(), '0.1.1');
  assert.equal(git('tag', '--list', 'v0.1.1'), 'v0.1.1');
  assert.equal(git('ls-remote', '--heads', 'origin', 'main').split(/\s/)[0], git('rev-parse', 'HEAD'));
  assert.equal(git('ls-remote', '--tags', 'origin'), '');
});
