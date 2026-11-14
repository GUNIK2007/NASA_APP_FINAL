/* Réact+ : logique de l'interface
 *
 *  1. Configuration      seuils, dimensions, couleurs
 *  2. Données            capteur et satellite (démonstration)
 *  3. Utilitaires        sélecteur, formats
 *  4. Graphiques         courbes, écart, statistiques, survol
 *  5. Mesures            cartes « dernières mesures »
 *  6. Décisions          règles d'irrigation et de chaleur
 *  7. NASA POWER         chargement des données en direct
 *  8. Démarrage
 */
"use strict";

/* ========== 1. CONFIGURATION ========== */

const N = 14; // nombre de jours affichés
const SEUIL_SOL = 70; // % : humidité du sol au-dessus de laquelle le riz n'a pas besoin d'eau
const SEUIL_CHALEUR = 35; // °C : seuil indicatif de stress du riz à la floraison
const MARGE_SURVEILLANCE = 4; // °C : sous cette marge, la chaleur est à surveiller
// Coordonnées de Kara utilisées pour demander le point météo correspondant à la parcelle.
const KARA = { lat: 9.55, lon: 1.19 };

const MOIS = ["jan", "fév", "mars", "avr", "mai", "juin", "juil", "août", "sept", "oct", "nov", "déc"];

const COULEURS = {
  capteur: "#16834A",
  satellite: "#3F6E8C",
  negatif: "#DC4C4C",
  grille: "#E1E8E3",
  zero: "#8A978E",
  texte: "#26352D",
};

// Les couleurs des graphiques suivent le thème (clair/sombre) : lues dans les variables CSS
function synchroniserCouleurs() {
  const s = getComputedStyle(document.documentElement);
  const v = (nom, defaut) => s.getPropertyValue(nom).trim() || defaut;
  COULEURS.capteur = v("--g", COULEURS.capteur);
  COULEURS.satellite = v("--sat", COULEURS.satellite);
  COULEURS.negatif = v("--crit", COULEURS.negatif);
  COULEURS.grille = v("--line", COULEURS.grille);
  COULEURS.zero = v("--mut", COULEURS.zero);
  COULEURS.texte = v("--ink", COULEURS.texte);
}

// Dimensions des graphiques (unités du viewBox SVG)
const GRAPHE = { largeur: 720, hauteur: 290, gauche: 48, droite: 16, haut: 30, bas: 30 };
const ECART = { hauteur: 140, haut: 16, bas: 28, largeurBarre: 26 };
const JOURS_AFFICHES = [0, 3, 6, 9, 13]; // indices des dates écrites sous l'axe

/* ========== 2. DONNÉES (démonstration) ========== */

// capteur = mesure sur la parcelle, satellite = mesure de la maille NASA
const DONNEES = {
  hum: {
    nom: "Humidité du sol",
    sat: "SMAP",
    unite: " %",
    uniteEcart: " pts",
    pas: 10,
    dec: 0,
    capteur: [74, 76, 79, 81, 80, 83, 82, 79, 77, 80, 84, 86, 84, 82],
    satellite: [58, 60, 63, 65, 64, 66, 66, 62, 60, 63, 67, 69, 67, 65],
  },
  temp: {
    nom: "Température",
    sat: "POWER",
    unite: " °C",
    uniteEcart: " °C",
    pas: 1,
    dec: 1,
    capteur: [29.1, 30.2, 31.0, 30.6, 29.8, 30.9, 32.1, 31.4, 30.2, 29.5, 30.8, 31.7, 32.4, 31.9],
    satellite: [28.2, 29.0, 29.8, 29.9, 29.1, 29.8, 30.7, 30.5, 29.4, 28.9, 29.6, 30.3, 31.0, 30.6],
  },
  rain: {
    nom: "Pluie",
    sat: "GPM",
    unite: " mm",
    uniteEcart: " mm",
    pas: 5,
    dec: 0,
    capteur: [0, 6, 14, 2, 0, 0, 8, 22, 4, 0, 0, 5, 12, 0],
    satellite: [1, 4, 11, 3, 0, 0, 6, 15, 5, 1, 0, 3, 9, 1],
  },
};

// Valeurs partagées par les graphiques et leur infobulle; les dates changent après le chargement NASA.
const etat = {
  dates: Array.from({ length: N }, (_, i) => `${18 + i} oct`),
  enDirect: false, // true une fois les données POWER chargées
};

/* ========== 3. UTILITAIRES ========== */

const $ = (sel) => document.querySelector(sel);

// 31.9 -> "31,9"
const fmt = (v, dec = 0) => v.toFixed(dec).replace(".", ",");

// 3 -> "+3", -3 -> "−3", 0 -> "0"
const signe = (v, dec = 0) => (v > 0 ? "+" : v < 0 ? "−" : "") + fmt(Math.abs(v), dec);

/* ========== 4. GRAPHIQUES ========== */

// Les fonctions suivantes calculent les positions SVG puis assemblent le HTML injecté dans #charts.

/* --- Géométrie --- */

const posX = (i) => GRAPHE.gauche + ((GRAPHE.largeur - GRAPHE.gauche - GRAPHE.droite) * i) / (N - 1);

const posY = (v, m) => GRAPHE.haut + (GRAPHE.hauteur - GRAPHE.haut - GRAPHE.bas) * (1 - (v - m.min) / (m.max - m.min));

const points = (serie, m) => serie.map((v, i) => `${posX(i)},${posY(v, m)}`).join(" ");

