# Install the package locally

To test `@huddle-ai/auth` before a registry release, build and pack it from the repository root:

```sh
npm ci
npm run build
npm pack
```

The last command creates `huddle-ai-auth-0.1.0.tgz`. In a separate consumer app, install that file using its absolute path:

```sh
npm install /absolute/path/react-oauth/huddle-ai-auth-0.1.0.tgz
```

The consumer needs React 19+ and its normal React DOM renderer. It does not need the library's router fixtures, test tools, or build tools. TypeScript declarations, component styles, and these guides are included in the package. Rebuild, repack, and reinstall after changing the library; the installed tarball is a snapshot.

For the repository's built-in consumer, run `npm run dev:mock` and `npm start` in separate terminals after `npm ci`. Open the Vite URL printed by the second command. This demo resolves the public package import directly to library source.

Before sharing a tarball, run `npm run test:deploy`, `npm run test:release`, `npm run check:router-examples`, and `npm run check:package`. The package check verifies the tarball's contents, JavaScript exports, and consumer types. See [releasing](releasing.md) for registry publication. The filename above reflects version `0.1.0`; subsequent versions change the suffix.
