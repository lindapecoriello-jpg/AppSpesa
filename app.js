'use strict';
/*
 * Spesa — lista della spesa ordinata per reparti.
 * Dati salvati sul telefono (localStorage) + condivisione opzionale tramite
 * Firebase Realtime Database (API REST, nessuna libreria esterna).
 *
 * Struttura dati:
 *   reparti/{id}   = { n: nome, pos: ordine }
 *   prodotti/{key} = { n: nome, r: idReparto, ogni: giorni (ricorrenza), ultimo: ms ultimo acquisto }
 *   lista/{key}    = { t: ms aggiunta, q: quantità, p: 1 se preso, pi: ms preso, auto: 1 se aggiunto da ricorrenza }
 */
const VERSIONE = '1.0';
const DAY = 86400000;
const LS = 'spesa.v1';
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = v => (v == null ? v : JSON.parse(JSON.stringify(v)));

/* ---------------- archivio locale ---------------- */
let store = (() => {
  try {
    const s = JSON.parse(localStorage.getItem(LS));
    if (s && typeof s === 'object' && s.server) return Object.assign({ pending: [], cfg: null, ui: {} }, s);
  } catch (e) { /* dati assenti o corrotti */ }
  return { server: {}, pending: [], cfg: null, ui: {} };
})();
function save() { try { localStorage.setItem(LS, JSON.stringify(store)); } catch (e) { /* memoria piena */ } }

function setPath(t, p, v) {
  if (!p) return v == null ? {} : clone(v);
  if (t == null || typeof t !== 'object') t = {};
  const ks = p.split('/'), chain = [];
  let o = t;
  for (let i = 0; i < ks.length - 1; i++) {
    if (o[ks[i]] == null || typeof o[ks[i]] !== 'object') { if (v == null) return t; o[ks[i]] = {}; }
    chain.push([o, ks[i]]);
    o = o[ks[i]];
  }
  const last = ks[ks.length - 1];
  if (v == null) delete o[last]; else o[last] = clone(v);
  for (let i = chain.length - 1; i >= 0; i--) {
    const [par, k] = chain[i];
    if (Object.keys(par[k]).length === 0) delete par[k]; else break;
  }
  return t;
}

let S = {}; // stato corrente = dati del server + modifiche non ancora inviate
function computeState() {
  let t = clone(store.server) || {};
  for (const op of store.pending) t = setPath(t, op.p, op.v);
  S = t;
  return t;
}

// ops: [[percorso, valore], ...]; valore null = elimina
function write(ops) {
  for (const [p, v] of ops) {
    const val = v === undefined ? null : v;
    if (store.cfg) store.pending.push({ p, v: val });
    else store.server = setPath(store.server, p, val);
  }
  save();
  if (store.cfg && syncState === 'ok') syncState = 'pending';
  render();
  if (store.cfg) scheduleSync(250);
}

/* ---------------- sincronizzazione (Firebase REST) ---------------- */
let syncing = false, syncTimer = null, syncErr = '';
let syncState = store.cfg ? 'pending' : 'local'; // local | ok | pending | offline | error

function req(url, opt = {}) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 8000);
  return fetch(url, Object.assign({ cache: 'no-store', signal: c.signal }, opt)).finally(() => clearTimeout(t));
}
function base() { return store.cfg.db + '/f/' + store.cfg.code; }
function scheduleSync(ms) { clearTimeout(syncTimer); syncTimer = setTimeout(sync, ms); }

async function sync() {
  if (!store.cfg || syncing) return;
  syncing = true;
  const cfg = store.cfg;
  try {
    // 1) invia le modifiche in attesa (raggruppate quando possibile)
    while (store.pending.length && store.cfg === cfg) {
      let n = 0, res;
      const first = store.pending[0];
      if (first.p === '') {
        n = 1;
        res = await req(base() + '.json', { method: 'PUT', body: JSON.stringify(first.v) });
      } else {
        const batch = {}, paths = [];
        for (const op of store.pending) {
          if (op.p === '' || paths.some(q => q !== op.p && (q.startsWith(op.p + '/') || op.p.startsWith(q + '/')))) break;
          paths.push(op.p); batch[op.p] = op.v; n++;
        }
        res = await req(base() + '.json', { method: 'PATCH', body: JSON.stringify(batch) });
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      store.pending.splice(0, n);
      save();
    }
    // 2) scarica lo stato aggiornato
    const r = await req(base() + '.json');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    if (store.cfg !== cfg) return;
    store.server = data && typeof data === 'object' ? data : {};
    syncState = store.pending.length ? 'pending' : 'ok';
    syncErr = '';
    save();
  } catch (e) {
    const m = String(e && e.message || e);
    if (m.startsWith('HTTP')) { syncState = 'error'; syncErr = m === 'HTTP 401' || m === 'HTTP 403' ? 'accesso negato (regole Firebase?)' : m; }
    else syncState = 'offline';
  } finally {
    syncing = false;
    render();
    checkRicorrenti();
    if (store.cfg && store.pending.length && syncState !== 'offline' && syncState !== 'error') scheduleSync(300);
  }
}

function statoTxt() {
  return {
    local: 'solo su questo telefono',
    ok: 'sincronizzata',
    pending: 'invio modifiche…',
    offline: 'senza rete: invio appena torna',
    error: 'errore: ' + syncErr,
  }[syncState];
}

/* ---------------- dominio ---------------- */
function keyOf(nome) {
  let k = String(nome).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!k) { let h = 0; for (const c of String(nome)) h = (h * 31 + c.codePointAt(0)) >>> 0; k = 'x' + h.toString(36); }
  return k.slice(0, 60);
}
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const sod = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const giorniTra = (a, b) => Math.round((sod(b) - sod(a)) / DAY);
const anticipo = g => (g >= 7 ? 1 : 0); // per ricorrenze settimanali o più lunghe: torna in lista il giorno prima
const dataTxt = t => new Date(t).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' });
const qtaTxt = q => (q ? (/^\d+$/.test(q) ? '×' + q : q) : '');

