/* Rezeptkartei – läuft komplett lokal im Browser (IndexedDB), keine Server-Anbindung. */
'use strict';
const APP_VERSION = '8';

/* ---------- Hilfsfunktionen ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), ms);
}
function busy(msg) {
  const el = document.createElement('div');
  el.className = 'busy';
  el.innerHTML = `<div>${esc(msg)}</div>`;
  document.body.appendChild(el);
  return { set: (m) => (el.firstChild.textContent = m), done: () => el.remove() };
}
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
};

/* ---------- Datenbank (IndexedDB) ---------- */
const DB = {
  db: null,
  mem: new Map(), // Fallback, falls IndexedDB nicht verfügbar
  async open() {
    try {
      this.db = await new Promise((res, rej) => {
        const r = indexedDB.open('rezeptkartei', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('recipes', { keyPath: 'id' });
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    } catch (e) {
      console.warn('IndexedDB nicht verfügbar', e);
      this.db = null;
    }
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  },
  tx(mode, fn) {
    return new Promise((res, rej) => {
      const t = this.db.transaction('recipes', mode);
      const store = t.objectStore('recipes');
      const r = fn(store);
      t.oncomplete = () => res(r && r.result);
      t.onerror = () => rej(t.error);
    });
  },
  async all() {
    if (!this.db) return [...this.mem.values()];
    return this.tx('readonly', (s) => s.getAll());
  },
  async get(id) {
    if (!this.db) return this.mem.get(id);
    return this.tx('readonly', (s) => s.get(id));
  },
  async put(rec) {
    rec.updated = Date.now();
    if (!this.db) { this.mem.set(rec.id, rec); return; }
    return this.tx('readwrite', (s) => s.put(rec));
  },
  async del(id) {
    if (!this.db) { this.mem.delete(id); return; }
    return this.tx('readwrite', (s) => s.delete(id));
  },
};

/* ---------- Zutaten parsen & rechnen ---------- */
const UNIT_MAP = {
  g: 'g', gr: 'g', gramm: 'g', kg: 'kg', kilo: 'kg', mg: 'mg',
  ml: 'ml', cl: 'cl', dl: 'dl', l: 'l', liter: 'l',
  el: 'EL', essl: 'EL', esslöffel: 'EL', tl: 'TL', teel: 'TL', teelöffel: 'TL',
  msp: 'Msp.', prise: 'Prise', prisen: 'Prise',
  stk: 'Stk.', stück: 'Stk.', st: 'Stk.',
  pck: 'Pck.', pkg: 'Pck.', päckchen: 'Pck.', packung: 'Pck.', pack: 'Pck.',
  dose: 'Dose', dosen: 'Dose', bund: 'Bund', zehe: 'Zehe', zehen: 'Zehe',
  scheibe: 'Scheibe', scheiben: 'Scheibe', becher: 'Becher', tasse: 'Tasse', tassen: 'Tasse',
  glas: 'Glas', gläser: 'Glas', handvoll: 'Handvoll', zweig: 'Zweig', zweige: 'Zweig',
  stange: 'Stange', stangen: 'Stange', kopf: 'Kopf', knolle: 'Knolle', knollen: 'Knolle',
  blatt: 'Blatt', blätter: 'Blatt', würfel: 'Würfel', flasche: 'Flasche', beutel: 'Beutel',
};
const FRACTIONS = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125 };
const NUM = String.raw`(?:\d+(?:[.,]\d+)?)`;
const QTY_RE = new RegExp(
  String.raw`^\s*(` +
    String.raw`\d+\s*[½¼¾⅓⅔⅛]|\d+\s+\d+\/\d+|\d+\/\d+|[½¼¾⅓⅔⅛]|${NUM}(?:\s*[-–]\s*${NUM})?` +
  String.raw`)\s*`
);

function parseNumber(s) {
  s = s.trim();
  let m;
  if ((m = s.match(/^(\d+)\s*([½¼¾⅓⅔⅛])$/))) return +m[1] + FRACTIONS[m[2]];
  if ((m = s.match(/^(\d+)\s+(\d+)\/(\d+)$/))) return +m[1] + m[2] / m[3];
  if ((m = s.match(/^(\d+)\/(\d+)$/))) return m[1] / m[2];
  if (FRACTIONS[s]) return FRACTIONS[s];
  if ((m = s.match(/[-–]\s*(.+)$/))) return parseFloat(m[1].replace(',', '.')); // Bereich "2-3": oberer Wert
  return parseFloat(s.replace(',', '.'));
}

function parseIngredient(line) {
  let rest = line.replace(/^[\s•·\-–*]+/, '').trim();
  if (!rest) return null;
  let qty = null;
  let unit = '';
  const m = rest.match(QTY_RE);
  if (m) {
    qty = parseNumber(m[1]);
    rest = rest.slice(m[0].length);
  }
  const um = rest.match(/^([A-Za-zÄÖÜäöüß]+)\.?(?=\s|$)/);
  // Einheit nur übernehmen, wenn danach noch ein Name folgt (sonst ist es z.B. "1 Zehe")
  if (um && UNIT_MAP[um[1].toLowerCase()] && rest.slice(um[0].length).trim()) {
    unit = UNIT_MAP[um[1].toLowerCase()];
    rest = rest.slice(um[0].length);
  }
  const name = rest.trim().replace(/^[,:]\s*/, '');
  if (!name) return { qty, unit: '', name: unit || (m ? m[1] : line.trim()) };
  return { qty: Number.isFinite(qty) ? qty : null, unit, name };
}
function parseIngredients(text) {
  return text.split('\n').map(parseIngredient).filter(Boolean);
}
function fmtNum(n) {
  if (n == null) return '';
  const r = n >= 100 ? Math.round(n) : n >= 10 ? Math.round(n * 2) / 2 : Math.round(n * 100) / 100;
  return r.toLocaleString('de-DE', { maximumFractionDigits: 2 });
}
function fmtIngredient(i, factor = 1) {
  const q = i.qty != null ? fmtNum(i.qty * factor) : '';
  return { q: [q, i.unit].filter(Boolean).join(' '), name: i.name };
}
function ingredientToLine(i) {
  return [i.qty != null ? fmtNum(i.qty) : '', i.unit, i.name].filter(Boolean).join(' ');
}

// Einkaufsliste: nur Zutatennamen, ohne Mengen/Einheiten.
// Wird eine Zutat in mehreren Rezepten gebraucht, steht "2x", "3x" … davor.
function shoppingNames(name) {
  return String(name || '')
    .replace(/\([^)]*\)/g, ' ') // Klammerzusätze, z. B. "(ca. 200 g)"
    .split(/,|;|\s+und\s+|\s+oder\s+|\s*&\s*|\s*\/\s*/i)
    .map((n) => n
      .replace(/^(etwas|evtl\.?|eventuell|optional|nach belieben|n\.\s?b\.?|ggf\.?|frisch gemahlener?|frischer?|einige|ein paar|wenig|viel)\s+/i, '')
      .replace(/\s+(nach belieben|zum (bestreuen|garnieren|braten|anbraten|servieren)|optional|n\.\s?b\.?)$/i, '')
      .replace(/^[\s\-–•.:]+|[\s\-–.:]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim())
    .filter((n) => /[A-Za-zÄÖÜäöüß]{2,}/.test(n));
}
/* ---------- Vorrat (Dinge, die man meistens zu Hause hat) ---------- */
const DEFAULT_PANTRY = ['Salz', 'Pfeffer', 'Zucker', 'Mehl', 'Öl', 'Olivenöl', 'Sonnenblumenöl', 'Rapsöl', 'Essig',
  'Balsamico', 'Paprikapulver', 'Currypulver', 'Curry', 'Kreuzkümmel', 'Kurkuma', 'Zimt', 'Muskat', 'Muskatnuss',
  'Oregano', 'Majoran', 'Chilipulver', 'Chiliflocken', 'Cayennepfeffer', 'Lorbeerblatt', 'Knoblauchpulver',
  'Gemüsebrühe', 'Brühe', 'Backpulver', 'Natron', 'Vanillezucker', 'Puderzucker', 'Speisestärke', 'Senf',
  'Sojasauce', 'Honig'];
const itemKey = (name) => String(name).toLowerCase().replace(/\s+/g, ' ').trim().replace(/(en|n|e|s)$/, '');
const getPantry = () => ls.get('pantry', DEFAULT_PANTRY);
const setPantry = (list) => ls.set('pantry', [...new Map(list.map((n) => [itemKey(n), n.trim()])).values()].filter(Boolean).sort((a, b) => a.localeCompare(b, 'de')));
// Gehört eine Zutat zum Vorrat? Auch "schwarzer Pfeffer" oder "Salz grob" passen zu "Pfeffer"/"Salz".
// Liefert den passenden Vorrats-Namen oder null
function pantryMatch(name, pantry = getPantry()) {
  const byKey = new Map(pantry.map((n) => [itemKey(n), n]));
  if (byKey.has(itemKey(name))) return byKey.get(itemKey(name));
  for (const w of String(name).split(/\s+/)) if (byKey.has(itemKey(w))) return byKey.get(itemKey(w));
  return null;
}

function buildShoppingList(entries) {
  // entries: [{recipe, portions}]
  const map = new Map();
  const pantry = getPantry();
  for (const { recipe } of entries) {
    const seen = new Set(); // pro Rezept jede Zutat nur einmal zählen
    for (const ing of recipe.ingredients || []) {
      if (isInstructionText(ing.name)) continue; // Sätze der Anleitung gehören nicht auf die Einkaufsliste
      for (const raw of shoppingNames(ing.name)) {
        const pm = pantryMatch(raw, pantry);
        const name = pm || raw; // "schwarzer Pfeffer" -> "Pfeffer"
        const isP = !!pm;
        // Singular/Plural zusammenführen (Zwiebel/Zwiebeln, Tomate/Tomaten)
        const key = itemKey(name);
        if (seen.has(key)) continue;
        seen.add(key);
        const cur = map.get(key) || { name, count: 0, isP };
        if (name.length < cur.name.length) cur.name = name; // kürzeste Form ("Zwiebel")
        cur.count++;
        map.set(key, cur);
      }
    }
  }
  // Ergebnis: { buy: [...], pantry: [...] } – jeweils {name, count}
  const all = [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'));
  return {
    buy: all.filter((it) => !it.isP).map(({ name, count }) => ({ name, count, on: true })),
    pantry: all.filter((it) => it.isP).map(({ name, count }) => ({ name, count, on: false })),
  };
}
const itemLabel = (it) => (it.count > 1 ? `${it.count}x ` : '') + it.name;

/* ---------- PDF / Bild-Import ---------- */
if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';

function canvasToJpeg(canvas, q = 0.78) { return canvas.toDataURL('image/jpeg', q); }
function scaledCanvas(src, w, h, maxW) {
  const s = Math.min(1, maxW / w);
  const c = document.createElement('canvas');
  c.width = Math.round(w * s); c.height = Math.round(h * s);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}
function loadImg(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Bild konnte nicht gelesen werden')); i.src = src; });
}

/* ---------- Texterkennung (OCR, läuft lokal auf dem Handy) ---------- */
const OCR = {
  worker: null,
  onProgress: null,
  async get() {
    if (this.worker) return this.worker;
    if (!window.Tesseract) throw new Error('Texterkennung nicht geladen');
    const abs = (p) => new URL(p, location.href).href;
    this.worker = await Tesseract.createWorker('deu', 1, {
      workerPath: abs('lib/tesseract/worker.min.js'),
      corePath: abs('lib/tesseract/core'),
      langPath: abs('lib/tesseract/lang'),
      workerBlobURL: false,
      logger: (m) => this.onProgress && this.onProgress(m),
    });
    await this.worker.setParameters({ preserve_interword_spaces: '1' });
    return this.worker;
  },
  // src: Bild, Canvas oder dataURL
  lowConfidence: false,
  async recognize(src, onProgress) {
    this.onProgress = onProgress;
    const w = await this.get();
    const canvas = prepareForOcr(src);
    const { data } = await w.recognize(canvas);
    // Sehr unsichere Erkennung (typisch bei Handschrift) liefert nur Buchstabensalat -> verwerfen
    if ((data.confidence ?? 100) < 55) { this.lowConfidence = true; return ''; }
    try {
      const t = layoutText(data, canvas.width);
      if (t.trim()) return t;
    } catch (e) { console.warn('Layout-Auswertung fehlgeschlagen', e); }
    return data.text || '';
  },
};

// Erkannten Text in Lesereihenfolge bringen – auch bei Karten mit zwei Spalten
// (z. B. Zutaten links, Zubereitung rechts).
function layoutText(data, W) {
  const segs = [];
  for (const line of data.lines || []) {
    const ws = (line.words || []).filter((w) => {
      const t = (w.text || '').trim();
      if (!t) return false;
      const alnum = t.replace(/[^A-Za-zÄÖÜäöüß0-9½¼¾]/g, '').length;
      if (!alnum) return false; // reine Satzzeichen/Striche
      return !(w.confidence < 55 && alnum < 3); // kurze, unsichere Krümel (Ränder, Schatten)
    });
    if (!ws.length) continue;
    const h = Math.max(8, line.bbox.y1 - line.bbox.y0);
    let cur = null;
    for (const w of ws) {
      // große Lücke in der Zeile = hier beginnt die nächste Spalte
      if (cur && w.bbox.x0 - cur.x1 > h * 2.2) { segs.push(cur); cur = null; }
      if (!cur) cur = { x0: w.bbox.x0, x1: w.bbox.x1, y: line.bbox.y0, text: w.text };
      else { cur.x1 = w.bbox.x1; cur.text += ' ' + w.text; }
    }
    segs.push(cur);
  }
  const byY = (a, b) => a.y - b.y || a.x0 - b.x0;
  // Spaltengrenze suchen: eine x-Position, die (fast) keine Zeile überquert
  let best = null;
  for (const c of segs) {
    const g = c.x0 - 1;
    if (g < W * 0.2 || g > W * 0.8) continue;
    const left = segs.filter((t) => t.x1 <= g).length;
    const right = segs.filter((t) => t.x0 >= g).length;
    const span = segs.length - left - right;
    if (left < 3 || right < 3) continue;
    const min = Math.min(left, right);
    if (!best || span < best.span || (span === best.span && min > best.min)) best = { g, span, min };
  }
  let ordered;
  if (best && best.span <= segs.length * 0.2) {
    const L = segs.filter((t) => t.x1 <= best.g).sort(byY);
    const R = segs.filter((t) => t.x0 >= best.g).sort(byY);
    const S = segs.filter((t) => t.x1 > best.g && t.x0 < best.g).sort(byY);
    const top = Math.min(L[0].y, R[0].y);
    ordered = [...S.filter((t) => t.y <= top), ...L, ...R, ...S.filter((t) => t.y > top)];
  } else {
    ordered = segs.sort(byY);
  }
  return ordered.map((t) => t.text.replace(/\s+/g, ' ').trim()).join('\n');
}

// Bild für die Texterkennung aufbereiten: passende Größe, Graustufen, Kontrast
function prepareForOcr(src) {
  const w0 = src.naturalWidth || src.width, h0 = src.naturalHeight || src.height;
  const s = Math.min(2400 / w0, 1.8);
  const c = document.createElement('canvas');
  c.width = Math.round(w0 * s); c.height = Math.round(h0 * s);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(src, 0, 0, c.width, c.height);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) {
    const g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
    d[i] = g; hist[g]++;
  }
  // Kontrast strecken (1 % dunkelste / hellste Pixel abschneiden)
  const total = d.length / 4;
  let lo = 0, hi = 255, acc = 0;
  for (; lo < 255 && (acc += hist[lo]) < total * 0.01; lo++);
  acc = 0;
  for (; hi > 0 && (acc += hist[hi]) < total * 0.01; hi--);
  const range = Math.max(1, hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.max(0, Math.min(255, ((d[i] - lo) * 255) / range));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function ocrProgressText(prefix, m) {
  if (m.status === 'recognizing text') return `${prefix}Text wird erkannt … ${Math.round(m.progress * 100)} %`;
  return `${prefix}Texterkennung wird vorbereitet …`;
}

async function readPdf(file, progress = () => {}) {
  if (!window.pdfjsLib) throw new Error('PDF-Bibliothek nicht geladen');
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const pages = [];
  const texts = [];
  let ocrUsed = false;
  for (let p = 1; p <= pdf.numPages; p++) {
    const pre = pdf.numPages > 1 ? `Seite ${p}/${pdf.numPages}: ` : '';
    progress(pre + 'Lese PDF …');
    const page = await pdf.getPage(p);
    const base = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: Math.min(4, 2200 / base.width) });
    const c = document.createElement('canvas');
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    pages.push(canvasToJpeg(scaledCanvas(c, c.width, c.height, 1300)));
    // 1. Versuch: eingebetteter Text der PDF
    const tc = await page.getTextContent();
    const rows = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const y = it.transform[5], x = it.transform[4];
      let row = rows.find((r) => Math.abs(r.y - y) < Math.max(2, (it.height || 10) * 0.5));
      if (!row) { row = { y, parts: [] }; rows.push(row); }
      row.parts.push({ x, s: it.str });
    }
    rows.sort((a, b) => b.y - a.y);
    let pageText = rows.map((r) => r.parts.sort((a, b) => a.x - b.x).map((q) => q.s).join(' ').replace(/\s+/g, ' ').trim()).join('\n');
    // 2. Kein Text (eingescannte Karte) → Texterkennung auf dem Bild
    if (pageText.replace(/\s/g, '').length < 20) {
      pageText = await OCR.recognize(c, (m) => progress(ocrProgressText(pre, m)));
      ocrUsed = true;
    }
    texts.push(pageText);
    c.width = c.height = 0; // Speicher freigeben (wichtig auf dem iPhone)
  }
  return { pages, text: texts.join('\n'), ocrUsed };
}

async function readImage(file, progress = () => {}) {
  const url = URL.createObjectURL(file);
  try {
    progress('Lese Foto …');
    const img = await loadImg(url);
    const pages = [canvasToJpeg(scaledCanvas(img, img.naturalWidth, img.naturalHeight, 1300))];
    const text = await OCR.recognize(img, (m) => progress(ocrProgressText('', m)));
    return { pages, text, ocrUsed: true };
  } finally { URL.revokeObjectURL(url); }
}

// Texterkennung für bereits gespeicherte Seiten eines Rezepts
async function ocrPages(pages, progress = () => {}) {
  const texts = [];
  for (let i = 0; i < pages.length; i++) {
    const pre = pages.length > 1 ? `Seite ${i + 1}/${pages.length}: ` : '';
    const img = await loadImg(pages[i]);
    texts.push(await OCR.recognize(img, (m) => progress(ocrProgressText(pre, m))));
  }
  return texts.join('\n');
}

async function makeThumb(dataUrl) {
  const img = await loadImg(dataUrl);
  const size = 160;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const s = Math.max(size / img.width, size / img.height);
  const w = img.width * s, h = img.height * s;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h); // oben links ausrichten (Titel der Karte sichtbar)
  return canvasToJpeg(c, 0.7);
}

