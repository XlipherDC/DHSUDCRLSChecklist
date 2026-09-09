# CRLS Workspace

A static, authentication-free app for processors reviewing Certificate of Registration and License to Sell applications. Built from the two Excel workbooks in `ChecklistSource`.

- Subdivision and condominium project records, search, and project details.
- 57 subdivision and 62 condominium document requirements with nested review prompts.
- Not submitted, for review, verified, needs revision, and not applicable statuses. N/A requires a reason.
- Received dates, processor names, and review remarks; no document uploading.
- PD957, BP220 economic, and BP220 socialized fee assessments, with itemized quantities, rates, payment records, and balance.
- Multiple subdivision categories: PD957 Open Market, PD957 Medium Cost, BP220 Economic, and BP220 Socialized.
- CRLS, TLS, and CLS application types; TLS undertaking selections for ECC, Building Permit, and Verified Survey Returns.
- Whole-project House and Lot / Lot Only counts with an automatic total. Fee assessments use one processor-selected CR fee and separate LS quantities for every project classification.
- JSON backup/restore of project records, import collision handling, and printable project summaries.
- Responsive layout, native keyboard-accessible forms/dialogs, and no sign-in.
- Optional shared workspace using a Cloudflare Worker and D1 database, while the interface remains on GitHub Pages.

## Run locally

Install Node.js 22 or later, then run:

```sh
npm install
npm run dev
```

Open `http://127.0.0.1:4173`. Opening `index.html` directly with `file://` is not supported because the app loads the source catalog as JSON.

```sh
npm test
npm run build
node scripts/serve.mjs --dist
```

The build writes the deployable static app to `dist`. It deliberately excludes the original workbooks, extraction intermediates, tests, and tooling.

## Deploy to GitHub Pages

1. Add this project to the intended GitHub repository on `main` or `master`.
2. In the repository, choose **Settings → Pages → Build and deployment → Source → GitHub Actions**.
3. Push the project. The included `.github/workflows/pages.yml` runs checks and tests, builds the static app, and deploys `dist`.
4. Open the URL shown by the successful `github-pages` deployment. It will usually be `https://OWNER.github.io/REPOSITORY/`.

You can also run the workflow manually from Actions. Pull requests run checks without publishing. For another branch name, update the workflow trigger and the `github-pages` environment branch rules.

All asset URLs are relative, and project navigation uses hash routes, so the app works below a repository subpath without a router fallback. GitHub Pages hosts the interface. Cloudflare is used only when shared record storage is enabled.

GitHub reference: [Using custom workflows with GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

## Storage and sharing

The app starts in local mode, with records stored in IndexedDB on the current browser. For records shared across computers, deploy the included Cloudflare Worker and D1 database by following [setup-cloudflare.md](setup-cloudflare.md), then connect through **Shared workspace** in the app.

The shared workspace uses one private link instead of individual accounts. Anyone with the link can view, edit, and delete its records. The app checks for changes every 15 seconds and when the tab becomes active. Optimistic revisions prevent a stale edit from silently replacing a newer change to the same project.

Clearing site data or using a temporary/private browser session can remove local records and the saved shared connection. Shared records remain in D1 and can be reopened with the private link. Backups contain project records and review details. Use **Backup & restore** regularly. The import limit is 150 MB; saves are also capped at that encoded workspace size so the exported backup remains restorable. The app reports failed saves and retains the form for retry.

Document attachment controls are removed. Earlier saved records and backups remain compatible; any legacy attachment data is preserved without being displayed or accepting new document uploads. Backup JSON import remains available for restoring project records.

Imports validate the full backup before writing; matching IDs are kept by default, with an explicit replace option. Import writes are atomic. Copying existing local projects into a shared workspace also requires an explicit confirmation.

The workspace key is access control for the shared data. Keep it private. It is stored as an encrypted Cloudflare Worker secret and is placed in the URL fragment of invitation links, which is not sent to GitHub Pages.

## Fee assessments

The current assessment uses the rates supplied by the workspace owner on September 9, 2026, defined in `lib/fee-schedule.js`.

| Project classification | Single CR processing fee | LS processing | Housing component |
| --- | --- | --- | --- |
| PD957 subdivision (Open Market or Medium Cost) | PHP 2,880 | PHP 216 per saleable lot | PHP 14.40 per square metre of housing floor area, when there is a House and Lot component |
| BP220 Economic subdivision | PHP 720 | PHP 72 per saleable lot | No additional housing charge in the supplied schedule |
| BP220 Socialized subdivision | PHP 420 | PHP 24 per saleable lot | No additional housing charge in the supplied schedule |
| PD957 condominium | PHP 2,880 | Residential PHP 17.30 / saleable square metre; commercial PHP 36 / saleable square metre | Included in saleable-area calculation |
| BP220 condominium | PHP 720 | Residential PHP 7.20 / saleable square metre; commercial PHP 10.65 / saleable square metre | Included in saleable-area calculation |

- A project has one CR. For mixed classifications, the processor selects one applicable CR fee; the fees are never added together. CR may be excluded from an assessment when it is not being charged.
- Each classification has a separate LS calculation. Open Market and Medium Cost remain separate LS classifications even though their rates match. Enter saleable lots and any PD957 housing floor area for each subdivision classification.
- Inspection is charged once per project at PHP 1,500 multiplied by the project area in hectares rounded UP to a whole hectare. For example, 2.5 hectares costs 3 x PHP 1,500 = PHP 4,500. This applies to every PD957 and BP220 project.
- The initial inspection area comes from project land area in square metres divided by 10,000. Updating land area resets the assessment to a draft with the revised inspection area.
- New assessments do not include the old CR/LS form, BP220 housing-area, provisional-certificate, or per-lot inspection charges.
- Each fee line rounds to centavos before summing. Payments affect balance and overpayment, not the assessed total.

Previously saved workbook assessments retain their original calculation until the processor explicitly saves an assessment under the new schedule. Historical backups remain readable. When upgrading a mixed-classification assessment, combined quantities are not automatically duplicated across LS classifications.

## Source mapping

`data/catalog.json` retains document requirements, nested review prompts, and the historical workbook rates used for old saved assessments. Regenerating the document catalog does not change the current fee schedule.

The supporting Titles, Design Standard, and Area Tab worksheets are not implemented as automated regulatory analyses. Their corresponding document requirements support review statuses and remarks. A completed checklist means the processor verified applicable documents; it does not issue a CR, LS, TLS, or regulatory approval.

To regenerate the catalog after changing source workbooks on Windows:

```sh
npm run extract
npm test
npm run build
```

The PowerShell extractor reads the XLSX ZIP/XML without modifying the workbooks. The generator promotes main requirement labels in column B, excludes metadata-only rows and check marks, groups requirements, preserves nested prompts in columns B–E, and maps rates to explicit source cells. Review `scripts/generate-catalog.mjs` if the workbook layout changes. Existing requirement IDs derive from the type and source cell, so review migration is needed if source rows are inserted or removed.