// supermercati: ognuno ha nome e proprio ordine dei reparti (mappe/{id} = { n, ord: { idReparto: posizione } })
function mappe() {
  return Object.entries(S.mappe || {}).filter(([, m]) => m && typeof m === 'object')
    .map(([id, m]) => ({ id, n: m.n || 'Supermercato', ord: m.ord && typeof m.ord === 'object' ? m.ord : {} }))
    .sort((a, b) => a.n.localeCompare(b.n, 'it'));
}
function mappaAttiva() { const ms = mappe(); return ms.find(m => m.id === store.ui.mappa) || ms[0] || null; }
function reparti() {
  const m = mappaAttiva(), ord = m ? m.ord : {};
  return Object.entries(S.reparti || {}).filter(([, r]) => r && typeof r === 'object')
    .map(([id, r]) => {
      const base = +r.pos || 0;
      return { id, n: r.n || '', base, pos: Object.prototype.hasOwnProperty.call(ord, id) ? +ord[id] : 1000 + base };
    })
    .sort((a, b) => a.pos - b.pos || a.n.localeCompare(b.n, 'it'));
}
function prodotto(k) { const p = (S.prodotti || {})[k]; return p && typeof p === 'object' ? Object.assign({ n: k }, p) : { n: k }; }
function voci() {
  const reps = reparti(), pos = {};
  reps.forEach((r, i) => { pos[r.id] = i; });
  return Object.entries(S.lista || {})
    .filter(([, it]) => it && typeof it === 'object')
    .map(([k, it]) => {
      const p = prodotto(k);
      const ri = Object.prototype.hasOwnProperty.call(pos, p.r) ? pos[p.r] : 1e9;
      return { k, it, p, ri, rep: ri < 1e9 ? reps[ri].n : 'Altro' };
    })
    .sort((a, b) => a.ri - b.ri || String(a.p.n).localeCompare(String(b.p.n), 'it'));
}
function dataRientro(p) {
  const g = +p.ogni || 0;
  if (!g) return null;
  if (!p.ultimo) return sod(Date.now());
  const d = new Date(sod(p.ultimo));
  d.setDate(d.getDate() + g - anticipo(g));
  return d.getTime();
}

function checkRicorrenti() {
  computeState();
  const now = Date.now(), ops = [];
  for (const [k, p] of Object.entries(S.prodotti || {})) {
    const g = +(p && p.ogni) || 0;
    if (!g || (S.lista || {})[k]) continue;
    if (!p.ultimo || giorniTra(p.ultimo, now) >= g - anticipo(g)) ops.push([`lista/${k}/t`, now], [`lista/${k}/auto`, 1]);
  }
  if (ops.length) write(ops);
}

function parseInput(txt) {
  return String(txt).split(/\n|;|,(?!\d)/).map(s => s.trim()).filter(Boolean).map(s => {
    let q = '', m;
    if ((m = s.match(/^(.+?)\s*[x×]\s*(\d+(?:[.,]\d+)?\s*[a-z]{0,4})$/i))) { s = m[1]; q = m[2]; }
    else if ((m = s.match(/^(\d+(?:[.,]\d+)?\s*(?:g|gr|kg|l|lt|ml|cl|pz|conf)?)\s+(?:x\s+)?(.+)$/i))) { q = m[1]; s = m[2]; }
    return { nome: s.trim(), q: q.replace(/\s+/g, '').trim() };
  }).filter(x => x.nome);
}

let askQueue = [];
function aggiungi(txt) {
  computeState();
  const items = parseInput(txt);
  if (!items.length) return;
  const ops = [], nuovi = [], now = Date.now(), haReparti = reparti().length > 0;
  for (const { nome, q } of items) {
    const k = keyOf(nome), p = (S.prodotti || {})[k], cur = (S.lista || {})[k];
    if (!p) ops.push([`prodotti/${k}`, { n: cap(nome) }]);
    const attivo = cur && !cur.p;
    const it = { t: attivo && cur.t ? cur.t : now };
    const qq = q || (attivo ? cur.q : '');
    if (qq) it.q = qq;
    ops.push([`lista/${k}`, it]);
    if (haReparti && !(p && p.r && (S.reparti || {})[p.r]) && !nuovi.includes(k)) nuovi.push(k);
  }
  write(ops);
  for (const k of nuovi) if (!askQueue.includes(k)) askQueue.push(k);
  if (askQueue.length && !sheet) apriChiedi();
}

function toggle(k) {
  const it = (S.lista || {})[k];
  if (!it) return;
  write(it.p ? [[`lista/${k}/p`, null], [`lista/${k}/pi`, null]] : [[`lista/${k}/p`, 1], [`lista/${k}/pi`, Date.now()]]);
  if (navigator.vibrate) try { navigator.vibrate(15); } catch (e) { /* ignora */ }
}