/* ---------- Text der Karte in Titel / Zutaten / Zubereitung aufteilen ---------- */
const ING_HEAD = /^(zutat\w*|einkaufsliste|du brauchst|das brauchst du|was du brauchst)\b/i;
const STEP_HEAD = /^(zubereit\w*|anleit\w*|so geht'?s|so wird'?s gemacht|und so wird'?s gemacht|schritte|arbeitsschritte|zubereitungsschritte|kochanleitung)\b/i;
const META = /(personen|portionen|minuten|min\.|std\.|kcal|kalorien|schwierigkeit|zubereitungszeit|kochzeit|gesamtzeit|arbeitszeit|backzeit)/i;
const GENERIC_NAME = /^(image|img|scan|dsc|pxl|photo|foto|bild|screenshot|dokument|document|file|kopie)[\s_-]*\d*/i;

function cleanLine(l) {
  return l
    .replace(/[|¦_~]+/g, ' ')
    .replace(/^[\s•·●▪■□◦○*»>\-–—→]+(?=\S)/, (m) => (m.trim() ? '→ ' : '')) // Aufzählungszeichen/Pfeile -> Markierung
    .replace(/\s+/g, ' ')
    .trim();
}
const words = (l) => l.split(/\s+/).filter(Boolean).length;
const isStepNumber = (l) => /^\d{1,2}\s*[.)]\s+\D/.test(l) && !/^\d+[.,]\d/.test(l);
// Typischer Lesefehler: "1 l Milch" wird als "11 Milch" erkannt
const LIQUID = /(brühe|milch|wasser|sahne|wein|saft|fond|bier|essig|öl|sud)/i;
function fixOcrIngredient(l) {
  return l.replace(/^(\d+(?:[.,]\d+)?)[1lI|]\s+(?=\S+)/, (m, n, off, str) => (LIQUID.test(str.slice(m.length).split(/\s+/)[0]) ? n + ' l ' : m));
}
function looksLikeIngredient(l) {
  if (isStepNumber(l)) return false;
  const w = words(l);
  if (/[.!?]$/.test(l) && w >= 4) return false;
  if (w > 8) return false;
  if (QTY_RE.test(l) && /^\s*[\d½¼¾⅓⅔⅛]/.test(l)) return true;
  const first = l.split(/\s+/)[0].replace(/\.$/, '').toLowerCase();
  if (UNIT_MAP[first] || /^(etwas|n\.\s?b\.|nach belieben|evtl\.|optional)/i.test(l)) return true;
  return w <= 3 && !/[.!?:]$/.test(l);
}
function isInstructionText(name) {
  const l = String(name || '').trim();
  return !l || l.length > 70 || STEP_HEAD.test(l) || ING_HEAD.test(l) || (looksLikeSentence(l) && !/^\s*[\d½¼¾]/.test(l));
}
function looksLikeSentence(l) {
  const w = words(l);
  return isStepNumber(l) || w >= 8 || (w >= 4 && /[.!?]$/.test(l)) || /[a-zäöüß]{4,}[.!?]$/.test(l) && !/^\s*[\d½¼¾]/.test(l);
}
// Zeilen der Zubereitung zu ganzen Schritten zusammenfügen
function mergeSteps(lines) {
  const out = [];
  for (const raw of lines) {
    const startsNew = isStepNumber(raw) || /^→/.test(raw);
    const text = (startsNew ? raw.replace(/^(\d{1,2}\s*[.)]|→)\s*/, '') : raw).trim();
    if (!text) continue;
    const prev = out[out.length - 1];
    if (!prev || startsNew || /[.!?:]$/.test(prev)) out.push(text);
    else if (/-$/.test(prev) && /^[a-zäöüß]/.test(text)) out[out.length - 1] = prev.slice(0, -1) + text;
    else out[out.length - 1] = prev + ' ' + text;
  }
  return out;
}

