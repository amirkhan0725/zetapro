<p align="center">
  <img src="icons/icon-192.png" alt="" width="88" height="88">
</p>

<h1 align="center">Zetapro</h1>

<p align="center">
  <b>Get faster at mental math, and see exactly what's slowing you down.</b><br>
  A Zetamac-style speed game and a timed “80 in 8”, with per-problem-type stats and targeted drills, plus probability and quant reasoning games for trading and quant interview prep.
</p>

<p align="center">
  <a href="https://zetapro.app/"><b>Play in your browser</b></a> ·
  <a href="https://github.com/amirkhan0725/zetapro/releases/latest">Download for Windows</a> ·
  <a href="https://github.com/amirkhan0725/zetapro/issues">Report a bug</a>
</p>

<p align="center">
  <img src="shots/stats.png" alt="Stats page: score per game with a goal line" width="720">
</p>

## Why

Zetamac is a great way to build arithmetic speed, but a round ends with a single number. Zetapro times every answer, sorts it by problem type (carries, borrows, each times table, 2-digit products, decimal division, fractions…) and shows which types cost you the most time and which mistakes you repeat. It then turns those weak spots into targeted drills, so practice goes where it helps most.

## Features

- **Classic:** Zetamac's rules and defaults (2 minutes; an answer counts the instant it's right). Tab restarts a round instantly.
- **Daily Challenge:** one shared 120-second set a day; your first try counts, and you can share the score without spoilers. A practice calendar shows your streak.
- **Where you lose time:** every problem type ranked by how much it slows you down, plus a factor map for × and ÷, mistake patterns (carry slips, off-by-one, swapped digits…) and the exact problems you keep missing.
- **Drills:** smart drills built from your slowest types, trouble-problem drills that retire problems once you've mastered them, or pick your own, with pace tracked per minute.
- **80 in 8:** 80 multiple-choice questions in 8 minutes (whole numbers, decimals, fractions, missing numbers) with net scoring and per-type stats.
- **Probability and quant games:** one for each kind of question in trading-firm online assessments:
  - **Beat the Odds:** probability and expected value.
  - **NumberLogic:** number sequences.
  - **Likelihood-list:** rank three outcomes.
  - **Intervals:** lower ÷ upper scoring, with a calibration report.
  - **Orderbooks:** find the arbitrage.
  - **Zap-N games:** Number Box, Code Compare, Balloon.

  Each has a Test mode in the reported format and a Learn mode that explains every answer.
- **Goals:** set a target score and track how consistently you hit it.
- **Sign in and sync (optional):** sign in with Google or email to keep phone, tablet and computer in step.
- **Phone-friendly:** installs to your home screen, has its own number pad, and works offline.
- **Your data, your control:** undo deletes, restore earlier synced versions, export or import a backup file.

<p align="center">
  <img src="shots/factors.png" alt="Factor map and mistake patterns" width="360">
  <img src="shots/e80.png" alt="80 in 8 question" width="360">
</p>

<p align="center">
  <img src="shots/orderbooks.png" alt="Orderbooks board" width="360">
  <img src="shots/likelihood.png" alt="Likelihood-list question" width="360">
</p>

## Get it

| Where | How |
| --- | --- |
| **Any browser** | Open [zetapro.app](https://zetapro.app/). Nothing to install. |
| **iPhone** | Open the link in Safari → Share → *Add to Home Screen*. |
| **Android** | Open the link in Chrome → ⋮ → *Install app*. |
| **Windows** | [Download the zip](https://github.com/amirkhan0725/zetapro/releases/latest), unzip, run `Zetapro.exe`. It isn't code-signed, so Windows may ask: *More info → Run anyway*. |

## Privacy

No ads, no analytics, no tracking. Games are saved on your device. If you sign in, they also sync to your own account, and database rules let only you read or write it. Signing in is optional; everything works without an account.

## About this repository

This repository is Zetapro's home on GitHub: the Windows downloads are under [Releases](https://github.com/amirkhan0725/zetapro/releases). Its files are a built copy of the website and app that keeps the old address, amirkhan0725.github.io/zetapro, working for older installs; the site itself lives at [zetapro.app](https://zetapro.app/). It's published automatically and replaced on each release, so pull requests against these files won't be merged. To suggest something, [open an issue](https://github.com/amirkhan0725/zetapro/issues).

Built with plain JavaScript (no framework), Electron for the Windows app, and Firebase for optional sign-in and sync.

Zetapro is an independent practice tool, not affiliated with Zetamac or any trading firm.
