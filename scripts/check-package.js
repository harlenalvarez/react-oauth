import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { parsePackedPackage } from './release.js';

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
  const packed = parsePackedPackage(run('npm', ['pack', '--json', '--pack-destination', scratch], root, true));
  assert.equal(packed.name, '@huddle-ai/auth');
  assert.equal(packed.version, manifest.version);
  const files = new Set(packed.files.map((file) => file.path));
  const entry = manifest.exports['.'];
  assert.equal(manifest.type, 'module');
  assert.equal(entry.require, undefined, 'The package must ship ESM only.');
  for (const path of [entry.default, entry.types, manifest.main, manifest.types, 'README.md', 'package.json', 'docs/getting-started.md']) {
    assert.ok(files.has(path.replace(/^\.\//, '')), `Missing packaged file: ${path}`);
  }
  for (const path of files) {
    assert.ok(/^(dist\/|docs\/|package\.json$|README\.md$|LICEN[CS]E(?:\..*)?$)/i.test(path), `Unexpected packaged file: ${path}`);
    assert.ok(!/\.(test|spec)\.[^/]+$|(^|\/)(__tests__|node_modules)(\/|$)/.test(path), `Development file in package: ${path}`);
    assert.ok(!/\.(cjs|mjs)$|\.umd\./.test(path), `Unexpected compatibility bundle: ${path}`);
  }

  const tarball = join(scratch, packed.filename);
  const consumer = join(scratch, 'consumer');
  mkdirSync(consumer);
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'huddle-auth-consumer-check', private: true, type: 'module' }));
  run('npm', [
    'install', '--ignore-scripts', '--no-audit', '--no-fund', tarball,
    `react@${manifest.devDependencies.react}`, `react-dom@${manifest.devDependencies['react-dom']}`,
    `@types/react@${manifest.devDependencies['@types/react']}`,
    `vite@${manifest.devDependencies.vite}`, `@vitejs/plugin-react@${manifest.devDependencies['@vitejs/plugin-react']}`,
  ], consumer);

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
  writeFileSync(join(consumer, 'runtime-check.js'), `import assert from 'node:assert/strict';\nimport * as library from '@huddle-ai/auth';\n${assertions}\n`);
  run(process.execPath, ['runtime-check.js'], consumer);

  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>');
  const previousDocument = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    await import(pathToFileURL(join(consumer, 'node_modules/@huddle-ai/auth', entry.default)).href);
    assert.ok(dom.window.document.querySelector('style')?.textContent.includes('.react-oauth-screen'), 'Importing the package must install its component styles automatically.');
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    dom.window.close();
  }

  writeFileSync(join(consumer, 'consumer.tsx'), `
import { createAuthClient, ReactAuthProvider, useAuth } from '@huddle-ai/auth';
import type { AuthNavigationAdapter, AuthHookValue, LogoutResult } from '@huddle-ai/auth';
type Profile = { email: string };
const client = createAuthClient<Profile>({
  clientId: 'consumer',
  endSessionEndpoint: 'https://identity.example.com/end-session',
  postLogoutRedirectUri: '/logout',
  authorizationEndpoint: 'https://identity.example.com/authorize',
  tokenEndpoint: 'https://identity.example.com/token',
  loadProfile: async () => ({ email: 'consumer@example.com' }),
});
export const processLogout = (): Promise<LogoutResult> => client.completeLogout();
const navigation: AuthNavigationAdapter = {
  getLocation: () => window.location.href,
  navigate: () => {},
  subscribe: () => () => {},
};
function ProfileView() {
  const auth: AuthHookValue<Profile> = useAuth(client);
  return <span>{auth.profile?.email}</span>;
}
export const app = <ReactAuthProvider client={client} navigation={navigation}><ProfileView /></ReactAuthProvider>;
`);
  run(process.execPath, [resolve(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--module', 'ESNext', '--moduleResolution', 'Bundler', '--verbatimModuleSyntax', '--moduleDetection', 'force', '--jsx', 'react-jsx', '--target', 'ES2023', '--lib', 'ES2023,DOM', 'consumer.tsx'], consumer);
  run(process.execPath, [resolve(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--jsx', 'react-jsx', '--target', 'ES2022', '--lib', 'ES2022,DOM', 'consumer.tsx'], consumer);

  writeFileSync(join(consumer, 'index.html'), '<!doctype html><html><body><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>');
  writeFileSync(join(consumer, 'main.tsx'), `import { createRoot } from 'react-dom/client';\nimport { app } from './consumer';\ncreateRoot(document.getElementById('root')!).render(app);\n`);
  writeFileSync(join(consumer, 'vite.config.js'), `import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\nexport default defineConfig({ plugins: [react()] });\n`);
  run(process.execPath, [join(consumer, 'node_modules/vite/bin/vite.js'), 'build'], consumer);
  rmSync(consumer, { recursive: true, force: true });

  console.log(`Verified ${packed.name}@${packed.version}: ESM contents, automatic styles, consumer types, and Vite production build.`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `tarball=${tarball}\n`);
    keepTarball = true;
  }
} finally {
  if (!keepTarball) rmSync(scratch, { recursive: true, force: true });
}
