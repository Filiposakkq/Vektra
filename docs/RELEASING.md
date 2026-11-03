# Releasing Vektra

A release publishes a new version of **both** the Chrome extension and the
Android app on GitHub, with one version number. People's extensions and apps
then offer the update. It takes two steps and about five minutes.

## 1. Write what changed

Open [`CHANGELOG.md`](../CHANGELOG.md). At the top is **Unreleased**, a ready
template:

```markdown
## Unreleased

> One line about what this release is for.

### ✨ New

### 🎨 Improved

### 🐛 Fixed
```

- Replace the `>` line with one sentence that sums the release up.
- Under each heading, one line per change, starting with `- `. Say what the
  user notices, not how the code changed: *"Castling no longer lags"*, not
  *"Refactor MoveAnnouncement.kt"*. Start with the most important.
- **Bold** the name of a big new feature: `- **Review your last game.** …`
- A heading with nothing under it is left out of the release on its own.

Commit it:

```bash
git commit -am "Changelog for the next release"
```

## 2. Release

Pick the version. Vektra uses three numbers, `major.minor.patch`:

| You changed | Use | Example |
| --- | --- | --- |
| Only fixes | `patch` | 0.4.0 → 0.4.1 |
| New features | `minor` | 0.4.1 → 0.5.0 |
| Something big that changes how Vektra works | `major` | 0.5.0 → 1.0.0 |

Then, in the repository folder:

```bash
npm run release -- patch
```

(or `minor`, `major`, or an exact version like `npm run release -- 0.4.1`).

The script shows the notes and asks **"Publish Vektra 0.4.1 on GitHub?"**.
Type `y` and press Enter. It then:

1. checks you're on the `bot-only` branch with nothing uncommitted,
2. turns *Unreleased* into the new version's section, dated today, and puts an
   empty template back for next time,
3. sets the version number, commits and pushes a tag like `v0.4.1`.

GitHub takes it from there: it runs the tests, builds the extension zip and the
signed Android APK, and publishes the release with your changelog section as
its notes. Watch it at
[Actions](https://github.com/Filiposakkq/Vektra/actions); when it's green
(about 4 minutes) the release is at
[Releases](https://github.com/Filiposakkq/Vektra/releases).

## If something goes wrong

- **"Write what changed under Unreleased first"**: step 1 isn't done or isn't committed.
- **"Commit or put away your changes first"**: run `git status`, commit what's there, try again.
- **The workflow failed** (red in Actions): nothing was published. Open the
  failed run to see why, fix it and commit the fix. The changelog and version
  are already done, so only the tag moves to the fixed commit:
  ```bash
  git push origin :refs/tags/v0.4.1
  ```
  ```bash
  git tag -f v0.4.1
  ```
  ```bash
  git push origin bot-only v0.4.1
  ```
- **The Android build says the signing secrets are missing**: the repository's
  `ANDROID_KEYSTORE_BASE64` and `ANDROID_KEYSTORE_PASSWORD` secrets are gone;
  set them again from the key in `E:\Vektra-signing` (see
  [docs/ANDROID.md](ANDROID.md#releases-and-updates)). Every release must be
  signed with that same key, or phones refuse the update.
