# CRLS Workspace

A static, authentication-free app for processors reviewing Certificate of Registration and License to Sell applications. Built from the two Excel workbooks in `ChecklistSource`.

- Subdivision and condominium project records, search, and project details.
- 57 subdivision and 62 condominium document requirements with source cell references and nested review prompts.
- Not submitted, for review, verified, needs revision, and not applicable statuses. N/A requires a reason.
- Received dates, processor names, and review remarks; no document uploading.
- PD957, BP220 economic, and BP220 socialized fee assessments, with itemized quantities, rates, references, payment records, and balance.
- Multiple subdivision categories: PD957 Open Market, PD957 Medium Cost, BP220 Economic, and BP220 Socialized.
- CRLS, TLS, and CLS application types; TLS undertaking selections for ECC, Building Permit, and Verified Survey Returns.
- Whole-project House and Lot / Lot Only counts with an automatic total. Fee assessments retain an explicitly selected rate schedule and separate assessed quantities.
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

## Source mapping and fee assumptions

`data/catalog.json` contains requirement labels, review prompts, fee rates, and worksheet references. It is generated from the provided files; no source project is preloaded and no existing source check marks are used as submission evidence.

The source rates are not certified as the current regulatory schedule; the workbooks do not establish their effective date. Confirm the applicable rates before issuing an official assessment.

| Charge | Subdivision | Condominium |
| --- | --- | --- |
| PD957 registration | ₱2,880 | ₱2,880 |
| PD957 LS processing | ₱216 / lot | ₱17.30 / residential saleable m²; ₱36 / commercial saleable m² |
| PD957 housing | ₱14.40 / housing m² | Included through saleable-area inputs above |
| BP220 socialized registration / processing | ₱420; ₱24 / lot | Same source rates |
| BP220 economic registration / processing | ₱720; ₱72 / lot | Same source rates |
| BP220 housing | ₱3 / housing m² | Same source rate |
| CR form / LS form | ₱216 each | ₱216 each |
| Inspection | ₱1,500 / lot, explicitly entered | Same source label and rate |
| SH provisional compliance certificate | ₱216 / form | ₱216 / form |

Only the selected category is assessed. Mixed-category projects require separate records. Registration may be excluded, form quantities are editable, and inspection/provisional certificate quantities start at zero. Each line is rounded to centavos before totals are summed. Amount paid is recorded separately and never changes the assessed total.

Two source-total issues are corrected:

- Subdivision `Fee!L21 = SUM(L3:M20)` adds all categories; the app selects one category.
- Condominium `Fee!L29 = L11+L13+L15+L16+L28` omits `L14` commercial processing; the app includes it when commercial area is entered.

The supporting Titles, Design Standard, and Area Tab worksheets are not implemented as automated regulatory analyses. Their corresponding document requirements support review statuses and remarks. A completed checklist means the processor verified applicable documents; it does not issue a CR, LS, TLS, or regulatory approval.

To regenerate the catalog after changing source workbooks on Windows:

```sh
npm run extract
npm test
npm run build
```

The PowerShell extractor reads the XLSX ZIP/XML without modifying the workbooks. The generator promotes main requirement labels in column B, excludes metadata-only rows and check marks, groups requirements, preserves nested prompts in columns B–E, and maps rates to explicit source cells. Review `scripts/generate-catalog.mjs` if the workbook layout changes. Existing requirement IDs derive from the type and source cell, so review migration is needed if source rows are inserted or removed.
