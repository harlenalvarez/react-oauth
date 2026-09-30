# Publishing @huddle-ai/auth

The npm package is public. The GitHub repository stays at `harlenalvarez/react-oauth`, and its build artifacts retain their `react-oauth` filenames. React 19+ is the only runtime peer dependency.

## Validation

CI uses Node 24. Locally, use Node 24.15 or later in the Node 24 release line, or Node 26, with npm 11.5.1 or later. The package check supports both npm 11 and npm 12; switching from Node 26 to Node 24 is optional. From the repository root:

```sh
npm ci
npm run test:deploy
npm run test:release
npm run build
npm run check:router-examples
npm run check:package
```

`check:package` creates a temporary tarball, checks its contents, and installs it into a separate consumer to verify ESM imports, CommonJS exports, and TypeScript declarations. It removes its temporary files locally; in GitHub Actions it retains the validated tarball for the publishing step.

CI runs these checks on pull requests and pushes to `main`. Publishing repeats all checks against the tagged commit.

## First publication: 0.1.0

1. Ensure your npm account has permission to create and publish `@huddle-ai/auth` publicly.
2. Commit the release changes and intended library changes, then merge them into `main` and let CI pass. Uncommitted local changes are not included in GitHub Actions.
3. From that clean `main` checkout, run the validation commands above, then authenticate and publish locally:

   ```sh
   npm login
   npm pack
   npm publish ./huddle-ai-auth-0.1.0.tgz --access public --tag latest --registry https://registry.npmjs.org
   npm view @huddle-ai/auth@0.1.0 version --registry https://registry.npmjs.org
   ```

4. Open `@huddle-ai/auth` on npmjs.com, then **Settings → Trusted publishing → Add trusted publisher → GitHub Actions**. Enter:

   | Setting | Value |
   | --- | --- |
   | Organization or user | `harlenalvarez` |
   | Repository | `react-oauth` |
   | Workflow filename | `publish.yml` |
   | Environment name | Leave blank |
   | Allowed actions | Enable direct `npm publish` |

5. Record the first release tag on the same published commit:

   ```sh
   git tag v0.1.0
   git push origin v0.1.0
   ```

The workflow validates the package and reports that `0.1.0` already exists, skipping publication successfully. No `NPM_TOKEN` secret is needed.

## Subsequent releases

Start with a clean, current `main` checkout. Update the version without creating a tag yet, so CI can validate the release commit before publication:

```sh
npm version patch --no-git-tag-version
git add package.json package-lock.json
git commit -m "chore: release 0.1.1"
git push origin main
```

If `main` requires pull requests, make the version change on a branch and merge it through the normal review process. After CI passes on the final `main` commit, tag that commit and push the tag:

```sh
git tag v0.1.1
git push origin v0.1.1
```

Choose `minor` or `major` instead of `patch` when appropriate, and use the resulting version in the commit message and tag. The workflow accepts stable `vX.Y.Z` tags only, requires an exact match with `package.json`, and requires the commit to be reachable from `main`. Prerelease and build-metadata tags are rejected.

The workflow publishes the checked tarball under `latest` using OIDC. An already published version is a successful skip; permission errors, registry failures, invalid release metadata, and failed validation stop the release. A retry after a successful publication therefore does not attempt to overwrite that version.

After the first CI publication, check the Actions run and the npm package's version and provenance information. OIDC and provenance cannot be fully verified by local dry runs. The first local publication is not expected to carry GitHub Actions provenance.

See npm's [trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/) for setup requirements and troubleshooting.
