/* Tour Commune — service worker : application installable, consultable hors connexion.

   GABARIT. publier.sh écrit dans la copie publiée VERSION (date de la publication) et FICHIERS (chemin → empreinte
   SHA-256 tronquée à 16 caractères de chaque fichier publié). Tel quel (03_Site, développement) il ne fait rien et se
   désinscrit ; installer.js ne l'enregistre d'ailleurs que sur la version publiée.

   - Précache : tous les fichiers de FICHIERS, clé = chemin + empreinte. Un fichier inchangé d'une publication à l'autre
     est repris du cache précédent sans rien télécharger ; chaque téléchargement est vérifié contre son empreinte.
   - index.html : réseau d'abord (3 s), mais seule la page de CETTE publication est servie. Si le réseau annonce une autre
     publication, la page en cache (cohérente avec les fichiers en cache) est servie ; la nouvelle version s'installe en
     arrière-plan, attend, et installer.js propose « Recharger ».
   - Fichiers publiés : cache d'abord. Autres ressources du site : cache à la demande (60 entrées au plus, 15 Mo par fichier).
   - Jamais de réponse d'erreur, partielle (Range) ou opaque en cache. Anciens caches supprimés à l'activation.
   - Retrait : si l'origine sert les sources de développement (importmap) ou si la publication n'a plus de sw.js (404),
     le worker se désinscrit, vide ses caches et laisse tout passer au réseau, même s'il est redémarré entre-temps.
     Pour retirer l'application proprement, on peut aussi publier ce gabarit tel quel comme sw.js. */
const VERSION = "202609250834";
const FICHIERS = {"app.202609250834.js":"58d469b8af1b4986","assets/contexte.json":"632526c838a5b09c","assets/favicon.png":"da5b7aa6860a0732","assets/Fracktif-Light.woff":"1811ebf470263fe5","assets/Fracktif-LightItalic.woff":"1aed2a5dbcc6bb8f","assets/Fracktif-Medium.woff":"6ca4388a3c7e2b26","assets/Fracktif-Regular.woff":"d759c23e3d674578","assets/icones/apple-touch-icon.png":"d6eaa7b032d42778","assets/icones/icone-192.png":"416b85e86572d415","assets/icones/icone-512.png":"9d4cd5031cd664a4","assets/icones/icone-maskable-192.png":"1a6cedc19da349e3","assets/icones/icone-maskable-512.png":"7587a09f7bfe81e6","assets/interieur.json":"00682978a369c086","assets/metro.json":"09f3897f73c43156","assets/remplaces.json":"583d6076f1dbf0ec","assets/rendus/rendus.json":"cbf4f3613b87a518","assets/sol_horizon.jpg":"95fafd70afe2f1e8","assets/sol_loin_fondu.jpg":"89d91309367f2cc2","assets/sol_loin.jpg":"bd31f2778fc47f7c","assets/sol_proche.jpg":"a4d46e89e26f6a8f","assets/terrain.glb":"f7d57b1dcfa28efb","assets/tour.glb":"598c20c839862ec8","assets/vegetation.json":"5db3ecd10fe2e89b","assets/vlau-logo-blanc.png":"2086a34fe4659ac1","assets/vlau-logo.png":"c84b6080617a8d32","index.html":"2db95bbde4657793","installer.css":"98ff042ba6061b91","installer.js":"077a55c3bb15bfbc","manifest.webmanifest":"c76195b962ffc0b9","style.202609250834.css":"cb4f74d4de9fafff"};
const PREFIXE = "tour-commune-";
const CACHE = PREFIXE + VERSION;
const DEMANDE = CACHE + "-demande";
const DEMANDE_MAX = 60;
const TAILLE_MAX = 15e6;
const DELAI = 3000;
const BASE = new URL("./", self.location.href).href;
const DEV = VERSION === "dev";
let retire = false;                            // retiré (voir plus haut) : ce worker ne sert plus rien
let enService = null;                          // promesse « le cache de cette version existe » : faux après un retrait,
                                               // y compris quand le navigateur a redémarré le worker (retire est alors perdu)

const cle = (chemin) => BASE + chemin + "?e=" + FICHIERS[chemin];
const bon = (r) => !!r && r.ok && r.status === 200 && r.type === "basic";
const trouver = (k) => caches.match(k, { ignoreVary: true });

async function empreinte(corps) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", corps));
  return Array.from(h.slice(0, 8), (o) => o.toString(16).padStart(2, "0")).join("");
}

// Télécharge un fichier publié en vérifiant son empreinte : d'abord par le cache HTTP (ce que la page vient de charger
// n'est pas retéléchargé), puis en contournant tous les caches (l'hébergeur sert parfois quelques minutes une ancienne copie).
async function telecharger(chemin) {
  for (const [url, cache] of [[BASE + chemin, "default"], [cle(chemin), "reload"]]) {
    const r = await fetch(url, { cache });
    if (!bon(r)) continue;
    const copie = r.clone();
    if ((await empreinte(await r.arrayBuffer())) === FICHIERS[chemin]) return copie;
  }
  throw new Error("précache impossible : " + chemin);
}

