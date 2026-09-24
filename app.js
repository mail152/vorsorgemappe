/* Vorsorgemappe — Etappe 2: ausfüllen, speichern, Fortschritt.
   Gespeichert werden nicht die Antworten, sondern die Änderungen als fortlaufende Liste.
   Der Zustand entsteht durch Zusammenfalten; bei zwei Änderungen am selben Feld gewinnt
   die jüngere. Deshalb schreibt jeder nur in seine eigene Datei. */
'use strict';

const S = {
  speicher: null, struktur: null,
  person: null,        // Kennung, unter der geschrieben wird
  verfuegung: null,    // 'a' oder 'b' — welcher der beiden Datenstände
  zustand: new Map(),  // schluessel -> {wert, zeit, von}
  kapitel: 0,
  schluessel: null,    // abgeleiteter Schlüssel für die geschützte Schicht
  warteschlange: [],
  merker: null,
};

const $ = (h) => { const d = document.createElement('div'); d.innerHTML = h.trim(); return d.firstElementChild; };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const wurzel = () => document.getElementById('wurzel');

/* ───────────────────────── Zustand ───────────────────────── */

const istGemeinsam = (f) => f.zugehoerigkeit === 'gemeinsam';
const schluesselVon = (f) => (istGemeinsam(f) ? 'gemeinsam' : S.verfuegung) + ':' + f.id;

function alleFelder() { return S.struktur.kapitel.flatMap((k) => k.felder); }
function feldMit(id) { return alleFelder().find((f) => f.id === id); }

function wert(f) {
  const e = S.zustand.get(schluesselVon(f));
  return e ? e.wert : null;
}

function sichtbar(f) {
  if (!f.wenn) return true;
  const q = feldMit(f.wenn.feld);
  return q ? wert(q) === f.wenn.ist : true;
}

function beantwortet(f) {
  const e = S.zustand.get(schluesselVon(f));
  if (e && e.ver && e.wert == null) return true;     // verschlüsselt, aber vorhanden
  const v = wert(f);
  if (v == null) return false;
  if (Array.isArray(v)) return v.filter((x) => String(x || '').trim()).length > 0;
  if (typeof v === 'object') return Object.values(v).some((x) => String(x || '').trim());
  return String(v).trim() !== '';
}

function fortschritt(k) {
  const eingaben = k.felder.filter((f) => f.typ !== 'hinweis' && sichtbar(f));
  const fertig = eingaben.filter(beantwortet).length;
  return { fertig, gesamt: eingaben.length, teil: eingaben.length ? fertig / eingaben.length : 1 };
}

/* Ereignisse zusammenfalten: jüngste Änderung je Feld gewinnt. */
function falten(zeilen) {
  for (const z of zeilen) {
    if (!z || !z.f) continue;
    const alt = S.zustand.get(z.f);
    if (!alt || z.t >= alt.zeit)
      S.zustand.set(z.f, { wert: z.e ? null : z.v, zeit: z.t, von: z.p, ver: z.e || null });
  }
}

async function ladeZustand() {
  S.zustand.clear();
  try {
    const gefunden = S.speicher.personen ? await S.speicher.personen() : [];
    S.andere = gefunden.filter((p) => p !== S.person);
  } catch (e) { S.andere = S.andere || []; }
  const dateien = [S.person, ...(S.andere || [])].filter(Boolean);
  for (const p of dateien) {
    const text = await S.speicher.lies(Speicher.DATEI.log(p));
    if (!text) continue;
    const zeilen = text.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (e) { return null; } });
    falten(zeilen.filter(Boolean));
  }
}

/* ───────────────────────── Schreiben ───────────────────────── */

async function setze(f, v) {
  const s = schluesselVon(f);
  const e = { t: new Date().toISOString(), p: S.person, f: s };
  if (f.schicht === 'geschuetzt') {
    if (!S.schluessel) return;                       // ohne Kennwort wird nichts geschrieben
    e.e = await verschluessle(JSON.stringify(v));    // nur der Geheimtext geht in die Datei
    S.zustand.set(s, { wert: v, zeit: e.t, von: S.person, ver: e.e });
  } else {
    e.v = v;
    S.zustand.set(s, { wert: v, zeit: e.t, von: S.person });
  }
  S.warteschlange.push(e);
  aktualisiereFortschritt();
  planeSchreiben();
}

