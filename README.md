# Streak Manager

> **Disclaimer:** This entire website, all included code, and this README were AI generated (vibe coded). In fact, even this disclaimer is AI generated.

Streak Manager is a private habit tracker for people who want a calm, structured way to keep showing up. It helps individuals track routines such as gym training, study, practice, or any other repeatable goal without needing a backend or a separate account system.

It exists to make progress visible at two useful levels: the small daily action and the larger weekly goal. A private GitHub Gist stores the data, so the app can remain a static website while still syncing your personal tracker.

## What It Does

- Tracks multiple routines.
- Lets each routine have several ordered objectives, from hardest to easiest.
- Records one real activity level per date and derives easier levels through the cascade system.
- Shows a full calendar for reviewing and editing past dates.
- Calculates a daily streak from consecutive local calendar dates.
- Calculates a **Current Goal streak** from consecutive completed weeks.
- Uses one freeze for each missed day in the existing daily system and one freeze for each missed completed week in the weekly goal system.
- Prevents activity from being logged on future dates.
- Syncs data with one private GitHub Gist.
- Supports JSON import and export for backups.

## Daily And Weekly Streaks

Each routine has two independent progress measures:

- **Current streak:** consecutive local calendar days with logged activity.
- **Current Goal streak:** consecutive completed Monday-to-Sunday weeks in which every objective reached its target.

The weekly goal is based on the same cascade-derived weekly progress already used by the routine. A harder activity can therefore contribute toward the targets of easier objectives during that week.

The weekly streak only evaluates completed weeks. The current, still-open week is not counted until it ends. If a completed week misses its objectives, the weekly system consumes one available routine freeze and preserves the goal streak. A week can only consume one freeze. The daily streak calculation remains separate and unchanged.

All date calculations use the browser's local date and time. No online clock or server date is used.

## Freezes

Freezes belong to each routine and are shared by its daily and weekly streak systems. Routine settings include:

- `maxFreezes`: maximum number held at once.
- `freezeEarnRate`: the configured daily earning interval.
- `availableFreezes`: the current calculated balance.

Daily and weekly freeze usage is stored in the routine's freeze ledger so refreshing the page does not repeatedly charge the same missed period. Freeze availability can be changed from the in-app Settings dialog.

## Cascade Objectives

Objectives are ordered from hardest to easiest. Logging one objective records only that actual action, while the app derives all easier objectives as satisfied for that date.

For example, with four objectives:

- Logging Objective 1 satisfies Objectives 1, 2, 3, and 4.
- Logging Objective 2 satisfies Objectives 2, 3, and 4.
- Logging Objective 3 satisfies Objectives 3 and 4.

The app does not store fake duplicate activities for the derived objectives.

## Privacy And Storage

The app is a static client-side website. Its only persistent database is one private GitHub Gist containing the routine JSON data.

The GitHub PAT is encrypted in the source configuration and decrypted only in browser memory after the unlock password is entered; the encryption uses the browser's native Web Crypto API and the plaintext token is not stored in browser storage.

The project is intended for one personal user. Keep the GitHub token, encrypted configuration, password, and private Gist under your control.

## Setup

1. Create one private GitHub Gist.
2. Add a file such as `streak-data.json`.
3. Copy the Gist ID.
4. Set the ID in `GIST_CONFIG` in `app.js`.
5. Create a GitHub PAT with only the Gist access required by this app.
6. Open `encrypt-pat.html` in a browser and generate an encrypted configuration.
7. Paste that configuration into `SECURITY_CONFIG` in `app.js`.
8. Serve or deploy the folder as a static site.
9. Open the site and enter the encryption password.

The app initializes an empty or missing data file with default routine data.

## Settings And Calendar

Use **Settings** to edit:

- Gist ID and data filename.
- Routine names.
- Objective names and weekly targets.
- Maximum freezes and the daily freeze earning interval.

Use the calendar to select any past or current date. Future dates are displayed as unavailable and cannot open the logging dialog or receive activity.

## Local Development

A simple local server is enough:

```text
python -m http.server 8000
```

Then open `http://localhost:8000/` in a browser.

The project contains:

```text
streak-manager/
├─ index.html
├─ styles.css
├─ app.js
├─ encrypt-pat.html
├─ README.md
└─ LICENSE
```

## GitHub Pages

This project has no backend and can be deployed to GitHub Pages:

1. Put the project in a repository.
2. Push the files to GitHub.
3. Enable GitHub Pages for the repository and selected branch or folder.
4. Open the published URL and unlock the tracker.

## Backup And Recovery

Use **Export** regularly to download a JSON backup. Keep a backup of the private Gist data as well.

If the unlock password is forgotten, the encrypted PAT cannot be decrypted from the encrypted value alone. You must have the original PAT available so you can generate a new encrypted configuration.

## EVVM Noncommercial License

Copyright (c) 2026 Alex Rambauske.

This project is released under the **EVVM Noncommercial** license. The complete license text is included in [LICENSE](LICENSE). You may view, copy, modify, and share the project for personal, educational, and other noncommercial purposes, provided that credit remains with **Alex Rambauske** and the license notices are retained. Commercial use, sale, or incorporation into a commercial product requires separate permission from the relevant licensor.

By using, modifying, or sharing this project, you accept the terms in [LICENSE](LICENSE).