self.addEventListener("install", (e) => {
  if (DEV) return void self.skipWaiting();
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const file = Object.keys(FICHIERS);
    const ouvrier = async () => {
      for (let c; (c = file.pop()); ) {
        if (await cache.match(cle(c), { ignoreVary: true })) continue;
        await cache.put(cle(c), (await trouver(cle(c))) || (await telecharger(c)));
      }
    };
    await Promise.all([ouvrier(), ouvrier(), ouvrier(), ouvrier()]);   // 4 téléchargements à la fois
  })());
});

self.addEventListener("activate", (e) => e.waitUntil((async () => {
  for (const n of await caches.keys()) if (n.startsWith(PREFIXE) && n !== CACHE && n !== DEMANDE) await caches.delete(n);
  if (DEV) return void (await self.registration.unregister());
  const cache = await caches.open(CACHE), valides = new Set(Object.keys(FICHIERS).map(cle));
  for (const k of await cache.keys()) if (!valides.has(k.url)) await cache.delete(k);
  await self.clients.claim();
})()));

self.addEventListener("message", (e) => { if (e.data === "activer") self.skipWaiting(); });

self.addEventListener("fetch", (e) => {
  const r = e.request;
  if (DEV || retire || r.method !== "GET" || !r.url.startsWith(BASE) || r.headers.has("range")) return;
  const url = new URL(r.url);
  const chemin = decodeURIComponent(url.pathname.slice(new URL(BASE).pathname.length));
  const estPage = chemin === "" || chemin === "index.html";
  if (!estPage && (r.mode === "navigate" || chemin === "sw.js")) return;
  e.respondWith((async () => {
    // cache de cette version disparu (retrait avant un redémarrage du worker, ou stockage vidé) : on s'efface ; à la
    // visite suivante, installer.js réenregistre le service worker si la page publiée le demande
    if (!(await (enService || (enService = caches.has(CACHE))))) { retirer(); return fetch(r); }
    if (estPage) return page(r);
    if (FICHIERS[chemin] && !url.search) return publie(chemin, r, e);
    return aLaDemande(r, e);
  })());
});

const avant = (promesse) => Promise.race([promesse.catch(() => null), new Promise((ok) => setTimeout(ok, DELAI, null))]);

async function page(r) {
  const locale = await trouver(cle("index.html"));
  if (!locale) return fetch(r);
  try {
    const rep = await avant(fetch(r.url, { cache: "reload", credentials: "same-origin" }));   // copie du serveur, sans cache HTTP
    if (!bon(rep)) return locale;          // hors connexion, réseau trop lent ou erreur du serveur
    const corps = await rep.clone().arrayBuffer();
    if ((await empreinte(corps)) === FICHIERS["index.html"]) return rep;
    // autre page que celle de cette publication : sources de développement, ou publication sans sw.js (sinon l'ancienne
    // version resterait servie indéfiniment : le navigateur garde le worker actif quand sw.js répond 404) → on s'efface
    if (new TextDecoder().decode(corps).includes('type="importmap"') || (await avant(fetch(BASE + "sw.js", { cache: "no-store" })))?.status === 404) {
      retirer();
      return rep;
    }
    return locale;                         // nouvelle publication : elle s'installe en arrière-plan, installer.js propose « Recharger »
  } catch {
    return locale;
  }
}

async function publie(chemin, r, e) {
  const trouve = await trouver(cle(chemin));
  if (trouve) return trouve;
  const rep = await fetch(r);              // copie absente (quota, nettoyage du navigateur) : réseau, rangée si l'empreinte est la bonne
  if (bon(rep)) {
    const [a, b] = [rep.clone(), rep.clone()];
    e.waitUntil(a.arrayBuffer().then(empreinte).then(async (h) => { if (h === FICHIERS[chemin] && !retire) await (await caches.open(CACHE)).put(cle(chemin), b); }));
  }
  return rep;
}

async function aLaDemande(r, e) {
  const cache = await caches.open(DEMANDE);
  const trouve = await cache.match(r, { ignoreVary: true });
  if (trouve) return trouve;
  const rep = await fetch(r);
  if (bon(rep) && !retire && Number(rep.headers.get("content-length") || 0) <= TAILLE_MAX) {
    e.waitUntil(cache.put(r, rep.clone()).then(async () => {
      const cles = await cache.keys();
      for (const k of cles.slice(0, Math.max(0, cles.length - DEMANDE_MAX))) await cache.delete(k);
    }));
  }
  return rep;
}

function retirer() {
  retire = true;                               // unregister() n'agit qu'à la fermeture de la page : on s'efface dès maintenant
  enService = Promise.resolve(false);
  self.registration.unregister();
  caches.keys().then((ns) => ns.filter((n) => n.startsWith(PREFIXE)).forEach((n) => caches.delete(n)));
}
