import { mkdir, copyFile, cp, readFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const catalog = JSON.parse(await readFile(new URL('data/catalog.json', root), 'utf8'));
for (const type of ['subdivision', 'condominium']) {
  if (!catalog[type]?.requirements.length || !catalog[type]?.rates.inspection) throw new Error(`Missing ${type} source catalog`);
}
await mkdir(new URL('dist', root), { recursive: true });
for (const file of ['index.html', 'styles.css', 'app.js', 'favicon.svg', '.nojekyll', 'setup-cloudflare.md']) await copyFile(new URL(file, root), new URL(`dist/${file}`, root));
for (const dir of ['lib', 'data']) await cp(new URL(dir, root), new URL(`dist/${dir}`, root), { recursive: true });
console.log('Built static app in dist/. Source workbooks and local records are excluded.');