const etiquettesX = (y) =>
  JOURS_AFFICHES.map((i) => `<text x="${posX(i)}" y="${y}" text-anchor="middle">${etat.dates[i]}</text>`).join("");

/* --- Calculs --- */

// Fixe les bornes de l'axe vertical sur les deux séries
function calculerAxe(m) {
  const toutes = [...m.capteur, ...m.satellite];
  m.min = Math.floor(Math.min(...toutes) / m.pas) * m.pas;
  m.max = Math.ceil(Math.max(...toutes) / m.pas) * m.pas;
  if (m.max === m.min) m.max += m.pas;
}

// Écart capteur moins satellite, jour par jour
function analyserEcart(m) {
  const valeurs = m.capteur.map((v, i) => v - m.satellite[i]);
  return {
    valeurs,
    moyenne: valeurs.reduce((a, b) => a + b) / N,
    iMax: valeurs.reduce((best, v, i) => (Math.abs(v) > Math.abs(valeurs[best]) ? i : best), 0),
    joursAuDessus: valeurs.filter((v) => v > 0).length,
  };
}

/* --- Briques SVG du graphique principal --- */

function svgMotifEcart(id) {
  return `<defs>
    <pattern id="${id}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="6" height="6" fill="${COULEURS.satellite}" fill-opacity=".12"/>
      <line y2="6" stroke="${COULEURS.texte}" stroke-opacity=".35" stroke-width="1.6"/>
    </pattern>
  </defs>`;
}

function svgGrille(m) {
  let html = "";
  for (let v = m.min; v <= m.max + 1e-9; v += m.pas) {
    const y = posY(v, m);
    html += `<line x1="${GRAPHE.gauche}" x2="${GRAPHE.largeur - GRAPHE.droite}" y1="${y}" y2="${y}" stroke="${COULEURS.grille}"/>`;
    html += `<text x="${GRAPHE.gauche - 8}" y="${y + 4}" text-anchor="end">${Math.round(v * 10) / 10}</text>`;
  }
  return html;
}

// Zone hachurée entre les deux courbes : le contour suit le capteur, puis revient par le satellite
function svgZoneEcart(m, id) {
  const retour = m.satellite
    .map((v, i) => `${posX(i)},${posY(v, m)}`)
    .reverse()
    .join(" ");
  return `<polygon points="${points(m.capteur, m)} ${retour}" fill="url(#${id})"/>`;
}

function svgCourbes(m) {
  const trait = (serie, couleur) =>
    `<polyline points="${points(serie, m)}" fill="none" stroke="${couleur}" stroke-width="3" stroke-linejoin="round"/>`;
  const pastilles = m.capteur
    .map(
      (v, i) =>
        `<circle cx="${posX(i)}" cy="${posY(v, m)}" r="3.5" fill="${COULEURS.capteur}"/>` +
        `<circle cx="${posX(i)}" cy="${posY(m.satellite[i], m)}" r="3.5" fill="${COULEURS.satellite}"/>`,
    )
    .join("");
  return trait(m.satellite, COULEURS.satellite) + trait(m.capteur, COULEURS.capteur) + pastilles;
}

// Trait vertical et valeur sur le jour où l'écart est le plus grand
function svgMarqueurEcart(m, iMax, ecart) {
  const x = posX(iMax);
  const yHaut = posY(m.capteur[iMax], m);
  const yBas = posY(m.satellite[iMax], m);
  return (
    `<line x1="${x}" x2="${x}" y1="${yHaut}" y2="${yBas}" stroke="${COULEURS.texte}" stroke-width="2" stroke-dasharray="4 3"/>` +
    `<text x="${x}" y="${Math.min(yHaut, yBas) - 10}" text-anchor="middle" font-weight="700" fill="${COULEURS.texte}">${signe(ecart, m.dec)}</text>`
  );
}

function svgPrincipal(cle, m, a) {
  const id = `h-${cle}`;
  return `<svg class="main" viewBox="0 0 ${GRAPHE.largeur} ${GRAPHE.hauteur}" role="img" aria-label="Courbes capteur et ${m.sat}, ${m.nom}">
    ${svgMotifEcart(id)}
    ${svgGrille(m)}
    ${svgZoneEcart(m, id)}
    ${svgCourbes(m)}
    ${svgMarqueurEcart(m, a.iMax, a.valeurs[a.iMax])}
    <line class="cur" y1="${GRAPHE.haut}" y2="${GRAPHE.hauteur - GRAPHE.bas}" style="display:none"/>
    ${etiquettesX(GRAPHE.hauteur - 8)}
  </svg>`;
}

/* --- Graphique de l'écart (barres) --- */

