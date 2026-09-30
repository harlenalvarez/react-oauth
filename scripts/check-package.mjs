import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = process.cwd();
const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
const scratch = mkdtempSync(join(tmpdir(), 'huddle-auth-package-'));
let keepTarball = false;

function run(command, args, cwd = root, capture = false) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed.\n${result.stderr ?? ''}`);
  return result.stdout;
}

try {
  const [packed] = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', scratch], root, true));
  assert.equal(packed.name, '@huddle-ai/auth');
  assert.equal(packed.version, manifest.version);
  const files = new Set(packed.files.map((file) => file.path));
  const entry = manifest.exports['.'];
  for (const path of [entry.import, entry.require, entry.types, manifest.main, manifest.module, manifest.types, 'README.md', 'package.json', 'docs/getting-started.md']) {
    assert.ok(files.has(path.replace(/^\.\//, '')), `Missing packaged file: ${path}`);
  }
  for (const path of files) {
    assert.ok(/^(dist\/|docs\/|package\.json$|README\.md$|LICEN[CS]E(?:\..*)?$)/i.test(path), `Unexpected packaged file: ${path}`);
    assert.ok(!/\.(test|spec)\.[^/]+$|(^|\/)(__tests__|node_modules)(\/|$)/.test(path), `Development file in package: ${path}`);
  }

  const tarball = join(scratch, packed.filename);
  const consumer = join(scratch, 'consumer');
  mkdirSync(consumer);
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'huddle-auth-consumer-check', private: true, type: 'module' }));
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball, `react@${manifest.devDependencies.react}`, `@types/react@${manifest.devDependencies['@types/react']}`], consumer);

  const installed = JSON.parse(readFileSync(join(consumer, 'node_modules/@huddle-ai/auth/package.json'), 'utf8'));
  assert.equal(installed.name, '@huddle-ai/auth');
  assert.equal(installed.version, manifest.version);
  assert.equal(installed.private, undefined);
  assert.deepEqual(installed.dependencies ?? {}, {}, 'The library must not add runtime dependencies.');
  assert.deepEqual(installed.peerDependencies, { react: '>=19.0.0' });
  assert.equal(installed.publishConfig?.access, 'public');
  assert.equal(installed.repository?.url, 'git+https://github.com/harlenalvarez/react-oauth.git');

  const names = ['AuthClient', 'createAuthClient', 'ReactAuthProvider', 'AuthClientProvider', 'AuthBoundary', 'AuthScreen', 'useAuth', 'useAuthClient', 'useAuthStatus', 'useAuthProfile'];
  const assertions = `for (const name of ${JSON.stringify(names)}) assert.equal(typeof library[name], 'function', name);`;
  writeFileSync(join(consumer, 'consumer.mjs'), `import assert from 'node:assert/strict';\nimport * as library from '@huddle-ai/auth';\n${assertions}\n`);
  writeFileSync(join(consumer, 'consumer.cjs'), `const assert = require('node:assert/strict');\nconst library = require('@huddle-ai/auth');\n${assertions}\n`);
  run(process.execPath, ['consumer.mjs'], consumer);
  run(process.execPath, ['consumer.cjs'], consumer);

  writeFileSync(join(consumer, 'consumer.tsx'), `
import { createAuthClient, ReactAuthProvider, useAuth } from '@huddle-ai/auth';
import type { AuthNavigationAdapter, AuthHookValue } from '@huddle-ai/auth';
type Profile = { email: string };
const client = createAuthClient<Profile>({
  clientId: 'consumer',
  authorizationEndpoint: 'https://identity.example.com/authorize',
  tokenEndpoint: 'https://identity.example.com/token',
  loadProfile: async () => ({ email: 'consumer@example.com' }),
});
const navigation: AuthNavigationAdapter = {
  getLocation: () => window.location.href,
  navigate: () => {},
  subscribe: () => () => {},
};
function ProfileView() {
  const auth: AuthHookValue<Profile> = useAuth(client);
  return <span>{auth.profile?.email}</span>;
}
const app = <ReactAuthProvider client={client} navigation={navigation}><ProfileView /></ReactAuthProvider>;
void app;
`);
  run(process.execPath, [resolve(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--jsx', 'react-jsx', '--target', 'ES2022', '--lib', 'ES2022,DOM', 'consumer.tsx'], consumer);
  rmSync(consumer, { recursive: true, force: true });

  console.log(`Verified ${packed.name}@${packed.version}: contents, ESM, CommonJS, and consumer types.`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `tarball=${tarball}\n`);
    keepTarball = true;
  }
} finally {
  if (!keepTarball) rmSync(scratch, { recursive: true, force: true });
}
