# Security Policy

## Supported versions

This is a small utility; security fixes are made on the latest release / `main`.

| Version | Supported |
|---------|:---------:|
| latest (`main`) | ✅ |
| older tags | ❌ |

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Use GitHub's [private vulnerability reporting](https://github.com/mmoollee101-lab/HTMLtoPPTX/security/advisories/new)
to report privately (include details and steps to reproduce).

You'll get an acknowledgement as soon as possible, and we'll work with you on a fix and
disclosure timeline.

## Good to know

- **Runs locally.** The app converts on your machine; your files are not uploaded anywhere.
  The web mode (`npm run web`) binds to `localhost` only.
- **Untrusted HTML.** Conversion renders the input HTML in headless Chromium. Treat decks
  from untrusted sources with the same caution as opening them in a browser.
- **Unsigned binaries.** Portable releases are not code-signed yet, so Windows SmartScreen /
  antivirus may warn on first run. Verify you downloaded the binary from the official
  [Releases](https://github.com/mmoollee101-lab/HTMLtoPPTX/releases) page.