/* Fortschritt nachziehen, ohne das Kapitel neu zu zeichnen — sonst springt beim
   Tippen die Schreibmarke aus dem Feld. */
function aktualisiereFortschritt() {
  const k = S.struktur.kapitel[S.kapitel];
  const p = fortschritt(k);
  const b = document.querySelector('.balken i');
  const t = document.querySelector('.balken-t');
  if (b) b.style.width = Math.round(p.teil * 100) + '%';
  if (t) t.textContent = `${p.fertig} von ${p.gesamt}`;
  document.querySelectorAll('#rail button').forEach((btn, i) => {
    const kap = S.struktur.kapitel[i];
    if (!kap) return;
    const q = fortschritt(kap);
    const ring = btn.querySelector('.ring');
    if (ring) ring.className = 'ring ' + (q.teil >= 1 ? 'voll' : (q.teil > 0 ? 'teil' : ''));
  });
  const ges = S.struktur.kapitel.reduce((a, kk) => {
    const q = fortschritt(kk); return { f: a.f + q.fertig, g: a.g + q.gesamt };
  }, { f: 0, g: 0 });
  const summe = document.getElementById('summe');
  if (summe) summe.textContent = `${ges.f} von ${ges.g} Fragen beantwortet`;
}

let schreibTimer = null;
function planeSchreiben() {
  zeigeStand('warte');
  clearTimeout(schreibTimer);
  schreibTimer = setTimeout(schreibeJetzt, 900);
}

async function schreibeJetzt() {
  if (!S.warteschlange.length) return;
  const raus = S.warteschlange.splice(0);
  try {
    await S.speicher.anhaengen(Speicher.DATEI.log(S.person), raus);
    zeigeStand('gut');
  } catch (err) {
    S.warteschlange.unshift(...raus);        // nichts verlieren
    zeigeStand('fehler', err.message);
  }
}

function zeigeStand(art, text) {
  const el = document.getElementById('stand');
  if (!el) return;
  const m = { warte: 'wird gespeichert …', gut: 'gespeichert', fehler: 'nicht gespeichert — ' + (text || '') };
  el.innerHTML = `<span class="pip ${art === 'gut' ? '' : 'warte'}"></span>${esc(m[art])}`;
}

window.addEventListener('beforeunload', (e) => {
  if (S.warteschlange.length) { schreibeJetzt(); e.preventDefault(); e.returnValue = ''; }
});

/* ───────────────────────── Geschützte Schicht ───────────────────────── */

async function schluesselAus(kennwort, salz) {
  const roh = await crypto.subtle.importKey('raw', new TextEncoder().encode(kennwort), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salz, iterations: 250000, hash: 'SHA-256' },
    roh, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
const zuB64 = (b) => btoa(String.fromCharCode(...new Uint8Array(b)));
const ausB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function verschluessle(text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, S.schluessel, new TextEncoder().encode(text));
  return { iv: zuB64(iv), ct: zuB64(ct) };
}
async function entschluessle(p) {
  const klar = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ausB64(p.iv) }, S.schluessel, ausB64(p.ct));
  return new TextDecoder().decode(klar);
}

async function kennwortOeffnen(kennwort) {
  const roh = await S.speicher.lies(Speicher.DATEI.kennwort);
  if (!roh) {                                   // erstes Mal: Salz anlegen
    const salz = crypto.getRandomValues(new Uint8Array(16));
    S.schluessel = await schluesselAus(kennwort, salz);
    const probe = await verschluessle('vorsorgemappe');
    await S.speicher.schreib(Speicher.DATEI.kennwort, JSON.stringify({ salz: zuB64(salz), probe }, null, 2));
    return true;
  }
  const d = JSON.parse(roh);
  S.schluessel = await schluesselAus(kennwort, ausB64(d.salz));
  try { return (await entschluessle(d.probe)) === 'vorsorgemappe'; }
  catch (e) { S.schluessel = null; return false; }
}