function svgBarresEcart(a) {
  const demi = (ECART.hauteur - ECART.haut - ECART.bas) / 2;
  const zero = ECART.haut + demi;
  const maxAbs = Math.ceil(Math.max(...a.valeurs.map(Math.abs))) || 1;

  const barres = a.valeurs
    .map((v, i) => {
      const h = Math.max((Math.abs(v) / maxAbs) * demi, 1);
      const y = v >= 0 ? zero - h : zero;
      const couleur = v >= 0 ? COULEURS.capteur : COULEURS.negatif;
      return `<rect x="${posX(i) - ECART.largeurBarre / 2}" y="${y}" width="${ECART.largeurBarre}" height="${h}" rx="2" fill="${couleur}"/>`;
    })
    .join("");

  const x = GRAPHE.gauche - 8;
  const echelle =
    `<text x="${x}" y="${ECART.haut + 4}" text-anchor="end">${signe(maxAbs)}</text>` +
    `<text x="${x}" y="${zero + 4}" text-anchor="end">0</text>` +
    `<text x="${x}" y="${ECART.hauteur - ECART.bas + 4}" text-anchor="end">${signe(-maxAbs)}</text>`;

  return `<svg viewBox="0 0 ${GRAPHE.largeur} ${ECART.hauteur}" role="img" aria-label="Écart capteur moins satellite">
    ${echelle}
    <line x1="${GRAPHE.gauche}" x2="${GRAPHE.largeur - GRAPHE.droite}" y1="${zero}" y2="${zero}" stroke="${COULEURS.zero}"/>
    ${barres}
    ${etiquettesX(ECART.hauteur - 6)}
  </svg>`;
}

/* --- Bloc complet d'une mesure --- */

const htmlLegende = (m) => `
  <div class="legend">
    <span class="k s">Capteur de la parcelle</span>
    <span class="k g">${m.sat} (satellite)</span>
    <span class="k h">Écart entre les deux</span>
  </div>`;

const htmlStatistiques = (m, a) => `
  <dl class="stats">
    <div><dt>Écart moyen</dt><dd>${signe(a.moyenne, m.dec)}${m.uniteEcart}</dd></div>
    <div><dt>Jour le plus éloigné</dt><dd>${etat.dates[a.iMax]} : ${signe(a.valeurs[a.iMax], m.dec)}${m.uniteEcart}</dd></div>
    <div><dt>Jours capteur au-dessus</dt><dd>${a.joursAuDessus} sur ${N}</dd></div>
  </dl>`;

function blocGraphique(cle) {
  const m = DONNEES[cle];
  calculerAxe(m);
  const a = analyserEcart(m);
  const sens = a.moyenne >= 0 ? "plus" : "moins";

  return `<div class="chart c-${cle}">
    ${htmlLegende(m)}
    <div class="plot">${svgPrincipal(cle, m, a)}<div class="tip"></div></div>
    <p class="cap">Écart : capteur moins satellite. En vert, le capteur mesure plus ; en rouge, moins.</p>
    <div class="plot">${svgBarresEcart(a)}</div>
    ${htmlStatistiques(m, a)}
    <p class="read">Le capteur mesure ${sens} que ${m.sat} en moyenne : il voit la parcelle, le satellite voit une maille entière.</p>
  </div>`;
}

/* --- Infobulle au survol --- */

function activerSurvol(svg, cle) {
  const curseur = svg.querySelector(".cur");
  const bulle = svg.parentNode.querySelector(".tip");

  svg.addEventListener("pointermove", (e) => {
    const m = DONNEES[cle];
    const rect = svg.getBoundingClientRect();
    const xSvg = ((e.clientX - rect.left) / rect.width) * GRAPHE.largeur;
    const i = Math.max(
      0,
      Math.min(
        N - 1,
        Math.round(((xSvg - GRAPHE.gauche) / (GRAPHE.largeur - GRAPHE.gauche - GRAPHE.droite)) * (N - 1)),
      ),
    );
    const ecart = m.capteur[i] - m.satellite[i];

    curseur.setAttribute("x1", posX(i));
    curseur.setAttribute("x2", posX(i));
    curseur.style.display = "";

    bulle.innerHTML =
      `<b>${etat.dates[i]}</b><br>Capteur ${fmt(m.capteur[i], m.dec)}${m.unite}` +
      `<br>${m.sat} ${fmt(m.satellite[i], m.dec)}${m.unite}` +
      `<br>Écart ${signe(ecart, m.dec)}${m.uniteEcart}`;
    bulle.style.display = "block";
    bulle.style.left = Math.min(Math.max((posX(i) / GRAPHE.largeur) * rect.width, 60), rect.width - 60) + "px";
  });

  svg.addEventListener("pointerleave", () => {
    curseur.style.display = "none";
    bulle.style.display = "none";
  });
}

function afficherGraphiques() {
  synchroniserCouleurs();
  // Construit les trois mesures, puis n'affiche que celle choisie par les radios m-hum/m-temp/m-rain.
  const cles = Object.keys(DONNEES);
  $("#charts").innerHTML = cles.map(blocGraphique).join("");
  document.querySelectorAll(".plot svg.main").forEach((svg, i) => activerSurvol(svg, cles[i]));

  $("#sub").textContent = etat.enDirect
    ? `Parcelle de riz, Kara · satellite : NASA POWER en direct, du ${etat.dates[0]} au ${etat.dates[N - 1]} · capteur de démonstration`
    : "Parcelle de riz, Kara · du 18 au 31 octobre · données de démonstration";
}

/* ========== 5. MESURES ========== */

const icone = (nom) => `<svg class="ic" aria-hidden="true"><use href="#i-${nom}"/></svg>`;

// Variation entre l'avant-dernier et le dernier jour du capteur
function tendance(m) {
  const delta = m.capteur[N - 1] - m.capteur[N - 2];
  const stable = Math.abs(delta) < Math.pow(10, -m.dec) / 2;
  return { delta, sens: stable ? "flat" : delta > 0 ? "up" : "down" };
}

