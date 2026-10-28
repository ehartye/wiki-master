import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { letterInventory, assessFidelity, pdfClipContent } from '../scripts/clip-pdf.mjs';

// assessFidelity reads characters, and a broken font map can leave only valid letters: it drops some, shifts the whole
// alphabet, or swaps one letter for another. Every other check reads that as healthy. No natural Latin-script text
// lacks an `a` or a `t`, whatever its language, so a long enough text whose share of a letter that must be there is far
// below any language's share is a text layer with a hole in it. These tests use the pinned documentation corpus as
// clean English prose and short passages for the other languages.

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const corpusDir = join(root, 'eval', 'plugin-docs-vault');
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.md') ? [join(dir, e.name)] : []));
const strip = (text) => text.replace(/^---\n[\s\S]*?\n---\n/, '');
const pages = walk(corpusDir).map((file) => ({ name: file.slice(corpusDir.length + 1), text: strip(readFileSync(file, 'utf8').replace(/\r\n/g, '\n')) }));
const letters = (text) => (text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().match(/[a-z]/g) ?? []).length;
const long = pages.filter((p) => letters(p.text) >= 5000).sort((a, b) => letters(b.text) - letters(a.text));
const sample = long[0].text;

test('the corpus offers enough clean English pages to serve as controls', () => {
  assert.ok(long.length >= 10, `only ${long.length} pages of 5,000 letters or more`);
});

test('every clean page of 5,000 letters or more passes, and is counted as tested', () => {
  for (const p of long) {
    const r = letterInventory(p.text);
    assert.equal(r.tested, true, p.name);
    assert.equal(r.suspect, false, `${p.name}: ${JSON.stringify(r.low)}`);
    assert.equal(assessFidelity(p.text).degraded, false, p.name);
  }
});

const drop = (text, chars) => text.replace(new RegExp(`[${chars}]`, 'g'), '');
const shift = (text, by) => text.replace(/[a-z]/gi, (c) => {
  const base = c <= 'Z' ? 65 : 97;
  return String.fromCharCode(base + ((c.charCodeAt(0) - base + by) % 26));
});
const swap = (text, from, to) => text.replaceAll(from, to).replaceAll(from.toUpperCase(), to.toUpperCase());

test('letters that vanish from a text layer are caught', () => {
  const broken = drop(sample, 'uwxqvUNV');
  const r = letterInventory(broken);
  assert.equal(r.suspect, true);
  assert.ok(r.low.some((x) => x.letter === 'u'), JSON.stringify(r.low));
  assert.equal(assessFidelity(broken).degraded, true);
});

test('an alphabet shifted by a font offset is caught', () => {
  const r = letterInventory(shift(sample, 3));
  assert.equal(r.suspect, true);
  assert.ok(r.low.length >= 3, 'a shift leaves several common letters rare');
});

test('one letter replaced by another throughout is caught', () => {
  const r = letterInventory(swap(sample, 'c', 'k'));
  assert.equal(r.suspect, true);
  assert.deepEqual(r.low.map((x) => x.letter), ['c']);
});

test('a result names the letters, their share and the floor they fell under', () => {
  const r = letterInventory(drop(sample, 'uU'));
  const u = r.low.find((x) => x.letter === 'u');
  assert.ok(u && u.share < u.floor && u.share >= 0 && u.floor > 0);
  assert.ok(r.letters >= 5000);
});