function fineSpesa() {
  const presi = voci().filter(v => v.it.p);
  if (!presi.length) return;
  if (!confirm(`Chiudere la spesa?\n${presi.length} prodotti presi verranno tolti dalla lista.`)) return;
  const ops = [];
  for (const v of presi) {
    ops.push([`lista/${v.k}`, null]);
    if ((S.prodotti || {})[v.k]) ops.push([`prodotti/${v.k}/ultimo`, v.it.pi || Date.now()]);
  }
  write(ops);
  if (layers[layers.length - 1] === 'spesa') history.back();
}

function togli(k) {
  const p = (S.prodotti || {})[k];
  const ops = [[`lista/${k}`, null]];
  if (p && p.ogni) ops.push([`prodotti/${k}/ultimo`, Date.now()]); // salta questo giro
  write(ops);
}

/* reparti */
function nuovoId() { return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function aggiungiReparti(nomi) {
  const reps = reparti(), m = mappaAttiva();
  let base = reps.length ? Math.max(...reps.map(r => r.base)) + 1 : 0;
  let pos = reps.length ? Math.max(...reps.map(r => r.pos)) + 1 : 0;
  const esistenti = new Set(reps.map(r => r.n.toLowerCase()));
  const ops = [];
  for (const n of nomi) {
    if (!n || esistenti.has(n.toLowerCase())) continue;
    esistenti.add(n.toLowerCase());
    const id = nuovoId();
    ops.push([`reparti/${id}`, { n, pos: base++ }]);
    if (m) ops.push([`mappe/${m.id}/ord/${id}`, pos++]);
  }
  if (ops.length) write(ops);
}
function parseReparti(txt) {
  return String(txt).split(/\n/).map(s => s.replace(/^\s*(?:\d+\s*[).:\-–]?|[-*•])\s*/, '').trim()).filter(Boolean);
}
function sposta(id, d) {
  const reps = reparti(), i = reps.findIndex(r => r.id === id), j = i + d;
  if (i < 0 || j < 0 || j >= reps.length) return;
  [reps[i], reps[j]] = [reps[j], reps[i]];
  const m = mappaAttiva();
  write(reps.map((r, x) => (m ? [`mappe/${m.id}/ord/${r.id}`, x] : [`reparti/${r.id}/pos`, x])));
}
function eliminaReparto(id) {
  const r = (S.reparti || {})[id];
  if (!r) return;
  const n = Object.values(S.prodotti || {}).filter(p => p && p.r === id).length;
  if (!confirm(`Eliminare il reparto «${r.n}» da tutti i supermercati?` + (n ? `\n${n} prodotti resteranno senza reparto.` : ''))) return;
  write([[`reparti/${id}`, null], ...mappe().map(m => [`mappe/${m.id}/ord/${id}`, null])]);
}
function nuovaMappa() {
  const nome = (prompt('Nome del supermercato (es. Conad via Roma):') || '').trim();
  if (!nome) return;
  const id = 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), ord = {};
  reparti().forEach((r, i) => { ord[r.id] = i; }); // parte con l'ordine del supermercato attuale
  store.ui.mappa = id;
  write([[`mappe/${id}`, { n: nome, ord }]]);
}
function scegliMappa(id) { store.ui.mappa = id; save(); render(); }
function eliminaMappa(id) {
  const ms = mappe(), m = ms.find(x => x.id === id);
  if (!m) return;
  if (ms.length < 2) { alert('Serve almeno un supermercato.'); return; }
  if (!confirm(`Eliminare il supermercato «${m.n}» e il suo ordine dei reparti?`)) return;
  if (mappaAttiva().id === id) store.ui.mappa = ms.find(x => x.id !== id).id;
  write([[`mappe/${id}`, null]]);
}

/* reparti e prodotti tipici (predefiniti.js) */
function opsPredefiniti() {
  computeState();
  const d = datiPredefiniti(keyOf), ops = [], reps = reparti(), perNome = {}, mappa = {};
  reps.forEach(r => { perNome[r.n.toLowerCase()] = r.id; });
  let pos = reps.length ? Math.max(...reps.map(r => r.pos)) + 1 : 0;
  for (const [id, r] of Object.entries(d.reparti).sort((a, b) => a[1].pos - b[1].pos)) {
    const esiste = perNome[r.n.toLowerCase()];
    if (esiste) { mappa[id] = esiste; continue; }
    const nid = (S.reparti || {})[id] ? nuovoId() : id;
    ops.push([`reparti/${nid}`, { n: r.n, pos: pos++ }]);
    mappa[id] = nid;
  }
  if (!mappe().length) {
    const ord = {};
    reps.map(r => r.id).concat(ops.map(o => o[0].slice(8))).forEach((id, i) => { ord[id] = i; });
    ops.push(['mappe/m1', { n: 'Il mio supermercato', ord }]);
  }
  for (const [k, p] of Object.entries(d.prodotti)) {
    const cur = (S.prodotti || {})[k];
    if (!cur) ops.push([`prodotti/${k}`, { n: p.n, r: mappa[p.r] }]);
    else if (!cur.r || !(S.reparti || {})[cur.r]) ops.push([`prodotti/${k}/r`, mappa[p.r]]);
  }
  return ops;
}
function caricaPredefiniti() {
  const ops = opsPredefiniti();
  if (!ops.length) { alert('Reparti e prodotti tipici sono già tutti presenti.'); return; }
  if (!confirm('Aggiungere i reparti e i prodotti tipici mancanti?\nQuelli che hai già non vengono modificati.')) return;
  write(ops);
}