// Mini courbe de l'évolution du capteur sur la période
function sparkline(serie) {
  const w = 96;
  const h = 32;
  const min = Math.min(...serie);
  const etendue = Math.max(...serie) - min || 1;
  const pts = serie.map((v, i) => [(w * i) / (serie.length - 1), h - 3 - ((v - min) / etendue) * (h - 6)]);
  const ligne = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [xf, yf] = pts[pts.length - 1];
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true">
    <polygon class="area" points="0,${h} ${ligne} ${w},${h}"/>
    <polyline class="line" points="${ligne}"/>
    <circle class="end" cx="${xf.toFixed(1)}" cy="${yf.toFixed(1)}" r="3"/>
  </svg>`;
}

// État global de la parcelle, cohérent avec les seuils du moteur de décision
function etatParcelle() {
  const sol = DONNEES.hum.capteur[N - 1];
  const marge = SEUIL_CHALEUR - DONNEES.temp.capteur[N - 1];
  if (marge <= 0) {
    return { points: 1, classe: " danger", titre: "Alerte", detail: "Chaleur au-dessus du seuil du riz" };
  }
  if (marge <= MARGE_SURVEILLANCE) {
    return { points: 2, classe: " warning", titre: "À surveiller", detail: `Chaleur : marge de ${fmt(marge, 1)} °C avant le seuil` };
  }
  if (sol <= SEUIL_SOL) {
    return { points: 2, classe: " warning", titre: "À surveiller", detail: `Sol sous le seuil de ${SEUIL_SOL} % pour le riz` };
  }
  return { points: 3, classe: "", titre: "Favorable", detail: "Eau et chaleur dans les seuils du riz" };
}

function carteMesure(cle, titre, icon) {
  const m = DONNEES[cle];
  const capteur = m.capteur[N - 1];
  const satellite = m.satellite[N - 1];
  const t = tendance(m);
  const fleche = { up: "up", down: "down", flat: "flat" }[t.sens];
  return `<article class="stat-card">
    <div class="stat-top"><span class="stat-ic">${icone(icon)}</span>${titre}<span class="stat-badge">Capteur · démo</span></div>
    <div class="stat-value"><span class="num" data-to="${capteur}" data-dec="${m.dec}">${fmt(capteur, m.dec)}</span><span class="stat-unit">${m.unite.trim()}</span></div>
    <div class="stat-foot">
      <span class="trend ${t.sens === "flat" ? "flat" : ""}">${icone(fleche)}${signe(t.delta, m.dec)}${m.uniteEcart} vs veille</span>
      ${sparkline(m.capteur)}
    </div>
    <div class="stat-source">${m.sat} ${fmt(satellite, m.dec)}${m.unite} · écart ${signe(capteur - satellite, m.dec)}${m.uniteEcart}</div>
  </article>`;
}

function carteEtat() {
  const e = etatParcelle();
  const segments = [1, 2, 3].map((i) => `<i class="${i <= e.points ? "on" : ""}"></i>`).join("");
  return `<article class="stat-card${e.classe}">
    <div class="stat-top"><span class="stat-ic">${icone("leaf")}</span>État de la parcelle</div>
    <div class="stat-value"><span class="stat-state">${e.titre}</span></div>
    <div class="stat-foot">
      <span class="trend flat">Selon les seuils du riz</span>
      <span class="level" role="img" aria-label="Niveau ${e.points} sur 3">${segments}</span>
    </div>
    <div class="stat-source">${e.detail}</div>
  </article>`;
}

// Fait « monter » les valeurs vers leur nombre final (une seule fois, au premier affichage)
function animerValeurs() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  document.querySelectorAll("#reads .num").forEach((el) => {
    const cible = +el.dataset.to;
    const dec = +el.dataset.dec;
    const debut = performance.now();
    const duree = 800;
    const pas = (t) => {
      const p = Math.min(1, (t - debut) / duree);
      el.textContent = fmt(cible * (1 - Math.pow(1 - p, 3)), dec);
      if (p < 1) requestAnimationFrame(pas);
    };
    requestAnimationFrame(pas);
  });
}

function afficherMesures() {
  // Produit les quatre cartes de résumé qui remplissent le conteneur #reads dans index.html.
  $("#reads").innerHTML =
    carteMesure("hum", "Humidité du sol", "drop") +
    carteMesure("temp", "Température", "thermo") +
    carteMesure("rain", "Précipitations", "rain") +
    carteEtat();
  if (!etat.mesuresAnimees) {
    etat.mesuresAnimees = true;
    animerValeurs();
  }
}

/* --- Indicateurs d'état (en-tête, source satellitaire) --- */

function afficherIndicateurs() {
  const live = etat.enDirect;
  const sync = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  $("#net-state").textContent = live ? "NASA POWER en direct" : "Mode démonstration";
  $("#net-pill").classList.toggle("live", live);
  $("#sync-label").textContent = live
    ? `NASA POWER synchronisé à ${sync}`
    : "Satellite : données de démonstration";
  $("#sync-chip").classList.toggle("live", live);
  $("#src-state").classList.toggle("live", live);
  $("#src-state-txt").textContent = live
    ? `Séries satellite : données réelles NASA POWER (${etat.dates[0]} au ${etat.dates[N - 1]}). Le capteur reste fictif.`
    : "Valeurs affichées : démonstration. Chargez NASA POWER pour des données réelles.";
}

/* ========== 6. DÉCISIONS ========== */

/* --- Règles (sans accès à la page) --- */

function decisionIrrigation(sol, pluieDemain) {
  // Décide uniquement à partir du seuil d'humidité et de la pluie prévue, sans manipuler le DOM.
  if (sol > SEUIL_SOL) {
    return pluieDemain ? "Ne pas irriguer demain." : "Pas d’irrigation aujourd’hui, à revérifier demain.";
  }
  return pluieDemain ? "Irriguer peu : la pluie va compléter." : "Irriguer demain.";
}

function niveauChaleur(marge) {
  // Retourne le texte et la classe CSS de l'alerte selon la distance au seuil de chaleur.
  if (marge <= 0) return { titre: "Stress thermique : agir.", classe: " danger" };
  if (marge <= MARGE_SURVEILLANCE) return { titre: "Chaleur à surveiller.", classe: " warning" };
  return { titre: "Pas de stress thermique.", classe: "" };
}

/* --- Affichage --- */

function afficherDecision() {
  // Lit les contrôles HTML, recalcule les décisions et met à jour les éléments repérés par leurs ID.
  const sol = +$("#in-sol").value;
  const temp = +$("#in-t").value;
  const pluieDemain = $("#in-pl").checked;
  const tempSatellite = DONNEES.temp.satellite[N - 1];
  const pluieHier = DONNEES.rain.satellite[N - 2];
  const marge = SEUIL_CHALEUR - temp;
  const chaleur = niveauChaleur(marge);

  $("#o-sol").textContent = `${sol} %`;
  $("#o-t").textContent = `${fmt(temp, 1)} °C`;

  // Irrigation
  $("#a-irr").className = "alert-card" + (sol > SEUIL_SOL ? "" : " warning");
  $("#dd").textContent = decisionIrrigation(sol, pluieDemain);
  $("#g1").style.width = `${sol}%`;
  $("#why").innerHTML =
    `<li><b>Capteur :</b> le sol est à ${sol} %, ${sol > SEUIL_SOL ? "au-dessus du" : "sous le"} seuil de ${SEUIL_SOL} % pour le riz.</li>` +
    `<li><b>${DONNEES.rain.sat} :</b> ${fmt(pluieHier)} mm de pluie hier.</li>` +
    `<li><b>Prévision :</b> ${pluieDemain ? "de la pluie est annoncée demain." : "aucune pluie annoncée demain."}</li>`;
  $("#rule").textContent =
    `Règle : sol > ${SEUIL_SOL} % et pluie demain, donc pas d’irrigation. ` +
    `Sol à ${sol} % : ${sol > SEUIL_SOL ? "vrai" : "faux"}. Pluie demain : ${pluieDemain ? "vrai" : "faux"}. ` +
    `L’IA rédige la phrase ; les seuils décident.`;

  // Chaleur
  $("#a-st").className = "alert-card" + chaleur.classe;
  $("#h-st").textContent = chaleur.titre;
  $("#g2").style.width = Math.max(0, Math.min(100, (temp - 20) * 5)) + "%";
  $("#p-st").innerHTML =
    `<b>Capteur :</b> ${fmt(temp, 1)} °C, soit ${signe(temp - tempSatellite, 1)} °C par rapport à ${DONNEES.temp.sat} (${fmt(tempSatellite, 1)} °C). ` +
    (marge > 0 ? `Marge de ${fmt(marge, 1)} °C avant le` : `Dépassement de ${fmt(-marge, 1)} °C du`) +
    ` seuil indicatif de stress à la floraison (${SEUIL_CHALEUR} °C).`;
}

/* ========== 6 bis. CONSEILS DE LA SEMAINE ========== */

const JOURS_SEMAINE = 7;

// Résume les 7 derniers jours de mesures du capteur et de leurs écarts avec le satellite
function resumerSemaine() {
  const debut = N - JOURS_SEMAINE;
  const tranche = (cle, src) => DONNEES[cle][src].slice(debut);
  const sol = tranche("hum", "capteur");
  const temp = tranche("temp", "capteur");
  const pluie = tranche("rain", "capteur");
  const somme = (t) => t.reduce((a, b) => a + b, 0);
  const moy = (t) => somme(t) / t.length;
  const ecartSol = moy(sol.map((v, i) => v - tranche("hum", "satellite")[i]));
  const jours = sol.map((v, i) => {
    const marge = SEUIL_CHALEUR - temp[i];
    let niveau = "ok";
    if (marge <= 0) niveau = "danger";
    else if (marge <= MARGE_SURVEILLANCE || v <= SEUIL_SOL) niveau = "warning";
    return { date: etat.dates[debut + i], sol: v, temp: temp[i], pluie: pluie[i], niveau };
  });
  return {
    jours,
    solMoyen: moy(sol),
    tempMoyenne: moy(temp),
    tempMax: Math.max(...temp),
    pluieTotale: somme(pluie),
    joursPluie: pluie.filter((p) => p >= 1).length,
    joursSecs: sol.filter((v) => v <= SEUIL_SOL).length,
    joursChauds: temp.filter((t) => SEUIL_CHALEUR - t <= MARGE_SURVEILLANCE).length,
    ecartSol,
  };
}

// Règles : chaque conseil indique son niveau, sa phrase et la donnée qui le justifie
function conseilsSemaine(s) {
  const c = [];

  // Irrigation
  if (s.joursSecs >= 3) {
    c.push({ niveau: "warning", icone: "drop", titre: "Irrigation", action: "Prévoir une irrigation dès que le sol passe sous 70 %.",
      pourquoi: `Le sol a été sous le seuil de ${SEUIL_SOL} % pendant ${s.joursSecs} jours sur ${JOURS_SEMAINE}.` });
  } else if (s.pluieTotale >= 30) {
    c.push({ niveau: "good", icone: "drop", titre: "Irrigation", action: "Pas d’irrigation nécessaire. Surveillez le drainage.",
      pourquoi: `${fmt(s.pluieTotale)} mm de pluie en ${JOURS_SEMAINE} jours et un sol à ${fmt(s.solMoyen)} % en moyenne.` });
  } else {
    c.push({ niveau: "good", icone: "drop", titre: "Irrigation", action: "Sol dans la zone favorable : pas d’irrigation systématique.",
      pourquoi: `Humidité moyenne de ${fmt(s.solMoyen)} %, au-dessus du seuil de ${SEUIL_SOL} % pour le riz.` });
  }

  // Chaleur
  if (s.tempMax >= SEUIL_CHALEUR) {
    c.push({ niveau: "danger", icone: "thermo", titre: "Chaleur", action: "Protéger la culture : garder le sol bien humide aux heures chaudes.",
      pourquoi: `Pic à ${fmt(s.tempMax, 1)} °C, au-dessus du seuil indicatif de ${SEUIL_CHALEUR} °C.` });
  } else if (s.joursChauds > 0) {
    c.push({ niveau: "warning", icone: "thermo", titre: "Chaleur", action: "Surveiller la chaleur, surtout à la floraison.",
      pourquoi: `${s.joursChauds} jour${s.joursChauds > 1 ? "s" : ""} à moins de ${MARGE_SURVEILLANCE} °C du seuil. Pic à ${fmt(s.tempMax, 1)} °C.` });
  } else {
    c.push({ niveau: "good", icone: "thermo", titre: "Chaleur", action: "Pas de risque de stress thermique cette semaine.",
      pourquoi: `Température moyenne de ${fmt(s.tempMoyenne, 1)} °C, pic à ${fmt(s.tempMax, 1)} °C.` });
  }

  // Pluie
  if (s.pluieTotale < 10) {
    c.push({ niveau: "warning", icone: "rain", titre: "Pluie", action: "Semaine sèche : anticipez vos besoins en eau.",
      pourquoi: `Seulement ${fmt(s.pluieTotale)} mm en ${JOURS_SEMAINE} jours.` });
  } else {
    c.push({ niveau: "good", icone: "rain", titre: "Pluie", action: "Les pluies couvrent une bonne partie des besoins en eau.",
      pourquoi: `${fmt(s.pluieTotale)} mm cumulés, ${s.joursPluie} jour${s.joursPluie > 1 ? "s" : ""} de pluie.` });
  }

  // Fiabilité des mesures
  if (Math.abs(s.ecartSol) > 10) {
    c.push({ niveau: "info", icone: "leaf", titre: "Lecture des données", action: "Le capteur et le satellite divergent : fiez-vous au capteur pour votre parcelle.",
      pourquoi: `Écart moyen d’humidité de ${signe(s.ecartSol)} pts : le capteur lit la parcelle, le satellite lit une maille entière. Vérifiez l’étalonnage une fois par mois.` });
  }
  return c;
}

function afficherSemaine() {
  const s = resumerSemaine();
  const premier = s.jours[0].date;
  const dernier = s.jours[JOURS_SEMAINE - 1].date;
  const etiquette = { ok: "Favorable", warning: "À surveiller", danger: "Alerte" };

  $("#week-sub").textContent =
    `Du ${premier} au ${dernier} · mesures du capteur (données de démonstration)` +
    (etat.enDirect ? ` · comparées à NASA POWER en direct` : "");

  $("#week-days").innerHTML = s.jours
    .map(
      (j) => `<div class="wd ${j.niveau}" role="listitem">
        <span class="wd-date">${j.date}</span>
        <span class="wd-state"><i class="wd-dot" aria-hidden="true"></i>${etiquette[j.niveau]}</span>
        <span class="wd-row"><b>${fmt(j.sol)}</b> % sol</span>
        <span class="wd-row"><b>${fmt(j.temp, 1)}</b> °C</span>
        <span class="wd-row"><b>${fmt(j.pluie)}</b> mm</span>
      </div>`,
    )
    .join("");

  $("#week-kpis").innerHTML = [
    ["Humidité moyenne", `${fmt(s.solMoyen)} %`],
    ["Température moyenne", `${fmt(s.tempMoyenne, 1)} °C`],
    ["Pluie cumulée", `${fmt(s.pluieTotale)} mm`],
    ["Jours de sol sec", `${s.joursSecs} sur ${JOURS_SEMAINE}`],
  ]
    .map(([t, v]) => `<div><dt>${t}</dt><dd>${v}</dd></div>`)
    .join("");

  const prio = { danger: "Priorité haute", warning: "Priorité moyenne", info: "À noter", good: "Favorable" };
  $("#week-advice").innerHTML = conseilsSemaine(s)
    .map(
      (a) => `<article class="alert-card ${a.niveau}">
        <div class="alert-header">
          <span class="alert-ic">${icone(a.icone)}</span>
          <span class="alert-head-txt"><span class="alert-type">${a.titre}</span><span class="alert-time">Cette semaine</span></span>
          <span class="prio" data-label="${prio[a.niveau]}">${prio[a.niveau]}</span>
        </div>
        <div class="alert-action">${a.action}</div>
        <div class="alert-reason"><b>Pourquoi :</b> ${a.pourquoi}</div>
      </article>`,
    )
    .join("");
}

/* ========== 6 ter. EN MOTS SIMPLES (mesure du jour) ========== */

// Phrases courtes, mots de tous les jours. Le niveau donne la couleur ET un mot (pas seulement la couleur).
function expliquerJour() {
  const sol = DONNEES.hum.capteur[N - 1];
  const temp = DONNEES.temp.capteur[N - 1];
  const pluie = DONNEES.rain.capteur[N - 1];
  const marge = SEUIL_CHALEUR - temp;

  const terre =
    sol > SEUIL_SOL
      ? { niveau: "good", icone: "drop", mot: "Bien", phrase: "La terre est assez mouillée. Le riz a assez d’eau." }
      : { niveau: "warning", icone: "drop", mot: "Attention", phrase: "La terre est trop sèche. Le riz a soif." };

  const chaleur =
    marge <= 0
      ? { niveau: "danger", icone: "thermo", mot: "Danger", phrase: "Il fait très chaud. Le riz souffre de la chaleur." }
      : marge <= MARGE_SURVEILLANCE
        ? { niveau: "warning", icone: "thermo", mot: "Attention", phrase: "Il fait chaud. Surveillez bien votre champ." }
        : { niveau: "good", icone: "thermo", mot: "Bien", phrase: "Il ne fait pas trop chaud. Le riz est tranquille." };

  const eau =
    pluie >= 10
      ? { niveau: "good", icone: "rain", mot: "Bien", phrase: "Il a bien plu. La terre a reçu de l’eau." }
      : pluie >= 1
        ? { niveau: "good", icone: "rain", mot: "Bien", phrase: "Il a plu un peu." }
        : { niveau: "info", icone: "rain", mot: "Rien", phrase: "Il n’a pas plu aujourd’hui." };

  const lignes = [
    { nom: "La terre", valeur: `${fmt(sol)} %`, ...terre },
    { nom: "La chaleur", valeur: `${fmt(temp, 1)} °C`, ...chaleur },
    { nom: "La pluie", valeur: `${fmt(pluie)} mm`, ...eau },
  ];

  // Ce qu'il faut faire : une ou deux phrases
  const faire = [sol > SEUIL_SOL ? "Vous n’avez pas besoin d’arroser aujourd’hui." : "Arrosez votre champ aujourd’hui."];
  if (marge <= MARGE_SURVEILLANCE) faire.push("Gardez de l’eau dans le champ aux heures chaudes de la journée.");
  const niveauFaire = marge <= 0 ? "danger" : sol <= SEUIL_SOL || marge <= MARGE_SURVEILLANCE ? "warning" : "good";

  return { lignes, faire, niveauFaire };
}

let lectureEnCours = false;

function lireTexte(texte) {
  if (!("speechSynthesis" in window)) return;
  if (lectureEnCours) {
    speechSynthesis.cancel();
    return;
  }
  const u = new SpeechSynthesisUtterance(texte);
  u.lang = "fr-FR";
  u.rate = 0.85;
  const fin = () => {
    lectureEnCours = false;
    $("#simple-listen span").textContent = "Écouter";
  };
  u.onend = fin;
  u.onerror = fin;
  lectureEnCours = true;
  $("#simple-listen span").textContent = "Arrêter";
  speechSynthesis.speak(u);
}

function afficherSimple() {
  const e = expliquerJour();
  $("#simple-sub").textContent =
    `Dernière mesure du capteur : ${etat.dates[N - 1]} (données de démonstration). Le vert veut dire que tout va bien, l’orange demande de faire attention, le rouge est un danger.`;

  $("#simple-list").innerHTML = e.lignes
    .map(
      (l) => `<li class="simple-row ${l.niveau}">
        <span class="simple-ic">${icone(l.icone)}</span>
        <span class="simple-txt"><span class="simple-name">${l.nom} <small>${l.valeur}</small></span><span class="simple-phrase">${l.phrase}</span></span>
        <span class="simple-pill">${l.mot}</span>
      </li>`,
    )
    .join("");

  $("#simple-todo").className = `simple-todo ${e.niveauFaire}`;
  $("#simple-todo").innerHTML = `<b>Ce qu’il faut faire :</b> ${e.faire.join(" ")}`;

  const bouton = $("#simple-listen");
  if ("speechSynthesis" in window) {
    bouton.hidden = false;
    bouton.onclick = () => lireTexte(e.lignes.map((l) => `${l.nom}. ${l.phrase}`).join(" ") + " Ce qu’il faut faire. " + e.faire.join(" "));
  }
}

/* ========== 7. NASA POWER (données en direct) ========== */

// POWER publie avec quelques jours de retard : on s'arrête à J-4
function urlPower() {
  // Construit l'URL de l'API quotidienne NASA POWER pour Kara et les 14 derniers jours publiés.
  const jour = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");
  const fin = new Date(Date.now() - 4 * 864e5);
  const debut = new Date(fin - (N - 1) * 864e5);
  return (
    "https://power.larc.nasa.gov/api/temporal/daily/point" +
    "?parameters=T2M,PRECTOTCORR,GWETTOP&community=AG" +
    `&longitude=${KARA.lon}&latitude=${KARA.lat}&start=${jour(debut)}&end=${jour(fin)}&format=JSON`
  );
}

// Vérifie la réponse et la convertit en séries ; lève une erreur si elle est incomplète
function lirePower(json) {
  const p = json.properties.parameter;
  const jours = Object.keys(p.T2M);
  const manquant = jours.some((j) => p.T2M[j] < -900 || p.PRECTOTCORR[j] < -900 || p.GWETTOP[j] < -900);
  if (jours.length !== N || manquant) throw new Error("données POWER incomplètes");

  return {
    dates: jours.map((j) => `${+j.slice(6)} ${MOIS[+j.slice(4, 6) - 1]}`),
    temp: jours.map((j) => p.T2M[j]),
    pluie: jours.map((j) => p.PRECTOTCORR[j]),
    humidite: jours.map((j) => p.GWETTOP[j] * 100),
  };
}

function appliquerPower(serie) {
  // Remplace les seules séries satellite; les mesures du capteur restent des données de démonstration.
  DONNEES.temp.satellite = serie.temp;
  DONNEES.rain.satellite = serie.pluie;
  DONNEES.hum.satellite = serie.humidite;
  for (const m of Object.values(DONNEES)) m.sat = "POWER";
  etat.dates = serie.dates;
  etat.enDirect = true;
}

async function chargerNasa() {
  // Gère l'état du bouton et du message HTML pendant la requête, puis rafraîchit l'interface en cas de succès.
  const bouton = $("#live");
  const message = $("#msg");
  const graphiques = $("#charts");
  const synchro = $("#sync-chip");
  bouton.disabled = true;
  graphiques.classList.add("is-loading");
  synchro.classList.add("loading");
  message.textContent = "Chargement des données NASA POWER…";

  try {
    const reponse = await fetch(urlPower());
    if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`);
    appliquerPower(lirePower(await reponse.json()));
    message.textContent = "Données NASA POWER chargées. Le capteur reste fictif.";
    afficherTout();
  } catch {
    message.textContent =
      "NASA POWER indisponible (réseau ou données pas encore publiées). Les données de démonstration restent affichées.";
  }
  graphiques.classList.remove("is-loading");
  synchro.classList.remove("loading");
  bouton.disabled = false;
}

