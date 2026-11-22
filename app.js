/* Rezeptkartei – läuft komplett lokal im Browser (IndexedDB), keine Server-Anbindung. */
'use strict';

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

// Einheiten zum Zusammenzählen auf Basiseinheit bringen
const BASE = { kg: ['g', 1000], mg: ['g', 0.001], l: ['ml', 1000], dl: ['ml', 100], cl: ['ml', 10] };
function buildShoppingList(entries) {
  // entries: [{recipe, portions}]
  const map = new Map();
  for (const { recipe, portions } of entries) {
    const factor = recipe.servings > 0 ? portions / recipe.servings : 1;
    for (const ing of recipe.ingredients || []) {
      let unit = ing.unit || '';
      let qty = ing.qty;
      if (qty != null && BASE[unit]) { qty *= BASE[unit][1]; unit = BASE[unit][0]; }
      // Singular/Plural zusammenführen (Zwiebel/Zwiebeln, Tomate/Tomaten)
      const nameKey = ing.name.toLowerCase().replace(/\s+/g, ' ').trim().replace(/(en|n|e|s)$/, '');
      const key = nameKey + '|' + unit;
      const cur = map.get(key) || { name: ing.name.trim(), unit, qty: null, noQty: false };
      if (ing.name.trim().length > cur.name.length) cur.name = ing.name.trim();
      if (qty != null) cur.qty = (cur.qty || 0) + qty * factor;
      else cur.noQty = true;
      map.set(key, cur);
    }
  }
  const items = [...map.values()].map((it) => {
    let { qty, unit } = it;
    if (qty != null && unit === 'g' && qty >= 1000) { qty /= 1000; unit = 'kg'; }
    if (qty != null && unit === 'ml' && qty >= 1000) { qty /= 1000; unit = 'l'; }
    if (qty != null && ['Stk.', 'Dose', 'Pck.', 'Bund', 'Zehe', 'Becher', 'Glas', 'Kopf', 'Knolle', 'Flasche', 'Beutel', 'Stange', ''].includes(unit)) {
      qty = Math.ceil(qty * 4 - 1e-9) / 4; // Stückzahlen auf Viertel aufrunden
    }
    const PLURAL = { Zehe: 'Zehen', Dose: 'Dosen', Scheibe: 'Scheiben', Tasse: 'Tassen', Stange: 'Stangen', Knolle: 'Knollen', Flasche: 'Flaschen', Zweig: 'Zweige', Prise: 'Prisen', Kopf: 'Köpfe' };
    if (qty != null && qty > 1 && PLURAL[unit]) unit = PLURAL[unit];
    const q = qty != null ? [fmtNum(qty), unit].filter(Boolean).join(' ') : unit;
    return { text: [q, it.name].filter(Boolean).join(' '), sort: it.name.toLowerCase() };
  });
  items.sort((a, b) => a.sort.localeCompare(b.sort, 'de'));
  return items.map((i) => i.text);
}

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

async function readPdf(file) {
  if (!window.pdfjsLib) throw new Error('PDF-Bibliothek nicht geladen');
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const pages = [];
  const lines = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const base = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: Math.min(3, 1300 / base.width) });
    const c = document.createElement('canvas');
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    pages.push(canvasToJpeg(c));
    // Text zeilenweise extrahieren (falls die PDF eine Textebene hat)
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
    for (const r of rows) lines.push(r.parts.sort((a, b) => a.x - b.x).map((p) => p.s).join(' ').replace(/\s+/g, ' ').trim());
  }
  return { pages, text: lines.filter(Boolean).join('\n') };
}

async function readImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    return { pages: [canvasToJpeg(scaledCanvas(img, img.naturalWidth, img.naturalHeight, 1300))], text: '' };
  } finally { URL.revokeObjectURL(url); }
}

async function makeThumb(dataUrl) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataUrl; });
  const size = 160;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const s = Math.max(size / img.width, size / img.height);
  const w = img.width * s, h = img.height * s;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h); // oben links ausrichten (Titel der Karte sichtbar)
  return canvasToJpeg(c, 0.7);
}

// Grobe Erkennung von Titel / Portionen / Zutaten / Zubereitung aus dem PDF-Text
function guessFromText(text, fallbackTitle) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const out = { title: fallbackTitle, servings: 0, ingredients: '', steps: '' };
  if (!lines.length) return out;
  const sv = text.match(/(?:für\s*)?(\d+)\s*(?:Personen|Portionen|Pers\.|Port\.)/i);
  if (sv) out.servings = +sv[1];
  const iZ = lines.findIndex((l) => /^zutaten\b/i.test(l));
  const iA = lines.findIndex((l, i) => i > iZ && /^(zubereitung|anleitung|so geht'?s|schritte|arbeitsschritte|und so wird'?s gemacht)\b/i.test(l));
  const head = lines.slice(0, iZ >= 0 ? iZ : 1);
  const t = head.find((l) => l.length > 2 && !/personen|portionen|minuten|min\.|kcal/i.test(l));
  if (t) out.title = t;
  if (iZ >= 0) {
    const firstIng = lines[iZ].replace(/^zutaten\b[^:]*:?\s*/i, '');
    const ing = [firstIng, ...lines.slice(iZ + 1, iA > 0 ? iA : undefined)].filter(Boolean)
      .filter((l) => !/^(für\s*)?\d+\s*(personen|portionen)/i.test(l));
    out.ingredients = ing.join('\n');
    if (iA > 0) {
      const firstStep = lines[iA].replace(/^\S+[^:]*:?\s*/, '');
      out.steps = [firstStep, ...lines.slice(iA + 1)].filter(Boolean).join('\n');
    }
  } else {
    out.steps = lines.slice(1).join('\n');
  }
  return out;
}

