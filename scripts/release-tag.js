import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function releaseTag({ cwd = fileURLToPath(new URL('../', import.meta.url)), bump = 'patch' } = {}) {
  assert.ok(['patch', 'minor', 'major'].includes(bump), 'Use patch, minor, or major.');
  const run = (command, args, { capture = false, statuses = [0] } = {}) => {
    const result = spawnSync(command, args, { cwd, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' });
    if (result.error) throw result.error;
    if (!statuses.includes(result.status)) {
      throw new Error(`${command} ${args.join(' ')} failed (exit ${result.status}).${result.stderr ? `\n${result.stderr.trim()}` : ''}`);
    }
    return { status: result.status, output: result.stdout?.trim() ?? '' };
  };
  const git = (...args) => run('git', args, { capture: true }).output;
  const readManifest = () => JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));

  assert.equal(git('branch', '--show-current'), 'main', 'Switch to main before releasing.');
  assert.equal(git('status', '--porcelain'), '', 'Commit or stash your changes before releasing, including untracked files.');
  git('var', 'GIT_AUTHOR_IDENT');
  git('var', 'GIT_COMMITTER_IDENT');
  const manifest = readManifest();
  assert.equal(manifest.name, '@huddle-ai/auth', 'Unexpected package name.');
  assert.match(manifest.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, 'Only stable versions may release.');
  const parts = manifest.version.split('.').map(Number);
  const index = { major: 0, minor: 1, patch: 2 }[bump];
  parts[index] += 1;
  parts.fill(0, index + 1);
  assert.ok(parts.every(Number.isSafeInteger), 'Version exceeds the supported range.');
  const version = parts.join('.');
  const tag = `v${version}`;

  run('git', ['fetch', '--no-tags', 'origin', 'main:refs/remotes/origin/main']);
  const ancestry = run('git', ['merge-base', '--is-ancestor', 'refs/remotes/origin/main', 'HEAD'], { capture: true, statuses: [0, 1] });
  assert.equal(ancestry.status, 0, 'Local main is behind or has diverged from origin/main. Update main before releasing.');
  const localTag = run('git', ['show-ref', '--verify', '--quiet', `refs/tags/${tag}`], { capture: true, statuses: [0, 1] });
  assert.equal(localTag.status, 1, `${tag} already exists locally.`);
  assert.equal(git('ls-remote', '--tags', 'origin', `refs/tags/${tag}`), '', `${tag} already exists on origin.`);

  let committed = false;
  let pushedMain = false;
  let tagged = false;
  console.log(`Releasing ${manifest.name}@${version} from main.`);
  try {
    run('npm', ['version', bump, '--no-git-tag-version', '--ignore-scripts']);
    assert.equal(readManifest().version, version, 'npm produced an unexpected version.');
    run('git', ['add', '--', 'package.json', 'package-lock.json']);
    run('git', ['commit', '-m', `chore: release ${version}`]);
    committed = true;
    const commit = git('rev-parse', 'HEAD');
    run('git', ['push', 'origin', 'main']);
    pushedMain = true;
    run('git', ['tag', '-a', tag, '-m', `Release ${tag}`, commit]);
    tagged = true;
    run('git', ['push', 'origin', `refs/tags/${tag}`]);
  } catch (error) {
    const recovery = [];
    if (committed) {
      if (!pushedMain) recovery.push('git push origin main');
      if (!tagged) recovery.push(`git tag -a ${tag} -m "Release ${tag}"`);
      recovery.push(`git push origin refs/tags/${tag}`);
    }
    throw new Error(`${error.message}\nRelease ${tag} stopped. Do not rerun the version bump.${recovery.length ? `\nAfter fixing the error, finish from this release commit with:\n${recovery.join('\n')}` : '\nInspect git status and resolve the version changes before trying again.'}`, { cause: error });
  }
  console.log(`Pushed ${tag}. GitHub Actions will validate and publish ${manifest.name}@${version} under latest.`);
  return tag;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    assert.ok(process.argv.length <= 3, 'Usage: npm run release-tag [-- patch|minor|major]');
    releaseTag({ bump: process.argv[2] ?? 'patch' });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
