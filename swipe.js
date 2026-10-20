/* =========================================================
   Tri rapide : swipe façon Tinder sur le catalogue et les fiches.
   Contrat DOM / CSS : /home/claude/agents/site/SWIPE.md
   Dépend de window.BIB (app.js) et de window.Catalogue (catalogue.js).
   ========================================================= */
(() => {
  "use strict";

  const BIB = window.BIB;
  if (!BIB) { console.error("swipe.js : window.BIB introuvable (app.js doit être chargé avant)."); return; }

  const PAR_PAGE = 30;
  const SEUIL_RATIO = 0.3;          // part de la largeur de carte
  const DISTANCE_RAPIDE = 40;       // px : distance mini si le geste est rapide
  const VITESSE_RAPIDE = 0.8;       // px / ms
  const SEUIL_CLIC = 6;             // px : en dessous, ce n'est pas un glisser
  const DELAI_SORTIE = 350;         // ms
  const PROFONDEUR_ANNULER = 10;
  const COLONNES = "qid,titre,annee,type,createur,genre,image_url,nb_personnes,bande_annonce";
  const LIBELLE_TYPE = { film: "Film", serie: "Série", video: "Vidéo", article: "Article", autre: "Autre" };
  const PILES = {
    "suggestions":     { libelle: "Suggestions — peut-être vus", statut: "incertain", tag: "suggestion" },
    "catalogue-film":  { libelle: "Catalogue — films",  catalogue: true, type: "film" },
    "catalogue-serie": { libelle: "Catalogue — séries", catalogue: true, type: "serie" },
    "catalogue-tout":  { libelle: "Catalogue — tout",   catalogue: true, type: null },
    "incertains":      { libelle: "Mes Incertains",     statut: "incertain", sansTag: "suggestion" },
    "a-voir":          { libelle: "Mes À voir",         statut: "a_voir" },
  };

  // Fiches de la bibliothèque qui composent une pile (statut + tag éventuel)
  const suggestionsRetirees = new Set();   // fiches passées en « Non vus » depuis le chargement
  const dansPile = (def) => (c) => {
    if (suggestionsRetirees.has(c.id)) return false;
    if (c.statut !== def.statut) return false;
    const tags = Array.isArray(c.tags) ? c.tags : [];
    if (def.tag && !tags.includes(def.tag)) return false;
    if (def.sansTag && tags.includes(def.sansTag)) return false;
    return true;
  };
  const esc = (s) => BIB.echapper(s);
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const iconeDe = (type) => BIB.ICONES[type] || BIB.ICONES.film;
  const typeDe = (t) => (["film", "serie", "video", "article"].includes(t) ? t : "autre");
  const idYoutube = (url) => {
    const m = String(url || "").match(/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{6,20})/);
    return m ? m[1] : null;
  };
  const sousTitre = (o) => [o.createur, o.genre].filter(Boolean).map(esc).join(" · ");
  const personnesTxt = (n) => `${n} personne${n > 1 ? "s" : ""} que tu connais`;

  function depuisCatalogue(l) {
    return {
      source: "catalogue", ligne: l, qid: l.qid, titre: l.titre, annee: l.annee, type: typeDe(l.type),
      createur: l.createur, genre: l.genre, image_url: l.image_url, nb: l.nb_personnes || 0,
      bande: l.bande_annonce || null, el: null,
    };
  }
  function depuisContenu(c) {
    return {
      source: "contenu", id: c.id, titre: c.titre, annee: c.annee, type: typeDe(c.type),
      createur: c.createur, genre: c.genre, image_url: c.image_url, nb: 0,
      bande: c.bande_annonce || null, statut: c.statut, date_visionnage: c.date_visionnage,
      nb_visionnages: c.nb_visionnages, fiche: c, el: null,
    };
  }

  /* ---------- Construction du DOM (une seule fois) ---------- */
  const DOM = `
  <div class="swipe-panneau">
    <header class="swipe-entete">
      <button class="swipe-retour" type="button" hidden>← Piles</button>
      <h2 id="swipe-titre" class="swipe-titre">Tri rapide</h2>
      <span class="swipe-compteur"></span>
      <button class="btn-icone swipe-fermer" type="button" aria-label="Fermer"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
    </header>
    <div class="swipe-choix">
      ${Object.entries(PILES).map(([cle, d]) => `<button class="swipe-pile" type="button" data-pile="${cle}"><span class="swipe-pile-nom">${esc(d.libelle)}</span><span class="swipe-pile-nb">…</span></button>`).join("")}
    </div>
    <div class="swipe-zone" hidden>
      <div class="swipe-pile-cartes" aria-live="polite"></div>
      <div class="swipe-actions">
        <button class="swipe-btn swipe-btn-pasvu" type="button" aria-label="Pas vu (flèche gauche)">✕<span>Pas vu</span></button>
        <button class="swipe-btn swipe-btn-avoir" type="button" aria-label="À voir (flèche haut)">★<span>À voir</span></button>
        <button class="swipe-btn swipe-btn-vu" type="button" aria-label="Vu (flèche droite)">✓<span>Vu</span></button>
      </div>
      <button class="swipe-annuler" type="button" disabled>↶ Annuler</button>
    </div>
    <div class="swipe-fin" hidden><p class="swipe-fin-titre">Tout est trié !</p><button class="btn-or swipe-fin-choisir" type="button">Choisir une autre pile</button></div>
    <p class="swipe-chargement" hidden>Chargement…</p>
  </div>`;

  const racine = document.createElement("div");
  racine.className = "swipe";
  racine.setAttribute("role", "dialog");
  racine.setAttribute("aria-modal", "true");
  racine.setAttribute("aria-labelledby", "swipe-titre");
  racine.hidden = true;
  racine.innerHTML = DOM;
  document.body.append(racine);

  const $ = (s) => racine.querySelector(s);
  const titreEl = $("#swipe-titre");
  const compteurEl = $(".swipe-compteur");
  const retourBtn = $(".swipe-retour");
  const choix = $(".swipe-choix");
  const zone = $(".swipe-zone");
  const cartesEl = $(".swipe-pile-cartes");
  const annulerBtn = $(".swipe-annuler");
  const btnAvoir = $(".swipe-btn-avoir");
  const fin = $(".swipe-fin");
  const chargementEl = $(".swipe-chargement");

  /* ---------- État ---------- */
  const etat = {
    ouvert: false,
    pile: null,          // { cle, def, catalogue, type, lus, retires, fin, enCours, total, faits }
    file: [],            // cartes à trier, la première est au-dessus
    historique: [],      // décisions annulables
    modifie: false,      // une action a réussi pendant cette ouverture
    avant: null,         // élément à re-focaliser à la fermeture
    lecteur: false,
    lecteurCarte: null,
  };
  const enAttente = new Set();

  /* ---------- Rendu ---------- */
  function creerCarte(o) {
    const el = document.createElement("article");
    el.className = "swipe-carte";
    const affiche = o.image_url
      ? `<img src="${esc(o.image_url)}" alt="" draggable="false">`
      : `<div class="affiche-vide">${iconeDe(o.type)}</div>`;
    const pastilles = [`<span class="pastille or">${esc(LIBELLE_TYPE[o.type] || "Autre")}</span>`];
    if (o.annee) pastilles.push(`<span class="pastille">${esc(o.annee)}</span>`);
    const ba = idYoutube(o.bande)
      ? `<button class="swipe-ba" type="button">▶ Bande-annonce</button>`
      : `<p class="swipe-avert">Bande-annonce introuvable pour l'instant</p>`;
    el.innerHTML = `
      <div class="swipe-affiche">${affiche}</div>
      <div class="swipe-tampon swipe-tampon-vu">VU</div>
      <div class="swipe-tampon swipe-tampon-pasvu">PAS VU</div>
      <div class="swipe-tampon swipe-tampon-avoir">À VOIR</div>
      <div class="swipe-infos">
        <div class="swipe-pastilles">${pastilles.join("")}</div>
        <h3 class="swipe-carte-titre">${esc(o.titre)}</h3>
        <p class="swipe-carte-sous">${sousTitre(o)}</p>
        ${o.nb ? `<p class="swipe-carte-meta">${personnesTxt(o.nb)}</p>` : ""}
        ${ba}
      </div>
      <div class="swipe-lecteur" hidden><iframe title="Bande-annonce"></iframe><button class="swipe-lecteur-fermer" type="button" aria-label="Fermer la bande-annonce">×</button></div>`;
    const img = el.querySelector(".swipe-affiche img");
    if (img) img.addEventListener("error", () => {
      const v = document.createElement("div");
      v.className = "affiche-vide";
      v.innerHTML = iconeDe(o.type);
      img.replaceWith(v);
    }, { once: true });
    return el;
  }

  // Aligne le DOM sur la file : carte du dessus = .est-dessus, suivante = .est-suivante.
  // Les cartes en sortie (data-sortie) gardent leur place jusqu'à leur retrait.
  function majDeck() {
    const visibles = etat.file.slice(0, 2);
    visibles.forEach((o) => { if (!o.el) o.el = creerCarte(o); });
    [...cartesEl.children].forEach((el) => {
      if (el.dataset.sortie) return;
      if (!visibles.some((o) => o.el === el)) el.remove();
    });
    for (let i = visibles.length - 1; i >= 0; i--) {   // ajout en fin de conteneur : la carte du dessus est la dernière
      const el = visibles[i].el;
      el.dataset.index = String(i);
      el.classList.toggle("est-dessus", i === 0);
      el.classList.toggle("est-suivante", i === 1);
      cartesEl.appendChild(el);
    }
    precharger();
    majAnnuler();
  }

  function sortir(el, dir) {
    if (!el) return;
    el.dataset.sortie = "1";
    el.classList.remove("glisse", "est-dessus", "est-suivante");
    el.classList.add(dir === "vu" ? "part-droite" : dir === "pasvu" ? "part-gauche" : "part-haut");
    let retire = false;
    const retirer = () => { if (retire) return; retire = true; el.remove(); };
    el.addEventListener("transitionend", (e) => { if (e.target === el) retirer(); }, { once: true });
    setTimeout(retirer, DELAI_SORTIE);
  }

  function afficherTampons(carte, dir, v) {
    if (!carte) return;
    const f = (cls, actif) => { const t = carte.querySelector(cls); if (t) t.style.opacity = actif ? String(v) : "0"; };
    f(".swipe-tampon-vu", dir === "vu");
    f(".swipe-tampon-pasvu", dir === "pasvu");
    f(".swipe-tampon-avoir", dir === "avoir");
  }

  function majCompteur() {
    const p = etat.pile;
    compteurEl.textContent = p && p.total != null ? `${p.faits} / ${p.total}` : "";
  }
  function majAnnuler() {
    annulerBtn.disabled = !etat.pile || etat.historique.length === 0;
  }
  function majChargement() {
    const p = etat.pile;
    chargementEl.hidden = !(p && p.enCours && etat.file.length === 0);
  }
  function verifierFin() {
    const p = etat.pile;
    if (!p) return;
    majChargement();
    const fini = etat.file.length === 0 && p.fin && !p.enCours;
    fin.hidden = !fini;
    zone.hidden = fini;
    if (fini) fin.querySelector(".swipe-fin-choisir").focus();
  }
  function precharger() {
    etat.file.slice(1, 3).forEach((o) => { if (o.image_url) { const i = new Image(); i.src = o.image_url; } });
  }

  /* ---------- Piles ---------- */
  async function compterCatalogue(type) {
    let q = BIB.sb.from("catalogue").select("qid", { count: "exact", head: true }).is("decision", null);
    if (type) q = q.eq("type", type);
    const { count, error } = await q;
    return error ? null : count;
  }

  function afficherChoix() {
    etat.pile = null;
    etat.file = [];
    etat.historique = [];
    cartesEl.innerHTML = "";
    fermerLecteur();
    titreEl.textContent = "Tri rapide";
    choix.hidden = false;
    zone.hidden = true;
    fin.hidden = true;
    chargementEl.hidden = true;
    retourBtn.hidden = true;
    compteurEl.textContent = "";
    for (const [cle, def] of Object.entries(PILES)) {
      const nb = $(`[data-pile="${cle}"] .swipe-pile-nb`);
      if (def.statut) {
        nb.textContent = String(BIB.contenus.filter(dansPile(def)).length);
      } else {
        nb.textContent = "…";
        compterCatalogue(def.type).then((n) => { nb.textContent = n == null ? "—" : String(n); });
      }
    }
    const premier = $(".swipe-pile");
    if (premier && racine.contains(document.activeElement) === false) premier.focus();
    else if (premier && !choix.contains(document.activeElement)) premier.focus();
  }

  function demarrer(cle) {
    const def = PILES[cle];
    if (!def) return;
    const p = { cle, def, catalogue: !!def.catalogue, type: def.type || null, lus: 0, retires: 0, fin: false, enCours: false, total: null, faits: 0 };
    etat.pile = p;
    etat.file = [];
    etat.historique = [];
    cartesEl.innerHTML = "";
    titreEl.textContent = def.libelle;
    choix.hidden = true;
    zone.hidden = false;
    fin.hidden = true;
    retourBtn.hidden = false;
    btnAvoir.hidden = cle === "a-voir";      // « À voir » n'est pas proposé sur Mes À voir
    retourBtn.focus();
    majCompteur();
    majAnnuler();

    if (p.catalogue) {
      compterCatalogue(p.type).then((n) => { if (etat.pile === p) { p.total = n ?? 0; majCompteur(); } });
      chargerPlus();
    } else {
      etat.file = BIB.contenus.filter(dansPile(def)).map(depuisContenu);
      p.total = etat.file.length;
      p.fin = true;
      majDeck();
      majCompteur();
      verifierFin();
    }
  }

  // Page suivante du catalogue. Les lignes décidées sortent de la liste : le décalage
  // se calcule donc avec lus - retires (sinon une carte serait sautée).
  async function chargerPlus() {
    const p = etat.pile;
    if (!p || !p.catalogue || p.fin || p.enCours) return;
    p.enCours = true;
    majChargement();
    const debut = Math.max(0, p.lus - p.retires);
    let q = BIB.sb.from("catalogue").select(COLONNES).is("decision", null);
    if (p.type) q = q.eq("type", p.type);
    const { data, error } = await q
      .order("nb_personnes", { ascending: false })
      .order("qid", { ascending: true })
      .range(debut, debut + PAR_PAGE - 1);
    p.enCours = false;
    if (etat.pile !== p) return;
    if (error) {
      BIB.toast("Chargement impossible. Réessaie.");
      majChargement();
      return;
    }
    p.lus += data.length;
    if (data.length < PAR_PAGE) p.fin = true;
    data.forEach((l) => etat.file.push(depuisCatalogue(l)));
    majDeck();
    majCompteur();
    verifierFin();
  }

  /* ---------- Actions en base (optimistes, en arrière-plan) ---------- */
  // Renvoie { restaurer, annuler } si l'action a réussi, null sinon.
  async function faireAction(p, o, dir) {
    if (o.source === "catalogue") {
      if (dir === "pasvu") {
        const qid = o.qid;
        const r = await BIB.sb.from("catalogue").update({ decision: "pas_vu", decide_le: new Date().toISOString() }).eq("qid", qid);
        if (r.error) return null;
        p.retires++;
        return {
          restaurer: true,
          annuler: async () => {
            const u = await BIB.sb.from("catalogue").update({ decision: null, decide_le: null }).eq("qid", qid);
            if (u.error) return false;
            p.retires = Math.max(0, p.retires - 1);
            return true;
          },
        };
      }
      const champs = dir === "vu"
        ? { statut: "termine", date_visionnage: BIB.aujourdhui(), nb_visionnages: 1 }
        : { statut: "a_voir" };
      if (!window.Catalogue) return null;
      const id = await window.Catalogue.passerDansBibliotheque(o.ligne, champs);
      if (!id) return null;
      p.retires++;
      // La ligne a quitté le catalogue : on ne peut pas la remettre, on supprime seulement la fiche.
      return {
        restaurer: false,
        annuler: async () => { const r = await BIB.sb.from("contenus").delete().eq("id", id); return !r.error; },
      };
    }

    // Fiches de la bibliothèque
    // Suggestions « pas vu » : la fiche quitte la bibliothèque et rejoint l'onglet « Non vus »
    if (dir === "pasvu" && p.cle === "suggestions") return suggestionPasVue(o);

    let champs;
    if (dir === "pasvu") {
      if (p.cle === "a-voir") return { restaurer: true, annuler: null };   // on passe, rien à modifier
      champs = { statut: "a_voir" };
    } else if (dir === "vu") {
      champs = { statut: "termine", date_visionnage: o.date_visionnage || BIB.aujourdhui(), nb_visionnages: Math.max(1, o.nb_visionnages || 0) };
    } else {
      champs = { statut: "a_voir" };   // « À voir » (Incertains)
    }
    const avant = { statut: o.statut, date_visionnage: o.date_visionnage, nb_visionnages: o.nb_visionnages };
    const ok = await BIB.majContenu(o.id, champs);
    if (!ok) return null;
    return { restaurer: true, annuler: () => BIB.majContenu(o.id, avant) };
  }

  async function suggestionPasVue(o) {
    const f = o.fiche;
    if (!f) return null;
    const qid = f.wikidata || null;
    if (qid) {
      const ligne = {
        qid, titre: f.titre, annee: f.annee, type: f.type, createur: f.createur, genre: f.genre,
        image_url: f.image_url, bande_annonce: f.bande_annonce, producteur: f.producteur,
        acteurs_principaux: f.acteurs_principaux, enrichi: true, affiche_faite: true, ba_faite: true,
        yt_fait: true, casting_fait: true, liens_faits: true,
        decision: "pas_vu", decide_le: new Date().toISOString(),
      };
      const ins = await BIB.sb.from("catalogue").upsert(ligne, { onConflict: "user_id,qid" });
      if (ins.error) return null;
    }
    const del = await BIB.sb.from("contenus").delete().eq("id", f.id);
    if (del.error) {
      if (qid) await BIB.sb.from("catalogue").delete().eq("qid", qid);
      return null;
    }
    suggestionsRetirees.add(f.id);
    return {
      restaurer: true,
      annuler: async () => {
        const { episodes, ...copie } = f;   // « episodes » vient d'une jointure, pas d'une colonne
        const r = await BIB.sb.from("contenus").insert(copie);
        if (r.error) return false;
        suggestionsRetirees.delete(f.id);
        if (qid) await BIB.sb.from("catalogue").delete().eq("qid", qid);
        return true;
      },
    };
  }

  function remettreEnTete(o) {
    o.el = null;   // l'ancien élément peut être en sortie : on repart d'une carte neuve
    etat.file.unshift(o);
    majDeck();
    verifierFin();
  }

  function decider(dir) {
    const p = etat.pile;
    const o = etat.file[0];
    if (!p || !o || etat.lecteur) return;
    if (dir === "avoir" && p.cle === "a-voir") return;
    etat.file.shift();
    const el = o.el;
    o.el = null;
    sortir(el, dir);

    const entree = { obj: o, dir, annuler: null, restaurer: true, promesse: null };
    entree.promesse = faireAction(p, o, dir).then((res) => {
      enAttente.delete(entree.promesse);
      if (!res) {
        const i = etat.historique.indexOf(entree);
        if (i >= 0) etat.historique.splice(i, 1);
        if (etat.pile === p) {
          p.faits = Math.max(0, p.faits - 1);
          remettreEnTete(o);
          majCompteur();
        }
        BIB.toast("Action impossible. Réessaie.");
        return false;
      }
      entree.annuler = res.annuler;
      entree.restaurer = res.restaurer;
      etat.modifie = true;
      return true;
    });
    enAttente.add(entree.promesse);

    p.faits++;
    etat.historique.push(entree);
    if (etat.historique.length > PROFONDEUR_ANNULER) etat.historique.shift();
    majDeck();
    majCompteur();
    if (etat.file.length <= 5) chargerPlus();
    verifierFin();
  }

  async function annuler() {
    const p = etat.pile;
    if (!p) return;
    const e = etat.historique.pop();
    majAnnuler();
    if (!e) return;
    const ok = await e.promesse;
    if (!ok || etat.pile !== p) return;   // échec déjà signalé, ou on a quitté la pile
    let reussi = true;
    if (e.annuler) reussi = await e.annuler();
    if (!reussi) {
      etat.historique.push(e);
      majAnnuler();
      BIB.toast("Action impossible. Réessaie.");
      return;
    }
    if (etat.pile !== p) return;
    p.faits = Math.max(0, p.faits - 1);
    if (e.restaurer) {
      remettreEnTete(e.obj);
      BIB.toast("Annulé");
    } else {
      BIB.toast("Annulé (l'œuvre a quitté le catalogue)");
    }
    majCompteur();
    majAnnuler();
  }

  /* ---------- Glisser (Pointer Events) ---------- */
  let geste = null;

  function directionDe(dx, dy, pile) {
    if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? "vu" : "pasvu";
    if (dy < 0 && pile !== "a-voir") return "avoir";
    return null;
  }

  function surDown(e) {
    if (etat.lecteur || !etat.pile) return;
    const carte = e.target.closest(".swipe-carte");
    if (!carte || !carte.classList.contains("est-dessus") || carte.dataset.sortie) return;
    if (e.target.closest("button, iframe, a, .swipe-lecteur")) return;   // les boutons restent cliquables
    if (e.button > 0) return;
    geste = { carte, id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: performance.now(), dx: 0, dy: 0, actif: false };
    try { carte.setPointerCapture(e.pointerId); } catch (_) { /* ignoré */ }
  }

  function surMove(e) {
    if (!geste || e.pointerId !== geste.id) return;
    const g = geste;
    g.dx = e.clientX - g.x0;
    g.dy = e.clientY - g.y0;
    if (!g.actif) {
      if (Math.hypot(g.dx, g.dy) < SEUIL_CLIC) return;
      g.actif = true;
      g.carte.classList.add("glisse");
    }
    const c = g.carte;
    c.style.transform = `translate(${g.dx}px, ${g.dy}px) rotate(${g.dx / 20}deg)`;
    const seuil = c.offsetWidth * SEUIL_RATIO || 1;
    const dir = directionDe(g.dx, g.dy, etat.pile && etat.pile.cle);
    const dist = dir === "avoir" ? -g.dy : Math.abs(g.dx);
    afficherTampons(c, dir, clamp01(dist / seuil));
  }

  function surUp(e) {
    if (!geste || e.pointerId !== geste.id) return;
    const g = geste;
    geste = null;
    try { g.carte.releasePointerCapture(e.pointerId); } catch (_) { /* ignoré */ }
    if (!g.actif) return;                       // simple clic : ne décide rien
    g.carte.classList.remove("glisse");
    const dir = e.type === "pointercancel" ? null : directionDe(g.dx, g.dy, etat.pile && etat.pile.cle);
    const dist = dir === "avoir" ? -g.dy : Math.abs(g.dx);
    const seuil = g.carte.offsetWidth * SEUIL_RATIO || 1;
    const duree = Math.max(1, performance.now() - g.t0);
    const rapide = dist >= DISTANCE_RAPIDE && dist / duree >= VITESSE_RAPIDE;
    if (dir && (dist >= seuil || rapide) && g.carte === etat.file[0]?.el) {
      decider(dir);
    } else {
      g.carte.style.transform = "";           // retour au centre (transition CSS)
      afficherTampons(g.carte, null, 0);
    }
  }

  /* ---------- Bande-annonce ---------- */
  function ouvrirLecteur(carte) {
    const o = etat.file[0];
    const id = o && idYoutube(o.bande);
    if (!carte || !id) return;
    const lecteur = carte.querySelector(".swipe-lecteur");
    const iframe = lecteur.querySelector("iframe");
    iframe.setAttribute("allow", "autoplay; encrypted-media; picture-in-picture");
    iframe.setAttribute("allowfullscreen", "");
    iframe.src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1`;
    lecteur.hidden = false;
    etat.lecteur = true;
    etat.lecteurCarte = carte;
    lecteur.querySelector(".swipe-lecteur-fermer").focus();
  }

  function fermerLecteur() {
    if (!etat.lecteur) return;
    const carte = etat.lecteurCarte;
    if (carte) {
      const lecteur = carte.querySelector(".swipe-lecteur");
      if (lecteur) { lecteur.hidden = true; lecteur.querySelector("iframe").removeAttribute("src"); }
    }
    etat.lecteur = false;
    etat.lecteurCarte = null;
    const ba = carte && carte.querySelector(".swipe-ba");
    if (ba && carte.isConnected) ba.focus();
  }

  /* ---------- Ouverture / fermeture ---------- */
  function focusables() {
    return [...racine.querySelectorAll("button, iframe, [href], input, select, textarea")]
      .filter((el) => !el.disabled && !el.closest("[hidden]") && el.getClientRects().length > 0);
  }

  function surClavier(e) {
    if (!etat.ouvert) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (etat.lecteur) fermerLecteur();
      else fermer();
      return;
    }
    if (e.key === "Tab") {
      const f = focusables();
      if (!f.length) return;
      const premier = f[0];
      const dernier = f[f.length - 1];
      const actif = document.activeElement;
      if (e.shiftKey && (actif === premier || !racine.contains(actif))) { e.preventDefault(); dernier.focus(); }
      else if (!e.shiftKey && (actif === dernier || !racine.contains(actif))) { e.preventDefault(); premier.focus(); }
      return;
    }
    const cible = e.target && e.target.closest ? e.target : null;
    if (cible && cible.closest("input, textarea, select, [contenteditable='true']")) return;
    if (e.key.toLowerCase() === "z") { e.preventDefault(); annuler(); return; }
    if (!etat.pile || etat.lecteur) return;
    const touches = { ArrowRight: "vu", ArrowLeft: "pasvu", ArrowUp: "avoir" };
    if (touches[e.key]) { e.preventDefault(); decider(touches[e.key]); }
  }

  function ouvrir() {
    if (etat.ouvert) return;
    etat.ouvert = true;
    etat.modifie = false;
    etat.avant = document.activeElement;
    racine.hidden = false;
    void racine.offsetWidth;                    // reflow pour que la transition joue
    racine.classList.add("visible");
    document.body.classList.add("swipe-ouvert");
    afficherChoix();
    const premier = $(".swipe-pile");
    if (premier) premier.focus();
  }

  async function fermer() {
    if (!etat.ouvert) return;
    fermerLecteur();
    etat.ouvert = false;
    etat.pile = null;
    etat.file = [];
    etat.historique = [];
    racine.classList.remove("visible");
    racine.hidden = true;
    document.body.classList.remove("swipe-ouvert");
    cartesEl.innerHTML = "";
    const avant = etat.avant;
    etat.avant = null;
    if (avant && avant.isConnected && typeof avant.focus === "function") avant.focus();

    await Promise.allSettled([...enAttente]);   // attend les actions encore en cours
    // Les décisions (vu / pas vu / à voir) changent le contenu des onglets Catalogue et Non vus.
    if (window.Catalogue && window.Catalogue.rafraichir) window.Catalogue.rafraichir();
    if (etat.modifie) {
      etat.modifie = false;
      if (window.Personnes && window.Personnes.invaliderCache) window.Personnes.invaliderCache();
      await BIB.recharger();
      BIB.rafraichirOnglets();
    }
  }

  /* ---------- Câblage ---------- */
  racine.addEventListener("click", (e) => {
    const t = e.target;
    if (t.closest(".swipe-fermer")) { fermer(); return; }
    if (t.closest(".swipe-retour")) { afficherChoix(); $(".swipe-pile").focus(); return; }
    const pile = t.closest(".swipe-pile");
    if (pile) { demarrer(pile.dataset.pile); return; }
    if (t.closest(".swipe-fin-choisir")) { afficherChoix(); return; }
    if (t.closest(".swipe-annuler")) { annuler(); return; }
    if (t.closest(".swipe-btn-vu")) { decider("vu"); return; }
    if (t.closest(".swipe-btn-pasvu")) { decider("pasvu"); return; }
    if (t.closest(".swipe-btn-avoir")) { decider("avoir"); return; }
    if (t.closest(".swipe-ba")) { ouvrirLecteur(t.closest(".swipe-carte")); return; }
    if (t.closest(".swipe-lecteur-fermer")) { fermerLecteur(); }
  });
  cartesEl.addEventListener("pointerdown", surDown);
  cartesEl.addEventListener("pointermove", surMove);
  cartesEl.addEventListener("pointerup", surUp);
  cartesEl.addEventListener("pointercancel", surUp);
  document.addEventListener("keydown", surClavier, true);

  window.Swipe = { ouvrir };
})();