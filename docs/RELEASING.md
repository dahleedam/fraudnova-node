# Releasing @fraudnova/sdk

These are your steps to publish the package. The code, tests and docs are already committed on `main`.

## First release (1.0.0)

1. Create the empty public repository `dahleedam/fraudnova-node` on GitHub (no README, no licence, no .gitignore).
2. Push `main`:

   ```bash
   git remote add origin https://github.com/dahleedam/fraudnova-node.git && git push -u origin main
   ```

   Open https://github.com/dahleedam/fraudnova-node/actions and wait for the **CI** run to go green on Node 18, 20 and 22. Do not tag until it is green.
3. On npmjs.com, create the organisation `fraudnova` (free for public packages), so the scoped name `@fraudnova/sdk` can be published.

   If you would rather publish unscoped, rename the package to `fraudnova` instead: change `name` in `package.json`, the install and import lines in `README.md`, and the `curl` URL in step 6, then commit.
4. Configure the npm trusted publisher, so the Release workflow publishes through GitHub's OIDC token and no npm token is ever stored. The package page does not exist yet, so open **Account → Packages → Trusted publishing** on npmjs.com (once the package exists, the same form is under the package's **Settings → Trusted publisher**). Enter:
   - Publisher: GitHub Actions
   - Owner: `dahleedam`
   - Repository: `fraudnova-node`
   - Workflow filename: `release.yml`
   - Environment: leave blank

   npm currently requires the package to exist before a trusted publisher can be added. If the form refuses, publish 1.0.0 once from this machine instead:

   ```bash
   npm login          # completes 2FA in the browser
   npm publish --access public
   ```

   npm 11 may stage a first publish for approval in the browser and print a success line regardless, so the package is not live until you approve it. This is why the `?write=true` curl check in step 6 is mandatory after a manual publish too.

   Then add the trusted publisher as above and let the workflow publish every release from 1.0.1 on. In that case still push the `v1.0.0` tag in step 5 to mark the release. Its publish job fails because 1.0.0 is already on npm, which is expected, and the GitHub release job is skipped with it, so create the 1.0.0 release by hand under **Releases → Draft a new release** (choose the `v1.0.0` tag and click **Generate release notes**).
5. Tag the release and push the tag:

   ```bash
   git tag v1.0.0 && git push origin v1.0.0
   ```

   The **Release** workflow checks that the tag matches `package.json`, runs lint, typecheck, build and tests, publishes to npm with a provenance statement, and creates the GitHub release with generated notes.
6. Verify the registry directly. Never trust the CLI's success line: a publish can print success and still not land.

   ```bash
   curl -s "https://registry.npmjs.org/@fraudnova%2Fsdk?write=true" | head -c 400
   ```

   The output must show `"name":"@fraudnova/sdk"` and the new version under `dist-tags`. Then check that the package installs in an empty directory:

   ```bash
   mkdir /tmp/fn && cd /tmp/fn && npm init -y >/dev/null && npm install @fraudnova/sdk && node -e "import('@fraudnova/sdk').then(m => console.log(m.VERSION))"
   ```

   It prints `1.0.0`.

## Follow-ups in the other repositories

The main app's `/docs#node-sdk` section, "Node.js SDK" code tabs and `node-sdk` changelog entry are committed on the app branch and deploy per `docs/DEPLOY.md`. The examples repository's README link to the SDK is committed and needs `git push`.

## Patch and minor releases

1. Make the change on `main` with tests.
2. Bump the version in `src/version.ts` (it is sent in the `User-Agent` header) and in `package.json` together.
3. In `CHANGELOG.md`, move the entries under `## [Unreleased]` into a new section such as `## [1.0.1] - YYYY-MM-DD`, and add its link reference at the bottom.
4. Commit, push, wait for CI to go green, then tag and push the tag:

   ```bash
   git tag v1.0.1 && git push origin v1.0.1
   ```

   The Release workflow publishes to npm and creates the GitHub release. Verify the registry with the `curl` from step 6 above.

`tests/release-consistency.test.ts` fails when `src/version.ts`, `package.json` and the newest version heading in `CHANGELOG.md` disagree, so bump all three together. The release workflow also refuses a tag that does not match `package.json`.

## Rules

Nothing public (README, changelog, docs, code, commit messages) may name the upstream data provider or describe keys, credentials or quota internals.

The leak-guard test (`tests/leak-guard.test.ts`) runs on every push. It only catches the provider's name or abbreviation and two fixed phrases in tracked files. It does not read commit messages, and it cannot tell when text describes keys or quota internals in other words, so check those by hand before you push.