async function entsperreAlles() {
  if (!S.schluessel) return;
  for (const [k, e] of S.zustand) {
    if (!e.ver || e.wert != null) continue;
    try { e.wert = JSON.parse(await entschluessle(e.ver)); }
    catch (err) { e.wert = null; }                   // falsches Kennwort: bleibt zu
  }
}

/* ───────────────────────── Ansicht: Felder ───────────────────────── */

function wannText(iso) {
  const d = new Date(iso), jetzt = new Date(), s = (jetzt - d) / 1000;
  if (s < 90) return 'gerade eben';
  if (s < 3600) return 'vor ' + Math.round(s / 60) + ' Minuten';
  if (d.toDateString() === jetzt.toDateString())
    return 'heute ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const gestern = new Date(jetzt); gestern.setDate(gestern.getDate() - 1);
  if (d.toDateString() === gestern.toDateString())
    return 'gestern ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function marken(f) {
  const m = [];
  if (istGemeinsam(f)) m.push('<span class="marke-k m-gem">gemeinsam</span>');
  if (f.schicht === 'geschuetzt') m.push('<span class="marke-k m-ges">geschützt</span>');
  if (f.in_notfallmappe) m.push('<span class="marke-k m-map">Notfallmappe</span>');
  return m.join('');
}

const KONTAKT = [['name', 'Name'], ['adresse', 'Adresse'], ['telefon', 'Telefon'],
                 ['email', 'E-Mail'], ['notiz', 'Anmerkung']];

function baueFeld(f) {
  const el = $(`<section class="feld${f.typ === 'hinweis' ? ' ist-hinweis' : ''}">
      <div class="feld-kopf"><div class="frage">${esc(f.frage)}</div>
      <div class="marken">${marken(f)}</div></div></section>`);
  const v = wert(f);

  if (f.typ === 'hinweis') { /* nur Text */ }

  else if (f.schicht === 'geschuetzt' && !S.schluessel) {
    const k = $(`<div class="schloss"><p>Dieses Feld ist verschlüsselt.</p>
       <button class="knopf">Kennwort eingeben</button></div>`);
    k.querySelector('button').onclick = kennwortDialog;
    el.append(k);
  }

  else if (f.typ === 'auswahl' || f.typ === 'mehrfachauswahl') {
    const mehr = f.typ === 'mehrfachauswahl';
    const box = $('<div class="wahl"></div>');
    (f.optionen || []).forEach((o, i) => {
      const gewaehlt = mehr ? (Array.isArray(v) && v.includes(o)) : v === o;
      const l = $(`<label><input type="${mehr ? 'checkbox' : 'radio'}" name="${esc(f.id)}"
         ${gewaehlt ? 'checked' : ''}><span>${esc(o)}</span></label>`);
      l.querySelector('input').onchange = (ev) => {
        if (mehr) {
          const jetzt = new Set(Array.isArray(v) ? v : []);
          ev.target.checked ? jetzt.add(o) : jetzt.delete(o);
          setze(f, [...jetzt]);
        } else setze(f, o);
        zeichneKapitel();
      };
      box.append(l);
    });
    el.append(box);
  }

  else if (f.typ === 'liste') {
    const zeilen = Array.isArray(v) ? v.slice() : [''];
    const box = $('<div class="zeilen"></div>');
    const neu = () => {
      box.innerHTML = '';
      zeilen.forEach((z, i) => {
        const r = $(`<div class="zeile"><input type="text" value="${esc(z)}"><button title="Zeile entfernen">×</button></div>`);
        r.querySelector('input').oninput = (e) => { zeilen[i] = e.target.value; setze(f, zeilen); };
        r.querySelector('button').onclick = () => { zeilen.splice(i, 1); if (!zeilen.length) zeilen.push(''); setze(f, zeilen); neu(); zeichneRail(); };
        box.append(r);
      });
      const b = $('<button class="mehr">+ noch eine Zeile</button>');
      b.onclick = () => { zeilen.push(''); neu(); box.querySelectorAll('input')[zeilen.length - 1].focus(); };
      box.append(b);
    };
    neu(); el.append(box);
  }

  else if (f.typ === 'kontakt') {
    const d = (v && typeof v === 'object') ? { ...v } : {};
    const g = $('<div class="kontakt"></div>');
    KONTAKT.forEach(([k, t]) => {
      const l = $(`<label><span>${t}</span><input type="text" value="${esc(d[k] || '')}"></label>`);
      l.querySelector('input').oninput = (e) => { d[k] = e.target.value; setze(f, d); };
      g.append(l);
    });
    el.append(g);
  }

  else if (f.typ === 'mehrzeilig') {
    const t = $(`<textarea placeholder="Noch nichts eingetragen">${esc(v || '')}</textarea>`);
    t.oninput = (e) => setze(f, e.target.value);
    el.append(t);
  }

  else { // text, datum
    const i = $(`<input type="${f.typ === 'datum' ? 'date' : 'text'}"
       value="${esc(v || '')}" placeholder="Noch nichts eingetragen">`);
    i.oninput = (e) => setze(f, e.target.value);
    el.append(i);
  }

  if (f.hilfe) el.append($(`<div class="hilfe">${esc(f.hilfe)}</div>`));

  const e = S.zustand.get(schluesselVon(f));
  if (e && e.von && e.zeit && f.typ !== 'hinweis') {
    const fremd = e.von !== S.person;
    el.append($(`<div class="herkunft${fremd ? ' fremd' : ''}">${
      fremd ? 'von ' + esc(e.von) : 'von dir'} · ${esc(wannText(e.zeit))}</div>`));
  }
  return el;
}

