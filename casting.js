/* Casting et production dans la fiche d'une œuvre.
   Exposé : window.Casting = { afficher(c, zone) }
   Dépend de window.BIB (sb, echapper) fourni par app.js. */
(function () {
  "use strict";

  const LIMITE_ACTEURS = 12;

  const echapper = (s) => window.BIB.echapper(String(s == null ? "" : s));

  function trier(liste) {
    return liste.sort((a, b) => a.nom.localeCompare(b.nom, "fr", { sensitivity: "base" }));
  }

  // Une personne peut apparaître plusieurs fois pour un même rôle : on dédoublonne.
  function regrouper(lignes) {
    const vus = new Set();
    const producteurs = [];
    const acteurs = [];
    for (const l of lignes) {
      const cle = l.role + "|" + l.personne_id;
      if (vus.has(cle)) continue;
      vus.add(cle);
      const personne = { id: l.personne_id, nom: (l.personnes && l.personnes.nom) || "Sans nom" };
      if (l.role === "producteur") producteurs.push(personne);
      else if (l.role === "acteur") acteurs.push(personne);
    }
    return { producteurs: trier(producteurs), acteurs: trier(acteurs) };
  }

  function puces(liste) {
    return liste.map((p) =>
      `<li><button class="casting-puce" type="button" data-personne="${echapper(p.id)}">${echapper(p.nom)}</button></li>`
    ).join("");
  }

  function blocActeurs(acteurs) {
    if (!acteurs.length) return "";
    const visibles = acteurs.slice(0, LIMITE_ACTEURS);
    const reste = acteurs.slice(LIMITE_ACTEURS);
    const bouton = reste.length
      ? `<button class="casting-plus" type="button" aria-expanded="false" data-plus>Voir les ${reste.length} autres</button>`
      : "";
    return `
      <div class="casting-bloc">
        <h3 class="casting-titre">Casting</h3>
        <ul class="casting-liste" data-liste-acteurs>${puces(visibles)}</ul>
        ${reste.length ? `<ul class="casting-liste casting-liste-suite" data-suite hidden>${puces(reste)}</ul>` : ""}
        ${bouton}
      </div>`;
  }

  function blocProducteurs(producteurs) {
    if (!producteurs.length) return "";
    return `
      <div class="casting-bloc">
        <h3 class="casting-titre">Production</h3>
        <ul class="casting-liste">${puces(producteurs)}</ul>
      </div>`;
  }

  function afficherEtat(zone, texte) {
    zone.innerHTML = `<p class="casting-etat">${echapper(texte)}</p>`;
  }

  function rendre(zone, groupes) {
    const { producteurs, acteurs } = groupes;
    if (!producteurs.length && !acteurs.length) {
      afficherEtat(zone, "Casting non renseigné.");
      return;
    }
    zone.innerHTML = blocProducteurs(producteurs) + blocActeurs(acteurs);
  }

  // Délégation : un seul écouteur par zone, les boutons sont recréés à chaque rendu.
  function brancher(zone) {
    if (zone.dataset.castingBranche) return;
    zone.dataset.castingBranche = "1";
    zone.addEventListener("click", (e) => {
      const plus = e.target.closest("[data-plus]");
      if (plus) {
        const suite = zone.querySelector("[data-suite]");
        const ouvert = plus.getAttribute("aria-expanded") === "true";
        if (suite) suite.hidden = ouvert;
        plus.setAttribute("aria-expanded", String(!ouvert));
        plus.textContent = ouvert ? plus.dataset.libelle : "Réduire";
        return;
      }
      const puce = e.target.closest("[data-personne]");
      if (puce && window.Personnes && typeof window.Personnes.ouvrirPersonne === "function") {
        window.Personnes.ouvrirPersonne(puce.dataset.personne);
      }
    });
  }

  function memoriserLibelle(zone) {
    const plus = zone.querySelector("[data-plus]");
    if (plus) plus.dataset.libelle = plus.textContent;
  }

  async function afficher(c, zone) {
    if (!zone) return;
    if (!c || (c.type !== "film" && c.type !== "serie")) {
      zone.hidden = true;
      zone.innerHTML = "";
      return;
    }
    zone.hidden = false;
    brancher(zone);

    const jeton = Symbol("casting");
    zone._jetonCasting = jeton;
    afficherEtat(zone, "Chargement du casting…");

    try {
      const { data, error } = await window.BIB.sb
        .from("participations")
        .select("role, personne_id, personnes(nom)")
        .eq("contenu_id", c.id);

      // La fiche a pu être remplacée pendant la requête : on ne touche plus à cette zone.
      if (!zone.isConnected || zone._jetonCasting !== jeton) return;
      if (error) throw error;

      rendre(zone, regrouper(data || []));
      memoriserLibelle(zone);
    } catch (err) {
      if (!zone.isConnected || zone._jetonCasting !== jeton) return;
      console.error("casting :", err);
      afficherEtat(zone, "Casting indisponible.");
    }
  }

  window.Casting = { afficher };
})();