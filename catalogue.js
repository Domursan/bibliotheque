/* =========================================================
   Catalogue : les œuvres « pas encore vues » de l'annuaire
   Onglet géré ici. app.js appelle Catalogue.afficher() et lit
   Catalogue.total pour le compteur de l'onglet.
   ========================================================= */
(() => {
  "use strict";

  const BIB = window.BIB;
  if (!BIB) { console.error("catalogue.js : window.BIB introuvable (app.js doit être chargé avant)."); return; }

  const PAR_PAGE = 60;
  const PAGE_SUPABASE = 1000;
  const LOT_QIDS = 300;          // filtre Personne : au-delà, la liste de QIDs est découpée
  const DELAI_FRAPPE = 250;
  const COLONNES = "qid,titre,annee,type,createur,genre,image_url,nb_personnes,bande_annonce,producteur,acteurs_principaux";
  const LIBELLES_TYPE = { film: "Film", serie: "Série", autre: "Autre" };
  const ICONE_AJOUT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';

  const esc = (s) => BIB.echapper(s);
  const norm = (s) => String(s ?? "").normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase();
  const motif = (s) => `%${s.replace(/[\\%_]/g, "\\$&")}%`;   // « contient », jokers LIKE échappés
  const typeDe = (c) => (c.type === "film" || c.type === "serie" ? c.type : "autre");
  const iconeDe = (type) => BIB.ICONES[type] || BIB.ICONES.film;
  const decouper = (liste, n) => { const r = []; for (let i = 0; i < liste.length; i += n) r.push(liste.slice(i, i + n)); return r; };
  const wikidata = (qid) => `https://www.wikidata.org/wiki/${encodeURIComponent(qid)}`;
  const trierFr = (a, b) => a.localeCompare(b, "fr", { sensitivity: "base" });

  // Pagine une requête Supabase (1000 lignes max par requête).
  async function paginer(construire) {
    const tout = [];
    for (let debut = 0; ; debut += PAGE_SUPABASE) {
      const { data, error } = await construire(debut, debut + PAGE_SUPABASE - 1);
      if (error) throw error;
      tout.push(...(data || []));
      if (!data || data.length < PAGE_SUPABASE) break;
    }
    return tout;
  }

  const etat = {
    total: null, totalDemande: false,
    filtres: { type: "", genre: "", createur: "", personneTexte: "", personne: null, personneInconnue: false, tri: "nb", recherche: "" },
    noms: null, personnesParNom: new Map(), personnesDemande: null, personnesErreur: false,
    qidsParPersonne: new Map(),
    grille: null, barre: null, pied: null, compte: null, datalist: null, champPersonne: null,
    lignes: [], affichees: 0, nbFiltre: null, enServeur: true, fin: true, qidsSrv: null,
    jeton: 0, minuteurFrappe: null, focusAvant: null,
    fiche: null, jetonFiche: 0,
  };

  /* ---------- Requêtes ---------- */

  // Filtres communs (type, genre, créateur, titre, liste de QIDs).
  function appliquer(q, qids) {
    const f = etat.filtres;
    if (f.type === "film" || f.type === "serie") q = q.eq("type", f.type);
    else if (f.type === "autre") q = q.or("type.is.null,type.eq.autre");
    if (f.genre) q = q.ilike("genre", motif(f.genre));
    if (f.createur) q = q.ilike("createur", motif(f.createur));
    if (f.recherche) q = q.ilike("titre", motif(f.recherche));
    if (qids) q = q.in("qid", qids);
    return q;
  }

  function trier(q) {
    const t = etat.filtres.tri;
    if (t === "annee") return q.order("annee", { ascending: false, nullsFirst: false }).order("qid", { ascending: true });
    if (t === "titre") return q.order("titre", { ascending: true }).order("qid", { ascending: true });
    return q.order("nb_personnes", { ascending: false }).order("qid", { ascending: true });
  }

  // Une tranche [debut, fin] des œuvres filtrées ; count exact = total filtré.
  const requete = (qids, debut, fin) =>
    trier(appliquer(BIB.sb.from("catalogue").select(COLONNES, { count: "exact" }), qids)).range(debut, fin);

  // Même tri que le serveur, pour le repli (liste de QIDs découpée).
  function comparateur(tri) {
    const parQid = (a, b) => (a.qid < b.qid ? -1 : a.qid > b.qid ? 1 : 0);
    if (tri === "annee") return (a, b) => {
      if (a.annee == null || b.annee == null) return (a.annee == null) - (b.annee == null) || parQid(a, b);
      return (b.annee - a.annee) || parQid(a, b);
    };
    if (tri === "titre") return (a, b) => trierFr(a.titre, b.titre) || parQid(a, b);
    return (a, b) => (b.nb_personnes - a.nb_personnes) || parQid(a, b);
  }

  // Toutes les œuvres d'un lot de QIDs (ou du catalogue entier si lot est null).
  const toutLot = (lot) => paginer((a, b) => requete(lot, a, b));

  // Filtre Personne : QIDs des œuvres « pas encore vues » de cette personne.
  async function lireQids(personneId) {
    const lignes = await paginer((a, b) => BIB.sb.from("participations")
      .select("oeuvre_qid")
      .eq("personne_id", personneId)
      .is("contenu_id", null)
      .order("oeuvre_qid", { ascending: true })
      .range(a, b));
    return [...new Set(lignes.map((l) => l.oeuvre_qid))];
  }

  async function qidsFiltre() {
    const f = etat.filtres;
    if (f.personneInconnue) return [];
    if (!f.personne) return null;
    if (!etat.qidsParPersonne.has(f.personne)) {
      const p = lireQids(f.personne);
      etat.qidsParPersonne.set(f.personne, p);
      p.catch(() => etat.qidsParPersonne.delete(f.personne));
    }
    return etat.qidsParPersonne.get(f.personne);
  }

  function chargerTotal() {
    if (etat.totalDemande) return;
    etat.totalDemande = true;
    BIB.sb.from("catalogue").select("qid", { count: "exact", head: true }).then(({ count, error }) => {
      if (error) { console.error("catalogue.js : total", error); etat.totalDemande = false; return; }
      etat.total = count ?? 0;
      BIB.rafraichirOnglets();
    });
  }

  // Noms des acteurs et producteurs (une seule fois, pour le champ Personne).
  function chargerPersonnes() {
    if (etat.personnesDemande) return;
    etat.personnesDemande = paginer((a, b) => BIB.sb.from("personnes").select("id, nom").order("id", { ascending: true }).range(a, b))
      .then((liste) => {
        etat.personnesParNom = new Map();
        liste.forEach((p) => {
          const cle = norm(p.nom || p.id);
          if (cle && !etat.personnesParNom.has(cle)) etat.personnesParNom.set(cle, p.id);
        });
        etat.noms = [...new Set(liste.map((p) => p.nom || p.id))].sort(trierFr);
        etat.personnesErreur = false;
        remplirDatalist();
        majChampPersonne();
      })
      .catch((err) => {
        console.error("catalogue.js : personnes", err);
        etat.personnesDemande = null;
        etat.personnesErreur = true;
        majChampPersonne();
      });
  }

  /* ---------- Barre de filtres ---------- */

  function remplirDatalist() {
    const dl = etat.datalist;
    if (!dl || !dl.isConnected || !etat.noms) return;
    dl.innerHTML = etat.noms.map((n) => `<option value="${esc(n)}"></option>`).join("");
  }

  function majChampPersonne() {
    const c = etat.champPersonne;
    if (!c || !c.isConnected) return;
    c.disabled = !etat.noms;
    c.placeholder = etat.noms ? "Nom d'un acteur ou producteur" : etat.personnesErreur ? "Indisponible" : "Chargement…";
  }

  function surSaisiePersonne(valeur) {
    const f = etat.filtres;
    f.personneTexte = valeur;
    const cle = norm(valeur);
    if (!cle) { f.personne = null; f.personneInconnue = false; }
    else {
      f.personne = etat.personnesParNom.get(cle) || null;
      f.personneInconnue = !f.personne;
    }
    planifier();
  }

  function construireBarre(grille) {
    const f = etat.filtres;
    grille.innerHTML = "";
    const barre = document.createElement("div");
    barre.className = "catalogue-barre";
    barre.setAttribute("role", "search");
    barre.setAttribute("aria-label", "Filtrer le catalogue");
    barre.innerHTML = `
      <div class="catalogue-champs">
        <label class="catalogue-champ">
          <span>Type</span>
          <select data-f="type">
            <option value="">Tout</option>
            <option value="film">Films</option>
            <option value="serie">Séries</option>
          </select>
        </label>
        <label class="catalogue-champ">
          <span>Genre</span>
          <input data-f="genre" type="text" autocomplete="off" spellcheck="false" placeholder="Contient…">
        </label>
        <label class="catalogue-champ">
          <span>Réalisateur ou créateur</span>
          <input data-f="createur" type="text" autocomplete="off" spellcheck="false" placeholder="Contient…">
        </label>
        <label class="catalogue-champ">
          <span>Acteur ou producteur</span>
          <input data-f="personne" type="text" list="catalogue-dl-personnes" autocomplete="off" spellcheck="false" disabled>
        </label>
        <datalist id="catalogue-dl-personnes"></datalist>
        <label class="catalogue-champ">
          <span>Tri</span>
          <select data-f="tri">
            <option value="nb">Le plus de personnes connues</option>
            <option value="annee">Année (récent)</option>
            <option value="titre">Titre (A → Z)</option>
          </select>
        </label>
      </div>
      <p class="catalogue-compte" aria-live="polite"></p>`;

    const type = barre.querySelector('[data-f="type"]');
    const genre = barre.querySelector('[data-f="genre"]');
    const createur = barre.querySelector('[data-f="createur"]');
    const personne = barre.querySelector('[data-f="personne"]');
    const tri = barre.querySelector('[data-f="tri"]');
    type.value = f.type;
    genre.value = f.genre;
    createur.value = f.createur;
    personne.value = f.personneTexte;
    tri.value = f.tri;

    type.addEventListener("change", () => { f.type = type.value; charger(); });
    tri.addEventListener("change", () => { f.tri = tri.value; charger(); });
    genre.addEventListener("input", () => { f.genre = genre.value.trim(); planifier(); });
    createur.addEventListener("input", () => { f.createur = createur.value.trim(); planifier(); });
    personne.addEventListener("input", () => surSaisiePersonne(personne.value));

    const pied = document.createElement("div");
    pied.className = "catalogue-pied";
    pied.hidden = true;
    pied.innerHTML = '<button type="button" class="btn-sobre">Afficher plus</button>';
    pied.querySelector("button").addEventListener("click", plusDeCartes);

    grille.append(barre, pied);
    etat.grille = grille;
    etat.barre = barre;
    etat.pied = pied;
    etat.compte = barre.querySelector(".catalogue-compte");
    etat.datalist = barre.querySelector("datalist");
    etat.champPersonne = personne;
    remplirDatalist();
    majChampPersonne();
  }

  /* ---------- Chargement et rendu de la liste ---------- */

  // Retire cartes, squelettes et états vides précédents (la barre reste).
  function retirerItems() {
    if (etat.grille) etat.grille.querySelectorAll(".catalogue-item").forEach((n) => n.remove());
  }

  function planifier() {
    clearTimeout(etat.minuteurFrappe);
    etat.minuteurFrappe = setTimeout(charger, DELAI_FRAPPE);
  }

  function etatVide(titre, texte, action) {
    const d = document.createElement("div");
    d.className = "vide catalogue-item";
    d.innerHTML = `<h2>${esc(titre)}</h2><p>${esc(texte)}</p>`;
    if (action) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn-or";
      b.textContent = action.libelle;
      b.addEventListener("click", action.quand);
      d.append(b);
    }
    return d;
  }

  function carteDe(c, i) {
    const type = typeDe(c);
    const icone = iconeDe(type);
    const cellule = document.createElement("div");
    cellule.className = "catalogue-item catalogue-cellule carte carte-v2";
    cellule.dataset.qid = c.qid;
    cellule.dataset.type = type;
    cellule.style.animationDelay = `${Math.min(i % PAR_PAGE, 12) * 40}ms`;
    cellule.innerHTML = `
      <button type="button" class="carte-lien" aria-label="${esc(c.titre)}"></button>
      <div class="affiche">
        ${c.image_url ? `<img src="${esc(c.image_url)}" alt="" loading="lazy">` : `<div class="affiche-vide">${icone}</div>`}
      </div>
      <div class="carte-boutons">
        ${c.bande_annonce
          ? `<button type="button" class="cb-ba" aria-label="Bande-annonce de ${esc(c.titre)}">▶ Bande-annonce</button>`
          : `<button type="button" class="cb-ba" disabled aria-label="Pas de bande-annonce">▶ Bande-annonce</button>`}
        <span class="cb-type">${LIBELLES_TYPE[type]}</span>
        <button type="button" class="cb-vu" aria-label="Marquer « ${esc(c.titre)} » comme vu">✓ Vu</button>
      </div>
      <div class="carte-corps">
        <h3 class="carte-titre">${esc(c.titre)}</h3>
        ${c.producteur ? `<p class="carte-info"><span>Producteur</span>${esc(c.producteur)}</p>` : ""}
        ${c.acteurs_principaux ? `<p class="carte-info"><span>Acteurs</span>${esc(c.acteurs_principaux)}</p>` : ""}
      </div>`;
    const img = cellule.querySelector("img");
    if (img) {
      img.addEventListener("error", () => {
        const v = document.createElement("div");
        v.className = "affiche-vide";
        v.innerHTML = icone;
        img.replaceWith(v);
      }, { once: true });
    }
    cellule.querySelector(".carte-lien").addEventListener("click", () => ouvrirFiche(c.qid));
    cellule.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      ouvrirFiche(c.qid);
    });
    const ba = cellule.querySelector(".cb-ba");
    if (c.bande_annonce) ba.addEventListener("click", (e) => { e.stopPropagation(); BIB.lireBandeAnnonce(c.bande_annonce, c.titre); });
    const vu = cellule.querySelector(".cb-vu");
    vu.addEventListener("click", (e) => { e.stopPropagation(); ajouter(vu, { vu: true, ligne: c }); });
    return cellule;
  }


  function rendreCartes(debut, fin) {
    for (let i = debut; i < fin; i++) etat.pied.before(carteDe(etat.lignes[i], i));
  }

  const reste = () => (etat.enServeur ? !etat.fin : etat.affichees < etat.lignes.length);

  function majPied() {
    etat.pied.hidden = !reste();
  }

  function majCompte() {
    const n = etat.nbFiltre;
    etat.compte.textContent = n == null ? "" : `${n} œuvre${n > 1 ? "s" : ""}`;
  }

  function montrer(jeton, lignes, { serveur, nb, fin }) {
    if (jeton !== etat.jeton) return;
    retirerItems();
    etat.lignes = lignes;
    etat.enServeur = serveur;
    etat.nbFiltre = nb;
    etat.fin = fin;
    if (!lignes.length) {
      etat.affichees = 0;
      const f = etat.filtres;
      etat.pied.before(etatVide("Rien à montrer", f.personneInconnue
        ? "Aucune personne de ce nom dans l'annuaire."
        : "Aucune œuvre ne correspond à ces filtres."));
    } else {
      const fin2 = serveur ? lignes.length : Math.min(lignes.length, PAR_PAGE);
      rendreCartes(0, fin2);
      etat.affichees = fin2;
    }
    majCompte();
    majPied();
  }

  async function charger() {
    if (!etat.barre || !etat.grille || !etat.grille.contains(etat.barre)) return;
    clearTimeout(etat.minuteurFrappe);
    const jeton = ++etat.jeton;
    retirerItems();
    etat.lignes = [];
    etat.affichees = 0;
    etat.nbFiltre = null;
    etat.enServeur = true;
    etat.fin = true;
    etat.qidsSrv = null;
    etat.pied.hidden = true;
    for (let i = 0; i < 6; i++) {
      const s = document.createElement("div");
      s.className = "squelette catalogue-item";
      etat.pied.before(s);
    }
    etat.compte.textContent = "Chargement…";

    try {
      const qids = await qidsFiltre();
      if (jeton !== etat.jeton) return;
      if (qids && !qids.length) return montrer(jeton, [], { serveur: true, nb: 0, fin: true });

      const lots = qids ? decouper(qids, LOT_QIDS) : [null];
      if (lots.length === 1) {
        // Cas courant : une seule requête paginée côté serveur.
        etat.qidsSrv = lots[0];
        const { data, error, count } = await requete(lots[0], 0, PAR_PAGE - 1);
        if (error) throw error;
        if (jeton !== etat.jeton) return;
        const lignes = data || [];
        const nb = count ?? lignes.length;
        montrer(jeton, lignes, { serveur: true, nb, fin: lignes.length >= nb || lignes.length < PAR_PAGE });
      } else {
        // Repli : plus de 300 œuvres pour la personne, on fusionne les lots puis on trie ici.
        const tout = (await Promise.all(lots.map(toutLot))).flat();
        if (jeton !== etat.jeton) return;
        tout.sort(comparateur(etat.filtres.tri));
        montrer(jeton, tout, { serveur: false, nb: tout.length, fin: true });
      }
    } catch (err) {
      if (jeton !== etat.jeton) return;
      console.error("catalogue.js : chargement", err);
      retirerItems();
      etat.lignes = [];
      etat.affichees = 0;
      etat.nbFiltre = null;
      etat.pied.hidden = true;
      etat.compte.textContent = "";
      etat.pied.before(etatVide("Projection interrompue", "Impossible de charger le catalogue.",
        { libelle: "Réessayer", quand: charger }));
    }
  }

  async function plusDeCartes() {
    if (!reste()) return;
    if (!etat.enServeur) {
      const debut = etat.affichees;
      const fin = Math.min(etat.lignes.length, debut + PAR_PAGE);
      rendreCartes(debut, fin);
      etat.affichees = fin;
      majPied();
      return;
    }
    const bouton = etat.pied.querySelector("button");
    const jeton = etat.jeton;
    const debut = etat.lignes.length;
    bouton.disabled = true;
    try {
      const { data, error, count } = await requete(etat.qidsSrv, debut, debut + PAR_PAGE - 1);
      if (error) throw error;
      if (jeton !== etat.jeton) return;
      const lignes = data || [];
      etat.lignes.push(...lignes);
      const nb = count ?? etat.nbFiltre ?? etat.lignes.length;
      etat.fin = lignes.length < PAR_PAGE || etat.lignes.length >= nb;
      rendreCartes(debut, etat.lignes.length);
      etat.affichees = etat.lignes.length;
      majPied();
    } catch (err) {
      console.error("catalogue.js : page suivante", err);
      BIB.toast("Chargement impossible. Réessaie.");
    } finally {
      bouton.disabled = false;
    }
  }

  /* ---------- Fiche (overlay) ---------- */

  function construireFiche() {
    const o = document.createElement("div");
    o.className = "catalogue-fiche";
    o.hidden = true;
    o.innerHTML = `
      <div class="catalogue-panneau" role="dialog" aria-modal="true" aria-labelledby="catalogue-fiche-titre">
        <button type="button" class="btn-icone catalogue-fermer" aria-label="Fermer">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
        </button>
        <div class="catalogue-fiche-corps"></div>
      </div>`;
    document.body.append(o);
    etat.fiche = {
      overlay: o,
      panneau: o.querySelector(".catalogue-panneau"),
      corps: o.querySelector(".catalogue-fiche-corps"),
      ouvert: false,
      ligne: null,
    };
    o.querySelector(".catalogue-fermer").addEventListener("click", () => fermerFiche());
    o.addEventListener("click", (e) => { if (e.target === o) fermerFiche(); });
    etat.fiche.corps.addEventListener("click", surClicFiche);
    // Escape ferme cette fiche seule (sans toucher à la séance dessous) ; Tab reste piégé.
    document.addEventListener("keydown", surTouche, true);
  }

  function surTouche(e) {
    const F = etat.fiche;
    if (!F || !F.ouvert) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopImmediatePropagation();
      fermerFiche();
      return;
    }
    if (e.key === "Tab") {
      const focusables = [...F.overlay.querySelectorAll('button:not([disabled]), a[href], [tabindex="0"]')]
        .filter((x) => x.getClientRects().length > 0);
      if (!focusables.length) return;
      const premier = focusables[0], dernier = focusables[focusables.length - 1];
      const dedans = F.overlay.contains(document.activeElement);
      if (e.shiftKey && (!dedans || document.activeElement === premier)) { e.preventDefault(); dernier.focus(); }
      else if (!e.shiftKey && (!dedans || document.activeElement === dernier)) { e.preventDefault(); premier.focus(); }
    }
  }

  function fermerFiche() {
    const F = etat.fiche;
    if (!F || !F.ouvert) return;
    F.ouvert = false;
    etat.jetonFiche++;   // invalide un chargement encore en cours
    F.overlay.classList.remove("visible");
    document.body.classList.remove("catalogue-ouvert");
    const masquer = () => { if (!F.ouvert) F.overlay.hidden = true; };
    if (document.body.classList.contains("sans-animations")) masquer();
    else setTimeout(masquer, 450);
    if (etat.focusAvant && document.contains(etat.focusAvant)) etat.focusAvant.focus({ preventScroll: true });
  }

  async function lireLigne(qid) {
    const { data, error } = await BIB.sb.from("catalogue").select(COLONNES).eq("qid", qid).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error(`œuvre ${qid} introuvable`);
    return data;
  }

  // Production et casting d'une œuvre (participations de l'œuvre, dédoublonnées par personne).
  async function lireCasting(qid) {
    const lignes = await paginer((a, b) => BIB.sb.from("participations")
      .select("role, personne_id, personnes(nom)")
      .eq("oeuvre_qid", qid)
      .order("personne_id", { ascending: true })
      .order("role", { ascending: true })
      .range(a, b));
    const groupes = { producteur: new Map(), acteur: new Map() };
    lignes.forEach((l) => {
      const nom = Array.isArray(l.personnes) ? l.personnes[0]?.nom : l.personnes?.nom;
      const g = groupes[l.role];
      if (g && nom) g.set(l.personne_id, nom);
    });
    const liste = (m) => [...m].map(([id, nom]) => ({ id, nom })).sort((a, b) => trierFr(a.nom, b.nom));
    return { producteurs: liste(groupes.producteur), acteurs: liste(groupes.acteur) };
  }

  const blocCasting = (titre, liste) => (liste.length
    ? `<section class="catalogue-bloc" aria-label="${esc(titre)}">
         <h3 class="catalogue-bloc-titre">${esc(titre)}</h3>
         <div class="catalogue-puces">${liste.map((p) =>
           `<button type="button" class="catalogue-puce" data-personne="${esc(p.id)}">${esc(p.nom)}</button>`).join("")}</div>
       </section>`
    : "");

  function htmlFiche(c, casting) {
    const type = typeDe(c);
    const infos = [];
    if (c.annee) infos.push(["Année", String(c.annee)]);
    if (c.createur) infos.push([type === "film" ? "Réalisateur" : "Créateur", c.createur]);
    if (c.genre) infos.push(["Genre", c.genre]);
    infos.push(["Wikidata", `<a href="${esc(wikidata(c.qid))}" target="_blank" rel="noopener">Wikidata ↗</a>`, true]);
    return `
      <article class="fiche" data-type="${type}">
        <div class="fiche-affiche">${c.image_url
          ? `<img src="${esc(c.image_url)}" alt="">`
          : `<div class="affiche-vide">${iconeDe(type)}</div>`}</div>
        <div>
          <div class="fiche-pastilles">
            <span class="pastille or">${LIBELLES_TYPE[type]}</span>
            <span class="pastille">Pas encore vu</span>
          </div>
          <h2 class="fiche-titre" id="catalogue-fiche-titre" tabindex="-1">${esc(c.titre)}</h2>
          <dl class="fiche-infos">
            ${infos.map(([k, v, html]) => `<div><dt>${esc(k)}</dt><dd>${html ? v : esc(v)}</dd></div>`).join("")}
          </dl>
          ${blocCasting("Production", casting.producteurs)}
          ${blocCasting("Casting", casting.acteurs)}
          <div class="fiche-actions">
            <button class="btn-or" type="button" data-action="ajouter">${ICONE_AJOUT}Ajouter à ma bibliothèque</button>
            <button class="btn-sobre" type="button" data-action="vu">Je l'ai vu</button>
          </div>
        </div>
      </article>`;
  }

  async function ouvrirFiche(qid) {
    if (!etat.fiche) construireFiche();
    const F = etat.fiche;
    if (!F.ouvert) {
      etat.focusAvant = document.activeElement;
      F.ouvert = true;
      F.overlay.hidden = false;
      document.body.classList.add("catalogue-ouvert");
      requestAnimationFrame(() => F.overlay.classList.add("visible"));
    }
    const jeton = ++etat.jetonFiche;
    F.ligne = null;
    F.panneau.scrollTop = 0;
    F.corps.innerHTML = '<p class="catalogue-chargement" role="status">Chargement de la fiche…</p>';
    try {
      const ligne = etat.lignes.find((l) => l.qid === qid) || await lireLigne(qid);
      const casting = await lireCasting(qid);
      if (jeton !== etat.jetonFiche || !F.ouvert) return;
      F.ligne = ligne;
      F.corps.innerHTML = htmlFiche(ligne, casting);
      const img = F.corps.querySelector(".fiche-affiche img");
      if (img) {
        img.addEventListener("error", () => {
          const v = document.createElement("div");
          v.className = "affiche-vide";
          v.innerHTML = iconeDe(typeDe(ligne));
          img.replaceWith(v);
        }, { once: true });
      }
      F.corps.querySelector(".fiche-titre").focus({ preventScroll: true });
    } catch (err) {
      if (jeton !== etat.jetonFiche) return;
      console.error("catalogue.js : fiche", err);
      F.corps.innerHTML = '<p class="erreur" role="alert">Fiche indisponible, réessaie.</p>';
    }
  }

  function surClicFiche(e) {
    const puce = e.target.closest("[data-personne]");
    if (puce) {
      const id = puce.dataset.personne;
      fermerFiche();
      if (window.Personnes) window.Personnes.ouvrirPersonne(id);
      return;
    }
    const bouton = e.target.closest('[data-action="ajouter"], [data-action="vu"]');
    if (bouton) ajouter(bouton, { vu: bouton.dataset.action === "vu" });
  }

  // Insère l'œuvre de la fiche dans la bibliothèque (champs propres au statut), lie ses participations
  // et la retire du catalogue. Renvoie l'id du contenu créé, ou null en cas d'échec (insertion annulée).
  async function passerDansBibliotheque(c, champs) {
    const type = c.type === "serie" ? "serie" : "film";
    const genre = (c.genre || "").split(",")[0].trim() || null;
    let nouvelId = null;
    let liee = false;
    try {
      const { data, error } = await BIB.sb.from("contenus").insert({
        type,
        titre: c.titre,
        annee: c.annee,
        createur: c.createur,
        genre,
        image_url: c.image_url,
        lien: wikidata(c.qid),
        wikidata: c.qid,
        tags: ["catalogue"],
        ...champs,
      }).select("id").single();
      if (error) throw error;
      nouvelId = data.id;

      const liaison = await BIB.sb.from("participations").update({ contenu_id: nouvelId }).eq("oeuvre_qid", c.qid);
      if (liaison.error) throw liaison.error;
      liee = true;

      const retrait = await BIB.sb.from("catalogue").delete().eq("qid", c.qid);
      if (retrait.error) throw retrait.error;
      return nouvelId;
    } catch (err) {
      console.error("catalogue.js : ajout", err);
      // Liaison non faite : on annule l'insertion pour ne pas laisser de doublon.
      if (nouvelId && !liee) await BIB.sb.from("contenus").delete().eq("id", nouvelId).then(() => {}, () => {});
      return null;
    }
  }

  // Un seul chemin pour « Ajouter à ma bibliothèque » (À voir) et « Je l'ai vu » (terminé + notation).
  async function ajouter(bouton, { vu = false, ligne = null } = {}) {
    const F = etat.fiche;
    const c = ligne || (F && F.ligne);
    if (!c || bouton.disabled) return;
    bouton.disabled = true;
    const champs = vu
      ? { statut: "termine", date_visionnage: BIB.aujourdhui(), nb_visionnages: 1 }
      : { statut: "a_voir" };
    const nouvelId = await passerDansBibliotheque(c, champs);
    if (!nouvelId) {
      bouton.disabled = false;
      BIB.toast("Ajout impossible. Réessaie.");
      return;
    }

    if (etat.total != null) etat.total = Math.max(0, etat.total - 1);
    BIB.rafraichirOnglets();
    if (!ligne) fermerFiche();
    const carte = etat.grille && etat.grille.querySelector(`.carte[data-qid="${CSS.escape(c.qid)}"]`);
    if (carte) (carte.closest(".catalogue-cellule") || carte).remove();
    else { const cel = etat.grille && etat.grille.querySelector(`.catalogue-cellule[data-qid="${CSS.escape(c.qid)}"]`); if (cel) cel.remove(); }
    BIB.toast(vu ? "Marqué comme vu" : "Ajouté à ta liste À voir");
    if (window.Personnes && window.Personnes.invaliderCache) window.Personnes.invaliderCache();
    await BIB.recharger();   // recharge la bibliothèque ; app.js rappelle Catalogue.afficher()

  }

  /* ---------- Pont ---------- */

  function afficher(grille, recherche = "") {
    chargerTotal();
    chargerPersonnes();
    const rech = String(recherche ?? "").trim();
    const enPlace = etat.grille === grille && etat.barre && grille.contains(etat.barre);
    if (!enPlace) {
      etat.filtres.recherche = rech;
      construireBarre(grille);
      charger();
      return;
    }
    if (rech !== etat.filtres.recherche) {
      etat.filtres.recherche = rech;
      planifier();
    }
  }

  window.Catalogue = {
    afficher,
    // passerDansBibliotheque(ligneCatalogue, champs) → id du contenu créé ou null (utilisé par swipe.js)
    passerDansBibliotheque: async (ligne, champs) => {
      const id = await passerDansBibliotheque(ligne, champs);
      if (id && etat.total != null) { etat.total = Math.max(0, etat.total - 1); BIB.rafraichirOnglets(); }
      return id;
    },
    ouvrirFiche,
    get total() { return etat.total; },
  };
})();