# Dynamiq rebrand (v5.08)

Source of truth: Claude Docs, "DWO Rebrand Spec: Dynamiq Logo and Rename". This file is the repo copy that the build followed.

DWO is now **Dynamiq Work Order**. The Dynamiq logo goes small at the bottom of the login splash and in the app header, below a larger Providence Mechanical logo on the splash. In-app "ProMech" text becomes "Dynamiq". Customer-facing output keeps Providence Mechanical branding first, with a small "Powered by Dynamiq" footer.

## In scope
- Login splash and app header
- Browser tab title, favicon, installed-app name and icon (new: manifest, icons)
- Every user-visible "ProMech" in the app
- Logo files and app icons

## Out of scope
- Internal identifiers (storage keys, database tables, columns, values, function names, file and repo names, code comments)
- Primary branding on customer PDFs and emails (stays Providence Mechanical)
- Email sender name (the app does not cover it yet; reports open in the user's own mail app)
- The stored `company_logo_url` setting (customer reports keep using it)

## Brand
- Navy `#323271`, brick red `#9C240D` (sampled from the Providence Mechanical logo), white
- Mark: navy hex nut, D cut out, three red speed lines. One-color white version for dark backgrounds
- Wordmark: "Dynamiq" (Manrope 800) with "WORK ORDER" (Manrope 700, spaced) in red

## Login splash
- Large Providence Mechanical logo (vector, `brand/providence-mechanical-logo.svg`) centered above the form: about 78% of screen width on phones, up to 480 px on desktop
- Small Dynamiq mark and wordmark centered at the bottom of the screen
- Form fields, buttons and tap targets unchanged; dark theme puts the Providence logo on a white plate and turns the Dynamiq mark white

## Header
- White one-color Dynamiq mark plus the title text. The default title is "Dynamiq"; other screen titles are unchanged
- The header no longer shows the stored company logo or company name (decision: Dynamiq only)

## Rename rules
| Category | Action |
| --- | --- |
| In-app, user-visible | Replace "ProMech" with "Dynamiq" |
| Customer-facing output | Providence Mechanical stays first; add small "Powered by Dynamiq" footer |
| Internal | Leave unchanged |

## Audit results (before build, v5.07)
- 17 "ProMech" occurrences: index.html 7 (apple title, page title, header default, menu heading, login heading, two version footers), app-core.js 8 (header title default and calls), app-quoted-billing.js 1, gps-engine.js 1 (comment, left alone)
- Database: no "ProMech" text in any text column; `settings.company_name` is "Providence Mechanical"
- No manifest, icons or service worker existed; all new
- Reports build their header from settings (company name, logo, address); no hardcoded ProMech

## Build decisions
1. Header shows Dynamiq only
2. New Providence vector used on the login screen only; stored company logo unchanged
3. "Powered by Dynamiq" added to the printable report footer and the report email text

## Acceptance checks
- [x] Login splash: large Providence logo, small Dynamiq lockup at bottom, phone and desktop, light and dark
- [x] Header shows the Dynamiq mark and title
- [x] Tab title, favicon, manifest and icons resolve
- [x] No user-visible "ProMech" remains
- [x] `node --check` passes on every changed JS file
- [ ] Reports and report email show the footer (needs a real work order; check after deploy)
- [ ] Installed app shows the new name and icon after reinstall (check on Android and iPhone after deploy)
- [ ] Existing logins and offline data work as before (no storage keys changed)

## Known limits
- The "Dynamiq" wordmark in `brand/dynamiq-lockup.svg` uses live text, not outlines (the font file was not available when it was built), so it falls back to the system bold font where Manrope is not installed. On the login screen the wordmark is plain page text in the app's own font.
- The Providence vector was traced from the original small Paint file, so edges are slightly softer than a redrawn logo.
