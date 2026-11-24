// ==UserScript==
// @name         CCC - Son d'erreur (pour la version sonore)
// @namespace    https://www.cccgrading.com/ccc-gradereport-guard-sonore
// @version      0.3.0
// @description  Demande au service local du Mac (installé par installer_lanceurs.command) de jouer le son d'erreur, avec les mêmes règles que le script de téléchargement.
// @match        https://www.cccgrading.com/*/admin/ecommerce/orders/*/show*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @updateURL    https://raw.githubusercontent.com/scripts-dr-strange/scripts-navigateur/main/ccc-gradereport-guard-sonore-son.user.js
// @downloadURL  https://raw.githubusercontent.com/scripts-dr-strange/scripts-navigateur/main/ccc-gradereport-guard-sonore-son.user.js
// ==/UserScript==

// Le son est joué par le Mac lui-même (afplay, volume forcé à 80 %, muet levé puis remis) via un petit
// service local installé par installer_lanceurs.command : voir sa section "3d". Ce userscript ne fait
// qu'envoyer la demande à http://127.0.0.1:47321/play ; sans le service, il ne se passe rien.
// La première fois, Tampermonkey peut demander l'autorisation de se connecter à 127.0.0.1 : "Toujours autoriser".

(function () {
  'use strict';
  const URL_PLAY = 'http://127.0.0.1:47321/play';
  let last = 0;

  function play(url) {
    if (Date.now() - last < 500) return;      // évite une double demande sur un même clic
    last = Date.now();
    GM_xmlhttpRequest({
      method: 'GET',
      url,
      timeout: 3000,
      onerror: () => { try { console.debug('[CCC son] service local injoignable (installer_lanceurs.command lancé sur ce Mac ?)'); } catch (e) { /* ignoré */ } },
      ontimeout: () => { /* ignoré */ },
    });
  }
  document.addEventListener('ccc-guard-sound', () => play(URL_PLAY));
  // Option + clic sans erreur : son aléatoire du dossier Sounds/chicken (rien si le dossier est vide ou absent)
  document.addEventListener('ccc-guard-sound-chicken', () => play(URL_PLAY + '?c=1'));
})();