/* ───────────────────────── Ansicht: Gerüst ───────────────────────── */

function zeichneRail() {
  const r = document.getElementById('rail');
  if (!r) return;
  r.innerHTML = '';
  let teil = null;
  const namen = { A: 'Wer und was zuerst', B: 'Die Bestattung', C: 'Papiere und Geld', D: 'Danach und daneben' };
  S.struktur.kapitel.forEach((k, i) => {
    if (k.teil !== teil) { teil = k.teil; r.append($(`<h2>${esc(namen[teil] || teil)}</h2>`)); }
    const p = fortschritt(k);
    const cls = p.teil >= 1 ? 'voll' : (p.teil > 0 ? 'teil' : '');
    const b = $(`<button ${i === S.kapitel ? 'aria-current="true"' : ''}>
        <span class="ring ${cls}"></span><span>${esc(k.titel)}</span></button>`);
    b.onclick = () => { S.kapitel = i; zeichneKapitel(); zeichneRail(); window.scrollTo(0, 0); };
    r.append(b);
  });
  const ges = S.struktur.kapitel.reduce((a, k) => {
    const p = fortschritt(k); return { f: a.f + p.fertig, g: a.g + p.gesamt };
  }, { f: 0, g: 0 });
  r.append($(`<h2>Insgesamt</h2>`));
  r.append($(`<div class="leise" id="summe" style="padding:0 .4rem">${ges.f} von ${ges.g} Fragen beantwortet</div>`));
}

function zeichneKapitel() {
  const k = S.struktur.kapitel[S.kapitel];
  const el = document.getElementById('blatt');
  if (!el) return;
  const p = fortschritt(k);
  el.innerHTML = '';
  // Nur behaupten, was stimmt: „ganz gemeinsam" gilt erst, wenn jedes Eingabefeld es ist.
  const eingaben = k.felder.filter((f) => f.typ !== 'hinweis');
  const anzahlGem = eingaben.filter(istGemeinsam).length;
  const zusatz = anzahlGem === 0 ? ''
    : anzahlGem === eingaben.length ? ' · ganzes Kapitel gemeinsam'
    : ` · ${anzahlGem} von ${eingaben.length} Fragen gemeinsam`;
  el.append($(`<div><div class="kap-nr">Kapitel ${S.kapitel + 1} von ${S.struktur.kapitel.length}${zusatz}</div>
    <h1 class="kap-titel">${esc(k.titel)}</h1>
    <p class="kap-ein">${esc(k.einleitung)}</p></div>`));
  el.append($(`<div class="kap-leiste"><div class="balken"><i style="width:${Math.round(p.teil * 100)}%"></i></div>
    <span class="balken-t">${p.fertig} von ${p.gesamt}</span></div>`));

  k.felder.filter(sichtbar).forEach((f) => el.append(baueFeld(f)));

  const fuss = $(`<div class="fuss"><span class="fuss-t"></span></div>`);
  const nav = $('<div class="reihe" style="margin:0"></div>');
  if (S.kapitel > 0) {
    const b = $('<button class="knopf">← Zurück</button>');
    b.onclick = () => { S.kapitel--; zeichneKapitel(); zeichneRail(); window.scrollTo(0, 0); };
    nav.append(b);
  }
  if (S.kapitel < S.struktur.kapitel.length - 1) {
    const b = $('<button class="knopf stark">Weiter →</button>');
    b.onclick = () => { S.kapitel++; zeichneKapitel(); zeichneRail(); window.scrollTo(0, 0); };
    nav.append(b);
  }
  fuss.querySelector('.fuss-t').textContent = `${k.felder.filter(sichtbar).length} Felder in diesem Kapitel`;
  fuss.append(nav);
  el.append(fuss);
}