function guessFromText(text, fallbackTitle) {
  const out = { title: '', servings: 0, ingredients: '', steps: '' };
  text = String(text || '')
    .replace(/\s*(?:-->|->|=>|⇒|➔|➜|→)\s*/g, '\n→ ') // Pfeile ("-> Erdäpfel kochen") = neuer Schritt
    .replace(/\r/g, '');
  const unmark = (l) => l.replace(/^→\s*/, '');
  const lines = text.split('\n').map(cleanLine).filter((l) => {
    if (!/[A-Za-zÄÖÜäöüß]{3,}|\d/.test(l)) return false;
    const chars = l.replace(/\s/g, '');
    return chars.replace(/[^A-Za-zÄÖÜäöüß0-9½¼¾,.()-]/g, '').length >= chars.length * 0.7;
  });
  const sv = text.match(/(?:für\s*)?(\d+)\s*(?:Personen|Portionen|Pers\.|Port\.)/i);
  if (sv && +sv[1] > 0 && +sv[1] < 30) out.servings = +sv[1];

  // Titel: erste aussagekräftige Zeile vor den Zutaten
  let titleIdx = lines.findIndex((l) => !/^→/.test(l) && !ING_HEAD.test(l) && !STEP_HEAD.test(l) && !META.test(l) && /[A-Za-zÄÖÜäöüß]{3,}/.test(l) && !looksLikeSentence(l) && !/^\s*[\d½¼¾]/.test(l));
  const firstHead = lines.findIndex((l) => ING_HEAD.test(unmark(l)) || STEP_HEAD.test(unmark(l)));
  if (firstHead >= 0 && titleIdx > firstHead) titleIdx = -1;
  if (titleIdx >= 0) out.title = lines[titleIdx].replace(/[.:]+$/, '');

  const ing = [], steps = [];
  let section = null;
  // Eine Zutaten-Zeile wie "Lachsfilet, Erdäpfel, Magerquark" in einzelne Zutaten aufteilen
  const pushIng = (l) => l.split(/,\s*(?=[A-Za-zÄÖÜäöüß])/).map((x) => x.trim()).filter(Boolean).forEach((x) => ing.push(x));
  lines.forEach((l, i) => {
    if (i === titleIdx) return;
    const marked = /^→/.test(l);
    l = unmark(l);
    if (ING_HEAD.test(l)) { section = 'ing'; l = l.replace(ING_HEAD, '').replace(/^[^:]*:\s*/, '').trim(); if (!l) return; }
    else if (STEP_HEAD.test(l)) { section = 'step'; l = l.replace(STEP_HEAD, '').replace(/^\s*:\s*/, '').trim(); if (!l) return; }
    if (META.test(l) && words(l) <= 6 && !looksLikeSentence(l)) return;
    const step = (marked ? '→ ' : '') + l;
    if (section === 'step') steps.push(step);
    else if (section === 'ing') { if (looksLikeSentence(l)) steps.push(step); else pushIng(l); }
    else if (looksLikeIngredient(l) && !(marked && words(l) >= 3)) pushIng(l);
    else steps.push(step);
  });
  out.ingredients = ing.map(fixOcrIngredient).join('\n');
  out.steps = mergeSteps(steps).join('\n');
  if (!out.title) out.title = GENERIC_NAME.test(fallbackTitle || '') ? '' : fallbackTitle || '';
  return out;
}

