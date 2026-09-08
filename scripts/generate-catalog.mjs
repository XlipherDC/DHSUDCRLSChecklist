import { readFile, writeFile, mkdir } from 'node:fs/promises';

const books = JSON.parse(await readFile(new URL('../source-extract.json', import.meta.url), 'utf8'));
const skip = /^(Type of Compliance:|Amount:|Name of Bonding company:|Validity:|O\.R\. No:|Date:|[\/X-])$/i;
const catalogs = {};
for (const book of books) {
  const sheet = book.sheets.find(s => s.name.startsWith('Checklist'));
  const cells = sheet.cells;
  const heads = Object.entries(cells).filter(([ref, c]) => /^B\d+$/.test(ref) && Number(ref.slice(1)) >= 10 && c.value.trim().length > 3 && !skip.test(c.value.trim()));
  let category = 'Application & declarations';
  const requirements = heads.map(([ref, cell], i) => {
    const title = cell.value.trim();
    if (title.startsWith('Certified True Copy of Titles')) category = 'Land & ownership';
    if (title.startsWith('Certified True Copy of LMS')) category = 'Plans & permits';
    if (title.startsWith('UDHA Compliance')) category = 'Socialized housing compliance';
    if (title.startsWith('BIR Zonal')) category = 'Financial & corporate documents';
    if (title.startsWith('DAR Clearance')) category = 'Clearances & utilities';
    if (title.startsWith("Publisher's")) category = 'Publication & guarantees';
    if (title.startsWith('Engineering plans')) category = 'Final plans & processing';
    const start = Number(ref.slice(1));
    const end = i + 1 < heads.length ? Number(heads[i + 1][0].slice(1)) : start + 1;
    const details = Object.entries(cells).filter(([r, c]) => {
      const [, col, row] = r.match(/^([A-Z]+)(\d+)$/);
      return Number(row) >= start && Number(row) < end && r !== ref && /^[B-E]$/.test(col) && c.value.trim().length > 2 && !c.formula && !/^[\d,.\s]+$/.test(c.value);
    }).map(([r, c]) => ({ text: c.value.trim(), ref: `${sheet.name}!${r}` }));
    return { id: `${book.type}-${ref}`, title, category, source: `${sheet.name}!${ref}`, details };
  });
  const fees = book.sheets.find(s => s.name === 'Fee').cells;
  const isCondo = book.type === 'condominium';
  const rate = (ref) => ({ value: Number(fees[ref].value), source: `Fee!${ref}` });
  catalogs[book.type] = {
    label: isCondo ? 'Condominium' : 'Subdivision', source: book.file, requirements,
    rates: {
      pd957Registration: rate(isCondo ? 'L11' : 'L3'),
      economicRegistration: rate(isCondo ? 'L20' : 'L12'),
      socializedRegistration: rate(isCondo ? 'L19' : 'L11'),
      pd957Processing: rate(isCondo ? 'G13' : 'G5'),
      ...(isCondo ? { commercialProcessing: rate('G14') } : { pd957Housing: rate('G6') }),
      socializedProcessing: rate(isCondo ? 'G22' : 'G14'),
      economicProcessing: rate(isCondo ? 'G23' : 'G15'),
      bp220Housing: rate(isCondo ? 'G24' : 'G16'),
      crForm: rate(isCondo ? 'L15' : 'L7'), lsForm: rate(isCondo ? 'L16' : 'L8'),
      inspection: rate(isCondo ? 'G28' : 'G20'), provisional: rate(isCondo ? 'G51' : 'G23')
    }
  };
}
await mkdir(new URL('../data/', import.meta.url), { recursive: true });
await writeFile(new URL('../data/catalog.json', import.meta.url), JSON.stringify(catalogs, null, 2) + '\n');
for (const [type, c] of Object.entries(catalogs)) console.log(`${type}: ${c.requirements.length} requirements, ${Object.keys(c.rates).length} source rates`);