function zeichneApp() {
  wurzel().innerHTML = '';
  const kopf = $(`<header class="kopf">
      <span class="marke">Vorsorgemappe</span>
      <span class="stand" id="stand"><span class="pip"></span>gespeichert</span>
      <span class="anwesend" id="anwesend"></span>
      <div class="modi">
        <button aria-pressed="true">Vorsorge</button>
        <button disabled title="kommt in Etappe 5">Ernstfall</button>
      </div>
      <button class="knopf" id="ablage" title="Speicherweg wechseln">Ablage</button>
      <button class="knopf" id="groesser" title="Schrift größer">A+</button>
      <button class="knopf" id="kleiner" title="Schrift kleiner">A−</button>
    </header>`);
  wurzel().append(kopf);
  const raum = $('<div class="raum"><nav class="rail" id="rail"></nav><main class="blatt" id="blatt"></main></div>');
  wurzel().append(raum);

  const setzeGr = (d) => {
    const g = Math.min(1.6, Math.max(0.85, (parseFloat(localStorage.getItem('vm.gr')) || 1) + d));
    localStorage.setItem('vm.gr', g);
    document.documentElement.style.setProperty('--gr', g);
  };
  document.getElementById('ablage').onclick = async () => {
    await schreibeJetzt();          // nichts Ungespeichertes zurücklassen
    wegDialog();
  };
  document.getElementById('groesser').onclick = () => setzeGr(0.1);
  document.getElementById('kleiner').onclick = () => setzeGr(-0.1);
  setzeGr(0);

  zeichneRail(); zeichneKapitel();
}

/* ───────────────────────── Zu zweit ─────────────────────────
   Anwesenheit: eine winzige Datei je Person, alle 20 Sekunden neu geschrieben.
   Wache: Dropbox meldet Änderungen im Ordner; sonst schauen wir alle 20 s nach. */

async function anwesenheitMelden() {
  if (!S.speicher || !S.speicher.schreib) return;
  const k = S.struktur.kapitel[S.kapitel];
  try {
    await S.speicher.schreib(`anwesend-${S.person}.json`, JSON.stringify({
      person: S.person, kapitel: k ? k.titel : null, zeit: new Date().toISOString(),
    }));
  } catch (e) { /* nicht wichtig genug für eine Meldung */ }
}

async function anwesenheitLesen() {
  const raus = [];
  for (const p of (S.andere || [])) {
    try {
      const t = await S.speicher.lies(`anwesend-${p}.json`);
      if (!t) continue;
      const d = JSON.parse(t);
      if ((new Date() - new Date(d.zeit)) / 1000 < 90) raus.push(d);   // älter = nicht mehr da
    } catch (e) { /* still */ }
  }
  return raus;
}

function zeigeAnwesend(liste) {
  const el = document.getElementById('anwesend');
  if (!el) return;
  if (!liste.length) { el.textContent = ''; return; }
  el.innerHTML = liste.map((d) => `<span class="wer-da"><span class="punkt"></span>${
    esc(d.person)}${d.kapitel ? ' · ' + esc(d.kapitel) : ''}</span>`).join('');
}

