// ==UserScript==
// @name         Cardmarket - Suivi des offres + filtres par défaut
// @namespace    raf.cardmarket
// @version      1.0.0
// @description  Flags couleur persistants sur les offres, alerte si prix/état modifié, filtres langue/état par défaut
// @match        https://www.cardmarket.com/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @updateURL    https://raw.githubusercontent.com/scripts-dr-strange/scripts-navigateur/main/cardmarket-suivi.user.js
// @downloadURL  https://raw.githubusercontent.com/scripts-dr-strange/scripts-navigateur/main/cardmarket-suivi.user.js
// ==/UserScript==

(function () {
  'use strict';

  const DEFAULTS = { auto: true, scroll: true, lang: 2, cond: 3 }; // 2 = Français, 3 = EX
  const LANGS = { 0: 'Toutes', 1: 'Anglais', 2: 'Français', 3: 'Allemand', 4: 'Espagnol', 5: 'Italien', 6: 'Chinois simplifié', 7: 'Japonais', 8: 'Portugais', 10: 'Coréen', 11: 'Chinois traditionnel' };
  const CONDS = { 0: 'Tous', 1: 'MT', 2: 'NM', 3: 'EX', 4: 'GD', 5: 'LP', 6: 'PL', 7: 'PO' };
  const STATUS = {
    sent: { label: 'Demande envoyée', color: '#2e9e44' },
    relance: { label: 'Relance 1', color: '#f2c200' },
    bad: { label: 'État non conforme', color: '#d93025' },
  };
  const FLAG = 'flag:';

  const settings = () => Object.assign({}, DEFAULTS, GM_getValue('settings', {}));
  const saveSettings = (patch) => GM_setValue('settings', Object.assign(settings(), patch));

  // ---------- Filtres ----------
  // Les noms de paramètres diffèrent entre fiche produit et page vendeur.
  function pageType(path = location.pathname) {
    if (/^\/[a-z]{2}\/[^/]+\/Products\/Singles\/[^/]+\/[^/]+\/?$/.test(path)) return { type: 'product', lang: 'language', cond: 'minCondition' };
    if (/^\/[a-z]{2}\/[^/]+\/Users\/[^/]+\/Offers\/Singles(\/.*)?$/.test(path)) return { type: 'seller', lang: 'idLanguages', cond: 'condition' };
    return null;
  }

  const store = {
    get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* ignoré */ } },
  };
  const markManual = () => store.set('cmf-manual', JSON.stringify({ path: location.pathname, t: Date.now() }));

  // true si l'on vient de la même page (changement de filtre, pagination) : on respecte le choix.
  function isSamePageNavigation() {
    try {
      if (document.referrer && new URL(document.referrer).pathname === location.pathname) return true;
      const m = JSON.parse(store.get('cmf-manual') || 'null');
      return !!m && m.path === location.pathname && Date.now() - m.t < 30000;
    } catch (e) { return false; }
  }

  const samePage = isSamePageNavigation();

  function applyDefaultsOnArrival() {
    const p = pageType();
    const s = settings();
    if (!p || !s.auto || samePage) return false;
    const url = new URL(location.href);
    let changed = false;
    if (Number(s.lang) && !url.searchParams.has(p.lang)) { url.searchParams.set(p.lang, s.lang); changed = true; }
    if (Number(s.cond) && Number(s.cond) < 7 && !url.searchParams.has(p.cond)) { url.searchParams.set(p.cond, s.cond); changed = true; }
    if (!changed) return false;
    // Garde-fou anti-boucle si le site retire un paramètre
    const last = JSON.parse(store.get('cmf-redirect') || 'null');
    if (last && last.url === url.href && Date.now() - last.t < 15000) return false;
    store.set('cmf-redirect', JSON.stringify({ url: url.href, t: Date.now() }));
    location.replace(url.href);
    return true;
  }

  if (applyDefaultsOnArrival()) return;

  // ---------- Lecture des lignes ----------
  const stripLang = (path) => path.replace(/^\/[a-z]{2}\//, '/');
  const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
  const parsePrice = (s) => {
    const n = parseFloat(String(s).replace(/[^\d,.]/g, '').replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  };

  function readRow(row) {
    const id = (row.id.match(/^(?:articleRow|stockRow)(\d+)$/) || [])[1];
    if (!id) return null;
    // Certaines offres ont une icône .color-primary devant le prix : on prend le texte du montant
    const priceEl = row.querySelector('.col-offer .price-container span.color-primary.text-nowrap') ||
      row.querySelector('.mobile-offer-container span.color-primary.text-nowrap');
    const condEl = row.querySelector('.article-condition');
    const condClass = condEl && condEl.className.match(/condition-([a-z]{2})\b/i);
    const p = pageType();
    let product = '';
    let seller = '';
    if (p && p.type === 'seller') {
      seller = decodeURIComponent(location.pathname.split('/')[4] || '');
      const a = row.querySelector('a[href*="/Products/Singles/"]');
      if (a) product = stripLang(new URL(a.getAttribute('href'), location.origin).pathname);
    } else {
      product = stripLang(location.pathname);
      seller = text(row.querySelector('.seller-name a'));
    }
    return {
      id,
      price: priceEl ? parsePrice(priceEl.textContent) : null,
      priceText: text(priceEl),
      cond: condClass ? condClass[1].toUpperCase() : text(condEl),
      comment: text(row.querySelector('.product-comments .text-truncate')),
      seller,
      product,
    };
  }

  // ---------- Stockage des flags ----------
  const getFlag = (id) => GM_getValue(FLAG + id, null);
  const allFlags = () => GM_listValues().filter((k) => k.startsWith(FLAG)).map((k) => GM_getValue(k)).filter(Boolean);
  const isRequest = (st) => st === 'sent' || st === 'relance';

  function setStatus(data, status) {
    const old = getFlag(data.id);
    // Demande envoyée -> Relance : on garde le prix et l'état de la demande d'origine
    const keep = old && isRequest(old.status) && isRequest(status);
    const snap = keep ? old : data;
    GM_setValue(FLAG + data.id, {
      id: data.id, status,
      price: snap.price, priceText: snap.priceText, cond: snap.cond,
      comment: data.comment, seller: data.seller, product: data.product,
      createdAt: keep ? old.createdAt : Date.now(),
      updatedAt: Date.now(),
    });
  }

  function acknowledge(data) {
    const f = getFlag(data.id);
    if (f) GM_setValue(FLAG + data.id, Object.assign({}, f, { price: data.price, priceText: data.priceText, cond: data.cond, updatedAt: Date.now() }));
  }

  function diff(flag, data) {
    const out = [];
    if (flag.price != null && data.price != null && Math.abs(flag.price - data.price) > 0.001) {
      const d = data.price - flag.price;
      out.push(`Prix : ${flag.priceText} → ${data.priceText} (${d > 0 ? '+' : ''}${d.toFixed(2).replace('.', ',')} €)`);
    }
    if (flag.cond && data.cond && flag.cond !== data.cond) out.push(`État : ${flag.cond} → ${data.cond}`);
    return out;
  }

  const fmtDate = (t) => new Date(t).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });

  // ---------- Interface ----------
  const CSS = `
    .article-row[data-cmf=sent]{background-color:#c9eecf!important;box-shadow:inset 6px 0 0 #2e9e44}
    .article-row[data-cmf=relance]{background-color:#fff1a8!important;box-shadow:inset 6px 0 0 #f2c200}
    .article-row[data-cmf=bad]{background-color:#f8c4c0!important;box-shadow:inset 6px 0 0 #d93025}
    .article-row[data-cmf=changed]{background-color:#ffd3a1!important;box-shadow:inset 6px 0 0 #f57c00}
    .article-row[data-cmf=suspect]{box-shadow:inset 6px 0 0 #f57c00}
    .cmf-btn{align-self:center;flex:0 0 auto;width:28px;height:28px;margin-left:6px;padding:0;border:1px solid #888;border-radius:5px;background:#fff;color:#333;cursor:pointer;line-height:1}
    .cmf-note{flex:0 0 100%;width:100%;padding:2px 10px 4px;font-size:12px;font-weight:600;color:#222}
    .cmf-note button,.cmf-bar button{margin-left:8px;padding:2px 9px;font-size:12px;border:1px solid #777;border-radius:4px;background:#fff;color:#222;cursor:pointer}
    .cmf-menu{position:absolute;z-index:100000;min-width:200px;padding:4px;background:#fff;color:#222;border:1px solid #999;border-radius:6px;box-shadow:0 6px 20px rgba(0,0,0,.25)}
    .cmf-menu button{display:flex;align-items:center;gap:8px;width:100%;padding:6px 8px;border:0;background:none;color:#222;text-align:left;font-size:13px;cursor:pointer}
    .cmf-menu button:hover{background:#eef2f7}
    .cmf-dot{display:inline-block;width:12px;height:12px;border-radius:50%}
    .cmf-bar{width:100%;margin:0 0 8px;padding:8px 10px;border:1px solid #9bb0c9;border-radius:6px;background:#eef4fb;color:#222;font-size:13px}
    .cmf-bar .cmf-line{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px}
    .cmf-bar label{display:flex;align-items:center;gap:4px;margin:0}
    .cmf-bar button{margin-left:0}
    .cmf-bar .cmf-primary{background:#0d5fb3;border-color:#0d5fb3;color:#fff}
    .cmf-bar details{margin-top:6px}
  `;

  function el(tag, props = {}, ...children) {
    const n = document.createElement(tag);
    Object.assign(n, props);
    n.append(...children);
    return n;
  }
  const button = (label, onClick, cls = '') => el('button', {
    type: 'button', className: cls, textContent: label,
    onclick: (e) => { e.preventDefault(); e.stopPropagation(); onClick(e); },
  });

  let menu = null;
  const closeMenu = () => { if (menu) { menu.remove(); menu = null; } };

  function openMenu(anchor, row) {
    closeMenu();
    const data = readRow(row);
    if (!data) return;
    const flag = getFlag(data.id);
    menu = el('div', { className: 'cmf-menu', onclick: (e) => e.stopPropagation() });
    const item = (label, color, action) => {
      const b = button(label, () => { action(); closeMenu(); renderAll(); });
      if (color) { const dot = el('span', { className: 'cmf-dot' }); dot.style.background = color; b.prepend(dot); }
      menu.append(b);
    };
    for (const [key, s] of Object.entries(STATUS)) item((flag && flag.status === key ? '✓ ' : '') + s.label, s.color, () => setStatus(data, key));
    if (flag && diff(flag, data).length) item('Valider le changement', null, () => acknowledge(data));
    if (flag) item('Retirer le flag', null, () => GM_deleteValue(FLAG + data.id));
    document.body.append(menu);
    const r = anchor.getBoundingClientRect();
    menu.style.top = `${r.bottom + window.scrollY + 4}px`;
    menu.style.left = `${Math.max(8, r.right + window.scrollX - menu.offsetWidth)}px`;
  }

  // Flag d'une annonce disparue du même vendeur sur la même carte : possible nouvel identifiant
  function findPredecessor(data, flags, visibleIds) {
    if (!data.seller || !data.product) return null;
    return flags.find((f) => !visibleIds.has(f.id) && f.seller === data.seller && f.product === data.product &&
      ((f.comment && f.comment === data.comment) || (f.price === data.price && f.cond === data.cond))) || null;
  }

  function renderRow(row, flags, visibleIds) {
    const data = readRow(row);
    if (!data) return;
    const host = row.querySelector('.col-offer') || row;
    if (!host.querySelector('.cmf-btn')) {
      const b = button('⚑', (e) => openMenu(e.currentTarget, row), 'cmf-btn');
      b.title = 'Suivi de cette offre';
      if (host !== row) host.classList.add('d-flex');
      host.append(b);
    }
    const flag = getFlag(data.id);
    const changes = flag ? diff(flag, data) : [];
    const old = flag ? null : findPredecessor(data, flags, visibleIds);
    const sig = JSON.stringify([flag && [flag.status, flag.updatedAt], changes, data.price, data.cond, old && old.id]);
    if (row.dataset.cmfSig === sig) return;
    row.dataset.cmfSig = sig;
    row.querySelectorAll(':scope > .cmf-note').forEach((n) => n.remove());
    delete row.dataset.cmf;
    const btn = host.querySelector('.cmf-btn');
    btn.style.background = '#fff';

    if (flag) {
      const changed = changes.length > 0;
      // "Non conforme" reste rouge ; demande et relance passent en orange en cas de changement
      row.dataset.cmf = changed && isRequest(flag.status) ? 'changed' : flag.status;
      btn.style.background = STATUS[flag.status].color;
      const note = el('div', { className: 'cmf-note' },
        `${STATUS[flag.status].label} - suivi depuis le ${fmtDate(flag.createdAt)}, mis à jour le ${fmtDate(flag.updatedAt)}`);
      if (changed) {
        note.append(el('div', { textContent: `⚠ Modifié depuis le flag - ${changes.join(' | ')}` }));
        note.lastChild.append(button('Valider le changement', () => { acknowledge(readRow(row)); renderAll(); }));
      }
      row.append(note);
    } else if (old) {
      row.dataset.cmf = 'suspect';
      const changes2 = diff(old, data);
      const note = el('div', { className: 'cmf-note' },
        `⚠ Possible annonce modifiée : ce vendeur avait une offre suivie (${STATUS[old.status].label}, ${old.cond}, ${old.priceText}) non affichée ici.` +
        (changes2.length ? ` ${changes2.join(' | ')}` : ''));
      note.append(button('Reprendre le suivi', () => {
        // On conserve l'ancien prix/état pour que la ligne passe en orange
        GM_setValue(FLAG + data.id, Object.assign({}, old, { id: data.id, comment: data.comment, updatedAt: Date.now() }));
        GM_deleteValue(FLAG + old.id);
        renderAll();
      }));
      row.append(note);
    }
  }

  // ---------- Barre en haut du listing ----------
  function goTo(lang, cond) {
    const p = pageType();
    const url = new URL(location.href);
    url.searchParams.delete('site');
    if (Number(lang)) url.searchParams.set(p.lang, lang); else url.searchParams.delete(p.lang);
    if (Number(cond)) url.searchParams.set(p.cond, cond); else url.searchParams.delete(p.cond);
    markManual();
    location.assign(url.href);
  }

  function select(options, value) {
    const s = el('select');
    Object.entries(options).forEach(([v, label]) => s.append(el('option', { value: v, textContent: label })));
    s.value = String(value);
    return s;
  }
  function checkbox(label, checked, onChange) {
    const c = el('input', { type: 'checkbox', checked });
    c.onchange = () => onChange(c.checked);
    return el('label', {}, c, label);
  }

  function exportFlags() {
    const blob = new Blob([JSON.stringify(allFlags(), null, 2)], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `cardmarket-flags-${new Date().toISOString().slice(0, 10)}.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function importFlags() {
    const input = el('input', { type: 'file', accept: '.json' });
    input.onchange = async () => {
      try {
        const list = JSON.parse(await input.files[0].text());
        const valid = list.filter((f) => f && /^\d+$/.test(f.id) && STATUS[f.status]);
        valid.forEach((f) => {
          const cur = getFlag(f.id);
          if (!cur || cur.updatedAt < f.updatedAt) GM_setValue(FLAG + f.id, f);
        });
        alert(`${valid.length} flag(s) lus.`);
        renderAll();
      } catch (e) { alert('Fichier invalide.'); }
    };
    input.click();
  }

  function buildBar() {
    if (!pageType() || document.querySelector('.cmf-bar')) return;
    const table = document.querySelector('.article-table');
    const anchor = table || document.querySelector('#table') || document.querySelector('main');
    if (!anchor) return;
    const s = settings();
    const lang = select(LANGS, s.lang);
    const cond = select(CONDS, s.cond);
    const bar = el('div', { className: 'cmf-bar' },
      el('div', { className: 'cmf-line' },
        el('label', {}, 'Langue', lang),
        el('label', {}, 'État minimum', cond),
        button('Appliquer et mémoriser', () => { saveSettings({ lang: Number(lang.value), cond: Number(cond.value) }); goTo(lang.value, cond.value); }, 'cmf-primary'),
        button('Juste cette page', () => goTo(lang.value, cond.value)),
        button('Sans filtre', () => goTo(0, 0)),
        checkbox('Filtres auto', s.auto, (v) => saveSettings({ auto: v })),
        checkbox('Aller au listing', s.scroll, (v) => saveSettings({ scroll: v })),
        button('Exporter', exportFlags),
        button('Importer', importFlags)),
      el('div', { className: 'cmf-missing' }));
    if (table) table.before(bar); else anchor.prepend(bar);
    if (s.scroll && !samePage) {
      const scroll = () => bar.scrollIntoView({ block: 'start' });
      scroll();
      window.addEventListener('load', scroll, { once: true });
    }
  }

  function renderMissing(flags, visibleIds) {
    const box = document.querySelector('.cmf-missing');
    const p = pageType();
    if (!box || !p || p.type !== 'product') return;
    const product = stripLang(location.pathname);
    const missing = flags.filter((f) => f.product === product && !visibleIds.has(f.id));
    const sig = JSON.stringify(missing.map((f) => [f.id, f.updatedAt]));
    if (box.dataset.sig === sig) return;
    box.dataset.sig = sig;
    box.replaceChildren();
    if (!missing.length) return;
    const details = el('details', {}, el('summary', { textContent: `⚠ ${missing.length} offre(s) suivie(s) non affichée(s) : filtres, "Show more results", vendue ou modifiée` }));
    missing.forEach((f) => {
      const line = el('div', {}, `${f.seller} - ${f.cond} - ${f.priceText} - ${STATUS[f.status].label} (${fmtDate(f.updatedAt)})`);
      line.append(button('Retirer', () => { GM_deleteValue(FLAG + f.id); renderAll(); }));
      details.append(line);
    });
    box.append(details);
  }

  function renderAll() {
    buildBar();
    const rows = [...document.querySelectorAll('.article-row')];
    const visibleIds = new Set(rows.map((r) => r.id.replace(/\D/g, '')));
    const flags = allFlags();
    rows.forEach((r) => renderRow(r, flags, visibleIds));
    // Pas d'alerte "absente" tant que le listing n'est pas chargé
    if (document.readyState !== 'loading') renderMissing(flags, visibleIds);
  }

  function init() {
    document.head.append(el('style', { textContent: CSS }));
    document.addEventListener('click', closeMenu);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
    document.addEventListener('submit', (e) => {
      const f = e.target;
      if (f.getAttribute('id') === 'FilterForm' || f.querySelector('[name="userInventoryFilterMode"]')) markManual();
    }, true);
    renderAll();
    // "Show more results" et autres chargements dynamiques
    let timer = null;
    new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(renderAll, 200); })
      .observe(document.body, { childList: true, subtree: true, characterData: true });
    // Resynchronise au retour sur l'onglet (flags posés ailleurs)
    document.addEventListener('visibilitychange', () => { if (!document.hidden) renderAll(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