const PASSAGES = {
  spanish: 'La biblioteca de la ciudad abre todos los días a las nueve de la mañana y cierra a las ocho de la noche. Los estudiantes llegan temprano para buscar libros sobre historia, matemáticas y literatura, y muchas personas mayores vienen a leer el periódico mientras toman un café. En el segundo piso hay una sala tranquila donde nadie puede hablar en voz alta, y en el primero se organizan talleres para los niños cada sábado. La bibliotecaria conoce a casi todos los visitantes por su nombre y siempre recomienda una novela nueva a quien pregunta qué leer. Durante el verano, el jardín interior se llena de mesas, y las tardes pasan despacio entre páginas, conversaciones y el sonido lejano de la calle.',
  german: 'Die Stadtbibliothek öffnet jeden Tag um neun Uhr morgens und schließt um acht Uhr abends. Die Studenten kommen früh, um Bücher über Geschichte, Mathematik und Literatur zu suchen, und viele ältere Menschen lesen bei einer Tasse Kaffee die Zeitung. Im zweiten Stock gibt es einen ruhigen Raum, in dem niemand laut sprechen darf, und im Erdgeschoss werden jeden Samstag Werkstätten für die Kinder angeboten. Die Bibliothekarin kennt fast alle Besucher beim Namen und empfiehlt jedem, der nach einem Buch fragt, einen neuen Roman. Im Sommer füllt sich der Innenhof mit Tischen, und die Nachmittage vergehen langsam zwischen Seiten, Gesprächen und dem fernen Geräusch der Straße.',
  french: 'La bibliothèque de la ville ouvre tous les jours à neuf heures du matin et ferme à huit heures du soir. Les étudiants arrivent tôt pour chercher des livres sur l’histoire, les mathématiques et la littérature, et beaucoup de personnes âgées viennent lire le journal en buvant un café. Au deuxième étage, il y a une salle tranquille où personne ne peut parler à voix haute, et au rez-de-chaussée on organise des ateliers pour les enfants chaque samedi. La bibliothécaire connaît presque tous les visiteurs par leur nom et recommande toujours un nouveau roman à celui qui demande quoi lire. Pendant l’été, la cour intérieure se remplit de tables, et les après-midi passent lentement entre les pages, les conversations et le bruit lointain de la rue.',
  italian: 'La biblioteca della città apre ogni giorno alle nove del mattino e chiude alle otto di sera. Gli studenti arrivano presto per cercare libri di storia, matematica e letteratura, e molte persone anziane vengono a leggere il giornale mentre bevono un caffè. Al secondo piano c’è una sala tranquilla dove nessuno può parlare ad alta voce, e al piano terra ogni sabato si organizzano laboratori per i bambini. La bibliotecaria conosce quasi tutti i visitatori per nome e consiglia sempre un romanzo nuovo a chi chiede che cosa leggere. D’estate il giardino interno si riempie di tavoli, e i pomeriggi passano lentamente tra le pagine, le conversazioni e il suono lontano della strada.',
};

test('prose in other Latin-script languages passes', () => {
  for (const [language, text] of Object.entries(PASSAGES)) {
    const r = letterInventory(text, { minLetters: 400 });
    assert.equal(r.tested, true, language);
    assert.equal(r.suspect, false, `${language}: ${JSON.stringify(r.low)}`);
  }
});

test('a text below the length gate is not judged, even when it is broken', () => {
  const short = drop(sample, 'uUaA').slice(0, 1500);
  const r = letterInventory(short);
  assert.equal(r.tested, false);
  assert.equal(r.suspect, false);
});

test('a text that is not Latin script is not judged, whatever letters it lacks', () => {
  const cyrillic = sample.replace(/[a-z]/gi, (c) => 'абвгдежзийклмнопрстуфхцчшщъыьэюя'[(c.toLowerCase().charCodeAt(0) - 97) % 32]);
  assert.ok(letters(cyrillic) < 100, 'the fixture really is not Latin');
  const r = letterInventory(cyrillic);
  assert.equal(r.tested, false);
  assert.equal(r.suspect, false);
});

test('a mostly non-Latin text with a long Latin quotation is not judged, though the quotation alone would be', () => {
  const quotation = drop(sample, 'uUaA');
  assert.ok(letters(quotation) >= 5000, 'the quotation alone passes the length gate');
  assert.equal(letterInventory(quotation).suspect, true, 'and alone it is broken');
  const mixed = `${quotation} ${'приветствие и описание документа '.repeat(2500)}`;
  const r = letterInventory(mixed);
  assert.equal(r.tested, false, 'under 90% Latin letters the script test excludes it');
  assert.equal(r.suspect, false);
});

test('pdfClipContent stamps a broken text layer degraded, and a clean one not', () => {
  const base = { title: 'T', source: '/x/t.pdf', created: '2026-01-01' };
  assert.equal(pdfClipContent({ ...base, text: shift(sample, 3) }).fidelity, 'degraded');
  assert.equal(pdfClipContent({ ...base, text: sample }).fidelity, 'high');
});

test('the inventory also reaches the OCR escalation: a broken layer is retried, not trusted', async () => {
  const { shouldTryOcr } = await import('../scripts/clip-pdf.mjs');
  const clip = pdfClipContent({ title: 'T', source: '/x/t.pdf', text: shift(sample, 3) });
  assert.equal(shouldTryOcr(clip), true);
});