/* Fremde Änderung übernehmen, ohne dem Tippenden ins Handwerk zu pfuschen. */
async function fremdesUebernehmen() {
  const aktiv = document.activeElement;
  const tippt = aktiv && /^(INPUT|TEXTAREA)$/.test(aktiv.tagName);
  await ladeZustand();
  if (S.schluessel) await entsperreAlles();
  if (tippt) { aktualisiereFortschritt(); zeigeHinweisNeu(); }
  else { zeichneKapitel(); zeichneRail(); }
}

function zeigeHinweisNeu() {
  const el = document.getElementById('stand');
  if (!el) return;
  el.innerHTML = '<span class="pip"></span>Änderung von außen — erscheint, sobald du das Feld verlässt';
}

async function wacheStarten() {
  // Anwesenheit
  anwesenheitMelden();
  zeigeAnwesend(await anwesenheitLesen());
  setInterval(async () => { anwesenheitMelden(); zeigeAnwesend(await anwesenheitLesen()); }, 20000);

  // Änderungen: bei Dropbox über longpoll, sonst regelmäßig nachsehen
  if (S.speicher.warteAufAenderung && S.speicher.cursor) {
    let cur = null;
    (async function runde() {
      try {
        if (!cur) cur = await S.speicher.cursor();
        if (!cur) throw new Error('kein Cursor');
        const geaendert = await S.speicher.warteAufAenderung(cur, 30);
        cur = await S.speicher.cursor();
        if (geaendert) await fremdesUebernehmen();
      } catch (e) {
        cur = null;
        await new Promise((r) => setTimeout(r, 20000));   // Rückfallweg
        try { await fremdesUebernehmen(); } catch (e2) { /* still */ }
      }
      runde();
    })();
  } else {
    setInterval(() => fremdesUebernehmen().catch(() => {}), 20000);
  }
}

/* ───────────────────────── Einrichtung ───────────────────────── */

function karte(inhalt) {
  wurzel().innerHTML = '';
  const m = $('<div class="mitte"></div>');
  const k = $('<div class="karte"></div>');
  k.append(inhalt); m.append(k); wurzel().append(m);
  return k;
}

function kennwortDialog() {
  const k = karte($(`<div><h1>Kennwort für die geschützten Felder</h1>
    <p>Vier Felder in der Mappe sind verschlüsselt: Schließfachnummer, Vertragsnummer,
    laufende Kredite und die Liste wichtiger Zugänge. Alles andere bleibt lesbarer Klartext.</p>
    <p class="leise">Dieses Kennwort kennt ihr beide. Es wird nirgends gespeichert — nur der
    abgeleitete Schlüssel bleibt bis zum Schließen des Fensters im Arbeitsspeicher.</p>
    <label><span>KENNWORT</span><input type="password" id="kw" autocomplete="current-password"></label>
    <div class="reihe"><button class="knopf stark" id="ok">Entsperren</button>
    <button class="knopf" id="ab">Später</button></div></div>`));
  const feld = k.querySelector('#kw');
  feld.focus();
  const los = async () => {
    if (!feld.value) return;
    if (await kennwortOeffnen(feld.value)) { await entsperreAlles(); zeichneApp(); }
    else {
      if (!k.querySelector('.fehler'))
        k.append($('<div class="fehler"><b>Stimmt nicht</b>Das Kennwort passt nicht zu dieser Mappe. Wenn ihr es geändert habt, muss die Datei kennwort.json neu angelegt werden.</div>'));
      feld.select();
    }
  };
  k.querySelector('#ok').onclick = los;
  feld.onkeydown = (e) => { if (e.key === 'Enter') los(); };
  k.querySelector('#ab').onclick = () => zeichneApp();
}

function personDialog() {
  const k = karte($(`<div><h1>Wer bist du?</h1>
    <p>Jeder schreibt ausschließlich in seine eigene Datei — deshalb kann es beim gleichzeitigen
    Arbeiten keine Konflikte geben. Dein Kürzel bestimmt, wie diese Datei heißt.</p>
    <label><span>DEIN KÜRZEL — kleingeschrieben, ohne Leerzeichen</span>
      <input type="text" id="p" placeholder="zum Beispiel tom"></label>
    <label><span>WELCHE VERFÜGUNG PFLEGST DU?</span></label>
    <div class="wahl">
      <label><input type="radio" name="v" value="a" checked><span>Verfügung A</span></label>
      <label><input type="radio" name="v" value="b"><span>Verfügung B</span></label>
    </div>
    <p class="leise">Gemeinsame Felder erscheinen in beiden Verfügungen und werden nur einmal gepflegt.</p>
    <div class="reihe"><button class="knopf stark" id="ok">Weiter</button></div></div>`));
  const feld = k.querySelector('#p');
  feld.focus();
  k.querySelector('#ok').onclick = async () => {
    const p = feld.value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (!p) { feld.focus(); return; }
    S.person = p;
    S.verfuegung = k.querySelector('input[name=v]:checked').value;
    localStorage.setItem('vm.person', p);
    localStorage.setItem('vm.verfuegung', S.verfuegung);
    await start();
  };
}

