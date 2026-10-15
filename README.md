# Quiz Helper Menu (Randomized)

Quiz Helper Menu (Randomized) is a userscript for Tecnisign AVA pages that helps with the quiz flow using randomized delays.

It runs locally in your browser and is meant to behave like a small helper overlay, not a browser extension.

## What it does

- Reads quiz pages and stores the captured state locally.
- Fills answers and navigates the quiz flow with randomized timing.
- Offers a quick mode and a total quiz duration slider (1–15 minutes).
- Keeps the helper menu draggable and persistent across page changes.

The slider sets the approximate time from clicking **Responder** through filling,
confirming answers, and finishing the quiz. The selected time is divided across the
questions with randomized pauses whose sum stays within that time budget. Quick mode
changes how time is split between filling and submitting while keeping the same total.
Page loads and site response times can add to the elapsed duration. Choose the duration
before starting; changing it during a run applies to the next run. Timing and mode
preferences are retained when the quiz finishes or the cache is cleared.

## Supported sites

- `https://ava.tecnisign.pt/*`
- `https://ava.multiformactiva.pt/*`

## Install

1. Install a userscript manager such as Tampermonkey or Violentmonkey.
2. Open the raw userscript file in GitHub:
   `https://raw.githubusercontent.com/eliaspc2/quiz-helper-menu-randomized/main/quiz-helper-menu-randomized.user.js`
3. Confirm the installation in your userscript manager.

If you already had an older local copy installed from `Instruction`, remove that old copy first so the browser only uses this repository version.
Installing from the raw GitHub URL keeps Tampermonkey wired to the repository's `@updateURL`, so updates come from GitHub automatically.

## Validation

Run the timing and simulated quiz flow checks with `node --test tests/timing.test.cjs`.

## License

MIT. See [LICENSE](./LICENSE).
