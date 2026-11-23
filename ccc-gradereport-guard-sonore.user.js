// ==UserScript==
// @name         CCC - Couleurs GradeReport (live) - VERSION SONORE
// @namespace    https://www.cccgrading.com/ccc-gradereport-guard-sonore
// @version      0.3.2
// @description  Listing : bouton de notation vert si tout est correct, rouge sombre si Refus. Pop-in : rien de coloré au départ ; à la première tentative sur un bouton en erreur il se colore, un message court s'affiche au-dessus et un son est demandé (un second clic passe).
// @match        https://www.cccgrading.com/*/admin/ecommerce/orders/*/show*
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/scripts-dr-strange/scripts-navigateur/main/ccc-gradereport-guard-sonore.user.js
// @downloadURL  https://raw.githubusercontent.com/scripts-dr-strange/scripts-navigateur/main/ccc-gradereport-guard-sonore.user.js
// ==/UserScript==

(function () {
  'use strict';

  const CFG = { seuilValeur: 100 };
  const COL = { grey: '#4d4d4d', green: '#188038', red: '#d93025', refus: '#7a0c0c', orange: '#f29900' };

  // ───────────────────────── Règles (fonctions pures) ─────────────────────────
  const SIDES = ['front', 'back'];
  const SIDE_FR = { front: 'recto', back: 'verso' };
  const PFX = 'card_order_item_evaluate';
  const SCALE = [10, 9.5, 9, 8.5, 8, 7, 6, 5, 4, 3, 2, 1];
  const WEAR_RANK = { none: 0, minimal: 1, light: 2, moderate: 3, significant: 4, heavy: 5 };
  const WEAR_FR = ['Aucune', 'Minime', 'Légère', 'Moyenne', 'Importante', 'Intense'];
  const WEAR_CAP = { 10: 0, 9.5: 1, 9: 1, 8.5: 1, 8: 2, 7: 2, 6: 3, 5: 3, 4: 4, 3: 4, 2: 5, 1: 5 };
  const KEYS = ['center', 'corner', 'side', 'surface'];
  const KEY_FR = { center: 'centrage', corner: 'coins', side: 'côtés', surface: 'surface' };

  const fmt = (n) => (n == null ? '?' : String(n).replace('.', ','));
  const num = (v) => {
    if (v == null) return null;
    const s = String(v).replace(/[\s ]/g, '').replace(',', '.').replace(/[^\d.\-]/g, '');
    if (s === '' || s === '-') return null;
    const n = parseFloat(s);
    return Number.isNaN(n) ? null : n;
  };
  const raise = (n) => { const i = SCALE.indexOf(n); return i < 0 ? null : i === 0 ? 10 : SCALE[i - 1]; };

  function expectedFinal(sub) {
    const arr = KEYS.map((k) => sub[k]).filter((v) => v != null);
    if (!arr.length) return null;
    const n10 = arr.filter((v) => v === 10).length;
    const n95 = arr.filter((v) => v === 9.5).length;
    const full = arr.length === 4;
    if (full && n95 === 2 && n10 === 2) return 10;
    if (full && sub.center === 9 && n10 === 3) return 10;
    if (full && sub.center === 8 && ['corner', 'side', 'surface'].every((k) => sub[k] === 9.5 || sub[k] === 10)) return 9;
    const min = Math.min(...arr);
    return arr.filter((v) => v === min).length === 1 ? raise(min) : min;
  }

  function expectedGoldBlack(sub, flags) {
    const flagged = KEYS.filter((k) => flags[k]);
    if (flagged.length === 0) {
      const v = KEYS.map((k) => sub[k]);
      if (v.every((x) => x === 10)) return 'Black';
      if (v.filter((x) => x === 10).length === 3 && v.filter((x) => x === 9.5).length === 1) return 'Gold';
      return null;
    }
    if (flagged.length === 1) {
      return KEYS.filter((k) => !flags[k]).every((k) => sub[k] === 10) ? 'Gold' : null;
    }
    return null;
  }

  // ───── lecture d'un formulaire de notation (document chargé ou formulaire ouvert) ─────
  const isChk = (e) => e.type === 'checkbox' || e.type === 'radio';
  function collect(root) {
    const m = {};
    root.querySelectorAll('[name^="' + PFX + '"]').forEach((e) => {
      const n = e.name.slice(PFX.length).replace(/\[\]$/, '');
      (m[n] = m[n] || []).push(e);
    });
    return m;
  }
  function scalar(m, n) {
    const els = m[n];
    if (!els) return null;
    if (els.some(isChk)) { const on = els.find((e) => isChk(e) && e.checked); return on ? on.value : null; }
    const e = els.find((x) => x.type !== 'hidden') || els[0];
    return e.value === '' ? null : e.value;
  }
  const isOn = (m, n) => !!m[n] && m[n].some((e) => isChk(e) && e.checked);
  const list = (m, n) => (m[n] || []).filter((e) => isChk(e) && e.checked).map((e) => e.value);

  function readState(root) {
    const m = collect(root);
    const nt = (k) => '[notation][' + k + ']';
    const st = {
      hasForm: Object.keys(m).length > 0,
      sub: {
        center: num(scalar(m, nt('centerNote'))), corner: num(scalar(m, nt('cornerNote'))),
        side: num(scalar(m, nt('sideNote'))), surface: num(scalar(m, nt('surfaceNote'))),
      },
      flags: {
        center: isOn(m, nt('centerNoteOc')) || isOn(m, nt('centerNoteMp')),
        corner: isOn(m, nt('cornerNoteMp')), side: isOn(m, nt('sideNoteMp')), surface: isOn(m, nt('surfaceNoteMp')),
      },
      cardNote: num(scalar(m, nt('cardNote'))),
      rejected: isOn(m, nt('rejected')), gold: isOn(m, nt('gold')), black: isOn(m, nt('black')),
      temp: (scalar(m, nt('temporaryComment')) || '').trim(),
      gr: {},
    };
    SIDES.forEach((s) => {
      const p = '[gradeReport][' + s + ']';
      const keys = Object.keys(m).filter((k) => k.startsWith(p + '['));
      st.gr[s] = {
        img: (m[p + '[image]'] || []).some((e) => !!e.value),
        dirs: list(m, p + '[centering][value]'),
        wear: scalar(m, p + '[wearLevel]'),
        comment: (scalar(m, p + '[comment]') || '').trim(),
        impact: keys.some((k) => !/\[(image|centering|wearLevel|comment)\]/.test(k.slice(p.length)) &&
          m[k].some((e) => isChk(e) && e.checked)),
      };
    });
    return st;
  }

  const calcSub = (st) => { const o = {}; KEYS.forEach((k) => { o[k] = st.flags[k] ? null : st.sub[k]; }); return o; };
  const notesComplete = (st) => st.cardNote != null && KEYS.every((k) => st.flags[k] || st.sub[k] != null);

  function expectedGR(card) {
    if (card.value == null) return { exp: null, why: 'valeur illisible' };
    if (card.value > CFG.seuilValeur) {
      return /authentif/i.test(card.service)
        ? { exp: false, why: 'service Authentification' }
        : { exp: true, why: 'valeur ' + fmt(card.value) + ' € > ' + CFG.seuilValeur + ' €' };
    }
    return card.optionGR
      ? { exp: true, why: 'option GradeReport' }
      : { exp: false, why: 'valeur ' + fmt(card.value) + ' € et pas d\'option GradeReport' };
  }

  // Erreurs de calcul (note finale, Gold/Black) - uniquement quand toutes les notes sont cochées
  function noteMsgs(st) {
    const msgs = [];
    const exp = expectedFinal(calcSub(st));
    if (exp != null && exp !== st.cardNote) {
      msgs.push('Note finale ' + fmt(st.cardNote) + ' incorrecte (attendue : ' + fmt(exp) + ').');
    }
    if (st.gold && st.black) {
      msgs.push("Gold et Black cochés en même temps.");
    } else {
      const actual = st.gold ? 'Gold' : st.black ? 'Black' : null;
      const wanted = expectedGoldBlack(st.sub, st.flags);
      if (actual !== wanted) {
        msgs.push('Gold/Black : ' + (actual ? actual + ' coché' : 'aucune case cochée') + ' - attendu : ' + (wanted || 'aucune case') + '.');
      }
    }
    return msgs;
  }

  // Règles propres au GR (kind = 'classic' | 'simple')
  // canvas (classique, en création) : { surface, corner, side } (booléens) ou undefined si le schéma est illisible
  function grMsgs(st, kind, canvas) {
    const msgs = [];
    const sub = calcSub(st);
    const others = ['corner', 'side', 'surface'].map((k) => sub[k]).filter((v) => v != null);
    const otherDefect = others.some((v) => v < 10);
    const hasCenter = SIDES.some((s) => st.gr[s].dirs.length > 0);

    // Le choix classique / simplifié appartient à l'opérateur : on ne contrôle que le centrage du classique.
    if (kind === 'classic') {
      SIDES.forEach((s) => { if (!st.gr[s].dirs.length) msgs.push('Centrage obligatoire au ' + SIDE_FR[s] + '.'); });
      if (canvas) {   // carte entière : un tracé sur le recto OU le verso suffit
        if (sub.surface != null && sub.surface < 10 && !canvas.surface) msgs.push('Surface < 10 : aucun label, tracé (draw) ni ligne (line) sur le schéma.');
        if (sub.corner != null && sub.corner < 10 && !canvas.corner) msgs.push('Coins < 10 : aucun tracé border sur un coin de la carte.');
        if (sub.side != null && sub.side < 10 && !canvas.side) msgs.push("Côtés < 10 : aucun tracé border le long d'un bord de la carte.");
      }
      return msgs;
    }

    if (st.cardNote != null && st.cardNote >= 9 && otherDefect) {
      msgs.push('Note finale ' + fmt(st.cardNote) + ' avec un défaut autre que le centrage : GR simplifié non autorisé.');
    }
    if (hasCenter) {                                           // simplifié « centrage »
      if (SIDES.some((s) => st.gr[s].wear && st.gr[s].wear !== 'none')) msgs.push("Usure recto/verso doit être 'Aucune' (défaut = centrage seul).");
      if (!SIDES.every((s) => st.gr[s].dirs.length > 0)) msgs.push('Centrage recto et verso à renseigner.');
      if (KEYS.every((k) => st.sub[k] === 10) && !SIDES.every((s) => st.gr[s].dirs.includes('valid'))) {
        msgs.push('Note parfaite : case centrale (valid) à cocher au recto et au verso.');
      }
      if (SIDES.some((s) => st.gr[s].impact)) msgs.push('Aucun élément impactant ne doit être coché (défaut = centrage seul).');
    } else {                                                   // simplifié « usure »
      const rk = (s) => (st.gr[s].wear in WEAR_RANK ? WEAR_RANK[st.gr[s].wear] : null);
      if (rk('front') == null || rk('back') == null) {
        msgs.push('Usure recto ET verso à renseigner.');
      } else {
        const worst = others.length ? Math.min(...others) : null;
        const top = Math.max(rk('front'), rk('back'));
        if (worst == null || !(worst in WEAR_CAP)) {
          msgs.push('Pire sous-note (' + fmt(worst) + ') hors table : usure à vérifier manuellement.');
        } else if (top > WEAR_CAP[worst]) {
          msgs.push('Usure ' + WEAR_FR[top] + ' trop sévère pour la pire sous-note ' + fmt(worst) + ' (max : ' + WEAR_FR[WEAR_CAP[worst]] + ').');
        }
        const justified = (s) => st.gr[s].impact || st.gr[s].comment;
        if (rk('front') > rk('back') && !justified('front')) msgs.push('Usure recto > verso : élément impactant ou commentaire à renseigner au recto.');
        if (rk('back') > rk('front') && !justified('back')) msgs.push('Usure verso > recto : élément impactant ou commentaire à renseigner au verso.');
      }
    }
    return msgs;
  }

  // Couleur du bouton de notation dans le listing : 'refus' | 'ok' | null
  // Vert = carte finalisée : toutes les notes cochées, note finale et Gold/Black corrects (indépendant du GR).
  function listingState(st) {
    if (!st) return null;
    if (st.rejected) return 'refus';
    return notesComplete(st) && !noteMsgs(st).length ? 'ok' : null;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { expectedFinal, expectedGoldBlack, noteMsgs, grMsgs, listingState, expectedGR, notesComplete };
  }
  if (typeof document === 'undefined') return;

  // ═════════════════════════ Interface ═════════════════════════
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const vis = (e) => !!e && e.offsetParent !== null;
  const cache = new Map();
  let cards = [];

  function paint(el, color) {
    if (!el) return;
    if (color) {
      el.style.setProperty('background-color', color, 'important');
      el.style.setProperty('border-color', color, 'important');
      el.style.setProperty('color', '#fff', 'important');
    } else {
      el.style.removeProperty('background-color');
      el.style.removeProperty('border-color');
      el.style.removeProperty('color');
    }
  }

  // ───── listing ─────
  function scanCards() {
    const table = $('table.table');
    if (!table) return [];
    const iVD = $$('thead th', table).map((t) => t.textContent.trim()).indexOf('VD');
    const out = [];
    let cur = null;
    $$('tbody > tr', table).forEach((tr) => {
      const numEl = $('.card-number', tr);
      if (numEl) {
        const btn = $('a[href*="edit_grade_report"]', tr);
        const m = btn && btn.getAttribute('href').match(/cards\/(\d+)\//);
        cur = {
          id: m ? m[1] : null, tr, btn, optText: '',
          valueTxt: ((tr.cells[iVD] && tr.cells[iVD].textContent) || '').trim(),
          service: (tr.cells[0] ? tr.cells[0].textContent : '').replace(numEl.textContent, '').trim(),
          hasPdf: !!$('a[href*="pdf_grade_report"]', tr),
        };
        cur.value = num(cur.valueTxt.replace(/€/g, ''));
        out.push(cur);
      } else if (cur && vis(tr)) {
        cur.optText += ' ' + tr.textContent;
      }
    });
    out.forEach((c) => { c.optionGR = /grade\s*report/i.test(c.optText); });
    return out.filter((c) => c.id);
  }

  async function loadCard(c) {
    try {
      const r = await fetch('/fr/admin/cards/' + c.id + '/edit_grade_report', {
        credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' },
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const st = readState(new DOMParser().parseFromString(await r.text(), 'text/html'));
      cache.set(c.id, st.hasForm ? st : null);
    } catch (e) { cache.set(c.id, null); }
  }
  async function loadAll(only) {
    const queue = (only || cards).slice();
    const worker = async () => { while (queue.length) await loadCard(queue.shift()); };
    await Promise.all([worker(), worker(), worker(), worker()]);
    renderListing();
  }
  function renderListing() {
    cards.forEach((c) => {
      const k = listingState(cache.get(c.id), c);
      paint(c.btn, k === 'refus' ? COL.refus : k === 'ok' ? COL.green : null);
    });
  }

  // ───── pop-in de notation ─────
  let cur = null;               // { form, wrapper, id }
  let attemptSig = null;        // état déjà signalé à l'utilisateur
  let passUntil = 0;
  let retryWarned = new Set();
  let bubble = null;
  let timer = null;
  let obs = null;

  function findPopin() {
    const form = $$('.popin-wrapper form[action*="edit_grade_report"]').find(vis);   // la pop-in fermée reste dans la page
    if (!form) return null;
    const m = (form.getAttribute('action') || '').match(/cards\/(\d+)\//);
    return { form, wrapper: form.closest('.popin-wrapper'), id: m ? m[1] : null };
  }

  // ───── schéma du GR classique (éditeur fabric.js de la pop-in) ─────
  // Chaque face expose `.report-canvas`.report : userObjects (ce que l'opérateur a dessiné) et _fabric (le canevas).
  // L'outil border produit un tracé identique à draw : on le distingue en notant l'outil actif au moment du tracé.
  const hooked = new WeakSet();
  const fabricOf = (r) => { try { return r && r._fabric; } catch (e) { return null; } };
  const reports = () => (cur ? $$('.report-canvas', cur.wrapper).map((h) => h.report).filter((r) => fabricOf(r)) : []);
  function activeTool() {
    const b = cur && $('.report-tools-button.is-active', cur.wrapper);
    if (!b) return 'move';
    if (b.hasAttribute('data-tool-border')) return 'border';
    if (b.hasAttribute('data-tool-draw')) return 'draw';
    if (b.hasAttribute('data-tool-line')) return 'line';
    return 'move';
  }
  function hookCanvases() {
    reports().forEach((r) => {
      if (hooked.has(r)) return;
      const f = fabricOf(r);
      if (!f.on) return;
      hooked.add(r);
      f.on('object:added', (e) => {
        const o = e && e.target;
        if (o && !o.__cccTool) o.__cccTool = (r.isBorderDrawing || activeTool() === 'border') ? 'border' : activeTool();
        schedule();
      });
      if (typeof r.on === 'function') r.on('canvas:updated', schedule);
    });
  }
  // Position d'un tracé border par rapport au cadre de la carte (objet « backgroundFrame », coins arrondis).
  // Coin = l'angle arrondi + une toute petite marge ; le reste du contour = côté.
  // Un tracé mixte (coin + côté) valide les deux. Un tracé loin du contour ne valide rien.
  const EDGE_TOL = 0.035;      // distance max au contour, en fraction de la largeur de la carte
  const CORNER_MARGIN = 0.012; // marge ajoutée au rayon d'arrondi pour définir le coin
  const SIDE_MIN = 0.02;       // longueur minimale de tracé « côté » (évite un simple débordement)
  function borderHits(o, frame) {
    const m = o.calcTransformMatrix();
    const raw = (o.path || []).map((c) => {
      const p = fabric.util.transformPoint(new fabric.Point(c[c.length - 2] - o.pathOffset.x, c[c.length - 1] - o.pathOffset.y), m);
      return [p.x, p.y];
    });
    const pts = [];
    raw.forEach((p, i) => {                                    // densification tous les ~3 px
      if (!i) { pts.push(p); return; }
      const a = raw[i - 1];
      const n = Math.max(1, Math.ceil(Math.hypot(p[0] - a[0], p[1] - a[1]) / 3));
      for (let k = 1; k <= n; k++) pts.push([a[0] + (p[0] - a[0]) * k / n, a[1] + (p[1] - a[1]) * k / n]);
    });
    const W = frame.width * (frame.scaleX || 1), H = frame.height * (frame.scaleY || 1);
    const L = frame.left, T = frame.top;
    const tol = Math.max(12, EDGE_TOL * W);
    const c = (frame.rx || 15) + Math.max(3, CORNER_MARGIN * W);
    let corner = false, sideLen = 0, prev = null;
    pts.forEach((p) => {
      const dx = Math.min(Math.abs(p[0] - L), Math.abs(p[0] - (L + W)));
      const dy = Math.min(Math.abs(p[1] - T), Math.abs(p[1] - (T + H)));
      const inX = p[0] >= L - tol && p[0] <= L + W + tol;
      const inY = p[1] >= T - tol && p[1] <= T + H + tol;
      if (!((inX && dy <= tol) || (inY && dx <= tol))) { prev = null; return; }   // pas sur le contour
      if (dx <= c && dy <= c) { corner = true; prev = null; return; }             // zone de coin
      if (prev) sideLen += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
      prev = p;
    });
    return { corner, side: sideLen >= Math.max(8, SIDE_MIN * W) };
  }
  function canvasMarks() {
    const rs = reports();
    if (!rs.length) return undefined;
    const marks = { surface: false, corner: false, side: false };
    rs.forEach((r) => {
      let objs = [];
      let frame = null;
      try { objs = r.userObjects || []; frame = fabricOf(r).getObjects().find((x) => x.name === 'backgroundFrame'); } catch (e) { /* illisible */ }
      objs.forEach((o) => {
        if (o.type === 'path' && o.__cccTool === 'border') {
          if (frame && typeof fabric !== 'undefined') {
            const h = borderHits(o, frame);
            if (h.corner) marks.corner = true;
            if (h.side) marks.side = true;
          } else { marks.corner = true; marks.side = true; }   // cadre illisible : on ne bloque pas
        } else if (['path', 'line', 'text', 'i-text', 'textbox'].indexOf(o.type) >= 0) marks.surface = true;
      });
    });
    return marks;
  }

  function evaluate() {
    const card = cards.find((c) => c.id === cur.id);
    if (!card) return null;
    const w = cur.wrapper;
    const st = readState(cur.form);
    const exp = expectedGR(card);
    const isNotation = vis($('.report-button-notation', w));
    const kind = vis($('.report-form-grade--simple', w)) ? 'simple' : vis($('.report-form-grade--complexe', w)) ? 'classic' : null;
    const grExists = card.hasPdf || vis($('.report-delete-button', w));
    const complete = notesComplete(st);
    const noteErrs = !st.rejected && complete ? noteMsgs(st) : [];
    const reds = [...noteErrs];
    if (!st.rejected) {
      if (isNotation) {
        if (exp.exp === true && !grExists) reds.push('GradeReport attendu : à créer.');
        if (exp.exp === false && grExists) reds.push('GradeReport non attendu mais présent.');
      } else if (kind) {
        if (exp.exp === false) reds.push('GradeReport non attendu (' + exp.why + ').');
        if (!complete) reds.push('Notation incomplète : cocher toutes les notes.');
        else reds.push(...grMsgs(st, kind, kind === 'classic' ? canvasMarks() : undefined));
      }
    }
    const orange = st.temp ? 'Commentaire temporaire présent' : null;
    return { st, exp, noteErrs, reds, orange, card, sig: reds.length ? 'R:' + reds.join('|') : orange ? 'O' : '' };
  }

  function msgBox() {
    let box = $('.ccc-msg', cur.wrapper);
    if (!box) {
      const sub = $('button[type=submit]', cur.wrapper);
      if (!sub) return null;
      box = document.createElement('div');
      box.className = 'ccc-msg';
      box.style.cssText = 'display:none;margin:0 0 6px auto;padding:5px 9px;border-radius:4px;font:12px/1.35 sans-serif;color:#fff;max-width:460px;text-align:left;white-space:pre-line;';
      sub.parentElement.insertBefore(box, sub);
    }
    return box;
  }
  function showMsg(lines, color) {
    const box = msgBox();
    if (!box) return;
    if (!lines.length) { box.style.display = 'none'; return; }
    box.textContent = lines.join('\n');
    box.style.background = color;
    box.style.display = 'block';
  }

  function update() {
    if (!cur) return;
    hookCanvases();
    const ev = evaluate();
    if (!ev) return;
    if (obs) obs.disconnect();
    const w = cur.wrapper;
    const sub = $('button[type=submit]', w);
    // Rien n'est coloré tant qu'il n'y a pas eu de tentative sur un bouton en erreur.
    // Boutons « Créer un GR » : gris seulement après un clic alors que le GR n'est pas attendu.
    $$('.report-retry-button', w).forEach((b) => {
      const key = b.getAttribute('data-report-retry') || b.textContent;
      paint(b, !ev.st.rejected && ev.exp.exp === false && retryWarned.has(key) ? COL.grey : null);
    });
    // Bouton principal : rouge / orange seulement après une tentative sur l'état courant.
    const attempted = attemptSig !== null && attemptSig === ev.sig;
    paint(sub, attempted ? (ev.reds.length ? COL.red : COL.orange) : null);
    if (attempted) {
      showMsg(ev.reds.length ? ev.reds : [ev.orange], ev.reds.length ? COL.red : COL.orange);
    } else {
      attemptSig = null;
      showMsg([], COL.red);
    }
    if (obs) obs.observe(w, { attributes: true, subtree: true, attributeFilter: ['class', 'style'] });
  }
  const schedule = () => { clearTimeout(timer); timer = setTimeout(update, 80); };

  // Son : délégué au 2e userscript (ccc-guard-sound), qui a accès au Drive local. Sans lui, rien ne se passe.
  const beep = (e) => { if (e && e.altKey) return; try {   // Option (Alt) maintenue pendant le clic : pas de son
       document.dispatchEvent(new CustomEvent('ccc-guard-sound')); } catch (e) { /* ignoré */ } };

  function hideBubble() { if (bubble) { bubble.remove(); bubble = null; } }
  function showBubble(target, text) {
    hideBubble();
    bubble = document.createElement('div');
    bubble.textContent = text;
    const r = target.getBoundingClientRect();
    bubble.style.cssText = 'position:fixed;z-index:100000;padding:5px 9px;border-radius:4px;background:' + COL.red +
      ';color:#fff;font:12px/1.35 sans-serif;max-width:360px;left:' + Math.max(8, r.left) + 'px;bottom:' + (window.innerHeight - r.top + 6) + 'px;';
    document.body.appendChild(bubble);
    setTimeout(hideBubble, 6000);
  }

  // Première tentative sur rouge/orange : on affiche le message et on bloque ; la seconde passe.
  function guardMain(e) {
    if (!cur || Date.now() < passUntil) return;
    const ev = evaluate();
    if (!ev || !ev.sig) return;
    if (attemptSig === ev.sig) { passUntil = Date.now() + 1500; return; }
    attemptSig = ev.sig;
    update();
    beep(e);
    e.preventDefault();
    e.stopImmediatePropagation();
  }
  function guardRetry(e, btn) {
    if (!cur) return;
    const ev = evaluate();
    if (!ev || ev.st.rejected || ev.exp.exp !== false) return;
    const key = btn.getAttribute('data-report-retry') || btn.textContent;
    if (retryWarned.has(key)) return;
    retryWarned.add(key);
    update();
    beep(e);
    showBubble(btn, 'GradeReport non attendu (' + ev.exp.why + '). Recliquer pour continuer.');
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  document.addEventListener('click', (e) => {
    hideBubble();
    if (!cur || !e.target.closest) return;
    const retry = e.target.closest('.report-retry-button');
    if (retry && cur.wrapper.contains(retry)) { guardRetry(e, retry); return; }
    const sub = e.target.closest('button[type=submit]');
    if (sub && cur.wrapper.contains(sub)) guardMain(e);
  }, true);
  ['input', 'change', 'click'].forEach((t) => document.addEventListener(t, () => { if (cur) schedule(); }, true));

  function onPopinChange() {
    const p = findPopin();
    if ((p && cur && p.form === cur.form && p.id === cur.id) || (!p && !cur)) return;
    if (cur) {                                    // fermeture : relecture serveur et recoloration du listing
      const closedId = cur.id;
      cur = null; attemptSig = null; retryWarned = new Set(); hideBubble();
      if (obs) obs.disconnect();
      setTimeout(() => {
        cards = scanCards();
        const c = cards.find((x) => x.id === closedId);
        renderListing();
        if (c) loadAll([c]);
      }, 800);
    }
    if (p) {
      cards = scanCards().length ? scanCards() : cards;   // état à jour (lien PDF, etc.)
      cur = p;
      attemptSig = null; retryWarned = new Set();
      p.form.addEventListener('submit', guardMain, true);
      obs = new MutationObserver(schedule);
      schedule();
    }
  }

  function init() {
    cards = scanCards();
    if (!cards.length) return;
    loadAll();
    let t;
    new MutationObserver(() => { clearTimeout(t); t = setTimeout(onPopinChange, 100); })
      .observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && !cur) loadAll(); });
  }
  init();
})();