/* ========== 8. DÉMARRAGE ========== */

function afficherTout() {
  // Point de rafraîchissement commun après l'initialisation et le chargement des données en direct.
  afficherGraphiques();
  afficherMesures();
  afficherDecision();
  afficherSemaine();
  afficherSimple();
  afficherIndicateurs();
}

// Apparition progressive des sections au défilement
function activerApparitions() {
  const blocs = document.querySelectorAll(".reveal");
  if (!("IntersectionObserver" in window)) {
    blocs.forEach((b) => b.classList.add("in"));
    return;
  }
  const obs = new IntersectionObserver(
    (entrees) =>
      entrees.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add("in");
          obs.unobserve(e.target);
        }
      }),
    { threshold: 0.08 },
  );
  blocs.forEach((b) => obs.observe(b));
}

// Met en évidence le lien de navigation de la section visible
function activerNavigation() {
  const liens = [...document.querySelectorAll(".nav a")];
  if (!("IntersectionObserver" in window)) return;
  const obs = new IntersectionObserver(
    (entrees) =>
      entrees.forEach((e) => {
        if (!e.isIntersecting) return;
        liens.forEach((l) => l.classList.toggle("on", l.getAttribute("href") === `#${e.target.id}`));
      }),
    { rootMargin: "-30% 0px -60% 0px" },
  );
  liens.forEach((l) => {
    const section = document.querySelector(l.getAttribute("href"));
    if (section) obs.observe(section);
  });
}