function wegDialog(fehler) {
  const k = karte($(`<div><h1>Vorsorgemappe</h1>
    <p>Wo sollen eure Antworten liegen?</p>
    <div class="wege">
      <button class="weg" id="w-drop"><span>◧</span><span><b>Dropbox</b>
        <em>Der gemeinsame Ordner. Beide arbeiten am selben Stand, auch gleichzeitig.</em></span></button>
      <button class="weg" id="w-ord"><span>▤</span><span><b>Ordner auf diesem Gerät</b>
        <em>Der bereits synchronisierte Projektordner. Ohne Anmeldung, nur in Chrome und Edge.</em></span></button>
      <button class="weg" id="w-probe"><span>◌</span><span><b>Probelauf</b>
        <em>Zum Anschauen. Bleibt in diesem Browser und geht nirgends hin.</em></span></button>
    </div>
    <p class="leise" style="margin-top:1.2rem">Der Dropbox-Weg braucht einmalig einen App-Schlüssel,
    den du unter dropbox.com/developers selbst anlegst. Siehe README.md.</p></div>`));
  if (S.speicher) {
    const zurueck = $(`<div class="reihe"><span class="leise">Zurzeit: ${esc(S.speicher.name)}</span>
      <button class="knopf" id="bleib">Dabei bleiben</button></div>`);
    zurueck.querySelector('#bleib').onclick = () => zeichneApp();
    k.append(zurueck);
  }
  if (fehler) k.append($(`<div class="fehler"><b>Das hat nicht geklappt</b>${esc(fehler)}</div>`));

  k.querySelector('#w-probe').onclick = async () => {
    S.speicher = Speicher.probelauf(); localStorage.setItem('vm.weg', 'probe'); await start();
  };
  k.querySelector('#w-ord').onclick = async () => {
    if (!window.showDirectoryPicker) return wegDialog('Dieser Browser kann keine Ordner öffnen. Nimm Chrome oder Edge — oder den Dropbox-Weg.');
    try {
      const griff = await window.showDirectoryPicker({ mode: 'readwrite' });
      S.speicher = Speicher.ordner(griff); localStorage.setItem('vm.weg', 'ordner'); await start();
    } catch (e) { /* abgebrochen */ }
  };
  k.querySelector('#w-drop').onclick = () => dropboxDialog();
}

