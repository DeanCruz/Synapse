# Update on `master`

This document describes the simplest release model for Synapse when you want desktop builds to track the `master` branch.

---

## Goal

Keep release handling simple for a non-technical team:

- work lands on `master`
- a new desktop build is produced from `master`
- users install the latest published build
- later, the packaged app can check GitHub for a newer release and prompt to update

---

## Recommended Release Model

Use `master` as the release branch.

When code is merged to `master`:

1. bump the app version
2. create a Git tag like `v1.2.3`
3. build the Electron app in GitHub Actions
4. publish the build artifacts to a GitHub Release

For macOS distribution, the release build should eventually be:

- signed with a `Developer ID Application` certificate
- notarized with Apple credentials

Without signing and notarization, the team can still receive builds, but macOS trust and auto-update behavior will be worse.

---

## Two Ways To Run It

### Option A: Fully Automatic on `master`

Every push to `master`:

- increments the version automatically
- creates and pushes a tag
- triggers a release build

This is the lowest-friction option, but it creates a release for every change that reaches `master`.

Good fit if:

- `master` is already tightly controlled
- every merge should produce a usable desktop build
- you are comfortable with frequent patch releases

### Option B: Build on `master`, Release on Tag

Every push to `master`:

- runs CI validation
- optionally creates an unsigned preview build

Then a release workflow:

- bumps version
- creates a tag
- publishes the signed build

This is safer if `master` moves often and not every merge should become a user-facing release.

---

## Version Bump Strategy

If release creation is automatic, keep the bump rules simple.

Recommended default:

- patch bump for normal merges
- minor bump only when explicitly requested
- major bump only for intentional breaking changes

The easiest rule set is:

- default to patch
- use a commit marker or PR label to request minor or major

Examples:

- `#minor`
- `#major`

If no marker is present, release as a patch.

---

## App Update Behavior

Once release artifacts are being published consistently, the packaged app can:

1. check GitHub Releases on launch
2. detect whether a newer version exists
3. download the latest build
4. prompt the user to restart and apply the update

For a non-technical team, the best UX is:

- check on startup
- show current version in Settings
- show a simple "Update available" prompt
- provide one button to restart into the new version

---

## Required Secrets For macOS Releases

To produce a signed, team-friendly macOS release in GitHub Actions, the repo will need:

- Apple Developer membership
- exported signing certificate (`.p12`)
- certificate password
- Apple ID
- app-specific password
- Apple team ID

These should live in GitHub Actions secrets, not in the repo.

---

## Suggested Next Step

If Synapse should always publish from `master`, the clean implementation is:

1. workflow 1: on push to `master`, auto-bump version and create a tag
2. workflow 2: on tag push, build and publish the Electron release
3. app-side updater: check GitHub Releases and prompt users to restart into the new version

That keeps the team out of the terminal while preserving a predictable release path.