function applyGuess(rec, text, fallbackTitle) {
  const g = guessFromText(text, fallbackTitle);
  rec.title = g.title || rec.title || 'Neues Rezept';
  if (g.servings) rec.servings = g.servings;
  const all = parseIngredients(g.ingredients);
  const moved = all.filter((i) => isInstructionText(i.name)).map(ingredientToLine);
  rec.ingredients = all.filter((i) => !isInstructionText(i.name));
  rec.steps = [g.steps, ...moved].filter(Boolean).join('\n');
  rec.sourceText = text;
  rec.needsReview = true;
}

const HANDWRITING_HINT = 'Text konnte nicht gelesen werden (z. B. Handschrift). Tipp: ✎ öffnen → „Text der Karte einfügen“.';
async function importFiles(files) {
  OCR.lowConfidence = false;
  const b = busy('Importiere …');
  const created = [];
  let n = 0;
  for (const f of files) {
    n++;
    const pre = files.length > 1 ? `Karte ${n}/${files.length} – ` : '';
    try {
      const isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
      const progress = (m) => b.set(pre + m);
      const { pages, text } = isPdf ? await readPdf(f, progress) : await readImage(f, progress);
      const rec = { id: uid(), title: '', servings: 2, ingredients: [], steps: '', pages, created: Date.now() };
      applyGuess(rec, text, f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '));
      rec.thumb = pages[0] ? await makeThumb(pages[0]) : '';
      await DB.put(rec);
      created.push(rec);
    } catch (e) {
      console.error(e);
      toast(`Fehler bei ${f.name}: ${e.message}`, 4000);
    }
  }
  b.done();
  if (OCR.lowConfidence) toast(HANDWRITING_HINT, 6000);
  return created;
}

/* ---------- Wochenplan & Einkaufsliste ---------- */
const getPlan = () => ls.get('plan', {});
const setPlan = (p) => ls.set('plan', p);

/* ---------- Routing / Ansichten ---------- */
let recipesCache = [];
let focusPaste = false;
async function loadRecipes() {
  recipesCache = (await DB.all()).sort((a, b) => a.title.localeCompare(b.title, 'de'));
  return recipesCache;
}

function setHeader(title, { back = false, action = null } = {}) {
  $('#title').textContent = title;
  document.title = title === 'Rezepte' ? 'Rezeptkartei' : title + ' – Rezeptkartei';
  const bb = $('#backBtn');
  bb.hidden = !back;
  const ab = $('#actionBtn');
  if (action) {
    ab.hidden = false;
    ab.textContent = action.label;
    ab.setAttribute('aria-label', action.aria || action.label);
    ab.onclick = action.onClick;
  } else { ab.hidden = true; ab.onclick = null; }
}
function setTab(tab) {
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
}
const go = (hash) => { if (location.hash === hash) render(); else location.hash = hash; };

async function render() {
  const h = location.hash.slice(1) || 'recipes';
  const [route, id] = h.split('/');
  const view = $('#view');
  window.scrollTo(0, 0);
  switch (route) {
    case 'recipe': setTab('recipes'); return viewRecipe(view, id);
    case 'edit': setTab('recipes'); return viewEdit(view, id);
    case 'week': setTab('week'); return viewWeek(view);
    case 'list': setTab('list'); return viewList(view);
    case 'settings': setTab('settings'); return viewSettings(view);
    case 'pantry': setTab('pantry'); return viewPantry(view);
    default: setTab('recipes'); return viewRecipes(view);
  }
}

async function viewRecipes(view) {
  setHeader('Rezepte', { action: { label: '+', aria: 'Rezept hinzufügen', onClick: () => addMenu() } });
  const recipes = await loadRecipes();
  if (!recipes.length) {
    view.innerHTML = `
      <div class="empty">
        <div class="big">📇</div>
        <p>Noch keine Rezepte.<br>Lade die PDFs deiner Karteikarten hoch.</p>
      </div>
      <button class="btn" id="imp">PDF / Foto hochladen</button>
      <div class="btn-row"><button class="btn secondary" id="manual">Manuell anlegen</button></div>`;
    $('#imp').onclick = () => $('#pdfInput').click();
    $('#manual').onclick = () => go('#edit/new');
    return;
  }
  const q = ls.get('search', '');
  view.innerHTML = `<input class="search" type="search" placeholder="Suchen (Gericht oder Zutat) …" value="${esc(q)}"><div class="grid" id="grid"></div>`;
  const plan = getPlan();
  const draw = (q) => {
    const ql = q.toLowerCase();
    const list = recipes.filter((r) => !ql || r.title.toLowerCase().includes(ql) || (r.ingredients || []).some((i) => i.name.toLowerCase().includes(ql)));
    $('#grid').innerHTML = list.map((r) => `
      <button class="card" data-id="${esc(r.id)}">
        ${r.thumb ? `<img class="thumb" src="${r.thumb}" alt="">` : `<div class="thumb">🍲</div>`}
        <div class="meta">
          <div class="name">${esc(r.title)}</div>
          <div class="sub">${(r.ingredients || []).length} Zutaten · ${r.servings || '?'} Portionen</div>
          <div>${plan[r.id] ? '<span class="badge">✓ Diese Woche</span> ' : ''}${r.needsReview ? '<span class="badge" style="background:#fbe9d5;color:#9a5a12">prüfen</span>' : ''}</div>
        </div>
      </button>`).join('') || '<div class="empty">Nichts gefunden.</div>';
  };
  draw(q);
  $('.search').oninput = (e) => { ls.set('search', e.target.value); draw(e.target.value); };
  $('#grid').onclick = (e) => { const c = e.target.closest('.card'); if (c) go('#recipe/' + c.dataset.id); };
}

function addMenu() {
  const view = $('#view');
  setHeader('Hinzufügen', { back: true });
  view.innerHTML = `
    <div class="section">
      <h2>PDF oder Foto der Karteikarte</h2>
      <p class="hint">Du kannst mehrere Dateien auf einmal auswählen – pro Datei entsteht ein Rezept. Enthält die PDF Text, werden Titel, Zutaten und Zubereitung automatisch vorgeschlagen. Bitte danach kurz prüfen.</p>
      <button class="btn" id="imp">Dateien auswählen</button>
    </div>
    <button class="btn secondary" id="manual">Rezept manuell anlegen</button>`;
  $('#imp').onclick = () => $('#pdfInput').click();
  $('#manual').onclick = () => go('#edit/new');
}

async function deleteRecipe(r) {
  if (!confirm(`„${r.title}“ wirklich löschen?\nDas kann nicht rückgängig gemacht werden.`)) return false;
  await DB.del(r.id);
  const p = getPlan(); delete p[r.id]; setPlan(p);
  toast('Rezept gelöscht');
  history.replaceState(null, '', '#recipes');
  render();
  return true;
}

async function viewRecipe(view, id) {
  const r = await DB.get(id);
  if (!r) return go('#recipes');
  setHeader(r.title, { back: true, action: { label: '✎', aria: 'Bearbeiten', onClick: () => go('#edit/' + id) } });
  let portions = getPlan()[id] || r.servings || 2;
  let stepsArr = (r.steps || '').split(/\n+/).map((s) => s.replace(/^\s*\d+[.)]\s*/, '').trim()).filter(Boolean);
  const draw = () => {
    const plan = getPlan();
    const factor = r.servings > 0 ? portions / r.servings : 1;
    view.innerHTML = `
      ${r.needsReview ? `<div class="section" style="border-color:#e8b77a">⚠️ Automatisch erkannt – bitte kurz prüfen und bei Bedarf über <b>✎</b> korrigieren.
        <div class="btn-row"><button class="btn secondary" id="okBtn">Ist korrekt</button></div></div>` : ''}
      ${!(r.ingredients || []).length ? `<div class="btn-row" style="margin:0 0 14px">
        <button class="btn" id="pasteBtn">📋 Text einfügen</button>
        ${(r.pages || []).length ? '<button class="btn secondary" id="ocrBtn">🔍 Erkennen</button>' : ''}
      </div>` : ''}
      <div class="two-col">
        <div class="section">
          <h2>Zutaten</h2>
          <div class="portion">Portionen
            <span class="stepper"><button id="minus" aria-label="weniger">−</button><span>${portions}</span><button id="plus" aria-label="mehr">+</button></span>
          </div>
          ${(r.ingredients || []).length ? `<ul class="ing">${r.ingredients.map((i) => { const f = fmtIngredient(i, factor); return `<li><span class="q">${esc(f.q)}</span><span>${esc(f.name)}</span></li>`; }).join('')}</ul>` : '<p class="hint">Keine Zutaten erfasst.</p>'}
          <button class="btn ${plan[id] ? 'secondary' : ''}" id="weekBtn" style="margin-top:12px">${plan[id] ? '✓ In dieser Woche (entfernen)' : 'Für diese Woche auswählen'}</button>
        </div>
        <div>
          <div class="section">
            <h2>Zubereitung</h2>
            ${stepsArr.length ? `<ol class="steps">${stepsArr.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : '<p class="hint">Keine Anleitung erfasst.</p>'}
          </div>
          ${(r.pages || []).length ? `<details class="section pages" ${!(r.ingredients || []).length && !stepsArr.length ? 'open' : ''}><summary>Original-Karteikarte (${r.pages.length} Seite${r.pages.length > 1 ? 'n' : ''})</summary>${r.pages.map((p) => `<img src="${p}" alt="Karteikarte" loading="lazy">`).join('')}</details>` : ''}
        </div>
      </div>
      <div class="btn-row">
        <button class="btn secondary" id="editBtn">✎ Bearbeiten</button>
        <button class="btn danger" id="delBtn">🗑 Löschen</button>
      </div>`;
    $('#editBtn').onclick = () => go('#edit/' + id);
    $('#delBtn').onclick = () => deleteRecipe(r);
    $('#minus').onclick = () => { if (portions > 1) { portions--; updPlan(); draw(); } };
    $('#plus').onclick = () => { portions++; updPlan(); draw(); };
    $('#weekBtn').onclick = () => {
      const p = getPlan();
      if (p[id]) delete p[id]; else p[id] = portions;
      setPlan(p); draw();
      toast(p[id] ? 'Zur Woche hinzugefügt' : 'Aus Woche entfernt');
    };
    const ok = $('#okBtn');
    if (ok) ok.onclick = async () => { r.needsReview = false; await DB.put(r); draw(); };
    const pasteBtn = $('#pasteBtn');
    if (pasteBtn) pasteBtn.onclick = () => { focusPaste = true; go('#edit/' + id); };
    const ocrBtn = $('#ocrBtn');
    if (ocrBtn) ocrBtn.onclick = async () => {
      OCR.lowConfidence = false;
      const b = busy('Texterkennung wird vorbereitet …');
      try {
        const text = await ocrPages(r.pages, (m) => b.set(m));
        applyGuess(r, text, r.title);
        await DB.put(r);
        setHeader(r.title, { back: true, action: { label: '✎', aria: 'Bearbeiten', onClick: () => go('#edit/' + id) } });
        toast((r.ingredients || []).length ? 'Text erkannt – bitte prüfen' : HANDWRITING_HINT, 6000);
      } catch (e) { toast('Fehler: ' + e.message, 4000); } finally { b.done(); }
      stepsArr = (r.steps || '').split(/\n+/).map((s) => s.replace(/^\s*\d+[.)]\s*/, '').trim()).filter(Boolean);
      draw();
    };
  };
  const updPlan = () => { const p = getPlan(); if (p[id]) { p[id] = portions; setPlan(p); } };
  draw();
}

async function viewEdit(view, id) {
  const isNew = id === 'new';
  const r = isNew
    ? { id: uid(), title: '', servings: 2, ingredients: [], steps: '', pages: [], thumb: '', created: Date.now() }
    : await DB.get(id);
  if (!r) return go('#recipes');
  setHeader(isNew ? 'Neues Rezept' : 'Bearbeiten', { back: true });
  const pagesHtml = () => (r.pages || []).map((p, i) => `<div style="position:relative"><img src="${p}" alt=""><button class="icon-btn" data-del="${i}" style="position:absolute;top:8px;right:8px;background:var(--card)" aria-label="Seite entfernen">✕</button></div>`).join('');
  view.innerHTML = `
    <div class="two-col">
      <div>
        <div class="section">
          <label class="field"><span>Name des Gerichts</span><input id="fTitle" value="${esc(r.title)}" placeholder="z. B. Spaghetti Bolognese"></label>
          <label class="field"><span>Portionen (für die die Mengen gelten)</span><input id="fServ" type="number" inputmode="numeric" min="1" value="${esc(r.servings || 2)}"></label>
          <label class="field"><span>Zutaten – eine pro Zeile</span>
            <textarea id="fIng" placeholder="500 g Spaghetti&#10;400 g Hackfleisch&#10;1 Zwiebel&#10;2 EL Tomatenmark&#10;Salz">${esc((r.ingredients || []).map(ingredientToLine).join('\n'))}</textarea>
            <div class="hint">Format: <b>Menge Einheit Zutat</b>, z. B. „200 g Mehl“, „1½ TL Salz“, „2 Zwiebeln“. Ohne Menge geht auch („Pfeffer“).</div>
          </label>
          <label class="field"><span>Zubereitung – ein Schritt pro Zeile</span>
            <textarea id="fSteps" style="min-height:200px">${esc(r.steps || '')}</textarea>
          </label>
        </div>
      </div>
      <div>
        <div class="section" id="pasteSection">
          <h2>📋 Text der Karte einfügen</h2>
          <p class="hint" style="margin-top:0">Für handgeschriebene Karten: Das Handy liest die Handschrift selbst – den Text hier einfügen, die App teilt ihn in Zutaten und Zubereitung auf.</p>
          <details class="hint" style="margin-bottom:10px"><summary><b>So geht’s</b></summary>
            <p><b>iPhone:</b> Ins Feld unten tippen und halten → <b>„Text scannen“</b> → Kamera auf die Karte halten → „Einsetzen“.<br>
            Oder: Foto in der <b>Fotos-App</b> öffnen → Live-Text-Symbol (unten rechts) → Text markieren → Kopieren → hier einfügen.</p>
            <p><b>Samsung:</b> Foto in der <b>Galerie</b> öffnen → „T“-Symbol (Text extrahieren) bzw. Google Lens → Text kopieren → hier einfügen.</p>
            <p>Die App erkennt Überschriften wie „Zutaten:“ und „Zubereitung:“, Zutaten mit Komma und Schritte mit Pfeil (→).</p>
          </details>
          <textarea class="list" id="fPaste" style="min-height:140px" placeholder="Zutaten: Lachsfilet, Erdäpfel, Magerquark&#10;Zubereitung: → Erdäpfel weich kochen …"></textarea>
          <button class="btn" id="pasteApply" style="margin-top:10px">In Felder übernehmen</button>
        </div>
        ${r.sourceText ? `<details class="section"><summary><b>Erkannter Text aus der PDF</b></summary><p class="hint">Zum Kopieren/Einfügen in die Felder.</p><textarea class="list" readonly style="min-height:200px">${esc(r.sourceText)}</textarea></details>` : ''}
        <div class="section pages">
          <h2>Karteikarte (PDF / Foto)</h2>
          <div id="pages">${pagesHtml()}</div>
          <button class="btn" id="ocrEdit" style="margin-bottom:10px" ${(r.pages || []).length ? '' : 'hidden'}>🔍 Text aus Karte erkennen</button>
          <button class="btn secondary" id="addPages">PDF / Foto anhängen</button>
        </div>
      </div>
    </div>
    <button class="btn" id="save">Speichern</button>
    ${isNew ? '' : '<div class="btn-row"><button class="btn danger" id="del">Rezept löschen</button></div>'}`;

  $('#pages').onclick = async (e) => {
    const b = e.target.closest('[data-del]');
    if (!b) return;
    r.pages.splice(+b.dataset.del, 1);
    r.thumb = r.pages[0] ? await makeThumb(r.pages[0]) : '';
    $('#pages').innerHTML = pagesHtml();
    $('#ocrEdit').hidden = !r.pages.length;
  };
  $('#pasteApply').onclick = () => {
    const text = $('#fPaste').value.trim();
    if (!text) { toast('Bitte zuerst Text einfügen'); $('#fPaste').focus(); return; }
    const filled = $('#fIng').value.trim() || $('#fSteps').value.trim();
    if (filled && !confirm('Zutaten und Zubereitung durch den eingefügten Text ersetzen?')) return;
    const g = guessFromText(text, $('#fTitle').value);
    if (g.title && (!$('#fTitle').value.trim() || GENERIC_NAME.test($('#fTitle').value))) $('#fTitle').value = g.title;
    if (g.servings) $('#fServ').value = g.servings;
    const all = parseIngredients(g.ingredients);
    $('#fIng').value = all.filter((i) => !isInstructionText(i.name)).map(ingredientToLine).join('\n');
    $('#fSteps').value = [g.steps, ...all.filter((i) => isInstructionText(i.name)).map(ingredientToLine)].filter(Boolean).join('\n');
    r.sourceText = text;
    $('#fTitle').scrollIntoView({ behavior: 'smooth', block: 'center' });
    toast('Übernommen – bitte prüfen und speichern', 3000);
  };
  if (focusPaste) { focusPaste = false; setTimeout(() => $('#pasteSection').scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); }
  $('#ocrEdit').onclick = async () => {
    if (!r.pages.length) return;
    const filled = $('#fIng').value.trim() || $('#fSteps').value.trim();
    if (filled && !confirm('Zutaten und Zubereitung durch den erkannten Text ersetzen?')) return;
    const b = busy('Texterkennung wird vorbereitet …');
    try {
      const text = await ocrPages(r.pages, (m) => b.set(m));
      if (!text.trim()) { toast(HANDWRITING_HINT, 6000); return; }
      const g = guessFromText(text, $('#fTitle').value);
      if (g.title && (!$('#fTitle').value.trim() || GENERIC_NAME.test($('#fTitle').value))) $('#fTitle').value = g.title;
      if (g.servings) $('#fServ').value = g.servings;
      $('#fIng').value = parseIngredients(g.ingredients).map(ingredientToLine).join('\n');
      $('#fSteps').value = g.steps;
      r.sourceText = text;
      toast('Text erkannt – bitte prüfen und speichern', 3000);
    } catch (e) { toast('Fehler: ' + e.message, 4000); } finally { b.done(); }
  };
  $('#addPages').onclick = () => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'application/pdf,image/*'; inp.multiple = true;
    inp.onchange = async () => {
      const b = busy('Lese Datei …');
      try {
        for (const f of inp.files) {
          const isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
          const res = isPdf ? await readPdf(f, (m) => b.set(m)) : await readImage(f, (m) => b.set(m));
          r.pages = [...(r.pages || []), ...res.pages];
          if (res.text) r.sourceText = [r.sourceText, res.text].filter(Boolean).join('\n');
        }
        // Leere Felder mit dem erkannten Text vorbelegen
        if (r.sourceText && !$('#fIng').value.trim() && !$('#fSteps').value.trim()) {
          const g = guessFromText(r.sourceText, $('#fTitle').value);
          if (g.title && !$('#fTitle').value.trim()) $('#fTitle').value = g.title;
          if (g.servings) $('#fServ').value = g.servings;
          $('#fIng').value = parseIngredients(g.ingredients).map(ingredientToLine).join('\n');
          $('#fSteps').value = g.steps;
        }
        if (!r.thumb && r.pages[0]) r.thumb = await makeThumb(r.pages[0]);
        $('#pages').innerHTML = pagesHtml();
        $('#ocrEdit').hidden = !r.pages.length;
      } catch (e) { toast('Fehler: ' + e.message, 4000); } finally { b.done(); }
    };
    inp.click();
  };
  $('#save').onclick = async () => {
    r.title = $('#fTitle').value.trim() || 'Ohne Namen';
    r.servings = Math.max(1, parseInt($('#fServ').value, 10) || 1);
    r.ingredients = parseIngredients($('#fIng').value);
    r.steps = $('#fSteps').value.trim();
    r.needsReview = false;
    await DB.put(r);
    toast('Gespeichert');
    history.replaceState(null, '', '#recipe/' + r.id);
    render();
  };
  const del = $('#del');
  if (del) del.onclick = () => deleteRecipe(r);
}

async function viewWeek(view) {
  setHeader('Gerichte der Woche');
  const recipes = await loadRecipes();
  if (!recipes.length) {
    view.innerHTML = `<div class="empty"><div class="big">🗓️</div><p>Lege zuerst Rezepte an.</p></div>`;
    return;
  }
  const plan = getPlan();
  const draw = () => {
    const count = Object.keys(plan).length;
    view.innerHTML = `
      <div class="section">
        <p class="hint" style="margin-top:0">Gerichte anhaken und Portionen wählen. Dann bestätigen – die Einkaufsliste wird automatisch erstellt.</p>
        ${recipes.map((r) => `
          <div class="week-item" data-id="${esc(r.id)}">
            <input type="checkbox" ${plan[r.id] ? 'checked' : ''} aria-label="${esc(r.title)} auswählen">
            <span class="name">${esc(r.title)}</span>
            <span class="stepper" ${plan[r.id] ? '' : 'style="opacity:.35"'}><button data-d="-1" aria-label="weniger">−</button><span>${plan[r.id] || r.servings || 2}</span><button data-d="1" aria-label="mehr">+</button></span>
          </div>`).join('')}
      </div>
      <button class="btn" id="confirm" ${count ? '' : 'disabled style="opacity:.5"'}>✓ Bestätigen &amp; Einkaufsliste erstellen (${count})</button>
      <div class="btn-row"><button class="btn secondary" id="clear">Auswahl leeren</button></div>`;
  };
  draw();
  view.onclick = (e) => {
    if (location.hash !== '#week') return;
    const row = e.target.closest('.week-item');
    if (row) {
      const r = recipes.find((x) => x.id === row.dataset.id);
      const d = e.target.closest('[data-d]');
      if (d) {
        const cur = plan[r.id] || r.servings || 2;
        plan[r.id] = Math.max(1, cur + +d.dataset.d);
      } else if (e.target.closest('.stepper')) {
        return;
      } else {
        if (plan[r.id]) delete plan[r.id]; else plan[r.id] = r.servings || 2;
      }
      setPlan(plan); draw();
      return;
    }
    if (e.target.id === 'clear') { for (const k of Object.keys(plan)) delete plan[k]; setPlan(plan); draw(); }
    if (e.target.id === 'confirm') {
      const entries = recipes.filter((r) => plan[r.id]).map((r) => ({ recipe: r, portions: plan[r.id] }));
      if (!entries.length) return;
      const list = buildShoppingList(entries);
      ls.set('shoppingList', { date: new Date().toLocaleDateString('de-DE'), ...list });
      go('#list');
    }
  };
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* Fallback */ }
  const ta = document.createElement('textarea');
  ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
  let ok = false; try { ok = document.execCommand('copy'); } catch { /* ignore */ }
  ta.remove(); return ok;
}

function getList() {
  const l = ls.get('shoppingList', null);
  if (!l) return null;
  if (typeof l === 'string' || !Array.isArray(l.buy)) return null; // Liste aus alter Version: bitte neu erstellen
  return l;
}
function listToText(l) {
  const items = [...l.buy, ...l.pantry].filter((it) => it.on).sort((a, b) => a.name.localeCompare(b.name, 'de'));
  return `Einkaufsliste${l.date ? ` (${l.date})` : ''}\n\n` + items.map((it) => '- ' + itemLabel(it)).join('\n');
}

function viewList(view) {
  setHeader('Einkaufsliste');
  const l = getList();
  if (!l) {
    view.innerHTML = `<div class="empty"><div class="big">🛒</div><p>Noch keine Einkaufsliste.<br>Wähle unter „Woche“ deine Gerichte aus und bestätige.</p></div><button class="btn" id="toWeek">Zur Wochenauswahl</button>`;
    $('#toWeek').onclick = () => go('#week');
    return;
  }
  const save = () => ls.set('shoppingList', l);
  const draw = () => {
    const count = [...l.buy, ...l.pantry].filter((it) => it.on).length;
    view.innerHTML = `
      <div class="btn-row" style="margin:0 0 14px">
        <button class="btn" id="copy">📋 Kopieren (${count})</button>
        ${navigator.share ? '<button class="btn secondary" id="share">📤 Senden</button>' : ''}
      </div>
      <div class="section">
        <h2>Einkaufen</h2>
        <p class="hint" style="margin-top:0">Antippen zum Abhaken (wird nicht mitkopiert). 🏠 = haben wir immer → in den Vorrat. ✕ = Eintrag löschen.</p>
        <div id="buy">${l.buy.map((it, i) => `
          <div class="week-item${it.on ? '' : ' off'}" data-i="${i}">
            <input type="checkbox" ${it.on ? 'checked' : ''} aria-label="${esc(it.name)} mitnehmen">
            <span class="name">${esc(itemLabel(it))}</span>
            <button class="icon-btn" data-home="${i}" aria-label="${esc(it.name)} in den Vorrat" style="font-size:18px">🏠</button>
            <button class="icon-btn" data-rm="${i}" aria-label="${esc(it.name)} löschen" style="font-size:18px;color:var(--danger);background:transparent;border:1px solid var(--line)">✕</button>
          </div>`).join('') || '<p class="hint">Alles im Vorrat.</p>'}</div>
        <form id="addForm" class="add-row">
          <input id="addInput" placeholder="Weitere Zutat hinzufügen …" autocomplete="off" enterkeyhint="done">
          <button class="icon-btn" type="submit" aria-label="Hinzufügen">+</button>
        </form>
      </div>
      ${l.pantry.length ? `
      <div class="section">
        <h2>Vorrat prüfen</h2>
        <p class="hint" style="margin-top:0">Wird für die Rezepte gebraucht, ist aber normalerweise da. Antippen, wenn es leer ist – dann kommt es mit auf die Liste.</p>
        <div class="chips" id="pantry">${l.pantry.map((it, i) => `<button class="chip${it.on ? ' on' : ''}" data-p="${i}" aria-pressed="${it.on}">${it.on ? '✓ ' : ''}${esc(itemLabel(it))}</button>`).join('')}</div>
      </div>` : ''}
      <button class="btn secondary" id="cleanList">🧹 Abgehakte entfernen</button>
      <div class="btn-row"><button class="btn danger" id="clearList">🗑 Ganze Liste löschen</button></div>`;

    $('#buy').onclick = (e) => {
      const rm = e.target.closest('[data-rm]');
      if (rm) {
        const it = l.buy.splice(+rm.dataset.rm, 1)[0];
        save(); draw();
        toast(`„${it.name}“ gelöscht`);
        return;
      }
      const home = e.target.closest('[data-home]');
      if (home) {
        const it = l.buy.splice(+home.dataset.home, 1)[0];
        setPantry([...getPantry(), it.name]);
        l.pantry.push({ ...it, on: false });
        l.pantry.sort((a, b) => a.name.localeCompare(b.name, 'de'));
        save(); draw();
        toast(`„${it.name}“ ist jetzt im Vorrat`);
        return;
      }
      const row = e.target.closest('[data-i]');
      if (!row) return;
      const it = l.buy[+row.dataset.i];
      it.on = !it.on; save(); draw();
    };
    const pan = $('#pantry');
    if (pan) pan.onclick = (e) => {
      const c = e.target.closest('[data-p]');
      if (!c) return;
      const it = l.pantry[+c.dataset.p];
      it.on = !it.on; save(); draw();
    };
    $('#addForm').onsubmit = (e) => {
      e.preventDefault();
      const name = $('#addInput').value.trim();
      if (!name) return;
      l.buy.push({ name, count: 1, on: true });
      save(); draw();
      $('#addInput').focus();
    };
    $('#copy').onclick = async () => toast((await copyText(listToText(l))) ? 'Kopiert – jetzt in WhatsApp, SMS o. Ä. einfügen' : 'Kopieren nicht möglich');
    const sh = $('#share');
    if (sh) sh.onclick = () => navigator.share({ title: 'Einkaufsliste', text: listToText(l) }).catch(() => {});
    $('#cleanList').onclick = () => {
      const before = l.buy.length;
      l.buy = l.buy.filter((it) => it.on);
      const n = before - l.buy.length;
      save(); draw();
      toast(n ? `${n} abgehakte${n === 1 ? 'r Eintrag' : ' Einträge'} entfernt` : 'Nichts abgehakt');
    };
    $('#clearList').onclick = () => {
      if (!confirm('Die ganze Einkaufsliste löschen?\n(Die Wochenauswahl wird ebenfalls zurückgesetzt.)')) return;
      ls.set('shoppingList', null);
      setPlan({});
      toast('Einkaufsliste gelöscht');
      render();
    };
  };
  draw();
}

// Eintrag auf die Einkaufsliste setzen (legt bei Bedarf eine neue Liste an)
function addToShoppingList(name) {
  const l = getList() || { date: new Date().toLocaleDateString('de-DE'), buy: [], pantry: [] };
  const k = itemKey(name);
  const inPantry = l.pantry.find((it) => itemKey(it.name) === k);
  const inBuy = l.buy.find((it) => itemKey(it.name) === k);
  if (inPantry) inPantry.on = true;
  else if (inBuy) inBuy.on = true;
  else l.buy.push({ name, count: 1, on: true });
  ls.set('shoppingList', l);
}
function isOnShoppingList(name) {
  const l = getList();
  if (!l) return false;
  const k = itemKey(name);
  return [...l.buy, ...l.pantry].some((it) => it.on && itemKey(it.name) === k);
}

function viewPantry(view) {
  setHeader('Vorrat');
  const draw = () => {
    const pantry = getPantry();
    view.innerHTML = `
      <div class="section">
        <h2>Vorrat hinzufügen</h2>
        <p class="hint" style="margin-top:0">Was ihr meistens zu Hause habt. Mehrere auf einmal mit Komma trennen, z. B. „Thymian, Reis, Nudeln“.</p>
        <form id="pantryForm" class="add-row" style="margin-top:0">
          <input id="pantryInput" placeholder="z. B. Thymian" autocomplete="off" enterkeyhint="done">
          <button class="icon-btn" type="submit" aria-label="Hinzufügen">+</button>
        </form>
      </div>
      <div class="section">
        <h2>Unser Vorrat (${pantry.length})</h2>
        <p class="hint" style="margin-top:0">🛒 = ist leer → kommt auf die Einkaufsliste. ✕ = aus dem Vorrat entfernen.</p>
        <input class="search" id="pantrySearch" type="search" placeholder="Im Vorrat suchen …" style="margin-bottom:6px">
        <div id="pantryList">${pantry.map((n) => {
          const on = isOnShoppingList(n);
          return `
          <div class="week-item" data-n="${esc(n)}">
            <span class="name">${esc(n)}</span>
            <button class="icon-btn" data-buy="1" aria-label="${esc(n)} ist leer" style="font-size:18px${on ? ';background:var(--accent);color:#fff' : ''}">${on ? '✓' : '🛒'}</button>
            <button class="icon-btn" data-rm="1" aria-label="${esc(n)} entfernen" style="font-size:18px;color:var(--danger);background:transparent;border:1px solid var(--line)">✕</button>
          </div>`;
        }).join('') || '<p class="hint">Noch nichts im Vorrat.</p>'}</div>
      </div>
      <button class="btn secondary" id="pantryReset">Standard-Vorrat wiederherstellen</button>`;

    $('#pantryForm').onsubmit = (e) => {
      e.preventDefault();
      const v = $('#pantryInput').value.trim();
      if (!v) return;
      const added = v.split(/,\s*/).map((x) => x.trim()).filter(Boolean);
      setPantry([...getPantry(), ...added]);
      toast(added.length === 1 ? `„${added[0]}“ hinzugefügt` : `${added.length} Einträge hinzugefügt`);
      draw();
      $('#pantryInput').focus();
    };
    $('#pantrySearch').oninput = (e) => {
      const q = e.target.value.toLowerCase();
      view.querySelectorAll('#pantryList .week-item').forEach((row) => { row.hidden = !row.dataset.n.toLowerCase().includes(q); });
    };
    $('#pantryList').onclick = (e) => {
      const row = e.target.closest('[data-n]');
      if (!row) return;
      const n = row.dataset.n;
      if (e.target.closest('[data-rm]')) {
        if (!confirm(`„${n}“ aus dem Vorrat entfernen?`)) return;
        setPantry(getPantry().filter((x) => x !== n));
        toast(`„${n}“ entfernt`);
        draw();
      } else if (e.target.closest('[data-buy]')) {
        if (isOnShoppingList(n)) { toast(`„${n}“ steht schon auf der Einkaufsliste`); return; }
        addToShoppingList(n);
        toast(`„${n}“ steht jetzt auf der Einkaufsliste`);
        draw();
      }
    };
    $('#pantryReset').onclick = () => {
      if (!confirm('Vorrat auf die Standardliste zurücksetzen? Eigene Einträge gehen dabei verloren.')) return;
      setPantry(DEFAULT_PANTRY); draw();
    };
  };
  draw();
}

function viewSettings(view) {
  setHeader('Daten & Sicherung');
  view.innerHTML = `
    <div class="section">
      <h2>Datensicherung</h2>
      <p class="hint">Alle Rezepte sind nur auf diesem Gerät gespeichert. Erstelle ab und zu eine Sicherung – damit kannst du die Rezepte auch auf das andere Handy übertragen (Datei per AirDrop, Mail, Cloud o. Ä. schicken und dort importieren).</p>
      <button class="btn" id="exp">Sicherung exportieren</button>
      <div class="btn-row"><button class="btn secondary" id="imp">Sicherung importieren</button></div>
    </div>
    <div class="section">
      <h2>Rezepte löschen</h2>
      <div id="delList"><p class="hint">…</p></div>
    </div>
    <div class="section">
      <h2>Speicher</h2>
      <p class="hint" id="storeInfo">…</p>
    </div>`;
  (async () => {
    const all = await DB.all();
    let s = `App-Version ${APP_VERSION}. ${all.length} Rezepte gespeichert.`;
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      s += ` Belegt: ca. ${(est.usage / 1048576).toFixed(1)} MB.`;
      if (navigator.storage.persisted) s += (await navigator.storage.persisted()) ? ' Dauerhafter Speicher aktiv.' : '';
    }
    $('#storeInfo').textContent = s;
  })();
  $('#exp').onclick = async () => {
    const all = await DB.all();
    const json = JSON.stringify({ app: 'rezeptkartei', version: 1, exported: new Date().toISOString(), recipes: all });
    const name = `rezepte-sicherung-${new Date().toISOString().slice(0, 10)}.json`;
    const file = new File([json], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Rezepte-Sicherung' }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  $('#imp').onclick = () => $('#backupInput').click();
  const drawDel = async () => {
    const all = await loadRecipes();
    $('#delList').innerHTML = all.length
      ? all.map((r) => `<div class="week-item"><span class="name">${esc(r.title)}</span><button class="icon-btn" data-del="${esc(r.id)}" aria-label="${esc(r.title)} löschen" style="color:var(--danger);font-size:18px">🗑</button></div>`).join('')
      : '<p class="hint">Keine Rezepte vorhanden.</p>';
  };
  drawDel();
  $('#delList').onclick = async (e) => {
    const b = e.target.closest('[data-del]');
    if (!b) return;
    const r = recipesCache.find((x) => x.id === b.dataset.del);
    if (!r || !confirm(`„${r.title}“ wirklich löschen?`)) return;
    await DB.del(r.id);
    const p = getPlan(); delete p[r.id]; setPlan(p);
    toast('Rezept gelöscht');
    drawDel();
  };
}

/* ---------- Start ---------- */
async function init() {
  await DB.open();
  $('#backBtn').onclick = () => (history.length > 1 ? history.back() : go('#recipes'));
  document.querySelectorAll('.tabbar button').forEach((b) => (b.onclick = () => go('#' + b.dataset.tab)));
  $('#pdfInput').onchange = async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    const created = await importFiles(files);
    if (created.length === 1) go('#recipe/' + created[0].id);
    else { toast(`${created.length} Rezepte importiert – bitte prüfen`, 3000); go('#recipes'); }
  };
  $('#backupInput').onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!Array.isArray(data.recipes)) throw new Error('Keine gültige Sicherung');
      for (const r of data.recipes) if (r && r.id && r.title) await DB.put(r);
      toast(`${data.recipes.length} Rezepte importiert`);
      go('#recipes');
    } catch (err) { toast('Import fehlgeschlagen: ' + err.message, 4000); }
  };
  window.addEventListener('hashchange', render);
  render();
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    // Updates automatisch holen: beim Start und wenn die App wieder in den Vordergrund kommt
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloaded) return;
      reloaded = true;
      location.reload();
    });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
      reg.update().catch(() => {});
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    }).catch(() => {});
  }
}
init();

// Für Tests
window.__rk = { parseIngredient, buildShoppingList, guessFromText, OCR };