function dropboxDialog() {
  const k = karte($(`<div><h1>Dropbox verbinden</h1>
    <p>Einmalig: Lege unter <b>dropbox.com/developers</b> eine App an (Scoped access, Full Dropbox),
    trage bei „Redirect URIs“ genau diese Adresse ein:</p>
    <p><code>${esc(location.origin + location.pathname)}</code></p>
    <p>und setze die Berechtigungen <code>files.content.read</code> und <code>files.content.write</code>.</p>
    <label><span>APP KEY</span><input type="text" id="key" value="${esc(localStorage.getItem('vm.dropbox.key') || '')}"></label>
    <label><span>ORDNER IN DER DROPBOX</span>
      <input type="text" id="pfad" value="${esc(localStorage.getItem('vm.dropbox.pfad') || '/Tom Sauermann/001 Mein kleines Erbe')}"></label>
    <div class="reihe"><button class="knopf stark" id="ok">Anmelden</button>
      <button class="knopf" id="zur">Zurück</button></div></div>`));
  k.querySelector('#ok').onclick = () => {
    const roh = k.querySelector('#key').value;
    const key = roh.replace(/\s+/g, '');          // auch Zeilenumbrüche aus der Zwischenablage
    const zeigeFehler = (t) => {
      k.querySelectorAll('.fehler').forEach((x) => x.remove());
      k.append($(`<div class="fehler"><b>Das ist kein App key</b>${esc(t)}</div>`));
      k.querySelector('#key').select();
    };
    if (!key) return zeigeFehler('Das Feld ist leer.');
    if (/^https?:/i.test(key))
      return zeigeFehler('Das sieht nach einer Adresse aus. Gemeint ist nur der App key von der '
        + 'Einstellungsseite deiner Dropbox-App.');
    if (/^sl\./i.test(key) || key.length > 60)
      return zeigeFehler('Das ist ein Zugriffstoken, kein App key. Ein Token ist ein persönlicher '
        + 'Schlüssel zu deinem eigenen Konto und läuft nach wenigen Stunden ab — damit könnte deine '
        + 'Frau sich nicht anmelden. Der App key steht auf derselben Dropbox-Seite weiter oben, im '
        + 'Feld „App key“, und ist rund 15 Zeichen lang.');
    if (!/^[a-z0-9]+$/i.test(key))
      return zeigeFehler('Ein App key besteht nur aus Buchstaben und Ziffern. Eingegeben wurde etwas '
        + 'anderes — vermutlich ist mehr als der Schlüssel mitkopiert worden.');
    if (key.length > 25)
      return zeigeFehler(`Ein App key ist rund 15 Zeichen lang, hier sind es ${key.length}. `
        + 'Wahrscheinlich ist mehr als der Schlüssel in der Zwischenablage gewesen — etwa „App key“ '
        + 'samt Beschriftung, oder Schlüssel und App secret zusammen.');
    if (key.length < 10)
      return zeigeFehler(`Hier sind nur ${key.length} Zeichen, ein App key ist rund 15 lang.`);
    k.querySelectorAll('.fehler').forEach((x) => x.remove());
    localStorage.setItem('vm.weg', 'dropbox');
    Speicher.pkceStart(key, k.querySelector('#pfad').value.trim());
  };
  k.querySelector('#zur').onclick = () => wegDialog();
}

/* ───────────────────────── Start ───────────────────────── */

async function start() {
  if (!S.speicher) return wegDialog();
  if (!S.person) return personDialog();
  try {
    S.struktur = await S.speicher.struktur();
    if (!S.struktur || !S.struktur.kapitel || !S.struktur.kapitel.length)
      throw new Error('struktur.json enthält keine Kapitel.');
  } catch (e) { return wegDialog(e.message); }
  await ladeZustand();
  zeichneApp();
  if (!S.wacheLaeuft) { S.wacheLaeuft = true; wacheStarten(); }
}

(async function () {
  const abfrage = new URLSearchParams(location.search);
  const code = abfrage.get('code');
  if (abfrage.get('error')) {
    history.replaceState({}, '', location.pathname);
    return wegDialog('Dropbox hat die Anmeldung abgelehnt: '
      + (abfrage.get('error_description') || abfrage.get('error')));
  }
  if (code) {
    try {
      const token = await Speicher.pkceEinloesen(code);
      const wurzel = await Speicher.wurzelBestimmen(token);
      localStorage.setItem('vm.dropbox.wurzel', wurzel || '');
      S.speicher = Speicher.dropbox(token, wurzel);
      history.replaceState({}, '', location.pathname);
    } catch (e) { return wegDialog(e.message); }
  } else {
    const weg = localStorage.getItem('vm.weg');
    if (weg === 'probe') S.speicher = Speicher.probelauf();
    else if (weg === 'dropbox') {
      const token = await Speicher.frischerToken();
      if (token) {
        let wurzel = localStorage.getItem('vm.dropbox.wurzel') || null;
        if (wurzel === null) { wurzel = await Speicher.wurzelBestimmen(token); }
        S.speicher = Speicher.dropbox(token, wurzel || null);
      }
    }
    // 'ordner' braucht bei jedem Start eine Nutzergeste — deshalb bewusst nicht automatisch
  }
  S.person = localStorage.getItem('vm.person');
  S.verfuegung = localStorage.getItem('vm.verfuegung') || 'a';
  S.andere = [];
  await start();
})();
