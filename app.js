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
  const STATUTS = { a_voir: "À voir", en_cours: "En cours", termine: "Terminé", abandonne: "Abandonné" };
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
    btnAjouter: $("#btn-ajouter"), btnMenu: $("#btn-menu"), menu: $("#menu"),
    menuUtilisateur: $("#menu-utilisateur"), btnAnimations: $("#btn-animations"), btnDeconnexion: $("#btn-deconnexion"),
    toast: $("#toast"),
  };

  const etat = { contenus: [], type: "", modeInscription: false };

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
  async function chargerContenus() {
    el.grille.innerHTML = '<div class="squelette"></div>'.repeat(6);
    const { data, error } = await sb
      .from("contenus")
      .select("*, episodes(saison, episode)")
      .order("created_at", { ascending: false });
    if (error) {
      el.grille.innerHTML = "";
      el.grille.append(etatVide("Projection interrompue", "Impossible de charger ta bibliothèque. Recharge la page pour réessayer."));
      return;
    }
    etat.contenus = data || [];
    afficher();
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
    const b = document.createElement("button");
    b.type = "button";
    b.className = "carte";
    b.dataset.type = c.type;
    b.dataset.id = c.id;
    b.style.animationDelay = `${Math.min(i, 12) * 40}ms`;
    const image = c.image_url
      ? `<img src="${echapper(c.image_url)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'affiche-vide',innerHTML:'${ICONES[c.type].replace(/"/g, "&quot;")}'}))">`
      : `<div class="affiche-vide">${ICONES[c.type]}</div>`;
    b.innerHTML = `
      <div class="affiche">
        ${image}
        <span class="badge badge-type">${type ? type.seul : ""}</span>
        <span class="badge badge-info">${echapper(progression(c))}</span>
      </div>
      <div class="carte-corps">
        <h3 class="carte-titre">${echapper(c.titre)}</h3>
        ${c.createur ? `<p class="carte-createur">${echapper(c.createur)}</p>` : ""}
        ${etoiles(c.note)}
        <p class="carte-avis ${c.avis ? "" : "sans-avis"}">${c.avis ? echapper(c.avis) : c.note == null ? "Pas encore noté" : "Pas d'avis"}</p>
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

  function afficherOnglets() {
    const compte = (id) => etat.contenus.filter((c) => !id || c.type === id).length;
    el.onglets.innerHTML = "";
    TYPES.forEach((t) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "onglet";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(etat.type === t.id));
      b.innerHTML = `${t.label}<span>${compte(t.id)}</span>`;
      b.addEventListener("click", () => { etat.type = t.id; afficher(); });
      el.onglets.append(b);
    });
  }

  function afficher() {
    afficherOnglets();
    const q = el.recherche.value.trim().toLowerCase();
    const statut = el.statut.value;
    let liste = etat.contenus.filter((c) =>
      (!etat.type || c.type === etat.type) &&
      (!statut || c.statut === statut) &&
      (!q || [c.titre, c.createur, c.genre, ...(c.tags || [])].some((v) => v && v.toLowerCase().includes(q)))
    );

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
            ${c.type === "serie" && progression(c).startsWith("S") ? `<span class="pastille">${progression(c)}</span>` : ""}
          </div>
          <h2 class="fiche-titre" id="seance-titre">${echapper(c.titre)}</h2>
          ${sousTitre ? `<p class="fiche-sous-titre">${sousTitre}</p>` : ""}
          ${c.note != null ? `<div class="fiche-note">${etoiles(c.note)}<span class="fiche-note-valeur">${formaterNote(c.note)}</span></div>` : ""}
          ${c.avis ? `<blockquote class="fiche-avis">${echapper(c.avis)}</blockquote>` : `<p class="fiche-avis vide">${c.note == null ? "Pas encore noté ni commenté." : "Pas d'avis écrit."}</p>`}
          <dl class="fiche-infos">
            ${infos.map(([k, v, html]) => `<div><dt>${k}</dt><dd>${html ? v : echapper(v)}</dd></div>`).join("")}
          </dl>
          <div class="fiche-actions">
            <button class="btn-or" type="button" data-action="modifier">${ICONE_MODIFIER}Modifier</button>
            <button class="btn-sobre btn-danger" type="button" data-action="supprimer">${ICONE_SUPPRIMER}Supprimer</button>
          </div>
          ${c.type === "serie" ? `<div class="fiche-episodes">Le suivi et la note par épisode arrivent à l'étape suivante.</div>` : ""}
        </div>
      </article>`;
    ouvrirSeance();
    SEANCE.contenu.querySelector('[data-action="modifier"]').focus({ preventScroll: true });
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
    const typeDefaut = etat.type || "film";
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

  SEANCE.fermer.addEventListener("click", () => fermerSeance());
  SEANCE.contenu.addEventListener("click", (e) => {
    const a = e.target.closest("[data-action]");
    if (!a || SEANCE.mode !== "fiche") return;
    if (a.dataset.action === "modifier") ouvrirFormulaire(SEANCE.fiche);
    if (a.dataset.action === "supprimer") supprimer(a);
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

  el.form.addEventListener("submit", soumettre);
  el.btnBascule.addEventListener("click", basculerMode);
  [el.utilisateur, el.mdp].forEach((i) => i.addEventListener("input", () => { el.erreur.textContent = ""; }));
  el.recherche.addEventListener("input", afficher);
  el.statut.addEventListener("change", afficher);
  el.tri.addEventListener("change", afficher);
  el.btnAjouter.addEventListener("click", ajouter);
  el.grille.addEventListener("click", (e) => { const c = e.target.closest(".carte"); if (c) ouvrirFiche(c.dataset.id); });
  el.btnMenu.addEventListener("click", (e) => { e.stopPropagation(); basculerMenu(); });
  document.addEventListener("click", (e) => { if (!el.menu.hidden && !el.menu.contains(e.target)) basculerMenu(false); });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!el.menu.hidden) basculerMenu(false);
    else if (SEANCE.ouverte) fermerSeance();
  });
  el.btnAnimations.addEventListener("click", () => { ecrirePref(animationsActives() ? "non" : "oui"); appliquerAnimations(); });
  el.btnDeconnexion.addEventListener("click", async () => { basculerMenu(false); await sb.auth.signOut(); });

  sb.auth.onAuthStateChange((_evt, session) => { setTimeout(() => surSession(session), 0); });
  sb.auth.getSession().then(({ data }) => {
    if (!data.session) { el.connexion.hidden = false; el.utilisateur.focus(); }
  });
})();
