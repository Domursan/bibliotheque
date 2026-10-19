/* =========================================================
   Ma bibliothèque — connexion, liste, fiches et formulaire
   ========================================================= */
(() => {
  "use strict";

  const { supabaseUrl, supabaseKey, domaineInterne } = window.BIBLIO_CONFIG;
  const sb = window.supabase.createClient(supabaseUrl, supabaseKey);

  const TYPES = [
    { id: "", label: "Tout" },
    { id: "serie", label: "Séries", seul: "Série" },
    { id: "film", label: "Films", seul: "Film" },
    { id: "article", label: "Articles", seul: "Article" },
    { id: "video", label: "Vidéos", seul: "Vidéo" },
  ];
  // Onglets : les 5 premiers filtrent par type, « À voir » et « Incertains » par statut (tous types).
  const ONGLETS = [
    { id: "tout", label: "Tout" },
    { id: "film", label: "Films", type: "film" },
    { id: "serie", label: "Séries", type: "serie" },
    { id: "video", label: "Vidéos", type: "video" },
    { id: "article", label: "Articles", type: "article" },
    { id: "a_voir", label: "À voir", statut: "a_voir" },
    { id: "incertain", label: "Incertains", statut: "incertain" },
    { id: "catalogue", label: "Catalogue", catalogue: true }, // géré par catalogue.js
  ];
  const STATUTS = { a_voir: "À voir", en_cours: "En cours", termine: "Terminé", abandonne: "Abandonné", incertain: "Incertain" };
  const ICONES = {
    serie: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
    film: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4"/></svg>',
    article: '<svg viewBox="0 0 24 24"><path d="M6 3h9l4 4v14H6z"/><path d="M9 12h7M9 16h7M9 8h3"/></svg>',
    video: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="3"/><path d="m10 9.5 5 2.5-5 2.5z"/></svg>',
  };

  const $ = (s) => document.querySelector(s);
  const el = {
    connexion: $("#ecran-connexion"), form: $("#form-connexion"),
    utilisateur: $("#champ-utilisateur"), mdp: $("#champ-mdp"),
    erreur: $("#erreur-connexion"), btnConnexion: $("#btn-connexion"), btnBascule: $("#btn-bascule"),
    app: $("#app"), onglets: $("#onglets"), grille: $("#grille"),
    recherche: $("#recherche"), statut: $("#filtre-statut"), tri: $("#tri"),
    filtres: $("#filtres"), filtresChamps: $("#filtres-champs"), btnFiltres: $("#btn-filtres"), filtresNb: $("#filtres-nb"),
    genre: $("#filtre-genre"), annee: $("#filtre-annee"), createur: $("#filtre-createur"), tag: $("#filtre-tag"),
    acteur: $("#filtre-acteur"), producteur: $("#filtre-producteur"), dlActeurs: $("#dl-acteurs"), dlProducteurs: $("#dl-producteurs"),
    reinitialiser: $("#btn-reinitialiser"),
    btnAjouter: $("#btn-ajouter"), btnMenu: $("#btn-menu"), menu: $("#menu"),
    menuUtilisateur: $("#menu-utilisateur"), btnAnimations: $("#btn-animations"), btnDeconnexion: $("#btn-deconnexion"),
    toast: $("#toast"),
  };

  // contenu_id -> { acteurs: Set<nom>, producteurs: Set<nom> }, chargé en arrière-plan
  const PARTICIPANTS = new Map();
  const ongletMemorise = () => {
    let id = null;
    try { id = localStorage.getItem("biblio-onglet"); } catch { /* ignoré */ }
    return ONGLETS.some((o) => o.id === id) ? id : "tout";
  };
  const etat = { contenus: [], modeInscription: false, participations: "chargement", onglet: ongletMemorise() };

  /* ---------- Préférences d'animation ---------- */
  const lirePref = () => { try { return localStorage.getItem("biblio-animations"); } catch { return null; } };
  const ecrirePref = (v) => { try { localStorage.setItem("biblio-animations", v); } catch { /* ignoré */ } };
  const animationsActives = () => {
    const p = lirePref();
    if (p) return p === "oui";
    return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  };
  const appliquerAnimations = () => {
    const on = animationsActives();
    document.body.classList.toggle("sans-animations", !on);
    el.btnAnimations.textContent = on ? "Couper les animations" : "Activer les animations";
  };

  /* ---------- Décor : fauteuils ---------- */
  function placerFauteuils() {
    const largeur = window.innerWidth;
    const mobile = largeur <= 720;
    document.querySelectorAll(".rangee").forEach((rangee) => {
      const avant = rangee.classList.contains("rangee-avant");
      const pas = mobile ? (avant ? 46 : 36) : (avant ? 62 : 51);
      const n = Math.ceil(largeur / pas) + 2;
      if (rangee.childElementCount === n) return;
      rangee.innerHTML = '<div class="siege"></div>'.repeat(n);
    });
  }

  /* ---------- Rideaux ---------- */
  const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
  async function ouvrirRideaux() {
    el.connexion.classList.add("part");
    el.app.hidden = false;
    await attendre(animationsActives() ? 250 : 0);
    document.body.classList.remove("rideaux-fermes");
    requestAnimationFrame(() => document.body.classList.add("projection"));
    await attendre(animationsActives() ? 900 : 0);
    el.connexion.hidden = true;
    el.connexion.classList.remove("part");
  }
  function fermerRideaux() {
    document.body.classList.remove("projection");
    document.body.classList.add("rideaux-fermes");
    el.connexion.hidden = false;
    setTimeout(() => { el.app.hidden = true; }, animationsActives() ? 1200 : 0);
  }

  /* ---------- Connexion ---------- */
  const normaliser = (u) => u.trim().toLowerCase();
  const versEmail = (u) => `${normaliser(u)}@${domaineInterne}`;
  const depuisEmail = (e) => (e || "").split("@")[0];

  function traduireErreur(err) {
    const m = (err && err.message) || "";
    if (/invalid login credentials/i.test(m)) return "Nom d'utilisateur ou mot de passe incorrect.";
    if (/already registered|already exists/i.test(m)) return "Ce nom d'utilisateur est déjà pris.";
    if (/password should be at least/i.test(m)) return "Le mot de passe doit faire au moins 6 caractères.";
    if (/signups not allowed|signup is disabled/i.test(m)) return "Les inscriptions sont fermées.";
    if (/email not confirmed/i.test(m)) return "Compte non confirmé. Désactive « Confirm email » dans Supabase.";
    if (/failed to fetch|network/i.test(m)) return "Connexion au serveur impossible. Vérifie ta connexion internet.";
    return "Une erreur est survenue. Réessaie.";
  }

  function basculerMode() {
    etat.modeInscription = !etat.modeInscription;
    el.btnConnexion.textContent = etat.modeInscription ? "Créer mon compte" : "Entrer dans la salle";
    el.btnBascule.textContent = etat.modeInscription ? "J'ai déjà un compte" : "Créer un compte";
    el.mdp.autocomplete = etat.modeInscription ? "new-password" : "current-password";
    el.erreur.textContent = "";
  }

  async function soumettre(e) {
    e.preventDefault();
    el.erreur.textContent = "";
    const u = normaliser(el.utilisateur.value);
    const mdp = el.mdp.value;

    if (!u) { el.erreur.textContent = "Entre ton nom d'utilisateur."; return el.utilisateur.focus(); }
    if (!/^[a-z0-9._-]{3,30}$/.test(u)) { el.erreur.textContent = "3 à 30 caractères : lettres, chiffres, point, tiret ou tiret bas."; return el.utilisateur.focus(); }
    if (!mdp) { el.erreur.textContent = "Entre ton mot de passe."; return el.mdp.focus(); }
    if (etat.modeInscription && mdp.length < 6) { el.erreur.textContent = "Le mot de passe doit faire au moins 6 caractères."; return el.mdp.focus(); }

    el.btnConnexion.disabled = true;
    const texte = el.btnConnexion.textContent;
    el.btnConnexion.textContent = "Un instant…";
    try {
      const { data, error } = etat.modeInscription
        ? await sb.auth.signUp({ email: versEmail(u), password: mdp, options: { data: { nom_utilisateur: u } } })
        : await sb.auth.signInWithPassword({ email: versEmail(u), password: mdp });
      if (error) throw error;
      if (!data.session) throw new Error("Email not confirmed");
      el.mdp.value = "";
    } catch (err) {
      el.erreur.textContent = traduireErreur(err);
    } finally {
      el.btnConnexion.disabled = false;
      el.btnConnexion.textContent = texte;
    }
  }

  /* ---------- Données ---------- */
  async function chargerContenus({ silencieux = false } = {}) {
    // En rechargement silencieux (après une action), on garde l'affichage et la position de défilement.
    if (!silencieux || !etat.contenus.length) el.grille.innerHTML = '<div class="squelette"></div>'.repeat(6);
    // Supabase renvoie au maximum 1000 lignes par requête : on charge par pages.
    const PAGE = 1000;
    const tout = [];
    for (let debut = 0; ; debut += PAGE) {
      const { data, error } = await sb
        .from("contenus")
        .select("*, episodes(saison, episode)")
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
        .range(debut, debut + PAGE - 1);
      if (error) {
        el.grille.innerHTML = "";
        el.grille.append(etatVide("Projection interrompue", "Impossible de charger ta bibliothèque. Recharge la page pour réessayer."));
        return;
      }
      tout.push(...(data || []));
      if (!data || data.length < PAGE) break;
    }
    etat.contenus = tout;
    afficher();
    chargerParticipations();
  }

  /* ---------- Affichage ---------- */
  const echapper = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function etoiles(note) {
    if (note == null) return "";
    const n = Number(note);
    let html = `<span class="etoiles" aria-label="${String(n).replace(".", ",")} sur 5">`;
    for (let i = 1; i <= 5; i++) {
      const cls = n >= i ? "pleine" : n >= i - 0.5 ? "demi" : "";
      html += `<span class="etoile ${cls}" aria-hidden="true">★</span>`;
    }
    return html + "</span>";
  }

  function progression(c) {
    if (c.type === "serie" && c.episodes && c.episodes.length) {
      const dernier = c.episodes.reduce((a, b) => (b.saison > a.saison || (b.saison === a.saison && b.episode > a.episode) ? b : a));
      return `S${dernier.saison} · É${dernier.episode}`;
    }
    if (c.statut !== "termine") return STATUTS[c.statut];
    if (c.annee) return String(c.annee);
    return STATUTS[c.statut];
  }

  function carte(c, i) {
    const type = TYPES.find((t) => t.id === c.type);
    const cinema = c.type === "film" || c.type === "serie";
    // Div et non button : les boutons de la carte ne peuvent pas être imbriqués dans un bouton.
    // L'ouverture de la fiche passe par .carte-lien (clavier) ; la délégation sur #grille couvre aussi les clics.
    const b = document.createElement("div");
    b.className = "carte carte-v2";
    b.dataset.type = c.type;
    b.dataset.id = c.id;
    b.style.animationDelay = `${Math.min(i, 12) * 40}ms`;
    const image = c.image_url
      ? `<img src="${echapper(c.image_url)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'affiche-vide',innerHTML:'${ICONES[c.type].replace(/"/g, "&quot;")}'}))">`
      : `<div class="affiche-vide">${ICONES[c.type]}</div>`;
    const vu = c.statut === "termine";
    const infos = cinema
      ? `${c.producteur ? `<p class="carte-info"><span>Producteur</span>${echapper(c.producteur)}</p>` : ""}
         ${c.acteurs_principaux ? `<p class="carte-info"><span>Acteurs</span>${echapper(c.acteurs_principaux)}</p>` : ""}`
      : (c.createur ? `<p class="carte-info"><span>${echapper(CREATEUR[c.type] ? CREATEUR[c.type].label : "Créateur")}</span>${echapper(c.createur)}</p>` : "");
    b.innerHTML = `
      <button type="button" class="carte-lien" aria-label="${echapper(c.titre)}"></button>
      <div class="affiche">${image}</div>
      <div class="carte-boutons">
        ${cinema ? (c.bande_annonce
          ? `<button type="button" class="cb-ba" data-ba aria-label="Bande-annonce de ${echapper(c.titre)}">▶ Bande-annonce</button>`
          : `<button type="button" class="cb-ba" disabled aria-label="Pas de bande-annonce">▶ Bande-annonce</button>`) : ""}
        <span class="cb-type">${type ? type.seul : ""}</span>
        <button type="button" class="cb-vu${vu ? " ok" : ""}" data-vu aria-pressed="${vu}" aria-label="${vu ? "Annuler le visionnage" : "Marquer comme vu"}">✓ Vu</button>
      </div>
      <div class="carte-corps">
        <h3 class="carte-titre">${echapper(c.titre)}</h3>
        ${infos}
      </div>`;
    return b;
  }


  function etatVide(titre, texte, bouton) {
    const d = document.createElement("div");
    d.className = "vide";
    d.innerHTML = `<h2>${titre}</h2><p>${texte}</p>`;
    if (bouton) {
      const b = document.createElement("button");
      b.className = "btn-or";
      b.type = "button";
      b.textContent = bouton;
      b.addEventListener("click", ajouter);
      d.append(b);
    }
    return d;
  }

  /* ---------- Onglets et filtres ---------- */
  const ongletCourant = () => ONGLETS.find((o) => o.id === etat.onglet) || ONGLETS[0];
  const dansOnglet = (o, c) => (o.catalogue ? false : o.type ? c.type === o.type : o.statut ? c.statut === o.statut : true);
  const compteOnglet = (o) => (o.catalogue
    ? (window.Catalogue && window.Catalogue.total != null ? window.Catalogue.total : "")
    : etat.contenus.filter((c) => dansOnglet(o, c)).length);
  const minuscules = (s) => (s || "").trim().toLowerCase();
  const genresDe = (c) => (c.genre || "").split(",").map((g) => g.trim()).filter(Boolean);
  const decennie = (annee) => (annee ? Math.floor(annee / 10) * 10 : null);
  const nomsDe = (c, role) => { const p = PARTICIPANTS.get(c.id); return p ? [...p[role]] : []; };
  const triAlpha = (a, b) => a.localeCompare(b, "fr", { sensitivity: "base" });
  const dansRecherche = (c, q) =>
    [c.titre, c.createur, c.genre, ...(c.tags || []), ...nomsDe(c, "acteurs"), ...nomsDe(c, "producteurs")]
      .some((v) => v && v.toLowerCase().includes(q));

  function construireOnglets() {
    el.onglets.innerHTML = "";
    ONGLETS.forEach((o, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "onglet";
      b.dataset.onglet = o.id;
      b.setAttribute("role", "tab");
      b.setAttribute("aria-controls", "grille");
      b.innerHTML = `${o.label}<span></span>`;
      b.addEventListener("click", () => changerOnglet(o.id));
      b.addEventListener("keydown", (e) => {
        const cible = { ArrowRight: (i + 1) % ONGLETS.length, ArrowLeft: (i - 1 + ONGLETS.length) % ONGLETS.length, Home: 0, End: ONGLETS.length - 1 }[e.key];
        if (cible === undefined) return;
        e.preventDefault();
        changerOnglet(ONGLETS[cible].id);
        el.onglets.querySelector(`[data-onglet="${ONGLETS[cible].id}"]`).focus();
      });
      el.onglets.append(b);
    });
    afficherOnglets();
  }

  function afficherOnglets() {
    el.onglets.querySelectorAll(".onglet").forEach((b) => {
      const o = ONGLETS.find((x) => x.id === b.dataset.onglet);
      const actif = o.id === etat.onglet;
      b.setAttribute("aria-selected", String(actif));
      b.tabIndex = actif ? 0 : -1;
      b.querySelector("span").textContent = compteOnglet(o);
    });
  }

  function changerOnglet(id) {
    if (etat.onglet === id) return;
    etat.onglet = id;
    try { localStorage.setItem("biblio-onglet", id); } catch { /* ignoré */ }
    afficher();
  }

  // Valeurs des listes déroulantes : celles présentes dans l'onglet courant.
  // La valeur déjà choisie reste toujours proposée, pour qu'un filtre actif ne disparaisse pas en silence.
  function remplirOptions(parent, items) {
    const sig = items.map((i) => `${i.v}\u0001${i.t}`).join("\u0002");
    if (parent.dataset.sig === sig) return;
    parent.dataset.sig = sig;
    const frag = document.createDocumentFragment();
    items.forEach(({ v, t }) => {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = t;
      frag.append(o);
    });
    parent.replaceChildren(frag);
  }
  function remplirSelect(select, placeholder, items) {
    const courant = select.value;
    if (courant && !items.some((i) => i.v === courant)) items = [...items, { v: courant, t: courant }];
    remplirOptions(select, [{ v: "", t: placeholder }, ...items]);
    select.value = courant;
  }
  function remplirListes(o) {
    const base = etat.contenus.filter((c) => dansOnglet(o, c));
    const valeurs = (extraire) => {
      const s = new Set();
      base.forEach((c) => extraire(c).forEach((v) => s.add(v)));
      return [...s].sort(triAlpha).map((v) => ({ v, t: v }));
    };
    const decennies = [...new Set(base.map((c) => decennie(c.annee)).filter((d) => d !== null))].sort((a, b) => b - a);
    remplirSelect(el.genre, "Tous les genres", valeurs(genresDe));
    remplirSelect(el.annee, "Toutes les années", decennies.map((d) => ({ v: String(d), t: `${d}–${d + 9}` })));
    remplirSelect(el.createur, "Tous les créateurs", valeurs((c) => (c.createur ? [c.createur] : [])));
    remplirSelect(el.tag, "Tous les tags", valeurs((c) => c.tags || []));
    const noms = (role) => valeurs((c) => nomsDe(c, role)).map((i) => i.v);
    remplirOptions(el.dlActeurs, noms("acteurs").map((v) => ({ v, t: "" })));
    remplirOptions(el.dlProducteurs, noms("producteurs").map((v) => ({ v, t: "" })));
  }

  function lireFiltres(o) {
    return {
      statut: o.statut ? "" : el.statut.value, // masqué sur « À voir » et « Incertains »
      genre: el.genre.value,
      annee: el.annee.value,
      createur: el.createur.value,
      tag: el.tag.value,
      acteur: minuscules(el.acteur.value),
      producteur: minuscules(el.producteur.value),
    };
  }

  function correspond(c, f) {
    return (!f.statut || c.statut === f.statut) &&
      (!f.genre || genresDe(c).includes(f.genre)) &&
      (!f.annee || decennie(c.annee) === Number(f.annee)) &&
      (!f.createur || c.createur === f.createur) &&
      (!f.tag || (c.tags || []).includes(f.tag)) &&
      (!f.acteur || nomsDe(c, "acteurs").some((n) => n.toLowerCase().includes(f.acteur))) &&
      (!f.producteur || nomsDe(c, "producteurs").some((n) => n.toLowerCase().includes(f.producteur)));
  }

  function reinitialiser() {
    [el.statut, el.genre, el.annee, el.createur, el.tag, el.acteur, el.producteur].forEach((c) => { c.value = ""; });
    afficher();
    (el.statut.hidden ? el.genre : el.statut).focus();
  }

  function basculerFiltres(ouvrir = !el.filtres.classList.contains("ouvert")) {
    el.filtres.classList.toggle("ouvert", ouvrir);
    el.btnFiltres.setAttribute("aria-expanded", String(ouvrir));
  }

  // Participations (acteurs, producteurs) : chargées en arrière-plan, par pages de 1000.
  function etatParticipations(statut) {
    etat.participations = statut;
    const pret = statut === "pret";
    const texte = statut === "echec" ? "Indisponible" : "Chargement…";
    [el.acteur, el.producteur].forEach((i) => { i.disabled = !pret; });
    el.acteur.placeholder = pret ? "Nom d'acteur" : texte;
    el.producteur.placeholder = pret ? "Nom de producteur" : texte;
    afficher();
  }

  async function chargerParticipations() {
    etatParticipations("chargement");
    const PAGE = 1000;
    const lignes = [];
    try {
      for (let debut = 0; ; debut += PAGE) {
        const { data, error } = await sb
          .from("participations")
          .select("role, contenu_id, personne_id, personnes(nom)")
          .not("contenu_id", "is", null)
          .order("personne_id", { ascending: true })
          .order("role", { ascending: true })
          .order("oeuvre_qid", { ascending: true })
          .range(debut, debut + PAGE - 1);
        if (error) throw error;
        lignes.push(...(data || []));
        if (!data || data.length < PAGE) break;
      }
    } catch {
      etatParticipations("echec");
      return;
    }
    PARTICIPANTS.clear();
    lignes.forEach((l) => {
      const role = l.role === "acteur" ? "acteurs" : l.role === "producteur" ? "producteurs" : null;
      const nom = Array.isArray(l.personnes) ? l.personnes[0]?.nom : l.personnes?.nom;
      if (!role || !nom) return;
      let p = PARTICIPANTS.get(l.contenu_id);
      if (!p) PARTICIPANTS.set(l.contenu_id, (p = { acteurs: new Set(), producteurs: new Set() }));
      p[role].add(nom);
    });
    etatParticipations("pret");
  }

  function afficher() {
    // Garde la position de défilement : reconstruire la grille ne doit pas faire remonter la page.
    const defilement = window.scrollY;
    afficherSansDefiler();
    if (Math.abs(window.scrollY - defilement) > 1) window.scrollTo(0, defilement);
  }

  function afficherSansDefiler() {
    const o = ongletCourant();
    // Onglet Catalogue : affichage délégué à catalogue.js
    el.filtres.hidden = Boolean(o.catalogue);
    if (o.catalogue) {
      afficherOnglets();
      if (window.Catalogue) window.Catalogue.afficher(el.grille, el.recherche.value.trim());
      return;
    }
    if (o.statut) el.statut.value = "";
    el.statut.hidden = Boolean(o.statut);
    afficherOnglets();
    remplirListes(o);

    const f = lireFiltres(o);
    const nb = Object.values(f).filter(Boolean).length;
    el.filtresNb.textContent = nb;
    el.filtresNb.hidden = nb === 0;
    el.reinitialiser.hidden = nb === 0;

    const q = el.recherche.value.trim().toLowerCase();
    const liste = etat.contenus.filter((c) => dansOnglet(o, c) && correspond(c, f) && (!q || dansRecherche(c, q)));

    const tri = el.tri.value;
    const parDate = (k) => (a, b) => (b[k] || "").localeCompare(a[k] || "");
    if (tri === "titre") liste.sort((a, b) => a.titre.localeCompare(b.titre, "fr", { sensitivity: "base" }));
    else if (tri === "note") liste.sort((a, b) => (b.note ?? -1) - (a.note ?? -1));
    else if (tri === "visionnage") liste.sort(parDate("date_visionnage"));
    else liste.sort(parDate("created_at"));

    el.grille.innerHTML = "";
    if (!etat.contenus.length) {
      el.grille.append(etatVide("La salle est prête", "Ajoute ta première série, ton premier film, article ou vidéo pour lancer la séance.", "Ajouter un contenu"));
    } else if (!liste.length) {
      el.grille.append(etatVide("Aucun résultat", "Aucune fiche ne correspond à ces filtres."));
    } else {
      liste.forEach((c, i) => el.grille.append(carte(c, i)));
    }
  }

  /* ---------- Divers ---------- */
  let minuteurToast;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add("visible");
    clearTimeout(minuteurToast);
    minuteurToast = setTimeout(() => el.toast.classList.remove("visible"), 2600);
  }

  /* ---------- Vu rapide : statut « termine » puis notation légère ---------- */
  // « ✓ Vu » : marque comme vu, ou annule le visionnage si la fiche est déjà terminée.
  async function basculerVu(id, declencheur) {
    const c = etat.contenus.find((x) => x.id === id);
    if (!c) return;
    if (c.statut !== "termine") return marquerVu(id, declencheur);
    if (declencheur) declencheur.disabled = true;
    const { data, error } = await sb.from("contenus")
      .update({ statut: "a_voir", date_visionnage: null, nb_visionnages: 0 })
      .eq("id", id).select("*, episodes(saison, episode)").single();
    if (error) {
      if (declencheur) declencheur.disabled = false;
      toast("Impossible d'annuler. Réessaie.");
      return;
    }
    etat.contenus = etat.contenus.map((x) => (x.id === data.id ? data : x));
    afficher();
    toast("Visionnage annulé");
    if (SEANCE.ouverte && SEANCE.mode === "fiche" && SEANCE.fiche && SEANCE.fiche.id === id) ouvrirFiche(id);
  }

  // Lecteur de bande-annonce (YouTube, sans cookies) en surimpression.
  let lecteurBA = null;
  function lireBandeAnnonce(url, titre) {
    const m = String(url || "").match(/(?:v=|youtu\.be\/|embed\/)([\w-]{11})/);
    if (!m) { window.open(url, "_blank", "noopener"); return; }
    fermerBandeAnnonce();
    const focusAvant = document.activeElement;
    const fond = document.createElement("div");
    fond.className = "ba-fond";
    fond.setAttribute("role", "dialog");
    fond.setAttribute("aria-modal", "true");
    fond.setAttribute("aria-label", `Bande-annonce : ${titre || ""}`);
    fond.innerHTML = `
      <div class="ba-cadre">
        <iframe src="https://www.youtube-nocookie.com/embed/${m[1]}?autoplay=1&rel=0" title="Bande-annonce : ${echapper(titre || "")}"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>
        <button type="button" class="btn-icone ba-fermer" aria-label="Fermer la bande-annonce"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
      </div>`;
    const surTouche = (e) => { if (e.key === "Escape") { e.stopPropagation(); fermerBandeAnnonce(); } };
    fond.addEventListener("click", (e) => { if (e.target === fond) fermerBandeAnnonce(); });
    fond.querySelector(".ba-fermer").addEventListener("click", () => fermerBandeAnnonce());
    document.addEventListener("keydown", surTouche, true);
    document.body.append(fond);
    document.body.classList.add("ba-ouverte");
    lecteurBA = { fond, surTouche, focusAvant };
    fond.querySelector(".ba-fermer").focus();
  }
  function fermerBandeAnnonce() {
    if (!lecteurBA) return;
    document.removeEventListener("keydown", lecteurBA.surTouche, true);
    lecteurBA.fond.remove();
    document.body.classList.remove("ba-ouverte");
    if (lecteurBA.focusAvant && document.contains(lecteurBA.focusAvant)) lecteurBA.focusAvant.focus();
    lecteurBA = null;
  }

  async function marquerVu(id, declencheur) {
    const c = etat.contenus.find((x) => x.id === id);
    if (!c || (declencheur && declencheur.disabled)) return;
    if (declencheur) declencheur.disabled = true;
    const { data, error } = await sb.from("contenus")
      .update({ statut: "termine", date_visionnage: c.date_visionnage || aujourdhui(), nb_visionnages: Math.max(1, c.nb_visionnages || 0) })
      .eq("id", id).select("*, episodes(saison, episode)").single();
    if (error) {
      if (declencheur) declencheur.disabled = false;
      toast("Impossible de marquer comme vu. Réessaie.");
      return;
    }
    etat.contenus = etat.contenus.map((x) => (x.id === data.id ? data : x));
    afficher();
    toast("Marqué comme vu");
    if (SEANCE.ouverte && SEANCE.mode === "fiche" && SEANCE.fiche && SEANCE.fiche.id === id) ouvrirFiche(id);
    // Pas de boîte de notation automatique : la note se met depuis la fiche (« Modifier »).
  }

  let notation = null; // { fond, focusAvant, surTouche } quand la boîte est ouverte
  function ouvrirNotation(c) {
    fermerNotation();
    const fond = document.createElement("div");
    fond.className = "vu-fond";
    fond.innerHTML = `
      <div class="vu-boite" role="dialog" aria-modal="true" aria-labelledby="vu-titre">
        <h2 class="vu-titre" id="vu-titre">Vu ! Tu lui mets combien ?</h2>
        <p class="vu-oeuvre">${echapper(c.titre)}</p>
        <div class="vu-note">
          <span class="vu-etiquette" id="vu-note-label">Note</span>
          <div class="choix-note">
            <div class="etoiles-saisie" role="slider" tabindex="0" aria-labelledby="vu-note-label"
                 aria-valuemin="0" aria-valuemax="5" data-note="${c.note ?? ""}"></div>
            <span class="choix-note-valeur" data-note-valeur></span>
          </div>
        </div>
        <label class="vu-avis">
          <span>Avis <em>(facultatif)</em></span>
          <textarea rows="2" maxlength="5000" placeholder="Un mot sur ce que tu en as pensé.">${echapper(c.avis || "")}</textarea>
        </label>
        <div class="vu-actions">
          <button type="button" class="btn-sobre" data-vu-action="plus-tard">Plus tard</button>
          <button type="button" class="btn-or" data-vu-action="enregistrer">Enregistrer</button>
        </div>
      </div>`;
    document.body.append(fond);
    const boite = fond.querySelector(".vu-boite");
    const zone = fond.querySelector(".etoiles-saisie");
    const avis = fond.querySelector("textarea");
    initialiserEtoiles(zone);

    // Escape ferme sans rien changer ; Tab reste dans la boîte. Capture : la séance dessous ne reçoit pas la touche.
    const surTouche = (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); fermerNotation(); return; }
      if (e.key !== "Tab") return;
      const focusables = [...boite.querySelectorAll("button:not([disabled]), textarea, [tabindex=\"0\"]")];
      const premier = focusables[0], dernier = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === premier) { e.preventDefault(); dernier.focus(); }
      else if (!e.shiftKey && document.activeElement === dernier) { e.preventDefault(); premier.focus(); }
    };
    document.addEventListener("keydown", surTouche, true);
    notation = { fond, focusAvant: document.activeElement, surTouche };

    fond.querySelector('[data-vu-action="plus-tard"]').addEventListener("click", () => fermerNotation());
    const enregistrer = fond.querySelector('[data-vu-action="enregistrer"]');
    enregistrer.addEventListener("click", async () => {
      const boutons = fond.querySelectorAll("button");
      boutons.forEach((b) => { b.disabled = true; });
      const { data, error } = await sb.from("contenus")
        .update({ note: lireNote(zone), avis: avis.value.trim() || null })
        .eq("id", c.id).select("*, episodes(saison, episode)").single();
      if (error) {
        boutons.forEach((b) => { b.disabled = false; });
        toast("Mise à jour impossible. Réessaie.");
        return;
      }
      etat.contenus = etat.contenus.map((x) => (x.id === data.id ? data : x));
      const ficheOuverte = SEANCE.ouverte && SEANCE.mode === "fiche" && SEANCE.fiche && SEANCE.fiche.id === c.id;
      fermerNotation();
      afficher();
      if (ficheOuverte) ouvrirFiche(c.id);
      toast("Note enregistrée");
    });

    zone.focus({ preventScroll: true });
  }

  function fermerNotation() {
    if (!notation) return;
    const N = notation;
    notation = null;
    document.removeEventListener("keydown", N.surTouche, true);
    N.fond.remove();
    // Rend le focus à l'endroit d'où la boîte a été ouverte, ou à défaut dans la séance ou la grille.
    const cible = (SEANCE.ouverte && SEANCE.contenu.querySelector('[data-action="modifier"]'))
      || (N.focusAvant && N.focusAvant.isConnected && N.focusAvant)
      || el.grille.querySelector(".carte-lien");
    if (cible) cible.focus({ preventScroll: true });
  }

  /* =========================================================
     Séance : fiche détaillée et formulaire
     ========================================================= */
  const SEANCE = {
    racine: $("#seance"), contenu: $("#seance-contenu"), fermer: $("#seance-fermer"),
    ouverte: false, mode: null, fiche: null, initial: null, focusAvant: null,
  };
  const CREATEUR = {
    serie: { label: "Créateur", ph: "Dan Erickson" },
    film: { label: "Réalisateur", ph: "Denis Villeneuve" },
    article: { label: "Auteur ou média", ph: "Le Temps" },
    video: { label: "Chaîne", ph: "Science Étonnante" },
  };
  const ICONE_MODIFIER = '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg>';
  const ICONE_SUPPRIMER = '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';
  const ICONE_VU = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5 9.5 17 19 7"/></svg>';

  const aujourdhui = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const formaterDate = (iso) => {
    if (!iso) return "";
    const [a, m, j] = iso.split("-").map(Number);
    return new Date(a, m - 1, j).toLocaleDateString("fr-CH", { day: "numeric", month: "long", year: "numeric" });
  };
  const formaterNote = (n) => (n == null ? "" : `${String(Number(n)).replace(".", ",")} / 5`);
  const hote = (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } };
  const urlValide = (u) => { try { const x = new URL(u); return x.protocol === "http:" || x.protocol === "https:"; } catch { return false; } };
  const idYoutube = (u) => {
    const m = (u || "").match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/);
    return m ? m[1] : null;
  };
  const affiche = (c) => c.image_url
    ? `<img src="${echapper(c.image_url)}" alt="" onerror="this.parentNode.innerHTML='<div class=&quot;affiche-vide&quot;>'+window.__icone('${c.type}')+'</div>'">`
    : `<div class="affiche-vide">${ICONES[c.type] || ICONES.film}</div>`;
  window.__icone = (t) => ICONES[t] || ICONES.film;

  /* ---------- Ouverture / fermeture ---------- */
  function ouvrirSeance() {
    if (!SEANCE.ouverte) {
      SEANCE.focusAvant = document.activeElement;
      SEANCE.ouverte = true;
      basculerMenu(false);
      SEANCE.racine.hidden = false;
      document.body.classList.add("en-seance");
      requestAnimationFrame(() => SEANCE.racine.classList.add("visible"));
    }
    SEANCE.racine.querySelector(".seance-panneau").scrollTop = 0;
  }

  function modifie() {
    return SEANCE.mode === "formulaire" && SEANCE.initial !== JSON.stringify(lireFormulaire());
  }

  function fermerSeance(forcer = false) {
    if (!SEANCE.ouverte) return;
    if (!forcer && modifie() && !confirm("Abandonner les modifications en cours ?")) return;
    SEANCE.ouverte = false;
    SEANCE.mode = null;
    SEANCE.racine.classList.remove("visible");
    document.body.classList.remove("en-seance");
    setTimeout(() => { if (!SEANCE.ouverte) { SEANCE.racine.hidden = true; SEANCE.contenu.innerHTML = ""; } }, animationsActives() ? 450 : 0);
    if (SEANCE.focusAvant && document.contains(SEANCE.focusAvant)) SEANCE.focusAvant.focus();
  }

  /* ---------- Fiche détaillée ---------- */
  function ouvrirFiche(id) {
    const c = etat.contenus.find((x) => x.id === id);
    if (!c) return;
    SEANCE.mode = "fiche";
    SEANCE.fiche = c;
    const type = TYPES.find((t) => t.id === c.type);
    const sousTitre = [c.createur, c.genre, c.annee].filter(Boolean).map(echapper).join(" · ");
    const infos = [];
    if (c.date_visionnage) infos.push(["Vu le", formaterDate(c.date_visionnage)]);
    if (c.nb_visionnages > 1) infos.push(["Visionnages", `${c.nb_visionnages} fois`]);
    if (c.lien) infos.push(["Lien", `<a href="${echapper(c.lien)}" target="_blank" rel="noopener">${echapper(hote(c.lien))} ↗</a>`, true]);
    if (c.tags && c.tags.length) infos.push(["Tags", `<div class="tags">${c.tags.map((t) => `<span class="tag">${echapper(t)}</span>`).join("")}</div>`, true]);
    infos.push(["Ajouté le", formaterDate(c.created_at.slice(0, 10))]);

    SEANCE.contenu.innerHTML = `
      <article class="fiche" data-type="${c.type}">
        <div class="fiche-affiche">${affiche(c)}</div>
        <div>
          <div class="fiche-pastilles">
            <span class="pastille or">${type ? type.seul : ""}</span>
            <span class="pastille">${STATUTS[c.statut]}</span>
            ${c.type === "serie" ? `<span class="pastille" data-progression ${progression(c).startsWith("S") ? "" : "hidden"}>${progression(c)}</span>` : ""}
          </div>
          <h2 class="fiche-titre" id="seance-titre">${echapper(c.titre)}</h2>
          ${sousTitre ? `<p class="fiche-sous-titre">${sousTitre}</p>` : ""}
          ${c.note != null ? `<div class="fiche-note">${etoiles(c.note)}<span class="fiche-note-valeur">${formaterNote(c.note)}</span></div>` : ""}
          ${c.avis ? `<blockquote class="fiche-avis">${echapper(c.avis)}</blockquote>` : `<p class="fiche-avis vide">${c.note == null ? "Pas encore noté ni commenté." : "Pas d'avis écrit."}</p>`}
          <dl class="fiche-infos">
            ${infos.map(([k, v, html]) => `<div><dt>${k}</dt><dd>${html ? v : echapper(v)}</dd></div>`).join("")}
          </dl>
          <section class="casting" data-casting aria-label="Casting et production"></section>
          <div class="fiche-actions">
            ${c.statut !== "termine" ? `<button class="btn-or" type="button" data-action="vu">${ICONE_VU}Marquer comme vu</button>` : ""}
            <button class="btn-or" type="button" data-action="modifier">${ICONE_MODIFIER}Modifier</button>
            <button class="btn-sobre btn-danger" type="button" data-action="supprimer">${ICONE_SUPPRIMER}Supprimer</button>
          </div>
          ${c.type === "serie" ? `<section class="episodes" data-episodes aria-label="Épisodes"></section>` : ""}
        </div>
      </article>`;
    ouvrirSeance();
    SEANCE.contenu.querySelector('[data-action="modifier"]').focus({ preventScroll: true });
    if (c.type === "serie") chargerEpisodes(c);
    // Casting et production (casting.js)
    const zoneCasting = SEANCE.contenu.querySelector("[data-casting]");
    if (window.Casting && zoneCasting) window.Casting.afficher(c, zoneCasting);
  }

  let minuteurSuppression;
  async function supprimer(bouton) {
    if (!bouton.classList.contains("confirmer")) {
      bouton.classList.add("confirmer");
      bouton.innerHTML = `${ICONE_SUPPRIMER}Confirmer la suppression`;
      clearTimeout(minuteurSuppression);
      minuteurSuppression = setTimeout(() => {
        if (document.contains(bouton)) { bouton.classList.remove("confirmer"); bouton.innerHTML = `${ICONE_SUPPRIMER}Supprimer`; }
      }, 4000);
      return;
    }
    clearTimeout(minuteurSuppression);
    bouton.disabled = true;
    const c = SEANCE.fiche;
    const { error } = await sb.from("contenus").delete().eq("id", c.id);
    if (error) { bouton.disabled = false; toast("Suppression impossible. Réessaie."); return; }
    etat.contenus = etat.contenus.filter((x) => x.id !== c.id);
    fermerSeance(true);
    afficher();
    toast(`« ${c.titre} » a quitté l'affiche.`);
  }

  /* ---------- Formulaire ---------- */
  function ouvrirFormulaire(c) {
    const neuf = !c;
    const typeDefaut = ongletCourant().type || "film";
    const v = c || { type: typeDefaut, statut: "termine", date_visionnage: aujourdhui(), nb_visionnages: 1, note: null, tags: [] };
    SEANCE.mode = "formulaire";
    SEANCE.fiche = c || null;

    const radio = (nom, valeur, label, actuel, icone = "") =>
      `<label><input type="radio" name="${nom}" value="${valeur}" ${actuel === valeur ? "checked" : ""}><span>${icone}${label}</span></label>`;

    SEANCE.contenu.innerHTML = `
      <h2 class="form-titre" id="seance-titre">${neuf ? "Nouvelle fiche" : "Modifier la fiche"}</h2>
      <p class="form-intro">${neuf ? "Ajoute ce que tu as vu, lu ou prévu de voir." : echapper(c.titre)}</p>
      <form id="form-fiche" class="formulaire" novalidate>
        <aside class="form-apercu">
          <div class="fiche-affiche" data-apercu></div>
          <p>Aperçu de l'affiche</p>
        </aside>
        <div class="form-champs">
          <fieldset class="form-champ large">
            <legend>Type</legend>
            <div class="segments">
              ${TYPES.filter((t) => t.id).map((t) => radio("type", t.id, t.seul, v.type, ICONES[t.id])).join("")}
            </div>
          </fieldset>

          <label class="form-champ large" data-champ="titre">
            <span>Titre <b>*</b></span>
            <input name="titre" maxlength="200" value="${echapper(v.titre || "")}" placeholder="Severance" required>
            <p class="form-erreur" data-erreur="titre"></p>
          </label>

          <label class="form-champ">
            <span data-label-createur>${CREATEUR[v.type].label}</span>
            <input name="createur" maxlength="120" value="${echapper(v.createur || "")}" placeholder="${CREATEUR[v.type].ph}">
          </label>
          <label class="form-champ">
            <span>Genre</span>
            <input name="genre" maxlength="60" value="${echapper(v.genre || "")}" placeholder="Science-fiction">
          </label>

          <label class="form-champ" data-champ="annee">
            <span>Année de sortie</span>
            <input name="annee" type="number" inputmode="numeric" min="1850" max="2100" step="1" value="${v.annee ?? ""}" placeholder="2024">
            <p class="form-erreur" data-erreur="annee"></p>
          </label>
          <label class="form-champ">
            <span>Tags</span>
            <input name="tags" maxlength="300" value="${echapper((v.tags || []).join(", "))}" placeholder="coup de cœur, à revoir">
            <p class="form-aide">Sépare-les par des virgules.</p>
          </label>

          <fieldset class="form-champ large">
            <legend>Statut</legend>
            <div class="segments">
              ${Object.entries(STATUTS).map(([k, l]) => radio("statut", k, l, v.statut)).join("")}
            </div>
          </fieldset>

          <div class="form-champ large">
            <span id="label-note">Note</span>
            <div class="choix-note">
              <div class="etoiles-saisie" role="slider" tabindex="0" aria-labelledby="label-note"
                   aria-valuemin="0" aria-valuemax="5" data-note="${v.note ?? ""}"></div>
              <span class="choix-note-valeur" data-note-valeur></span>
              <button type="button" class="lien-discret" data-effacer-note>Effacer la note</button>
            </div>
            <p class="form-aide">Clique sur la moitié gauche d'une étoile pour une demi-étoile.</p>
          </div>

          <label class="form-champ large">
            <span>Avis</span>
            <textarea name="avis" maxlength="5000" placeholder="Ce que tu en as pensé, en quelques mots ou en long.">${echapper(v.avis || "")}</textarea>
          </label>

          <label class="form-champ">
            <span>Date de visionnage</span>
            <input name="date_visionnage" type="date" max="2100-12-31" value="${v.date_visionnage || ""}">
          </label>
          <label class="form-champ" data-champ="nb_visionnages">
            <span>Nombre de visionnages</span>
            <input name="nb_visionnages" type="number" inputmode="numeric" min="0" max="999" step="1" value="${v.nb_visionnages ?? 1}">
            <p class="form-erreur" data-erreur="nb_visionnages"></p>
          </label>

          <label class="form-champ large" data-champ="lien">
            <span>Lien</span>
            <input name="lien" type="url" inputmode="url" maxlength="1000" value="${echapper(v.lien || "")}" placeholder="https://">
            <p class="form-erreur" data-erreur="lien"></p>
          </label>
          <label class="form-champ large" data-champ="image_url">
            <span>Image ou affiche (URL)</span>
            <input name="image_url" type="url" inputmode="url" maxlength="1000" value="${echapper(v.image_url || "")}" placeholder="https://">
            <p class="form-aide" data-aide-image>Pour une vidéo YouTube, la miniature est ajoutée automatiquement depuis le lien.</p>
            <p class="form-erreur" data-erreur="image_url"></p>
          </label>

          <p class="form-erreur large" data-erreur="global"></p>
          <div class="form-actions">
            <button type="button" class="btn-sobre" data-action="annuler">Annuler</button>
            <button type="submit" class="btn-or">${neuf ? "Ajouter à la bibliothèque" : "Enregistrer"}</button>
          </div>
        </div>
      </form>`;

    const f = SEANCE.contenu.querySelector("#form-fiche");
    const saisie = f.querySelector(".etoiles-saisie");
    initialiserEtoiles(saisie);
    majFormulaire(f);
    f.addEventListener("input", (e) => {
      const champ = e.target.closest("[data-champ]");
      if (champ) { champ.classList.remove("invalide"); const er = champ.querySelector(".form-erreur"); if (er) er.textContent = ""; }
      majFormulaire(f);
    });
    f.addEventListener("submit", (e) => { e.preventDefault(); enregistrer(f); });
    f.querySelector('[data-action="annuler"]').addEventListener("click", () => (c ? (modifie() && !confirm("Abandonner les modifications en cours ?") ? null : ouvrirFiche(c.id)) : fermerSeance()));
    f.querySelector("[data-effacer-note]").addEventListener("click", () => { definirNote(saisie, null); });

    ouvrirSeance();
    SEANCE.initial = JSON.stringify(lireFormulaire());
    f.querySelector('[name="titre"]').focus({ preventScroll: true });
  }

  function majFormulaire(f) {
    const type = f.querySelector('[name="type"]:checked').value;
    f.querySelector("[data-label-createur]").textContent = CREATEUR[type].label;
    f.querySelector('[name="createur"]').placeholder = CREATEUR[type].ph;
    f.querySelector("[data-aide-image]").hidden = type !== "video";
    const apercu = f.querySelector("[data-apercu]");
    const url = imageEffective(f);
    apercu.style.aspectRatio = type === "article" || type === "video" ? "16 / 10" : "2 / 3";
    const cle = `${type}|${url}`;
    if (apercu.dataset.cle !== cle) {
      apercu.dataset.cle = cle;
      apercu.innerHTML = affiche({ type, image_url: urlValide(url) ? url : "" });
    }
  }

  function imageEffective(f) {
    const image = f.querySelector('[name="image_url"]').value.trim();
    if (image) return image;
    const type = f.querySelector('[name="type"]:checked').value;
    const yt = type === "video" && idYoutube(f.querySelector('[name="lien"]').value);
    return yt ? `https://img.youtube.com/vi/${yt}/hqdefault.jpg` : "";
  }

  /* ---------- Saisie des étoiles ---------- */
  function initialiserEtoiles(zone) {
    zone.innerHTML = Array.from({ length: 5 }, () => '<span class="etoile" aria-hidden="true">★</span>').join("");
    const valeurDepuis = (e) => {
      const etoile = e.target.closest(".etoile");
      if (!etoile) return null;
      const i = [...zone.children].indexOf(etoile) + 1;
      const r = etoile.getBoundingClientRect();
      return e.clientX - r.left < r.width / 2 ? i - 0.5 : i;
    };
    zone.addEventListener("mousemove", (e) => { const v = valeurDepuis(e); if (v) peindre(zone, v); });
    zone.addEventListener("mouseleave", () => peindre(zone, lireNote(zone)));
    zone.addEventListener("click", (e) => { const v = valeurDepuis(e); if (v) definirNote(zone, v); });
    zone.addEventListener("keydown", (e) => {
      const n = lireNote(zone) ?? 0;
      const touches = { ArrowRight: 0.5, ArrowUp: 0.5, ArrowLeft: -0.5, ArrowDown: -0.5 };
      if (e.key in touches) { e.preventDefault(); const v = Math.min(5, Math.max(0, n + touches[e.key])); definirNote(zone, v || null); }
      else if (e.key === "Home") { e.preventDefault(); definirNote(zone, 0.5); }
      else if (e.key === "End") { e.preventDefault(); definirNote(zone, 5); }
      else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); definirNote(zone, null); }
    });
    definirNote(zone, lireNote(zone), true);
  }
  const lireNote = (zone) => (zone.dataset.note === "" ? null : Number(zone.dataset.note));
  function peindre(zone, n) {
    [...zone.children].forEach((s, k) => {
      const i = k + 1;
      s.className = "etoile " + (n == null ? "" : n >= i ? "pleine" : n >= i - 0.5 ? "demi" : "");
    });
  }
  function definirNote(zone, n, silencieux) {
    zone.dataset.note = n == null ? "" : String(n);
    zone.setAttribute("aria-valuenow", n ?? 0);
    zone.setAttribute("aria-valuetext", n == null ? "Pas de note" : formaterNote(n));
    peindre(zone, n);
    const sortie = zone.parentElement.querySelector("[data-note-valeur]");
    if (sortie) sortie.textContent = n == null ? "Pas de note" : formaterNote(n);
    const eff = zone.parentElement.querySelector("[data-effacer-note]");
    if (eff) eff.hidden = n == null;
    if (!silencieux) zone.dispatchEvent(new Event("input", { bubbles: true }));
  }

  /* ---------- Lecture, validation, enregistrement ---------- */
  function lireFormulaire() {
    const f = SEANCE.contenu.querySelector("#form-fiche");
    if (!f) return null;
    const val = (n) => f.querySelector(`[name="${n}"]`).value.trim();
    const nombre = (n) => (val(n) === "" ? null : Number(val(n)));
    const type = f.querySelector('[name="type"]:checked').value;
    return {
      type,
      titre: val("titre"),
      createur: val("createur") || null,
      genre: val("genre") || null,
      annee: nombre("annee"),
      tags: [...new Set(val("tags").split(",").map((t) => t.trim()).filter(Boolean))],
      statut: f.querySelector('[name="statut"]:checked').value,
      note: lireNote(f.querySelector(".etoiles-saisie")),
      avis: f.querySelector('[name="avis"]').value.trim() || null,
      date_visionnage: val("date_visionnage") || null,
      nb_visionnages: nombre("nb_visionnages") ?? 1,
      lien: val("lien") || null,
      image_url: val("image_url") || (type === "video" && idYoutube(val("lien")) ? `https://img.youtube.com/vi/${idYoutube(val("lien"))}/hqdefault.jpg` : null),
    };
  }

  function valider(f, d) {
    const erreurs = {};
    if (!d.titre) erreurs.titre = "Donne un titre à la fiche.";
    if (d.annee != null && (!Number.isInteger(d.annee) || d.annee < 1850 || d.annee > 2100)) erreurs.annee = "Entre une année entre 1850 et 2100.";
    if (!Number.isInteger(d.nb_visionnages) || d.nb_visionnages < 0 || d.nb_visionnages > 999) erreurs.nb_visionnages = "Entre un nombre entier entre 0 et 999.";
    if (d.lien && !urlValide(d.lien)) erreurs.lien = "Le lien doit commencer par http:// ou https://.";
    if (d.image_url && !urlValide(d.image_url)) erreurs.image_url = "L'adresse de l'image doit commencer par http:// ou https://.";
    f.querySelectorAll("[data-champ]").forEach((c) => c.classList.remove("invalide"));
    f.querySelectorAll(".form-erreur").forEach((p) => { p.textContent = ""; });
    Object.entries(erreurs).forEach(([k, msg]) => {
      f.querySelector(`[data-champ="${k}"]`).classList.add("invalide");
      f.querySelector(`[data-erreur="${k}"]`).textContent = msg;
    });
    const premier = Object.keys(erreurs)[0];
    if (premier) f.querySelector(`[name="${premier}"]`).focus();
    return !premier;
  }

  async function enregistrer(f) {
    const d = lireFormulaire();
    if (!valider(f, d)) return;
    const bouton = f.querySelector('[type="submit"]');
    const texte = bouton.textContent;
    bouton.disabled = true;
    bouton.textContent = "Enregistrement…";
    const existant = SEANCE.fiche;
    const requete = existant
      ? sb.from("contenus").update(d).eq("id", existant.id)
      : sb.from("contenus").insert(d);
    const { data, error } = await requete.select("*, episodes(saison, episode)").single();
    bouton.disabled = false;
    bouton.textContent = texte;
    if (error) {
      f.querySelector('[data-erreur="global"]').textContent = "L'enregistrement a échoué. Vérifie ta connexion et réessaie.";
      return;
    }
    if (existant) etat.contenus = etat.contenus.map((x) => (x.id === data.id ? data : x));
    else etat.contenus.unshift(data);
    afficher();
    SEANCE.initial = JSON.stringify(lireFormulaire());
    toast(existant ? "Fiche mise à jour." : `« ${data.titre} » est à l'affiche.`);
    ouvrirFiche(data.id);
  }

  function ajouter() { ouvrirFormulaire(null); }

  /* =========================================================
     Épisodes : suivi et note par épisode (séries)
     ========================================================= */
  const EPI = { liste: [], contenu: null, edition: null, ouvertes: new Set() };
  const ICONE_PLUS = '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>';
  const ICONE_LOT = '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10"/></svg>';

  const zoneEpisodes = () => SEANCE.contenu.querySelector("[data-episodes]");
  const moyenne = (liste) => {
    const notes = liste.map((e) => e.note).filter((n) => n != null).map(Number);
    return notes.length ? notes.reduce((a, b) => a + b, 0) / notes.length : null;
  };
  const formaterMoyenne = (m) => m.toLocaleString("fr-CH", { maximumFractionDigits: 1 });
  const derniereSaison = () => (EPI.liste.length ? Math.max(...EPI.liste.map((e) => e.saison)) : 1);
  const prochainEpisode = (saison) => {
    const ep = EPI.liste.filter((e) => e.saison === saison).map((e) => e.episode);
    return ep.length ? Math.max(...ep) + 1 : 1;
  };
  const trier = () => EPI.liste.sort((a, b) => a.saison - b.saison || a.episode - b.episode);

  async function chargerEpisodes(c) {
    const zone = zoneEpisodes();
    if (!zone) return;
    zone.innerHTML = '<p class="episodes-vide">Chargement des épisodes…</p>';
    const { data, error } = await sb.from("episodes").select("*").eq("contenu_id", c.id).order("saison").order("episode");
    if (SEANCE.mode !== "fiche" || SEANCE.fiche !== c) return;
    if (error) { zone.innerHTML = '<p class="form-erreur">Impossible de charger les épisodes. Ferme et rouvre la fiche pour réessayer.</p>'; return; }
    EPI.liste = data || [];
    EPI.contenu = c;
    EPI.edition = null;
    EPI.ouvertes = new Set([derniereSaison()]);
    rendreEpisodes();
  }

  /* ---------- Rendu ---------- */
  function rendreEpisodes() {
    const zone = zoneEpisodes();
    if (!zone) return;
    const c = EPI.contenu;
    const moy = moyenne(EPI.liste);
    const saisons = [...new Set(EPI.liste.map((e) => e.saison))];

    let resume = EPI.liste.length ? `${EPI.liste.length} épisode${EPI.liste.length > 1 ? "s" : ""} suivi${EPI.liste.length > 1 ? "s" : ""}` : "";
    if (moy != null) resume += ` · moyenne ${formaterMoyenne(moy)} / 5`;

    const arrondi = moy != null ? Math.max(0.5, Math.round(moy * 2) / 2) : null;
    const suggestion = arrondi != null && Number(c.note) !== arrondi
      ? `<div class="episodes-suggestion">
           <span>La moyenne des épisodes donne ${etoiles(arrondi)} ${formaterNote(arrondi)}</span>
           <button type="button" class="lien-discret" data-ep="moyenne">En faire la note globale</button>
         </div>`
      : "";

    zone.innerHTML = `
      <div class="episodes-entete">
        <div>
          <h3 class="episodes-titre">Épisodes</h3>
          ${resume ? `<p class="episodes-resume">${resume}</p>` : ""}
        </div>
        <div class="episodes-boutons">
          <button type="button" class="btn-sobre" data-ep="lot">${ICONE_LOT}Plusieurs</button>
          <button type="button" class="btn-sobre" data-ep="nouveau">${ICONE_PLUS}Épisode</button>
        </div>
      </div>
      ${suggestion}
      ${EPI.edition === "nouveau" ? formEpisode(null) : ""}
      ${EPI.edition === "lot" ? formLot() : ""}
      ${!EPI.liste.length && !EPI.edition ? '<p class="episodes-vide">Aucun épisode pour l\'instant. Ajoute ceux que tu as vus pour suivre ta progression et les noter un par un.</p>' : ""}
      ${saisons.map((s) => {
        const eps = EPI.liste.filter((e) => e.saison === s);
        const m = moyenne(eps);
        return `
          <details class="saison" data-saison="${s}" ${EPI.ouvertes.has(s) || eps.some((e) => e.id === EPI.edition) ? "open" : ""}>
            <summary>
              <span class="saison-nom">${s === 0 ? "Hors-série" : `Saison ${s}`}</span>
              <span class="saison-info">${eps.length} ép.${m != null ? ` · <span class="or">★</span> ${formaterMoyenne(m)}` : ""}</span>
              <svg class="saison-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
            </summary>
            <ol class="episodes-liste">
              ${eps.map((e) => (EPI.edition === e.id ? `<li>${formEpisode(e)}</li>` : ligneEpisode(e))).join("")}
            </ol>
          </details>`;
      }).join("")}`;

    zone.querySelectorAll(".etoiles-saisie").forEach(initialiserEtoiles);
    const premier = zone.querySelector(".form-episode input");
    if (premier) premier.focus({ preventScroll: false });
  }

  function ligneEpisode(e) {
    return `
      <li>
        <button type="button" class="episode" data-ep-modifier="${e.id}">
          <span class="episode-num">É${e.episode}</span>
          <span class="episode-corps">
            <span class="episode-titre">${e.titre ? echapper(e.titre) : `Épisode ${e.episode}`}</span>
            ${e.avis ? `<span class="episode-avis">${echapper(e.avis)}</span>` : ""}
          </span>
          <span class="episode-note">${e.note != null ? etoiles(e.note) : '<span class="episode-sans-note">Non noté</span>'}</span>
          <span class="episode-date">${e.date_visionnage ? formaterDate(e.date_visionnage) : ""}</span>
        </button>
      </li>`;
  }

  function formEpisode(e) {
    const neuf = !e;
    const saison = neuf ? derniereSaison() : e.saison;
    const v = e || { saison, episode: prochainEpisode(saison), date_visionnage: aujourdhui(), note: null };
    return `
      <form class="form-episode" data-form-ep="${neuf ? "nouveau" : e.id}" novalidate>
        <div class="form-episode-grille">
          <label class="form-champ" data-champ="saison"><span>Saison</span>
            <input name="saison" type="number" inputmode="numeric" min="0" max="999" step="1" value="${v.saison}"></label>
          <label class="form-champ" data-champ="episode"><span>Épisode</span>
            <input name="episode" type="number" inputmode="numeric" min="1" max="9999" step="1" value="${v.episode}"></label>
          <label class="form-champ ep-titre"><span>Titre</span>
            <input name="titre" maxlength="200" value="${echapper(v.titre || "")}" placeholder="Facultatif"></label>
          <label class="form-champ ep-date"><span>Vu le</span>
            <input name="date_visionnage" type="date" max="2100-12-31" value="${v.date_visionnage || ""}"></label>
        </div>
        <div class="form-champ">
          <span>Note</span>
          <div class="choix-note">
            <div class="etoiles-saisie" role="slider" tabindex="0" aria-label="Note de l'épisode" aria-valuemin="0" aria-valuemax="5" data-note="${v.note ?? ""}"></div>
            <span class="choix-note-valeur" data-note-valeur></span>
            <button type="button" class="lien-discret" data-effacer-note>Effacer</button>
          </div>
        </div>
        <label class="form-champ"><span>Avis</span>
          <textarea name="avis" maxlength="3000" rows="2" placeholder="Un mot sur cet épisode">${echapper(v.avis || "")}</textarea></label>
        <p class="form-erreur" data-erreur-ep></p>
        <div class="form-episode-actions">
          ${neuf ? "" : `<button type="button" class="btn-sobre btn-danger" data-ep="supprimer" data-id="${e.id}">${ICONE_SUPPRIMER}Supprimer</button>`}
          <span class="espace"></span>
          <button type="button" class="btn-sobre" data-ep="annuler">Annuler</button>
          <button type="submit" class="btn-or">${neuf ? "Ajouter l'épisode" : "Enregistrer"}</button>
        </div>
      </form>`;
  }

  function formLot() {
    const saison = derniereSaison();
    const debut = prochainEpisode(saison);
    return `
      <form class="form-episode" data-form-ep="lot" novalidate>
        <p class="form-aide lot-aide">Ajoute d'un coup une série d'épisodes vus, sans note. Tu pourras les noter ensuite un par un. Les épisodes déjà présents sont ignorés.</p>
        <div class="form-episode-grille lot">
          <label class="form-champ" data-champ="saison"><span>Saison</span>
            <input name="saison" type="number" inputmode="numeric" min="0" max="999" step="1" value="${saison}"></label>
          <label class="form-champ" data-champ="debut"><span>Du épisode</span>
            <input name="debut" type="number" inputmode="numeric" min="1" max="9999" step="1" value="${debut}"></label>
          <label class="form-champ" data-champ="fin"><span>Au épisode</span>
            <input name="fin" type="number" inputmode="numeric" min="1" max="9999" step="1" value="${debut + 9}"></label>
          <label class="form-champ ep-date"><span>Vu le</span>
            <input name="date_visionnage" type="date" max="2100-12-31" value=""></label>
        </div>
        <p class="form-erreur" data-erreur-ep></p>
        <div class="form-episode-actions">
          <span class="espace"></span>
          <button type="button" class="btn-sobre" data-ep="annuler">Annuler</button>
          <button type="submit" class="btn-or">Ajouter les épisodes</button>
        </div>
      </form>`;
  }

  /* ---------- Synchronisation avec la carte ---------- */
  function synchroniserCarte() {
    const c = EPI.contenu;
    c.episodes = EPI.liste.map((e) => ({ saison: e.saison, episode: e.episode }));
    const p = SEANCE.contenu.querySelector("[data-progression]");
    const prog = progression(c);
    if (p) { p.textContent = prog; p.hidden = !prog.startsWith("S"); }
    afficher();
  }

  /* ---------- Actions ---------- */
  function erreurEpisode(form, champs, message) {
    form.querySelectorAll("[data-champ]").forEach((x) => x.classList.toggle("invalide", champs.includes(x.dataset.champ)));
    form.querySelector("[data-erreur-ep]").textContent = message;
    if (champs[0]) form.querySelector(`[name="${champs[0]}"]`).focus();
  }
  const entier = (form, nom) => {
    const v = form.querySelector(`[name="${nom}"]`).value.trim();
    return v === "" ? NaN : Number(v);
  };

  async function enregistrerEpisode(form) {
    const cle = form.dataset.formEp;
    const saison = entier(form, "saison");
    const episode = entier(form, "episode");
    if (!Number.isInteger(saison) || saison < 0 || saison > 999) return erreurEpisode(form, ["saison"], "Entre un numéro de saison entre 0 et 999 (0 pour les hors-série).");
    if (!Number.isInteger(episode) || episode < 1 || episode > 9999) return erreurEpisode(form, ["episode"], "Entre un numéro d'épisode à partir de 1.");
    const d = {
      saison, episode,
      titre: form.querySelector('[name="titre"]').value.trim() || null,
      note: lireNote(form.querySelector(".etoiles-saisie")),
      avis: form.querySelector('[name="avis"]').value.trim() || null,
      date_visionnage: form.querySelector('[name="date_visionnage"]').value || null,
    };
    const bouton = form.querySelector('[type="submit"]');
    bouton.disabled = true;
    const req = cle === "nouveau"
      ? sb.from("episodes").insert({ ...d, contenu_id: EPI.contenu.id })
      : sb.from("episodes").update(d).eq("id", cle);
    const { data, error } = await req.select("*").single();
    bouton.disabled = false;
    if (error) {
      if (error.code === "23505") return erreurEpisode(form, ["saison", "episode"], `L'épisode ${episode} de la saison ${saison} existe déjà.`);
      return erreurEpisode(form, [], "L'enregistrement a échoué. Réessaie.");
    }
    EPI.liste = cle === "nouveau" ? [...EPI.liste, data] : EPI.liste.map((e) => (e.id === data.id ? data : e));
    trier();
    EPI.edition = null;
    EPI.ouvertes.add(data.saison);
    rendreEpisodes();
    synchroniserCarte();
    toast(cle === "nouveau" ? `S${data.saison} · É${data.episode} ajouté.` : "Épisode mis à jour.");
  }

  async function enregistrerLot(form) {
    const saison = entier(form, "saison");
    const debut = entier(form, "debut");
    const fin = entier(form, "fin");
    if (!Number.isInteger(saison) || saison < 0 || saison > 999) return erreurEpisode(form, ["saison"], "Entre un numéro de saison entre 0 et 999.");
    if (!Number.isInteger(debut) || debut < 1) return erreurEpisode(form, ["debut"], "Le premier épisode doit être au moins 1.");
    if (!Number.isInteger(fin) || fin < debut) return erreurEpisode(form, ["fin"], "Le dernier épisode doit être supérieur ou égal au premier.");
    if (fin - debut + 1 > 200) return erreurEpisode(form, ["fin"], "200 épisodes maximum à la fois.");
    const date = form.querySelector('[name="date_visionnage"]').value || null;
    const lignes = [];
    for (let n = debut; n <= fin; n++) lignes.push({ contenu_id: EPI.contenu.id, saison, episode: n, date_visionnage: date });

    const bouton = form.querySelector('[type="submit"]');
    bouton.disabled = true;
    const { data, error } = await sb.from("episodes")
      .upsert(lignes, { onConflict: "contenu_id,saison,episode", ignoreDuplicates: true })
      .select("*");
    bouton.disabled = false;
    if (error) return erreurEpisode(form, [], "L'ajout a échoué. Réessaie.");
    const ajoutes = data || [];
    EPI.liste = [...EPI.liste, ...ajoutes];
    trier();
    EPI.edition = null;
    EPI.ouvertes.add(saison);
    rendreEpisodes();
    synchroniserCarte();
    toast(ajoutes.length ? `${ajoutes.length} épisode${ajoutes.length > 1 ? "s" : ""} ajouté${ajoutes.length > 1 ? "s" : ""}.` : "Ces épisodes étaient déjà dans la liste.");
  }

  let minuteurSuppressionEp;
  async function supprimerEpisode(bouton) {
    if (!bouton.classList.contains("confirmer")) {
      bouton.classList.add("confirmer");
      bouton.innerHTML = `${ICONE_SUPPRIMER}Confirmer`;
      clearTimeout(minuteurSuppressionEp);
      minuteurSuppressionEp = setTimeout(() => {
        if (document.contains(bouton)) { bouton.classList.remove("confirmer"); bouton.innerHTML = `${ICONE_SUPPRIMER}Supprimer`; }
      }, 4000);
      return;
    }
    clearTimeout(minuteurSuppressionEp);
    bouton.disabled = true;
    const id = bouton.dataset.id;
    const { error } = await sb.from("episodes").delete().eq("id", id);
    if (error) { bouton.disabled = false; toast("Suppression impossible. Réessaie."); return; }
    EPI.liste = EPI.liste.filter((e) => e.id !== id);
    EPI.edition = null;
    rendreEpisodes();
    synchroniserCarte();
    toast("Épisode supprimé.");
  }

  async function appliquerMoyenne(bouton) {
    const moy = moyenne(EPI.liste);
    if (moy == null) return;
    const note = Math.max(0.5, Math.round(moy * 2) / 2);
    bouton.disabled = true;
    const { data, error } = await sb.from("contenus").update({ note }).eq("id", EPI.contenu.id).select("*, episodes(saison, episode)").single();
    bouton.disabled = false;
    if (error) { toast("Mise à jour impossible. Réessaie."); return; }
    etat.contenus = etat.contenus.map((x) => (x.id === data.id ? data : x));
    afficher();
    ouvrirFiche(data.id);
    toast("Note globale mise à jour.");
  }

  SEANCE.contenu.addEventListener("click", (e) => {
    if (SEANCE.mode !== "fiche" || !zoneEpisodes()) return;
    const modif = e.target.closest("[data-ep-modifier]");
    if (modif) { EPI.edition = modif.dataset.epModifier; return rendreEpisodes(); }
    const a = e.target.closest("[data-ep]");
    if (!a) return;
    const action = a.dataset.ep;
    if (action === "nouveau" || action === "lot") { EPI.edition = EPI.edition === action ? null : action; rendreEpisodes(); }
    else if (action === "annuler") { EPI.edition = null; rendreEpisodes(); }
    else if (action === "supprimer") supprimerEpisode(a);
    else if (action === "moyenne") appliquerMoyenne(a);
  });
  SEANCE.contenu.addEventListener("submit", (e) => {
    const form = e.target.closest("[data-form-ep]");
    if (!form) return;
    e.preventDefault();
    if (form.dataset.formEp === "lot") enregistrerLot(form);
    else enregistrerEpisode(form);
  });
  SEANCE.contenu.addEventListener("input", (e) => {
    const form = e.target.closest("[data-form-ep]");
    if (!form) return;
    const champ = e.target.closest("[data-champ]");
    if (champ) champ.classList.remove("invalide");
    form.querySelector("[data-erreur-ep]").textContent = "";
  });
  SEANCE.contenu.addEventListener("toggle", (e) => {
    const d = e.target;
    if (!d.matches || !d.matches("details.saison")) return;
    const s = Number(d.dataset.saison);
    if (d.open) EPI.ouvertes.add(s); else EPI.ouvertes.delete(s);
  }, true);
  SEANCE.contenu.addEventListener("click", (e) => {
    const b = e.target.closest("[data-effacer-note]");
    if (!b || !b.closest("[data-form-ep]")) return;
    definirNote(b.closest(".choix-note").querySelector(".etoiles-saisie"), null);
  });

  SEANCE.fermer.addEventListener("click", () => fermerSeance());
  SEANCE.contenu.addEventListener("click", (e) => {
    const a = e.target.closest("[data-action]");
    if (!a || SEANCE.mode !== "fiche") return;
    if (a.dataset.action === "modifier") ouvrirFormulaire(SEANCE.fiche);
    if (a.dataset.action === "supprimer") supprimer(a);
    if (a.dataset.action === "vu") marquerVu(SEANCE.fiche.id, a);
  });
  SEANCE.racine.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const focusables = [...SEANCE.racine.querySelectorAll('button:not([disabled]):not([hidden]), input, textarea, select, a[href], [tabindex="0"]')].filter((x) => x.offsetParent !== null);
    if (!focusables.length) return;
    const premier = focusables[0], dernier = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === premier) { e.preventDefault(); dernier.focus(); }
    else if (!e.shiftKey && document.activeElement === dernier) { e.preventDefault(); premier.focus(); }
  });
  window.addEventListener("beforeunload", (e) => { if (modifie()) { e.preventDefault(); e.returnValue = ""; } });

  function basculerMenu(ouvrir) {
    const o = ouvrir ?? el.menu.hidden;
    el.menu.hidden = !o;
    el.btnMenu.setAttribute("aria-expanded", String(o));
  }

  /* ---------- Session ---------- */
  let sessionActive = null;
  async function surSession(session) {
    const id = session ? session.user.id : null;
    if (id === sessionActive) return;
    sessionActive = id;
    if (session) {
      el.menuUtilisateur.textContent = `Connecté en tant que ${session.user.user_metadata?.nom_utilisateur || depuisEmail(session.user.email)}`;
      chargerContenus();
      await ouvrirRideaux();
    } else {
      fermerSeance(true);
      etat.contenus = [];
      fermerRideaux();
      setTimeout(() => el.utilisateur.focus(), 50);
    }
  }

  /* ---------- Démarrage ---------- */
  appliquerAnimations();
  placerFauteuils();
  window.addEventListener("resize", placerFauteuils);
  construireOnglets();

  el.form.addEventListener("submit", soumettre);
  el.btnBascule.addEventListener("click", basculerMode);
  [el.utilisateur, el.mdp].forEach((i) => i.addEventListener("input", () => { el.erreur.textContent = ""; }));
  el.recherche.addEventListener("input", afficher);
  el.statut.addEventListener("change", afficher);
  el.tri.addEventListener("change", afficher);
  [el.genre, el.annee, el.createur, el.tag].forEach((s) => s.addEventListener("change", afficher));
  [el.acteur, el.producteur].forEach((i) => i.addEventListener("input", afficher));
  el.reinitialiser.addEventListener("click", reinitialiser);
  el.btnFiltres.addEventListener("click", () => basculerFiltres());
  el.filtresChamps.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !el.filtres.classList.contains("ouvert")) return;
    basculerFiltres(false);
    el.btnFiltres.focus();
  });
  el.btnAjouter.addEventListener("click", ajouter);
  el.grille.addEventListener("click", (e) => {
    const c = e.target.closest(".carte");
    if (!c || !c.dataset.id) return; // cartes du catalogue : gérées par catalogue.js
    const btnVu = e.target.closest("[data-vu]");
    if (btnVu) { basculerVu(c.dataset.id, btnVu); return; } // ne doit pas ouvrir la fiche
    if (e.target.closest(".cb-ba")) {
      const f = etat.contenus.find((x) => x.id === c.dataset.id);
      if (f && f.bande_annonce) lireBandeAnnonce(f.bande_annonce, f.titre);
      return;
    }
    if (e.target.closest(".cb-type")) { /* simple étiquette */ }
    ouvrirFiche(c.dataset.id);
  });
  el.btnMenu.addEventListener("click", (e) => { e.stopPropagation(); basculerMenu(); });
  document.addEventListener("click", (e) => { if (!el.menu.hidden && !el.menu.contains(e.target)) basculerMenu(false); });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!el.menu.hidden) basculerMenu(false);
    else if (SEANCE.ouverte) fermerSeance();
  });
  el.btnAnimations.addEventListener("click", () => { ecrirePref(animationsActives() ? "non" : "oui"); appliquerAnimations(); });
  el.btnDeconnexion.addEventListener("click", async () => { basculerMenu(false); await sb.auth.signOut(); });

  /* ---------- Pont pour les modules (casting.js, personnes.js) ---------- */
  window.BIB = {
    sb,
    echapper,
    toast,
    ICONES,
    get contenus() { return etat.contenus; },
    ouvrirFiche,          // ouvrirFiche(idContenu) : ouvre la fiche d'une œuvre de la bibliothèque
    recharger: () => chargerContenus({ silencieux: true }), // recharge les fiches sans remonter en haut de page
    rafraichirOnglets: () => afficherOnglets(),
    lireBandeAnnonce, // lireBandeAnnonce(urlYoutube, titre) : lecteur en surimpression
    // majContenu(id, champs) → met à jour une fiche (ex. { statut: "a_voir" }), rafraîchit la liste ; renvoie true/false
    majContenu: async (id, champs) => {
      const { data, error } = await sb.from("contenus").update(champs).eq("id", id).select("*, episodes(saison, episode)").single();
      if (error) return false;
      etat.contenus = etat.contenus.map((x) => (x.id === data.id ? data : x));
      afficher();
      return true;
    },
    fermerSeance,
    aujourdhui,
    // noterRapide(idContenu) : ouvre la boîte de notation pour une fiche déjà chargée (après recharger()).
    noterRapide: (id) => { const c = etat.contenus.find((x) => x.id === id); if (c) ouvrirNotation(c); },
  };
  el.btnSwipe = $("#btn-swipe");
  if (el.btnSwipe) el.btnSwipe.addEventListener("click", () => { if (window.Swipe) window.Swipe.ouvrir(); });
  el.btnAnnuaire = $("#btn-annuaire");
  if (el.btnAnnuaire) el.btnAnnuaire.addEventListener("click", () => { if (window.Personnes) window.Personnes.ouvrirAnnuaire(); });

  sb.auth.onAuthStateChange((_evt, session) => { setTimeout(() => surSession(session), 0); });
  sb.auth.getSession().then(({ data }) => {
    if (!data.session) { el.connexion.hidden = false; el.utilisateur.focus(); }
  });
})();