async function importFiles(files) {
  const b = busy('Importiere …');
  const created = [];
  try {
    let n = 0;
    for (const f of files) {
      n++;
      b.set(`Importiere ${n}/${files.length}: ${f.name}`);
      const isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
      const { pages, text } = isPdf ? await readPdf(f) : await readImage(f);
      const g = guessFromText(text, f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '));
      const rec = {
        id: uid(),
        title: g.title,
        servings: g.servings || 2,
        ingredients: parseIngredients(g.ingredients),
        steps: g.steps,
        pages,
        thumb: pages[0] ? await makeThumb(pages[0]) : '',
        sourceText: text,
        needsReview: true,
        created: Date.now(),
      };
      await DB.put(rec);
      created.push(rec);
    }
  } catch (e) {
    console.error(e);
    toast('Fehler beim Import: ' + e.message, 4000);
  } finally { b.done(); }
  return created;
}

/* ---------- Wochenplan & Einkaufsliste ---------- */
const getPlan = () => ls.get('plan', {});
const setPlan = (p) => ls.set('plan', p);

/* ---------- Routing / Ansichten ---------- */
let recipesCache = [];
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

async function viewRecipe(view, id) {
  const r = await DB.get(id);
  if (!r) return go('#recipes');
  setHeader(r.title, { back: true, action: { label: '✎', aria: 'Bearbeiten', onClick: () => go('#edit/' + id) } });
  let portions = getPlan()[id] || r.servings || 2;
  const stepsArr = (r.steps || '').split(/\n+/).map((s) => s.replace(/^\s*\d+[.)]\s*/, '').trim()).filter(Boolean);
  const draw = () => {
    const plan = getPlan();
    const factor = r.servings > 0 ? portions / r.servings : 1;
    view.innerHTML = `
      ${r.needsReview ? `<div class="section" style="border-color:#e8b77a">⚠️ Automatisch importiert – bitte über <b>✎</b> prüfen. <button class="btn secondary" id="okBtn" style="margin-top:10px">Ist korrekt</button></div>` : ''}
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
      </div>`;
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
        ${r.sourceText ? `<details class="section"><summary><b>Erkannter Text aus der PDF</b></summary><p class="hint">Zum Kopieren/Einfügen in die Felder.</p><textarea class="list" readonly style="min-height:200px">${esc(r.sourceText)}</textarea></details>` : ''}
        <div class="section pages">
          <h2>Karteikarte (PDF / Foto)</h2>
          <div id="pages">${pagesHtml()}</div>
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
  };
  $('#addPages').onclick = () => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'application/pdf,image/*'; inp.multiple = true;
    inp.onchange = async () => {
      const b = busy('Lese Datei …');
      try {
        for (const f of inp.files) {
          const isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
          const res = isPdf ? await readPdf(f) : await readImage(f);
          r.pages = [...(r.pages || []), ...res.pages];
          if (res.text) r.sourceText = [r.sourceText, res.text].filter(Boolean).join('\n');
        }
        if (!r.thumb && r.pages[0]) r.thumb = await makeThumb(r.pages[0]);
        $('#pages').innerHTML = pagesHtml();
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
  if (del) del.onclick = async () => {
    if (!confirm(`„${r.title}“ wirklich löschen?`)) return;
    await DB.del(r.id);
    const p = getPlan(); delete p[r.id]; setPlan(p);
    toast('Gelöscht');
    history.replaceState(null, '', '#recipes');
    render();
  };
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
      const items = buildShoppingList(entries);
      const d = new Date();
      const text = `Einkaufsliste (${d.toLocaleDateString('de-DE')})\n\n` +
        items.map((i) => '- ' + i).join('\n') +
        `\n\nGerichte:\n` + entries.map((e) => `• ${e.recipe.title} (${e.portions} Port.)`).join('\n');
      ls.set('shoppingList', text);
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

function viewList(view) {
  setHeader('Einkaufsliste');
  const text = ls.get('shoppingList', '');
  if (!text) {
    view.innerHTML = `<div class="empty"><div class="big">🛒</div><p>Noch keine Einkaufsliste.<br>Wähle unter „Woche“ deine Gerichte aus und bestätige.</p></div><button class="btn" id="toWeek">Zur Wochenauswahl</button>`;
    $('#toWeek').onclick = () => go('#week');
    return;
  }
  view.innerHTML = `
    <div class="section">
      <p class="hint" style="margin-top:0">Du kannst die Liste hier noch bearbeiten (z. B. Dinge löschen, die du schon hast).</p>
      <div class="btn-row" style="margin:0 0 12px">
        <button class="btn" id="copy">📋 Kopieren</button>
        ${navigator.share ? '<button class="btn secondary" id="share">📤 Senden</button>' : ''}
      </div>
      <textarea class="list" id="listText">${esc(text)}</textarea>
    </div>`;
  const ta = $('#listText');
  ta.style.height = Math.max(300, ta.scrollHeight + 4) + 'px';
  ta.oninput = () => ls.set('shoppingList', ta.value);
  $('#copy').onclick = async () => toast((await copyText(ta.value)) ? 'Kopiert – jetzt in WhatsApp, SMS o. Ä. einfügen' : 'Kopieren nicht möglich – Text markieren und manuell kopieren');
  const sh = $('#share');
  if (sh) sh.onclick = () => navigator.share({ title: 'Einkaufsliste', text: ta.value }).catch(() => {});
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
      <h2>Speicher</h2>
      <p class="hint" id="storeInfo">…</p>
    </div>`;
  (async () => {
    const all = await DB.all();
    let s = `${all.length} Rezepte gespeichert.`;
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
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
init();

// Für Tests
window.__rk = { parseIngredient, buildShoppingList, guessFromText };
