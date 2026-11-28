// ==UserScript==
// @name         Cardmarket - Suivi des offres + filtres par défaut
// @namespace    raf.cardmarket
// @version      1.3.0
// @description  Flags sur les offres, alerte si prix/état modifié, filtres par défaut, cartes favorites, messages types
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
  // color : bouton actif et liseré ; row : fond de ligne ; ink : couleur de l'icône sur le bouton actif ; icon : tracé SVG 24x24
  const STATUS = {
    sent: { label: 'Demande envoyée', short: 'Envoyée', color: '#2e9e44', row: '#c9eecf', ink: '#fff',
      icon: 'M22 2 11 13 M22 2 15 22 11 13 2 9 22 2' }, // avion en papier
    relance: { label: 'Relance 1', short: 'Relance', color: '#f2c200', row: '#fff1a8', ink: '#222',
      icon: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9 M13.7 21a2 2 0 0 1-3.4 0' }, // cloche
    bad: { label: 'État non conforme', short: 'Non conf.', color: '#d93025', row: '#f5aea8', ink: '#fff',
      icon: 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z M12 9v4 M12 17h.01' }, // alerte
    firm: { label: 'Non négociable', short: 'Non négo.', color: '#c8ad7f', row: '#efe3c8', ink: '#222',
      icon: 'M5 11h14v10H5z M8 11V7a4 4 0 0 1 8 0v4' }, // cadenas
    expensive: { label: 'Trop cher', short: 'Trop cher', color: '#ef9a9a', row: '#fce4e4', ink: '#222',
      icon: 'M18 6.5a7 7 0 1 0 0 11 M3 10h10 M3 14h8' }, // euro
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
    ${Object.entries(STATUS).map(([k, st]) => `.article-row[data-cmf=${k}]{background-color:${st.row}!important;box-shadow:inset 6px 0 0 ${st.color}}`).join('\n    ')}
    .article-row[data-cmf=changed]{background-color:#ffd3a1!important;box-shadow:inset 6px 0 0 #f57c00}
    .article-row[data-cmf=suspect]{box-shadow:inset 6px 0 0 #f57c00}
    .article-row[data-cmf] div:not(.cmf-side):not(.cmf-note){background-color:transparent!important}
    .article-row{position:relative}
    .article-row[data-cmf] .cmf-side,.article-row[data-cmf] .cmf-side div,.article-row .cmf-side,.article-row .cmf-side div{background-color:transparent!important;border:0!important;box-shadow:none!important}
    .article-row>.cmf-side{position:absolute;top:0;bottom:0;left:calc(100% + 16px);display:flex;align-items:center;gap:4px;width:var(--cmf-w,170px)!important;max-width:none!important;padding:0;white-space:nowrap}
    .cmf-btn{flex:0 0 auto;display:flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:1px solid #888;border-radius:5px;background:#fff;color:#555;cursor:pointer}
    .cmf-btn:hover{border-color:#222;color:#000}
    .cmf-btn svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;pointer-events:none}
    .cmf-note{display:flex;align-items:center;gap:5px;min-width:0;margin-left:3px;overflow:hidden;font-size:11px;line-height:1.2;color:#666}
    .cmf-note span{white-space:normal;max-height:2.4em;overflow:hidden}
    .cmf-note.cmf-alert{color:#b35400;font-weight:600}
    .cmf-note button{flex:0 0 auto;padding:0 5px;font-size:11px;line-height:15px;border:1px solid currentColor;border-radius:3px;background:#fff;color:inherit;cursor:pointer}
    .cmf-bar button{margin-left:8px;padding:2px 9px;font-size:12px;border:1px solid #777;border-radius:4px;background:#fff;color:#222;cursor:pointer}
    .cmf-bar{width:100%;margin:0 0 8px;padding:8px 10px;border:1px solid #9bb0c9;border-radius:6px;background:#eef4fb;color:#222;font-size:13px}
    .cmf-bar .cmf-line{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px}
    .cmf-bar label{display:flex;align-items:center;gap:4px;margin:0}
    .cmf-bar button{margin-left:0}
    .cmf-bar .cmf-primary{background:#0d5fb3;border-color:#0d5fb3;color:#fff}
    .cmf-bar details{margin-top:6px}
    .cmf-fav{margin-left:12px;padding:3px 10px;border:1px solid #b58900;border-radius:5px;background:#fff;color:#7a5c00;font-size:13px;font-weight:600;vertical-align:middle;cursor:pointer}
    .cmf-fav.cmf-on{background:#ffd54a;color:#222}
    .cmf-bar .cmf-fav{margin-left:0;border-color:#b58900}
    .cmf-bar .cmf-fav.cmf-on{background:#ffd54a}
    .cmf-home{margin:16px auto}
    .cmf-home h2{font-size:20px;margin-bottom:10px}
    .cmf-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:8px}
    .cmf-card{position:relative;border:1px solid #ccd5e0;border-radius:6px;background:#fff}
    .cmf-card a{display:flex;gap:10px;padding:6px 26px 6px 6px;color:#222;text-decoration:none}
    .cmf-card a:hover{background:#eef4fb}
    .cmf-card img{flex:0 0 46px;width:46px;height:64px;object-fit:cover;border-radius:3px;background:#e5e9ef}
    .cmf-card a span{display:flex;flex-direction:column;justify-content:center;min-width:0;line-height:1.35}
    .cmf-card strong{font-size:13px}
    .cmf-card small{font-size:11px;color:#666}
    .cmf-card small.cmf-price{color:#0d5fb3}
    .cmf-card .cmf-remove{position:absolute;top:3px;right:5px;padding:0 4px;border:0;background:none;color:#999;cursor:pointer}
    .cmf-msg{display:flex;flex-wrap:wrap;align-items:center;gap:6px;width:100%;padding:6px 8px;background:#eef4fb;border:1px solid #9bb0c9;border-radius:6px;font-size:12px}
    .cmf-msg input{padding:3px 6px;font-size:12px;border:1px solid #999;border-radius:4px;min-width:200px}
    .cmf-msg input.cmf-offer{min-width:0;width:90px}
    .cmf-tpls{display:contents}
    .cmf-msg button,.cmf-modal button{padding:3px 9px;font-size:12px;border:1px solid #777;border-radius:4px;background:#fff;color:#222;cursor:pointer}
    .cmf-msg button.cmf-primary,.cmf-modal button.cmf-primary{background:#0d5fb3;border-color:#0d5fb3;color:#fff}
    .cmf-modal{position:fixed;inset:0;z-index:100001;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45)}
    .cmf-modal>div{width:min(640px,94vw);max-height:90vh;overflow:auto;padding:16px;border-radius:8px;background:#fff;color:#222;font-size:13px}
    .cmf-tpl{margin-bottom:12px}
    .cmf-tpl>div{display:flex;gap:8px;margin-bottom:4px}
    .cmf-tpl input{flex:1;padding:4px 6px}
    .cmf-tpl textarea{width:100%;padding:6px;font-size:13px}
    .cmf-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px}
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

  function toggleStatus(row, status) {
    const data = readRow(row);
    if (!data) return;
    const flag = getFlag(data.id);
    if (flag && flag.status === status) GM_deleteValue(FLAG + data.id);
    else setStatus(data, status);
    renderAll();
  }

  function icon(path) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', path);
    svg.append(p);
    return svg;
  }

  function buildSide(row) {
    const buttons = Object.entries(STATUS).map(([key, st]) => {
      const b = button('', () => toggleStatus(row, key), 'cmf-btn');
      b.dataset.status = key;
      b.append(icon(st.icon));
      return b;
    });
    const side = el('div', { className: 'cmf-side' }, ...buttons, el('div', { className: 'cmf-note' }));
    row.append(side);
    return side;
  }

  // Les boutons vivent à droite du listing : on réserve la place si la fenêtre est étroite
  function layout() {
    const table = document.querySelector('.article-table');
    if (!table) return;
    const MIN = 280; // 5 boutons + note sur deux lignes
    const width = document.documentElement.clientWidth;
    table.style.marginRight = '';
    let space = width - table.getBoundingClientRect().right;
    if (space < MIN) {
      table.style.marginRight = `${Math.ceil(MIN - space)}px`;
      space = width - table.getBoundingClientRect().right;
    }
    document.documentElement.style.setProperty('--cmf-w', `${Math.max(250, Math.floor(space) - 22)}px`);
  }

  const day = (t) => new Date(t).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
  function shortDiff(flag, data) {
    const out = [];
    if (flag.price != null && data.price != null && Math.abs(flag.price - data.price) > 0.001) out.push(`${flag.priceText.replace(/\s*€/, '')}→\u200b${data.priceText}`);
    if (flag.cond && data.cond && flag.cond !== data.cond) out.push(`${flag.cond}→${data.cond}`);
    return out.join(' · ');
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
    const side = row.querySelector(':scope > .cmf-side') || buildSide(row);
    const flag = getFlag(data.id);
    const changes = flag ? diff(flag, data) : [];
    const old = flag ? null : findPredecessor(data, flags, visibleIds);
    const sig = JSON.stringify([flag && [flag.status, flag.updatedAt], changes, data.price, data.cond, old && old.id]);
    if (side.dataset.sig === sig) return;
    side.dataset.sig = sig;
    delete row.dataset.cmf;
    side.querySelectorAll('.cmf-btn').forEach((b) => {
      const key = b.dataset.status;
      const on = !!flag && flag.status === key;
      b.setAttribute('aria-pressed', on);
      b.style.background = on ? STATUS[key].color : '';
      b.style.borderColor = on ? STATUS[key].color : '';
      b.style.color = on ? STATUS[key].ink : '';
      b.title = on ? `${STATUS[key].label} (cliquer pour retirer)` : STATUS[key].label;
    });
    const note = side.querySelector('.cmf-note');
    note.replaceChildren();
    note.className = 'cmf-note';
    note.title = '';

    if (flag) {
      const changed = changes.length > 0;
      // Seules demande et relance passent en orange ; les autres statuts gardent leur couleur (note orange)
      row.dataset.cmf = changed && isRequest(flag.status) ? 'changed' : flag.status;
      note.title = `${STATUS[flag.status].label}\nSuivi depuis le ${fmtDate(flag.createdAt)}\nMis à jour le ${fmtDate(flag.updatedAt)}`;
      if (changed) {
        note.classList.add('cmf-alert');
        note.title += `\n${changes.join('\n')}`;
        const ok = button('OK', () => { acknowledge(readRow(row)); renderAll(); });
        ok.title = 'Valider le changement';
        note.append(ok, el('span', { textContent: shortDiff(flag, data) }));
      } else {
        note.append(el('span', { textContent: `${STATUS[flag.status].short} ${day(flag.updatedAt)}` }));
      }
    } else if (old) {
      row.dataset.cmf = 'suspect';
      note.classList.add('cmf-alert');
      note.title = `Possible annonce modifiée : ce vendeur avait une offre suivie (${STATUS[old.status].label}, ${old.cond}, ${old.priceText}) non affichée ici.\n${diff(old, data).join('\n')}`;
      const take = button('Reprendre', () => {
        // On conserve l'ancien prix/état pour que la ligne passe en orange
        GM_setValue(FLAG + data.id, Object.assign({}, old, { id: data.id, comment: data.comment, updatedAt: Date.now() }));
        GM_deleteValue(FLAG + old.id);
        renderAll();
      });
      note.append(take, el('span', { textContent: '⚠ Annonce modifiée ?' }));
    }
  }

  // ---------- Cartes favorites ----------
  const FAV = 'fav:';
  const gameOf = (productPath) => productPath.split('/')[1] || '';
  const langPrefix = () => location.pathname.split('/')[1] || 'en';
  const favorites = () => GM_listValues().filter((k) => k.startsWith(FAV)).map((k) => GM_getValue(k)).filter(Boolean);

  function readCard() {
    const p = pageType();
    const h1 = document.querySelector('.page-title-container h1') || document.querySelector('main h1');
    if (!p || p.type !== 'product' || !h1) return null;
    const first = [...h1.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
    const name = (first ? first.textContent : text(h1)).replace(/\s+/g, ' ').trim();
    const set = text(h1.querySelector('span:not(.cmf-fav-wrap)')).replace(/\s+-\s+[^-]+$/, '');
    const idProduct = (document.querySelector('input[name="idProduct"]') || {}).value;
    const og = document.querySelector('meta[property="og:image"]');
    const match = idProduct && [...document.querySelectorAll('.card-image img')].find((i) => i.src.split('?')[0].endsWith(`/${idProduct}.jpg`));
    const img = (match && match.src) || (og && og.content) || '';
    const path = stripLang(location.pathname).replace(/\/$/, '');
    return { path, game: gameOf(path), name, set, img };
  }

  // Prix le plus bas affiché, avec les filtres en cours
  function lowestOffer() {
    const offers = [...document.querySelectorAll('.article-row')].map(readRow).filter((d) => d && d.price != null);
    if (!offers.length) return null;
    const best = offers.reduce((a, b) => (b.price < a.price ? b : a));
    const q = new URL(location.href).searchParams;
    const filters = [CONDS[q.get('minCondition')], LANGS[q.get('language')]].filter(Boolean).join(' ');
    return { from: best.priceText, filters };
  }

  const favKey = (card) => FAV + card.path;
  function toggleFavorite() {
    const card = readCard();
    if (!card) return;
    if (GM_getValue(favKey(card), null)) GM_deleteValue(favKey(card));
    else GM_setValue(favKey(card), Object.assign({}, card, lowestOffer(), { addedAt: Date.now(), seenAt: Date.now() }));
    renderAll();
  }

  function favButton() {
    const b = button('', toggleFavorite, 'cmf-fav');
    return b;
  }

  function renderProductExtras() {
    const card = readCard();
    if (!card) return;
    const h1 = document.querySelector('.page-title-container h1') || document.querySelector('main h1');
    if (!h1.querySelector('.cmf-fav')) h1.append(favButton());
    const bar = document.querySelector('.cmf-bar .cmf-line');
    if (bar && !bar.querySelector('.cmf-fav')) bar.prepend(favButton());
    const fav = GM_getValue(favKey(card), null);
    document.querySelectorAll('.cmf-fav').forEach((b) => {
      const label = fav ? '★ Dans les favoris' : '☆ Ajouter aux favoris';
      if (b.textContent !== label) b.textContent = label;
      b.classList.toggle('cmf-on', !!fav);
      b.title = fav ? 'Retirer des favoris' : 'Ajouter la carte aux favoris';
    });
    const offer = lowestOffer();
    if (fav && offer && (fav.from !== offer.from || fav.filters !== offer.filters || fav.img !== card.img)) {
      GM_setValue(favKey(card), Object.assign({}, fav, card, offer, { seenAt: Date.now() }));
    }
    // Historique des cartes consultées : sert à préremplir les messages
    const sellers = [...new Set([...document.querySelectorAll('.article-row .seller-name a')].map(text))];
    const recent = GM_getValue('recent', []);
    const entry = { path: card.path, name: card.name, sellers };
    if (JSON.stringify(recent[0]) !== JSON.stringify(entry)) {
      GM_setValue('recent', [entry, ...recent.filter((r) => r.path !== card.path)].slice(0, 30));
    }
  }

  function renderHome() {
    const m = location.pathname.match(/^\/[a-z]{2}\/([^/]+)\/?$/);
    const main = document.querySelector('main');
    if (!m || !main) return;
    const list = favorites().filter((f) => f.game === m[1]).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    const sig = JSON.stringify(list);
    let box = main.querySelector('.cmf-home');
    if (box && box.dataset.sig === sig) return;
    if (!box) {
      box = el('section', { className: 'cmf-home container' });
      const carousel = main.querySelector('#marketingCarousel');
      if (carousel) carousel.after(box); else main.prepend(box);
    }
    box.dataset.sig = sig;
    const grid = el('div', { className: 'cmf-grid' });
    list.forEach((f) => {
      const thumb = el('img', { alt: '', loading: 'lazy' });
      if (/^https:\/\/[a-z0-9.-]*cardmarket\.com\//.test(f.img)) thumb.src = f.img;
      const link = el('a', { href: `/${langPrefix()}${f.path}` }, thumb,
        el('span', {},
          el('strong', { textContent: f.name }),
          el('small', { textContent: f.set || '' }),
          el('small', { className: 'cmf-price', textContent: f.from ? `Dès ${f.from}${f.filters ? ` (${f.filters})` : ''} - vu le ${day(f.seenAt)}` : '' })));
      const remove = button('✕', () => { GM_deleteValue(favKey(f)); renderAll(); }, 'cmf-remove');
      remove.title = 'Retirer des favoris';
      grid.append(el('div', { className: 'cmf-card' }, link, remove));
    });
    box.replaceChildren(el('h2', { textContent: `★ Mes cartes favorites (${list.length})` }),
      list.length ? grid : el('p', { textContent: 'Aucune favorite pour ce jeu. Utilise "☆ Ajouter aux favoris" sur la page d\'une carte.' }));
  }

  // ---------- Messages types ----------
  const OUTRO = 'N\'hésitez pas à m\'indiquer les défauts que vous voyez 🙏 Merci beaucoup 😊\n\nMerci';
  const DEFAULT_TEMPLATES = [
    { title: 'Photos + NM-/NM', text: `Bonjour,\n\nJe suis potentiellement intéressé par votre {carte}\n\nAuriez-vous des photos s'il vous plait :) ?\n\nAfin de savoir si c'est plutôt un NM- ou plutôt un NM sans aucune rayure\n\n${OUTRO}` },
    { title: 'Recto / verso', text: `Bonjour,\n\nEst-ce possible d'avoir des photos recto/verso de votre {carte} svp ? :)\nJe cherche à m'assurer qu'elle ne soit pas rayée et jamais posée sur une table sans pochette.\n\n${OUTRO}` },
    { title: 'Verso rayures', text: `Bonjour,\n\nEst-ce possible d'avoir des photos du verso de votre {carte} svp ? :) Principalement le verso avec une lumière qui révèlerait les rayures au back\n\nEst-ce plutôt un NM- ou plutôt un NM sans aucune rayure ?\n\n${OUTRO}` },
    { title: 'Offre de prix', text: 'Bonjour,\n\nJe suis potentiellement intéressé par votre {carte}\nAccepteriez-vous une offre à {prix} € ? Je me permets car il y a eu quelques ventes à ce prix-là récemment sur les groupes FB\n\nMerci pour votre considération 😊' },
  ];
  const templates = () => GM_getValue('templates', DEFAULT_TEMPLATES);

  function sellerFromPage() {
    const m = location.pathname.match(/\/Account\/Messages\/([^/]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  // Cartes probables pour ce vendeur : suivies, puis consultées chez lui, puis le reste
  function cardSuggestions(seller) {
    const recent = GM_getValue('recent', []);
    const names = new Map(recent.concat(favorites()).map((c) => [c.path, c.name]));
    const slug = (path) => (path || '').replace(/\/$/, '').split('/').pop().replace(/-/g, ' ');
    const flagged = allFlags().filter((f) => f.seller === seller).sort((a, b) => b.updatedAt - a.updatedAt)
      .map((f) => names.get(f.product) || slug(f.product));
    const seen = recent.filter((r) => (r.sellers || []).includes(seller)).map((r) => r.name);
    const likely = [...new Set(flagged.concat(seen))].filter(Boolean);
    return { best: likely[0] || '', all: [...new Set(likely.concat(recent.map((r) => r.name)))].filter(Boolean) };
  }

  function insertTemplate(area, tpl, card, price) {
    if (area.value.trim() && area.value !== area.dataset.cmfLast && !confirm('Remplacer le message en cours ?')) return;
    const values = { carte: card.trim() || '___', prix: price.trim().replace(/\s*€$/, '') || '___', vendeur: sellerFromPage() };
    const message = tpl.text.replace(/\{(carte|prix|vendeur)\}/g, (m, k) => values[k]);
    area.value = message;
    area.dataset.cmfLast = area.value;
    area.dispatchEvent(new Event('input', { bubbles: true }));
    area.style.height = `${Math.min(area.scrollHeight + 4, window.innerHeight * 0.45)}px`;
    area.focus();
    const hole = area.value.indexOf('___');
    if (hole >= 0) area.setSelectionRange(hole, hole + 3);
    if (area.maxLength > 0 && message.length > area.maxLength) alert(`Message trop long : ${message.length} / ${area.maxLength} caractères.`);
  }

  function openEditor(onSaved) {
    if (document.querySelector('.cmf-modal')) return;
    const list = el('div');
    const addItem = (t) => {
      const title = el('input', { type: 'text', value: t.title, placeholder: 'Nom du bouton' });
      const body = el('textarea', { value: t.text, rows: 7 });
      const item = el('div', { className: 'cmf-tpl' });
      item.append(el('div', {}, title, button('Supprimer', () => item.remove())), body);
      list.append(item);
    };
    templates().forEach(addItem);
    const modal = el('div', { className: 'cmf-modal' });
    const save = () => {
      const next = [...list.children].map((item) => ({ title: item.querySelector('input').value.trim() || 'Sans nom', text: item.querySelector('textarea').value }))
        .filter((t) => t.text.trim());
      GM_setValue('templates', next);
      modal.remove();
      onSaved();
    };
    modal.append(el('div', {},
      el('h3', { textContent: 'Mes messages types' }),
      el('p', { textContent: 'Variables remplacées à l\'insertion : {carte}, {prix}, {vendeur}' }),
      list,
      el('div', { className: 'cmf-actions' },
        button('+ Ajouter un message', () => { addItem({ title: '', text: 'Bonjour,\n\n' }); list.lastChild.querySelector('input').focus(); }),
        button('Remettre les 4 d\'origine', () => { if (confirm('Remplacer la liste par les messages d\'origine ?')) { list.replaceChildren(); DEFAULT_TEMPLATES.forEach(addItem); } }),
        button('Annuler', () => modal.remove()),
        button('Enregistrer', save, 'cmf-primary'))));
    document.body.append(modal);
  }

  function renderMessages() {
    const area = document.querySelector('textarea[name="textMessage"]');
    if (!area || !area.form || document.querySelector('.cmf-msg')) return;
    const suggestions = cardSuggestions(sellerFromPage());
    const card = el('input', { type: 'text', value: suggestions.best, placeholder: 'Nom de la carte' });
    card.setAttribute('list', 'cmf-cards');
    const cards = el('datalist', { id: 'cmf-cards' }, ...suggestions.all.map((n) => el('option', { value: n })));
    const price = el('input', { type: 'text', inputMode: 'decimal', placeholder: 'Prix offre', className: 'cmf-offer' });
    const buttons = el('span', { className: 'cmf-tpls' });
    const fill = () => buttons.replaceChildren(...templates().map((t) => {
      const b = button(t.title, () => insertTemplate(area, t, card.value, price.value));
      b.title = t.text;
      return b;
    }));
    fill();
    // Entrée dans un champ ne doit pas envoyer le message
    [card, price].forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); }));
    area.form.before(el('div', { className: 'cmf-msg' }, card, cards, price, buttons,
      button('✎ Modifier / ajouter', () => openEditor(fill), 'cmf-primary')));
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

  function exportData() {
    const data = { flags: allFlags(), favorites: favorites(), templates: templates() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `cardmarket-suivi-${new Date().toISOString().slice(0, 10)}.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function importData() {
    const input = el('input', { type: 'file', accept: '.json' });
    input.onchange = async () => {
      try {
        const data = JSON.parse(await input.files[0].text());
        // Les anciens exports ne contenaient que la liste des flags
        const list = Array.isArray(data) ? data : data.flags || [];
        const valid = list.filter((f) => f && /^\d+$/.test(f.id) && STATUS[f.status]);
        valid.forEach((f) => {
          const cur = getFlag(f.id);
          if (!cur || cur.updatedAt < f.updatedAt) GM_setValue(FLAG + f.id, f);
        });
        const favs = (data.favorites || []).filter((f) => f && typeof f.path === 'string' && f.name);
        favs.forEach((f) => GM_setValue(favKey(f), f));
        if (Array.isArray(data.templates) && data.templates.every((t) => t && typeof t.text === 'string') &&
          confirm('Remplacer aussi les messages types par ceux du fichier ?')) GM_setValue('templates', data.templates);
        alert(`${valid.length} flag(s) et ${favs.length} favori(s) lus.`);
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
        button('Exporter', exportData),
        button('Importer', importData)),
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
    layout();
    renderHome();
    renderMessages();
    if (document.readyState !== 'loading') renderProductExtras();
    // Pas d'alerte "absente" tant que le listing n'est pas chargé
    if (document.readyState !== 'loading') renderMissing(flags, visibleIds);
  }

  function init() {
    document.head.append(el('style', { textContent: CSS }));
    window.addEventListener('resize', layout);
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
