# Random Word Generator

A static random-word and passphrase generator for GitHub Pages.

## Features

- Word count, capitalization, separator, and length controls
- Switchable Simple (EFF short) and Complex (EFF long) word lists
- Automatic regeneration when settings change
- Passphrase combination estimate
- Copy and restore-defaults buttons
- Browser Web Crypto API for random selection
- No dependencies or build step

## Run locally

Serve the directory so the browser can load the word-list file:

```sh
python -m http.server 8000
```

Open `http://localhost:8000`.

## Deploy

In the repository's GitHub Pages settings, deploy the default branch from the repository root.

## Word list

Uses the [EFF Long Wordlist](https://www.eff.org/dice) with 7,776 words and
[EFF Short Wordlist #1](https://www.eff.org/document/eff-short-wordlist-passphrases-1) with 1,296
shorter words. Generation happens in the browser. The security estimate assumes the selected list
and settings are known.
