// Minimal uncompressed PDF writer for tests. Places text runs at absolute
// positions, which is the only way to build a genuinely TABULAR page (cells
// aligned in columns) versus a PROSE page — the distinction the extraction-mode
// detector exists to make. Generated at test time so no binary lands in the repo.
import { writeFileSync } from 'node:fs';

const esc = (s) => s.replace(/([\()])/g, '\$1');

// pages: [ [ { x, y, size?, text }, ... ], ... ]
export function makePdf(pages, out) {
  const objs = [];
  const FIRST_PAGE_OBJ = 4; // 1 catalog, 2 pages, 3 font
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = `<< /Type /Pages /Kids [${pages.map((_, i) => `${FIRST_PAGE_OBJ + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  pages.forEach((runs, i) => {
    const pageObj = FIRST_PAGE_OBJ + i * 2;
    objs[pageObj] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageObj + 1} 0 R >>`;
    objs[pageObj + 1] = {
      stream: runs.map((r) => `BT /F1 ${r.size || 10} Tf 1 0 0 1 ${r.x} ${r.y} Tm (${esc(r.text)}) Tj ET`).join('\n'),
    };
  });

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = pdf.length;
    const o = objs[i];
    pdf += typeof o === 'string'
      ? `${i} 0 obj\n${o}\nendobj\n`
      : `${i} 0 obj\n<< /Length ${o.stream.length} >>\nstream\n${o.stream}\nendstream\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objs.length; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  writeFileSync(out, pdf, 'latin1');
  return out;
}

// A three-column standards table: code | wrapped text | strand. Mirrors the real
// layout from ehartye/wiki-master#66.
export function tablePages(n = 4) {
  // Twelve rows, not six: the detector abstains below eight distinct key cells
  // (fewer than that and the promotion ratio is noise), so a fixture meant to
  // exercise detection has to clear that floor rather than the floor bend to it.
  const rows = [
    ['5.31', ['Describe the steps that Tennessee took to become a state,', 'including the population requirement and the constitution.'], 'G, H, P'],
    ['5.32', ['Identify the year Tennessee became a state, its first', 'governor, and the original capital city of the state.'], 'G, H, P, T'],
    ['5.33', ['Describe involvement in the War of 1812, including the', 'Tennessee volunteers and the Battle of Horseshoe Bend.'], 'H, P, T'],
    ['5.34', ['Explain how the western boundary of Tennessee was', 'expanded with the Jackson Purchase of 1818.'], 'G, H, T'],
    ['5.35', ['Analyze the impact of the Indian Removal Act on the', 'Cherokee people and the resulting Trail of Tears.'], 'C, G, H, P'],
    ['5.36', ['Examine the growth of the cotton economy in West', 'Tennessee and its reliance on enslaved labor.'], 'E, G, H'],
    ['5.37', ['Describe the role of the state in the secession crisis', 'and the debates that divided its three grand divisions.'], 'H, P, T'],
    ['5.38', ['Identify the major battles fought on Tennessee soil', 'and explain their significance to the wider conflict.'], 'G, H, T'],
    ['5.39', ['Explain the impact of Reconstruction on the state,', 'including the ratification debates of the period.'], 'C, H, P'],
    ['5.40', ['Analyze the rise of a manufacturing economy and its', 'effect on migration patterns within the state.'], 'E, G, H'],
    ['5.41', ['Describe the contributions of Tennesseans during the', 'world wars, including industry and military service.'], 'E, H, T'],
    ['5.42', ['Examine the Civil Rights Movement in Tennessee and', 'the people and places central to that history.'], 'C, H, P, T'],
  ];
  return Array.from({ length: n }, () => {
    const runs = [];
    let y = 740;
    for (const [code, lines, strand] of rows) {
      runs.push({ x: 60, y, text: code }, { x: 470, y, text: strand });
      lines.forEach((ln, i) => runs.push({ x: 130, y: y - i * 13, text: ln }));
      y -= lines.length * 13 + 7;
    }
    return runs;
  });
}

// A two-column paper: the layout that must KEEP reading-order mode, because
// aligned modes interleave its columns line-by-line.
export function prosePages(n = 4) {
  const wrap = (t) => t.match(/.{1,52}(\s|$)/g).map((s) => s.trim());
  const left = wrap('This paper examines how bidding behavior responds to changes in the estimation process used by state transportation agencies. We assemble a panel of unit price data and estimate a model of contractor markup that accounts for the number of bidders and the size of each project awarded.');
  const right = wrap('The results indicate that improved cost estimation reduces the dispersion of submitted bids without raising the average award amount. We interpret this as evidence that better public estimates reduce the informational advantage held by incumbent contractors in these markets.');
  return Array.from({ length: n }, (_, p) => [
    { x: 60, y: 760, size: 9, text: 'Journal of Infrastructure Economics' },
    ...left.map((ln, i) => ({ x: 60, y: 720 - i * 14, text: ln })),
    ...right.map((ln, i) => ({ x: 320, y: 720 - i * 14, text: ln })),
    { x: 300, y: 40, size: 9, text: String(p + 1) },
  ]);
}