/* --- Mode sombre --- */

function appliquerTheme(theme, memoriser) {
  document.documentElement.setAttribute("data-theme", theme);
  const sombre = theme === "dark";
  const bouton = $("#theme-toggle");
  bouton.setAttribute("aria-label", sombre ? "Passer en mode clair" : "Passer en mode sombre");
  bouton.title = sombre ? "Mode clair" : "Mode sombre";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = sombre ? "#0E1511" : "#16834A";
  if (memoriser) {
    try {
      localStorage.setItem("reactplus-theme", theme);
    } catch {}
  }
  afficherGraphiques(); // les graphiques SVG reprennent les couleurs du thème
}

function activerTheme() {
  const courant = () => document.documentElement.getAttribute("data-theme") || "light";
  $("#theme-toggle").addEventListener("click", () => appliquerTheme(courant() === "dark" ? "light" : "dark", true));
  // Suit le thème du téléphone tant que l'utilisateur n'a rien choisi
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
    let choisi = null;
    try {
      choisi = localStorage.getItem("reactplus-theme");
    } catch {}
    if (!choisi) appliquerTheme(e.matches ? "dark" : "light", false);
  });
  appliquerTheme(courant(), false);
}

function demarrer() {
  // Initialise les valeurs des commandes et relie leurs événements aux fonctions de mise à jour.
  // Les curseurs partent des dernières mesures du capteur
  $("#in-sol").value = DONNEES.hum.capteur[N - 1];
  $("#in-t").value = DONNEES.temp.capteur[N - 1];

  ["#in-sol", "#in-t", "#in-pl"].forEach((sel) => $(sel).addEventListener("input", afficherDecision));
  $("#live").addEventListener("click", chargerNasa);
  // Ouvre l'assistant (défini dans chat.js, chargé après ce fichier)
  $("#week-ask").addEventListener("click", () => {
    if (typeof ouvrir === "function") ouvrir();
  });

  $("#today").textContent = new Date().toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  activerTheme();
  afficherTout();
  activerApparitions();
  activerNavigation();
}

document.documentElement.classList.add("js");

demarrer();