/* condivisione */
function nuovoCodice() {
  const a = new Uint8Array(20), al = 'abcdefghijkmnpqrstuvwxyz23456789';
  crypto.getRandomValues(a);
  return Array.from(a, b => al[b % 32]).join('');
}
function normDb(u) {
  u = String(u || '').trim().replace(/\/+$/, '');
  return /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.(firebaseio\.com|firebasedatabase\.app)$/i.test(u) ? u : null;
}
async function creaCondivisa() {
  const db = normDb($('#db') && $('#db').value);
  if (!db) { alert('Indirizzo del database non valido.\nDeve essere simile a:\nhttps://nome-default-rtdb.europe-west1.firebasedatabase.app'); return; }
  const code = nuovoCodice();
  try {
    const body = Object.assign({}, computeState(), { creato: Date.now() });
    const r = await req(`${db}/f/${code}.json`, { method: 'PUT', body: JSON.stringify(body) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
  } catch (e) {
    alert('Non riesco a scrivere sul database (' + (e.message || e) + ').\nControlla l\'indirizzo e le regole di Firebase.');
    return;
  }
  store.cfg = { db, code };
  store.server = clone(S);
  store.pending = [];
  syncState = 'ok';
  save();
  render();
  alert('Lista condivisa creata.\nOra tocca «Invia invito» e manda il link all\'altro telefono.');
}
function linkInvito() { return location.origin + location.pathname + '#db=' + encodeURIComponent(store.cfg.db) + '&c=' + store.cfg.code; }
async function invita() {
  const url = linkInvito();
  try {
    if (navigator.share) { await navigator.share({ title: 'Lista della spesa', text: 'Apri questo link con Chrome per collegarti alla lista della spesa condivisa:', url }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(url); alert('Link copiato: incollalo in un messaggio.'); }
  catch (e) { prompt('Copia questo link e mandalo all\'altro telefono:', url); }
}
function leggiInvito(str) {
  str = String(str || '');
  const i = str.indexOf('#');
  const p = new URLSearchParams(i >= 0 ? str.slice(i + 1) : str);
  return { db: p.get('db'), c: p.get('c') };
}
async function unisciti(dbIn, code) {
  const db = normDb(dbIn);
  if (!db || !/^[a-z0-9]{16,64}$/.test(code || '')) { alert('Link di invito non valido.'); return; }
  if (store.cfg && store.cfg.code === code && store.cfg.db === db) { sync(); return; }
  computeState();
  const haDati = Object.keys(S.lista || {}).length || Object.keys(S.reparti || {}).length;
  if (!confirm('Collegare questo telefono alla lista condivisa?' + (haDati ? '\nLa lista attuale di questo telefono verrà sostituita.' : ''))) return;
  store.cfg = { db, code };
  store.pending = [];
  store.server = {};
  syncState = 'pending';
  save();
  render();
  await sync();
  if (syncState === 'ok') alert('Collegato! Ora la lista è condivisa.');
}
function scollega() {
  if (!confirm('Scollegare questo telefono dalla lista condivisa?\nI dati restano su questo telefono ma non si aggiornano più.')) return;
  store.server = clone(computeState());
  store.cfg = null;
  store.pending = [];
  syncState = 'local';
  save();
  render();
}

/* backup */
function esporta() {
  const blob = new Blob([JSON.stringify(computeState(), null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'spesa-backup-' + new Date().toISOString().slice(0, 10) + '.json';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}
function importa(file) {
  if (!file) return;
  const fr = new FileReader();
  fr.onload = () => {
    try {
      const d = JSON.parse(fr.result);
      if (!d || typeof d !== 'object' || !(d.reparti || d.prodotti || d.lista)) throw new Error('formato');
      if (confirm('Sostituire tutti i dati con quelli del backup?')) write([['', d]]);
    } catch (e) { alert('File di backup non valido.'); }
  };
  fr.readAsText(file);
}

/* ---------------- livelli (indietro di Android) ---------------- */
const layers = [];
function pushLayer(n) { layers.push(n); history.pushState({ l: layers.length }, ''); }
window.addEventListener('popstate', () => {
  const n = layers.pop();
  if (n === 'sheet') { sheet = null; askQueue = []; }
  else if (n === 'spesa') esciSpesa();
  render();
});

let sheet = null; // { tipo: 'chiedi' | 'mod', k }
function apriSheet(s) { const era = !!sheet; sheet = s; if (!era) pushLayer('sheet'); render(); }
function chiudiSheet() { if (sheet && layers[layers.length - 1] === 'sheet') history.back(); else { sheet = null; render(); } }
function apriChiedi() {
  while (askQueue.length && !(S.lista || {})[askQueue[0]]) askQueue.shift();
  if (!askQueue.length) { if (sheet && sheet.tipo === 'chiedi') chiudiSheet(); return; }
  apriSheet({ tipo: 'chiedi', k: askQueue[0] });
}

/* ---------------- modalità spesa: schermo intero + niente standby ---------------- */
let wakeLock = null;
async function teniAcceso() {
  try {
    if ('wakeLock' in navigator && document.visibilityState === 'visible' && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; statoSchermo(); });
    }
  } catch (e) { wakeLock = null; }
  statoSchermo();
}
function statoSchermo() {
  const e = $('#wl');
  if (e) e.textContent = 'wakeLock' in navigator ? '' : '⚠ lo schermo può spegnersi';
}
function entraSpesa() {
  pushLayer('spesa');
  render();
  const el = document.documentElement;
  try { if (el.requestFullscreen) el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {}); } catch (e) { /* non supportato */ }
  teniAcceso();
  $('#spesa').scrollTop = 0;
}
function esciSpesa() {
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  try { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); } catch (e) { /* ignora */ }
}

/* ---------------- disegno ---------------- */
function setHTML(el, html) {
  if (el._h === html) return;
  const a = document.activeElement;
  const id = a && a.id && el.contains(a) ? a.id : null;
  const val = id ? a.value : null;
  let s1 = null, s2 = null;
  try { if (id) { s1 = a.selectionStart; s2 = a.selectionEnd; } } catch (e) { /* tipo number */ }
  el.innerHTML = html;
  el._h = html;
  if (id) {
    const b = document.getElementById(id);
    if (b) { b.value = val; b.focus(); try { if (s1 != null) b.setSelectionRange(s1, s2); } catch (e) { /* ignora */ } }
  }
}

function render() {
  computeState();
  const top = layers.filter(l => l !== 'sheet').pop() || 'lista';
  $('#impostazioni').hidden = top !== 'impostazioni';
  $('#spesa').hidden = top !== 'spesa';
  $('#foot').hidden = top !== 'lista';
  $('#lista').hidden = top !== 'lista';
  $('#top').hidden = top !== 'lista';
  document.documentElement.style.background = top === 'lista' ? '' : '#fff';
  const d = $('#dot'); d.className = 'dot ' + syncState; d.title = statoTxt();
  renderLista();
  if (top === 'impostazioni') renderImpostazioni();
  if (top === 'spesa') renderSpesa();
  renderSheet();
}

function rigaLista(v) {
  return `<div class="riga${v.it.p ? ' preso' : ''}" data-a="mod" data-k="${esc(v.k)}"><span class="n">${esc(v.p.n)}</span>` +
    (v.it.q ? `<span class="q">${esc(qtaTxt(v.it.q))}</span>` : '') +
    (v.p.ogni ? '<span class="ric" title="Ricorrente">↻</span>' : '') + '</div>';
}
function renderLista() {
  const reps = reparti(), vs = voci(), da = vs.filter(v => !v.it.p), presi = vs.filter(v => v.it.p);
  let h = '';
  if (!reps.length) h += '<div class="avviso">Per ordinare la lista inserisci prima la <b>mappa del supermercato</b> (l\'elenco dei reparti in ordine).<br><button data-a="apri-imp">Imposta la mappa</button></div>';
  const ms = mappe(), att = mappaAttiva();
  if (ms.length > 1) h += `<div class="mappa-bar">📍 <select id="selmappa" aria-label="Supermercato">${ms.map(m => `<option value="${esc(m.id)}"${m.id === att.id ? ' selected' : ''}>${esc(m.n)}</option>`).join('')}</select></div>`;
  else if (att) h += `<div class="mappa-bar">📍 ${esc(att.n)}</div>`;
  h += '<div class="add"><input id="add" type="text" placeholder="Scrivi: latte, pane, uova x6…" autocomplete="off" autocapitalize="sentences" enterkeyhint="done"><button data-a="add" aria-label="Aggiungi">+</button></div><div id="sugg"></div>';
  if (!vs.length) h += '<p class="vuoto">La lista è vuota.</p>';
  let last = null;
  for (const v of da) {
    if (v.rep !== last) { h += `<h3>${esc(v.rep)}</h3>`; last = v.rep; }
    h += rigaLista(v);
  }
  if (presi.length) {
    h += `<div class="presi-head"><h3>Già presi (${presi.length})</h3><button data-a="fine">Fine spesa</button></div>`;
    for (const v of presi) h += rigaLista(v);
  }
  setHTML($('#lista'), h);
  aggiornaSugg();
  setHTML($('#foot'), da.length ? `<button class="big" data-a="spesa">🛒 Fai la spesa · ${da.length}</button>` : '');
}

function aggiornaSugg() {
  const inp = $('#add'), box = $('#sugg');
  if (!inp || !box) return;
  const parts = inp.value.split(/\n|;|,(?!\d)/);
  const term = (parts[parts.length - 1] || '').trim();
  let h = '';
  if (term) {
    const kt = keyOf(term), lista = S.lista || {};
    h = Object.entries(S.prodotti || {})
      .filter(([k]) => k.includes(kt) && !(lista[k] && !lista[k].p))
      .sort((a, b) => (b[0].startsWith(kt) - a[0].startsWith(kt)) || String(a[1].n).localeCompare(String(b[1].n), 'it'))
      .slice(0, 6)
      .map(([k, p]) => `<button data-a="sugg" data-k="${esc(k)}">${esc(p.n)}</button>`).join('');
  }
  if (box.innerHTML !== h) box.innerHTML = h;
}

function rigaSpesa(v) {
  return `<div class="sriga${v.it.p ? ' preso' : ''}" data-a="toggle" data-k="${esc(v.k)}"><span class="n">${esc(v.p.n)}</span>` +
    (v.it.q ? `<span class="q">${esc(qtaTxt(v.it.q))}</span>` : '') + '</div>';
}
function renderSpesa() {
  const vs = voci(), da = vs.filter(v => !v.it.p), presi = vs.filter(v => v.it.p);
  const fs = Math.round(30 * (store.ui.size || 1));
  let h = `<div class="sbar"><button data-a="esci" aria-label="Esci">✕</button><span class="dot ${syncState}"></span><span class="cont">${presi.length} / ${vs.length}</span><span id="wl"></span><button data-a="size-" aria-label="Testo più piccolo">A−</button><button data-a="size+" aria-label="Testo più grande">A+</button></div><div class="slist" style="font-size:${fs}px">`;
  let last = null;
  for (const v of da) {
    if (v.rep !== last) { h += `<div class="srep">${esc(v.rep)}</div>`; last = v.rep; }
    h += rigaSpesa(v);
  }
  if (!da.length) h += '<div class="fatto">Tutto preso ✓</div>';
  if (presi.length) {
    h += '<div class="srep">Presi</div>';
    for (const v of presi) h += rigaSpesa(v);
    h += '<button class="big fine" data-a="fine">Fine spesa</button>';
  }
  h += '</div>';
  setHTML($('#spesa'), h);
  statoSchermo();
}

function renderImpostazioni() {
  const reps = reparti();
  let h = '<div class="ihead"><button data-a="indietro" aria-label="Indietro">←</button><h2>Impostazioni</h2></div><div class="icorpo">';

  const ms = mappe(), att = mappaAttiva();
  h += '<section><h3>Supermercati</h3><p class="info">Ogni supermercato ha il suo ordine dei reparti. Quello selezionato vale per questo telefono.</p><div class="chips">' +
    ms.map(m => `<button class="chip${att && m.id === att.id ? ' on' : ''}" data-a="selmappa" data-id="${esc(m.id)}">${esc(m.n)}</button>`).join('') +
    '<button class="chip" data-a="nuovamappa">+ Nuovo supermercato</button></div>';
  if (att) h += `<label class="campo">Nome <input id="nomemappa" data-id="${esc(att.id)}" value="${esc(att.n)}" enterkeyhint="done"></label>`;
  h += '</section>';
  h += `<section><h3>Ordine dei reparti${att ? ' · ' + esc(att.n) : ''}</h3><p class="info">I reparti nell'ordine in cui li percorri. Rinominare o eliminare un reparto vale per tutti i supermercati.</p>`;
  reps.forEach((r, i) => {
    h += `<div class="rep"><span class="num">${i + 1}</span><input id="rep-${esc(r.id)}" class="repn" data-id="${esc(r.id)}" value="${esc(r.n)}">` +
      `<button data-a="su" data-id="${esc(r.id)}"${i === 0 ? ' disabled' : ''} aria-label="Su">▲</button>` +
      `<button data-a="giu" data-id="${esc(r.id)}"${i === reps.length - 1 ? ' disabled' : ''} aria-label="Giù">▼</button>` +
      `<button data-a="delrep" data-id="${esc(r.id)}" aria-label="Elimina">🗑</button></div>`;
  });
  h += '<div class="rep"><input id="newrep" placeholder="Nuovo reparto…" enterkeyhint="done"><button class="prim" data-a="addrep">Aggiungi</button></div>';
  h += `<details><summary>Incolla un elenco di reparti</summary><textarea id="paste" rows="7" placeholder="1) Frutta e verdura&#10;2) Pane&#10;3) Latte e uova&#10;…"></textarea><button data-a="incolla">Aggiungi questi reparti</button></details>` +
    (ms.length > 1 ? `<p><button class="sec rosso" data-a="delmappa" data-id="${esc(att.id)}">Elimina il supermercato «${esc(att.n)}»</button></p>` : '') +
    '<details><summary>Reparti e prodotti tipici</summary><p class="info">Aggiunge i reparti e i prodotti tipici che mancano, senza toccare quelli che hai già.</p><button class="sec" data-a="predef">Aggiungi i tipici mancanti</button></details></section>';

  const repNome = {};
  reps.forEach(r => { repNome[r.id] = r.n; });
  const prods = Object.entries(S.prodotti || {}).filter(([, p]) => p && typeof p === 'object')
    .sort((a, b) => String(a[1].n).localeCompare(String(b[1].n), 'it'));
  h += `<section><h3>Prodotti conosciuti (${prods.length})</h3><p class="info">Tocca un prodotto per cambiare reparto o ricorrenza.</p>` +
    prods.map(([k, p]) => `<div class="riga" data-a="mod" data-k="${esc(k)}"><span class="n">${esc(p.n)}</span>` +
      (p.ogni ? `<span class="ric">↻ ${esc(p.ogni)} gg</span>` : '') + `<span class="q">${esc(repNome[p.r] || '—')}</span></div>`).join('') + '</section>';

  h += '<section><h3>Condivisione</h3>';
  if (store.cfg) {
    h += `<p>Lista condivisa · <b>${esc(statoTxt())}</b></p><div class="chips"><button data-a="invita">Invia invito</button><button class="sec" data-a="sync">Sincronizza ora</button></div>` +
      `<details><summary>Dettagli</summary><p class="info mono">${esc(store.cfg.db)}<br>codice: ${esc(store.cfg.code)}</p><button class="sec rosso" data-a="scollega">Scollega questo telefono</button></details>`;
  } else {
    h += '<p class="info">Per condividere la lista con un altro telefono serve un database Firebase gratuito (vedi istruzioni). Sul primo telefono crea la lista condivisa, poi invia l\'invito all\'altro.</p>' +
      `<input id="db" class="campo" placeholder="https://…firebasedatabase.app" value="${esc(store.ui.db || '')}" autocapitalize="off" autocomplete="off"><button data-a="crea">Crea lista condivisa</button>` +
      '<details><summary>Ho ricevuto un link di invito</summary><input id="inv" placeholder="Incolla qui il link" autocapitalize="off"><button data-a="unisciti">Collegati</button></details>';
  }
  h += '</section>';

  h += '<section><h3>Backup</h3><div class="chips"><button class="sec" data-a="esporta">Esporta</button><button class="sec" data-a="importa">Importa</button></div><input type="file" id="file" accept="application/json,.json" hidden></section>';
  h += `<p class="info">Versione ${VERSIONE}</p></div>`;
  setHTML($('#impostazioni'), h);
}

function htmlModifica(k) {
  const p = prodotto(k), it = (S.lista || {})[k], reps = reparti(), g = +p.ogni || 0, ek = esc(k);
  let h = `<h2>${esc(p.n)}</h2>`;
  if (it) h += `<label>Quantità <input id="qta" type="text" value="${esc(it.q || '')}" placeholder="es. 2, 500g" data-k="${ek}" enterkeyhint="done"></label>`;
  h += '<div class="lbl">Reparto</div><div class="chips">' +
    (reps.map(r => `<button class="chip${p.r === r.id ? ' on' : ''}" data-a="rep" data-k="${ek}" data-id="${esc(r.id)}">${esc(r.n)}</button>`).join('') || '<i>Nessun reparto: imposta prima la mappa.</i>') + '</div>';
  const opz = [[0, 'No'], [7, '1 a settimana'], [14, 'Ogni 2 settimane'], [30, '1 al mese']];
  h += '<div class="lbl">Acquisto ricorrente</div><div class="chips">' +
    opz.map(([v, t]) => `<button class="chip${g === v ? ' on' : ''}" data-a="ogni" data-k="${ek}" data-g="${v}">${t}</button>`).join('') +
    `<span class="custom">ogni <input id="ogni" type="number" min="1" max="365" inputmode="numeric" value="${g && ![7, 14, 30].includes(g) ? g : ''}" data-k="${ek}"> giorni</span></div>`;
  if (g) {
    const dr = dataRientro(p);
    h += `<p class="info">${p.ultimo ? 'Ultimo acquisto: ' + dataTxt(p.ultimo) + ' · ' : ''}${it ? 'già in lista' : 'torna in lista: ' + (dr <= sod(Date.now()) ? 'subito' : dataTxt(dr))}</p>`;
  } else if (p.ultimo) h += `<p class="info">Ultimo acquisto: ${dataTxt(p.ultimo)}</p>`;
  h += '<div class="azioni">';
  if (it) h += `<button class="sec" data-a="togli" data-k="${ek}">${g ? 'Togli (salta questo giro)' : 'Togli dalla lista'}</button>`;
  else h += `<button class="sec rosso" data-a="dimentica" data-k="${ek}">Dimentica</button><button class="sec" data-a="metti" data-k="${ek}">Aggiungi alla lista</button>`;
  h += '<button data-a="chiudi">Fatto</button></div>';
  return h;
}
function renderSheet() {
  const bg = $('#sheet-bg');
  if (!sheet) { bg.hidden = true; return; }
  bg.hidden = false;
  let h = '';
  if (sheet.tipo === 'chiedi') {
    const p = prodotto(sheet.k), ek = esc(sheet.k);
    h = `<h2>In che reparto trovi «${esc(p.n)}»?</h2><div class="chips grandi">` +
      reparti().map(r => `<button class="chip" data-a="rep" data-chiedi="1" data-k="${ek}" data-id="${esc(r.id)}">${esc(r.n)}</button>`).join('') +
      `</div><p class="info">Lo chiedo solo la prima volta.${askQueue.length > 1 ? ` Ancora ${askQueue.length - 1} da assegnare.` : ''}</p>` +
      '<div class="azioni"><button class="sec" data-a="salta">Salta</button></div>';
  } else {
    h = htmlModifica(sheet.k);
  }
  setHTML($('#sheet'), h);
}

/* ---------------- eventi ---------------- */
function inviaInput() {
  const inp = $('#add');
  if (!inp || !inp.value.trim()) return;
  const v = inp.value;
  inp.value = '';
  aggiungi(v);
  aggiornaSugg();
}

document.addEventListener('click', e => {
  if (e.target.id === 'sheet-bg') { chiudiSheet(); return; }
  const b = e.target.closest('[data-a]');
  if (!b || b.disabled) return;
  const a = b.dataset.a, k = b.dataset.k, id = b.dataset.id;
  switch (a) {
    case 'apri-imp': if (layers[layers.length - 1] !== 'impostazioni') { pushLayer('impostazioni'); render(); $('#impostazioni').scrollTop = 0; } break;
    case 'indietro': case 'esci': history.back(); break;
    case 'add': inviaInput(); $('#add') && $('#add').focus(); break;
    case 'sugg': {
      const inp = $('#add'), parts = inp.value.split(/\n|;|,(?!\d)/);
      parts[parts.length - 1] = prodotto(k).n;
      inp.value = parts.join(', ');
      inviaInput();
      break;
    }
    case 'mod': apriSheet({ tipo: 'mod', k }); break;
    case 'spesa': entraSpesa(); break;
    case 'toggle': toggle(k); break;
    case 'fine': fineSpesa(); break;
    case 'size+': case 'size-':
      store.ui.size = Math.max(0.7, Math.min(2, (store.ui.size || 1) + (a === 'size+' ? 0.15 : -0.15)));
      save(); render(); break;
    case 'rep':
      write([[`prodotti/${k}/r`, id]]);
      if (b.dataset.chiedi) { askQueue = askQueue.filter(x => x !== k); apriChiedi(); }
      break;
    case 'salta': askQueue.shift(); apriChiedi(); break;
    case 'ogni': {
      const g = +b.dataset.g;
      write([[`prodotti/${k}/ogni`, g || null]]);
      checkRicorrenti();
      break;
    }
    case 'togli': togli(k); chiudiSheet(); break;
    case 'metti': write([[`lista/${k}`, { t: Date.now() }]]); chiudiSheet(); break;
    case 'dimentica':
      if (confirm(`Dimenticare «${prodotto(k).n}»? Reparto e ricorrenza andranno persi.`)) { write([[`prodotti/${k}`, null]]); chiudiSheet(); }
      break;
    case 'chiudi': chiudiSheet(); break;
    case 'su': sposta(id, -1); break;
    case 'giu': sposta(id, 1); break;
    case 'delrep': eliminaReparto(id); break;
    case 'addrep': { const i = $('#newrep'); const n = i.value.trim(); if (n) { i.value = ''; aggiungiReparti([n]); } break; }
    case 'incolla': { const t = $('#paste'); const nomi = parseReparti(t.value); if (nomi.length) { t.value = ''; aggiungiReparti(nomi); } break; }
    case 'predef': caricaPredefiniti(); break;
    case 'selmappa': scegliMappa(id); break;
    case 'nuovamappa': nuovaMappa(); break;
    case 'delmappa': eliminaMappa(id); break;
    case 'crea': creaCondivisa(); break;
    case 'invita': invita(); break;
    case 'sync': syncState = 'pending'; render(); sync(); break;
    case 'scollega': scollega(); break;
    case 'unisciti': { const { db, c } = leggiInvito($('#inv').value); unisciti(db, c); break; }
    case 'esporta': esporta(); break;
    case 'importa': $('#file').click(); break;
  }
});

document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const t = e.target;
  if (t.id === 'add') { e.preventDefault(); inviaInput(); }
  else if (t.id === 'newrep') { e.preventDefault(); const n = t.value.trim(); if (n) { t.value = ''; aggiungiReparti([n]); } }
  else if (t.id === 'qta' || t.id === 'ogni' || t.id === 'nomemappa' || t.classList.contains('repn')) t.blur();
});
document.addEventListener('input', e => { if (e.target.id === 'add') aggiornaSugg(); });
document.addEventListener('change', e => {
  const t = e.target;
  if (t.classList.contains('repn')) {
    const n = t.value.trim();
    if (n && n !== ((S.reparti || {})[t.dataset.id] || {}).n) write([[`reparti/${t.dataset.id}/n`, n]]);
    else render();
  } else if (t.id === 'qta') {
    if ((S.lista || {})[t.dataset.k]) write([[`lista/${t.dataset.k}/q`, t.value.trim() || null]]);
  } else if (t.id === 'ogni') {
    const g = parseInt(t.value, 10);
    write([[`prodotti/${t.dataset.k}/ogni`, g > 0 ? Math.min(g, 365) : null]]);
    checkRicorrenti();
  } else if (t.id === 'selmappa') scegliMappa(t.value);
  else if (t.id === 'nomemappa') {
    const n = t.value.trim();
    if (n) write([[`mappe/${t.dataset.id}/n`, n]]); else render();
  } else if (t.id === 'db') { store.ui.db = t.value.trim(); save(); }
  else if (t.id === 'file') { importa(t.files[0]); t.value = ''; }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (store.cfg) sync(); else checkRicorrenti();
  if (layers.includes('spesa')) teniAcceso();
});
window.addEventListener('online', () => sync());
setInterval(() => { if (store.cfg && document.visibilityState === 'visible') sync(); }, 10000);
setInterval(() => { if (!store.cfg) checkRicorrenti(); }, 60000);

/* ---------------- avvio ---------------- */
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
// primo avvio: parte con reparti e prodotti tipici
if (!store.cfg && !store.ui.seeded && !Object.keys(store.server || {}).length) {
  store.server = {};
  computeState();
  for (const [p, v] of opsPredefiniti()) store.server = setPath(store.server, p, v);
}
store.ui.seeded = true;
save();
render();
if (location.hash.includes('db=')) {
  const { db, c } = leggiInvito(location.hash);
  history.replaceState(null, '', location.pathname + location.search);
  setTimeout(() => unisciti(db, c), 300);
}
if (store.cfg) sync(); else checkRicorrenti();
