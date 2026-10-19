/* =========================================================
   Annuaire : producteurs et acteurs, avec leur filmographie
   ========================================================= */
(() => {
  "use strict";

  const BIB = window.BIB;
  if (!BIB) { console.error("personnes.js : window.BIB introuvable (app.js doit être chargé avant)."); return; }

  const ROLES = { acteur: "Acteur", producteur: "Producteur" };
  const ORDRE_ROLES = ["acteur", "producteur"];
  const STATUTS = { a_voir: "À voir", en_cours: "En cours", termine: "Terminé", abandonne: "Abandonné", incertain: "Incertain" };
  const PAR_PAGE_LISTE = 200;
  const PAGE_SUPABASE = 1000;
  const TEXTE_ERREUR = "Annuaire indisponible, réessaie.";

  const esc = (s) => BIB.echapper(s);
  const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const wikidata = (qid) => `https://www.wikidata.org/wiki/${encodeURIComponent(qid)}`;
  const nbOeuvres = (n) => `${n} œuvre${n > 1 ? "s" : ""} dans ta bibliothèque`;
  const rolesTexte = (roles) => ORDRE_ROLES.filter((r) => roles.has(r)).map((r) => ROLES[r]).join(" · ");

  function etoilesHtml(note) {
    if (note == null) return "";
    const n = Number(note);
    let html = `<span class="etoiles" aria-label="${String(n).replace(".", ",")} sur 5">`;
    for (let i = 1; i <= 5; i++) {
      const cls = n >= i ? "pleine" : n >= i - 0.5 ? "demi" : "";
      html += `<span class="etoile ${cls}" aria-hidden="true">★</span>`;
    }
    return html + "</span>";
  }

  const etat = {
    overlay: null, corps: null,
    base: null, basePromesse: null,
    filmos: new Map(),
    ouvert: false, focusAvant: null, minuteur: null,
    vue: null, personne: null, jeton: 0, reessayer: null,
    recherche: "", filtre: "tous", tri: "compteur", affiches: PAR_PAGE_LISTE,
  };

  /* ---------- Données ---------- */

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

  // Liste de toutes les personnes + rôles et compteurs (œuvres de la bibliothèque). Mis en cache.
  function chargerBase() {
    if (!etat.basePromesse) {
      etat.basePromesse = (async () => {
        const [personnes, liens] = await Promise.all([
          paginer((a, b) => BIB.sb.from("personnes").select("id, nom").order("id", { ascending: true }).range(a, b)),
          paginer((a, b) => BIB.sb.from("participations")
            .select("personne_id, role, contenu_id")
            .not("contenu_id", "is", null)
            .order("personne_id", { ascending: true })
            .order("role", { ascending: true })
            .order("oeuvre_qid", { ascending: true })
            .range(a, b)),
        ]);
        const index = new Map();
        personnes.forEach((p) => index.set(p.id, { id: p.id, nom: p.nom || p.id, roles: new Set(), oeuvres: new Set() }));
        liens.forEach((l) => {
          const p = index.get(l.personne_id);
          if (!p) return;
          p.roles.add(l.role);
          p.oeuvres.add(l.contenu_id);
        });
        const base = { liste: [...index.values()], index };
        etat.base = base;
        return base;
      })().catch((err) => { etat.basePromesse = null; throw err; });
    }
    return etat.basePromesse;
  }

  // Filmographie d'une personne, dédoublonnée par œuvre, triée par année décroissante.
  async function filmographie(qid) {
    const lignes = await paginer((a, b) => BIB.sb.from("participations")
      .select("role, oeuvre_qid, titre, annee, contenu_id")
      .eq("personne_id", qid)
      .order("oeuvre_qid", { ascending: true })
      .order("role", { ascending: true })
      .range(a, b));
    const par = new Map();
    lignes.forEach((l) => {
      let o = par.get(l.oeuvre_qid);
      if (!o) {
        o = { oeuvre_qid: l.oeuvre_qid, titre: null, annee: null, contenu_id: null, roles: new Set() };
        par.set(l.oeuvre_qid, o);
      }
      o.roles.add(l.role);
      if (l.contenu_id) o.contenu_id = l.contenu_id;
      if (!o.titre && l.titre) o.titre = l.titre;
      if (o.annee == null && l.annee != null) o.annee = l.annee;
    });
    const cmpAnnee = (a, b) => {
      if (a.annee == null && b.annee == null) return 0;
      if (a.annee == null) return 1;
      if (b.annee == null) return -1;
      return b.annee - a.annee;
    };
    return [...par.values()].sort((a, b) => cmpAnnee(a, b) || (a.titre || "").localeCompare(b.titre || "", "fr", { sensitivity: "base" }));
  }

  function chargerFilmo(qid) {
    if (!etat.filmos.has(qid)) {
      const p = filmographie(qid).catch((err) => { etat.filmos.delete(qid); throw err; });
      etat.filmos.set(qid, p);
    }
    return etat.filmos.get(qid);
  }

  /* ---------- Ouverture / fermeture ---------- */

  function construire() {
    const o = document.createElement("div");
    o.className = "annuaire";
    o.setAttribute("role", "dialog");
    o.setAttribute("aria-modal", "true");
    o.setAttribute("aria-labelledby", "annuaire-titre");
    o.hidden = true;
    o.innerHTML = `
      <div class="annuaire-panneau">
        <header class="annuaire-entete">
          <h2 class="annuaire-titre" id="annuaire-titre" tabindex="-1">Annuaire</h2>
          <button type="button" class="btn-icone annuaire-fermer" aria-label="Fermer">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
          </button>
        </header>
        <div class="annuaire-corps"></div>
      </div>`;
    document.body.append(o);
    etat.overlay = o;
    etat.corps = o.querySelector(".annuaire-corps");

    o.querySelector(".annuaire-fermer").addEventListener("click", () => fermer());
    o.addEventListener("click", (e) => { if (e.target === o) fermer(); });

    const corps = etat.corps;
    corps.addEventListener("click", surClic);
    corps.addEventListener("input", (e) => {
      if (!e.target.matches("[data-recherche]")) return;
      etat.recherche = e.target.value;
      etat.affiches = PAR_PAGE_LISTE;
      rendreResultats();
    });
    corps.addEventListener("change", (e) => {
      if (e.target.matches("[data-filtre]")) { etat.filtre = e.target.value; etat.affiches = PAR_PAGE_LISTE; rendreResultats(); }
      else if (e.target.matches("[data-tri]")) { etat.tri = e.target.value; etat.affiches = PAR_PAGE_LISTE; rendreResultats(); }
    });
    // Affiche cassée : on remplace l'image par l'icône du type (les erreurs de chargement ne remontent pas, d'où la capture).
    corps.addEventListener("error", (e) => {
      const img = e.target;
      if (img.tagName !== "IMG" || !img.closest("[data-affiche]")) return;
      const type = img.dataset.type;
      img.parentNode.innerHTML = `<span class="affiche-vide">${BIB.ICONES[type] || BIB.ICONES.film}</span>`;
    }, true);

    return o;
  }

  function ouvrir() {
    if (etat.ouvert) return;
    if (!etat.overlay) construire();
    clearTimeout(etat.minuteur);
    etat.focusAvant = document.activeElement;
    etat.ouvert = true;
    etat.overlay.hidden = false;
    document.body.classList.add("annuaire-ouvert");
    requestAnimationFrame(() => etat.overlay.classList.add("visible"));
  }

  function fermer() {
    if (!etat.ouvert) return;
    etat.ouvert = false;
    etat.overlay.classList.remove("visible");
    document.body.classList.remove("annuaire-ouvert");
    const masquer = () => { if (!etat.ouvert) etat.overlay.hidden = true; };
    if (document.body.classList.contains("sans-animations")) masquer();
    else etat.minuteur = setTimeout(masquer, 450);
    if (etat.focusAvant && document.contains(etat.focusAvant)) etat.focusAvant.focus({ preventScroll: true });
  }

  // Escape ferme l'annuaire seul (sans fermer la séance dessous) ; Tab reste piégé dans l'annuaire.
  function surTouche(e) {
    if (!etat.ouvert) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopImmediatePropagation();
      fermer();
      return;
    }
    if (e.key === "Tab") {
      const focusables = [...etat.overlay.querySelectorAll('button:not([disabled]), input, select, a[href], [tabindex="0"]')]
        .filter((x) => x.getClientRects().length > 0);
      if (!focusables.length) return;
      const premier = focusables[0], dernier = focusables[focusables.length - 1];
      const dedans = etat.overlay.contains(document.activeElement);
      if (e.shiftKey && (!dedans || document.activeElement === premier)) { e.preventDefault(); dernier.focus(); }
      else if (!e.shiftKey && (!dedans || document.activeElement === dernier)) { e.preventDefault(); premier.focus(); }
    }
  }

  /* ---------- Rendu ---------- */

  function rendre(html) { etat.corps.innerHTML = html; }

  function afficherChargement(texte) {
    rendre(`<p class="annuaire-chargement" role="status">${esc(texte)}</p>
      <div class="annuaire-squelettes" aria-hidden="true"><span></span><span></span><span></span></div>`);
  }

  function afficherErreur(reessayer) {
    etat.reessayer = reessayer;
    rendre(`<div class="annuaire-erreur" role="alert">
      <p>${esc(TEXTE_ERREUR)}</p>
      <button type="button" class="btn-sobre" data-action="reessayer">Réessayer</button>
    </div>`);
  }

  function ligneListe(p) {
    const roles = rolesTexte(p.roles);
    return `<li><button type="button" class="annuaire-ligne" data-qid="${esc(p.id)}">
      <span class="annuaire-nom">${esc(p.nom)}</span>
      ${roles ? `<span class="annuaire-roles">${esc(roles)}</span>` : ""}
      <span class="annuaire-compte">${esc(nbOeuvres(p.oeuvres.size))}</span>
    </button></li>`;
  }

  function listeFiltree(base) {
    const q = norm(etat.recherche).trim();
    const f = etat.filtre;
    const liste = base.liste.filter((p) =>
      (!q || norm(p.nom).includes(q)) && (f === "tous" || p.roles.has(f)));
    if (etat.tri === "nom") {
      liste.sort((a, b) => a.nom.localeCompare(b.nom, "fr", { sensitivity: "base" }));
    } else {
      liste.sort((a, b) => b.oeuvres.size - a.oeuvres.size || a.nom.localeCompare(b.nom, "fr", { sensitivity: "base" }));
    }
    return liste;
  }

  // Ne redessine que les résultats, pour garder le focus dans les champs de recherche.
  function rendreResultats() {
    const liste = listeFiltree(etat.base);
    const visibles = liste.slice(0, etat.affiches);
    const resume = etat.corps.querySelector("[data-resume]");
    const zone = etat.corps.querySelector("[data-liste]");
    const plus = etat.corps.querySelector("[data-plus]");
    if (!resume || !zone || !plus) return;
    resume.textContent = liste.length ? `${liste.length} personne${liste.length > 1 ? "s" : ""}` : "";
    if (!liste.length) {
      zone.innerHTML = `<li class="annuaire-vide-ligne">Aucun résultat pour ces filtres.</li>`;
      plus.innerHTML = "";
      return;
    }
    zone.innerHTML = visibles.map(ligneListe).join("");
    const reste = liste.length - visibles.length;
    plus.innerHTML = reste > 0
      ? `<button type="button" class="btn-sobre annuaire-plus" data-action="plus">Afficher plus (${reste} restantes)</button>`
      : "";
  }

  function vueListeHtml() {
    return `
      <div class="annuaire-outils" role="search">
        <label class="annuaire-recherche">
          <span class="sr-only">Rechercher par nom</span>
          <input type="search" data-recherche placeholder="Rechercher par nom" autocomplete="off" spellcheck="false" value="${esc(etat.recherche)}">
        </label>
        <label class="annuaire-select">
          <span class="sr-only">Filtrer par rôle</span>
          <select data-filtre>
            <option value="tous">Tous</option>
            <option value="acteur">Acteurs</option>
            <option value="producteur">Producteurs</option>
          </select>
        </label>
        <label class="annuaire-select">
          <span class="sr-only">Trier</span>
          <select data-tri>
            <option value="compteur">Plus présents dans ma bibliothèque</option>
            <option value="nom">Nom (A → Z)</option>
          </select>
        </label>
      </div>
      <p class="annuaire-resume" data-resume></p>
      <ul class="annuaire-liste" data-liste></ul>
      <div class="annuaire-plus-zone" data-plus></div>`;
  }

  async function afficherListe() {
    etat.vue = "liste";
    const jeton = ++etat.jeton;
    if (!etat.base) afficherChargement("Chargement de l'annuaire…");
    try {
      const base = await chargerBase();
      if (jeton !== etat.jeton) return;
      if (!base.liste.length) { rendre(`<p class="annuaire-rien">L'annuaire est vide.</p>`); return; }
      rendre(vueListeHtml());
      etat.corps.querySelector("[data-filtre]").value = etat.filtre;
      etat.corps.querySelector("[data-tri]").value = etat.tri;
      rendreResultats();
    } catch (err) {
      if (jeton === etat.jeton) afficherErreur(() => afficherListe());
    }
  }

  // Ligne d'une œuvre présente dans la bibliothèque : affiche, statut, note.
  function ligneBibliotheque(o, bib) {
    const c = bib.find((x) => x.id === o.contenu_id);
    const titre = c ? c.titre : (o.titre || "Sans titre");
    const type = c ? c.type : "film";
    const image = c && c.image_url
      ? `<img src="${esc(c.image_url)}" alt="" loading="lazy" data-type="${esc(type)}">`
      : `<span class="affiche-vide">${BIB.ICONES[type] || BIB.ICONES.film}</span>`;
    const infos = [rolesTexte(o.roles), o.annee != null ? String(o.annee) : "", c ? STATUTS[c.statut] : ""]
      .filter(Boolean).map(esc).join(" · ");
    const note = c && c.note != null ? ` ${etoilesHtml(c.note)}` : "";
    return `<li><button type="button" class="annuaire-film" data-contenu="${esc(o.contenu_id)}">
      <span class="annuaire-affiche" data-affiche>${image}</span>
      <span class="annuaire-film-corps">
        <span class="annuaire-film-titre">${esc(titre)}</span>
        <span class="annuaire-film-meta">${infos}${note}</span>
      </span>
    </button></li>`;
  }

  // Œuvre pas encore dans la bibliothèque : titre, année, lien Wikidata.
  function ligneAutre(o) {
    const infos = [rolesTexte(o.roles), o.annee != null ? String(o.annee) : ""].filter(Boolean).map(esc).join(" · ");
    return `<li class="annuaire-autre">
      <span class="annuaire-film-corps">
        <span class="annuaire-film-titre">${esc(o.titre || "Sans titre")}</span>
        ${infos ? `<span class="annuaire-film-meta">${infos}</span>` : ""}
      </span>
      <a class="annuaire-wd" href="${esc(wikidata(o.oeuvre_qid))}" target="_blank" rel="noopener">Wikidata ↗</a>
    </li>`;
  }

  function vuePersonneHtml(p, filmo) {
    const bib = BIB.contenus || [];
    const roles = new Set();
    filmo.forEach((o) => o.roles.forEach((r) => roles.add(r)));
    const dansBib = filmo.filter((o) => o.contenu_id);
    const pasVu = filmo.filter((o) => !o.contenu_id);
    return `
      <button type="button" class="btn-sobre annuaire-retour" data-action="retour">← Annuaire</button>
      <article class="annuaire-personne">
        <h2 class="annuaire-personne-nom" tabindex="-1" data-titre-personne>${esc(p.nom)}</h2>
        <p class="annuaire-personne-meta">
          ${roles.size ? `<span>${esc(rolesTexte(roles))}</span>` : ""}
          <a href="${esc(wikidata(p.id))}" target="_blank" rel="noopener">Wikidata ↗</a>
        </p>
        <section class="annuaire-section">
          <h3 class="annuaire-section-titre">Dans ta bibliothèque <span>${dansBib.length}</span></h3>
          ${dansBib.length
            ? `<ul class="annuaire-films">${dansBib.map((o) => ligneBibliotheque(o, bib)).join("")}</ul>`
            : `<p class="annuaire-rien">Aucune de ses œuvres n'est dans ta bibliothèque.</p>`}
        </section>
        <section class="annuaire-section">
          <h3 class="annuaire-section-titre">Pas encore vu <span>${pasVu.length}</span></h3>
          ${pasVu.length
            ? `<ul class="annuaire-films">${pasVu.map(ligneAutre).join("")}</ul>`
            : `<p class="annuaire-rien">Aucune autre œuvre connue.</p>`}
        </section>
      </article>`;
  }

  async function ouvrirPersonne(qid) {
    if (!qid) return;
    BIB.fermerSeance(true); // ferme la fiche d'une œuvre si elle est ouverte
    ouvrir();
    etat.vue = "personne";
    etat.personne = qid;
    const jeton = ++etat.jeton;
    afficherChargement("Chargement de la filmographie…");
    try {
      const [base, filmo] = await Promise.all([chargerBase(), chargerFilmo(qid)]);
      if (jeton !== etat.jeton) return;
      const p = base.index.get(qid) || { id: qid, nom: qid, roles: new Set(), oeuvres: new Set() };
      rendre(vuePersonneHtml(p, filmo));
      etat.corps.querySelector("[data-titre-personne]").focus({ preventScroll: true });
    } catch (err) {
      if (jeton === etat.jeton) afficherErreur(() => ouvrirPersonne(qid));
    }
  }

  function ouvrirFicheBibliotheque(id) {
    if (!(BIB.contenus || []).some((c) => c.id === id)) {
      BIB.toast("Cette fiche n'est pas disponible pour l'instant.");
      return;
    }
    fermer();
    BIB.ouvrirFiche(id);
  }

  function surClic(e) {
    const t = e.target;
    const ligne = t.closest("[data-qid]");
    if (ligne && etat.vue === "liste") { ouvrirPersonne(ligne.dataset.qid); return; }
    const film = t.closest("[data-contenu]");
    if (film) { ouvrirFicheBibliotheque(film.dataset.contenu); return; }
    const action = t.closest("[data-action]");
    if (!action) return;
    switch (action.dataset.action) {
      case "plus":
        etat.affiches += PAR_PAGE_LISTE;
        rendreResultats();
        break;
      case "retour":
        afficherListe().then(() => {
          const cible = etat.corps.querySelector(`[data-qid="${etat.personne}"]`)
            || etat.corps.querySelector("[data-recherche]");
          if (cible) cible.focus({ preventScroll: true });
        });
        break;
      case "reessayer":
        if (etat.reessayer) etat.reessayer();
        break;
    }
  }

  function ouvrirAnnuaire() {
    ouvrir();
    afficherListe().then(() => {
      if (etat.vue === "liste") etat.overlay.querySelector(".annuaire-titre").focus({ preventScroll: true });
    });
  }

  document.addEventListener("keydown", surTouche, true);

  window.Personnes = { ouvrirAnnuaire, ouvrirPersonne };
})();