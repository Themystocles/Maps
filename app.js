const STORAGE_KEY = "por-onde-andei-visits-v1";
const BRAZIL_URL = "assets/maps/brazil-states.geojson";
const CEARA_URL = "assets/maps/ceara-municipalities.geojson";
const CATALOG_URL = "assets/data/visits.json";
const SVG_NS = "http://www.w3.org/2000/svg";
const isLocalEditor = ["localhost", "127.0.0.1"].includes(location.hostname);
const attendanceOptions = {
    father: { label: "Themystocles sozinho", short: "Só pai", color: "#2457a6" },
    mother: { label: "Maryanna sozinha", short: "Só mãe", color: "#b83267" },
    daughter: { label: "Marya Eliza sozinha", short: "Só filha", color: "#7047a3" },
    couple: { label: "Themystocles + Maryanna", short: "Casal", color: "#b08400" },
    fatherDaughter: { label: "Themystocles + Marya Eliza", short: "Pai + filha", color: "#27834b" },
    motherDaughter: { label: "Maryanna + Marya Eliza", short: "Mãe + filha", color: "#148f9a" },
    family: { label: "Toda a família", short: "Todos", color: "#e5673f" }
};
const unknownAttendance = { label: "Companhia não informada", short: "Sem grupo", color: "#a2aaa0" };
const stateNames = {
    AC: "Acre", AL: "Alagoas", AP: "Amapá", AM: "Amazonas", BA: "Bahia", CE: "Ceará",
    DF: "Distrito Federal", ES: "Espírito Santo", GO: "Goiás", MA: "Maranhão", MT: "Mato Grosso",
    MS: "Mato Grosso do Sul", MG: "Minas Gerais", PA: "Pará", PB: "Paraíba", PR: "Paraná",
    PE: "Pernambuco", PI: "Piauí", RJ: "Rio de Janeiro", RN: "Rio Grande do Norte", RS: "Rio Grande do Sul",
    RO: "Rondônia", RR: "Roraima", SC: "Santa Catarina", SP: "São Paulo", SE: "Sergipe", TO: "Tocantins"
};
const elements = Object.fromEntries([
    "travel-map", "map-loader", "map-tooltip", "map-tooltip-image", "map-tooltip-caption", "map-tooltip-open", "map-tooltip-edit", "map-title", "map-eyebrow", "map-hint", "back-button", "panel-kicker",
    "panel-title", "panel-copy", "add-visit-button", "list-title", "list-count", "recent-list", "list-empty", "memory-search",
    "trip-count", "state-count", "visit-dialog", "visit-form", "state-select", "party-select", "attendance-legend", "dialog-subtitle", "form-error",
    "close-dialog", "cancel-dialog", "dialog-title", "photo-dialog", "photo-gallery", "photo-caption", "close-photo", "toast",
    "editor-tools", "editor-status", "choose-project", "existing-photos", "photo-help"
].map((id) => [id, document.getElementById(id)]));

let states = [];
let municipalities = [];
let visits = [];
let mapMode = "brazil";
let selectedState = "CE";
let clickPoint = null;
let toastTimer;
let tooltipHideTimer;
let tooltipVisit = null;
let projectHandle = null;
let editingVisitId = null;
let removedPhotoPaths = new Set();
let memorySearch = "";

function svgElement(name, attributes = {}) {
    const element = document.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
    return element;
}

function coordinatesFromGeometry(geometry, visit, additionalGeometries = []) {
    const positions = [];
    const visitCoordinates = (coordinates) => {
        if (typeof coordinates[0] === "number") positions.push(coordinates);
        else coordinates.forEach(visitCoordinates);
    };
    [geometry, ...additionalGeometries].forEach((item) => visitCoordinates(item.coordinates));
    const longitudes = positions.map((point) => point[0]);
    const latitudes = positions.map((point) => point[1]);
    const minLon = Math.min(...longitudes);
    const maxLon = Math.max(...longitudes);
    const minLat = Math.min(...latitudes);
    const maxLat = Math.max(...latitudes);
    const width = Math.max(maxLon - minLon, 0.00001);
    const height = Math.max(maxLat - minLat, 0.00001);
    const padding = mapMode === "brazil" ? 22 : 14;
    const innerWidth = 1000 - padding * 2;
    const innerHeight = 700 - padding * 2;
    const scale = Math.min(innerWidth / width, innerHeight / height);
    const offsetX = (1000 - width * scale) / 2;
    const offsetY = (700 - height * scale) / 2;
    return (point) => [offsetX + (point[0] - minLon) * scale, offsetY + (maxLat - point[1]) * scale];
}

function geometryPath(geometry, project) {
    const rings = [];
    const visitRings = (coordinates) => {
        if (Array.isArray(coordinates[0]) && typeof coordinates[0][0] === "number") {
            rings.push(coordinates);
            return;
        }
        coordinates.forEach(visitRings);
    };
    visitRings(geometry.coordinates);
    return rings.map((ring) => ring.map((point, index) => {
        const [x, y] = project(point);
        return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(" ") + " Z").join(" ");
}

function fitViewBox() {
    const bounds = elements["travel-map"].getBBox();
    const padding = mapMode === "brazil" ? 12 : 22;
    const scale = Math.max(bounds.width, bounds.height);
    if (!scale) return;
    const width = bounds.width + padding * 2;
    const height = bounds.height + padding * 2;
    elements["travel-map"].setAttribute("viewBox", `${bounds.x - padding} ${bounds.y - padding} ${width} ${height}`);
    elements["travel-map"].setAttribute("preserveAspectRatio", "xMidYMid meet");
}

function visitPoint(visit, project) {
    if (Number.isFinite(visit.lon) && Number.isFinite(visit.lat)) return project([visit.lon, visit.lat]);
    const state = states.find((feature) => feature.properties.sigla === visit.state);
    if (!state) return [500, 350];
    const center = geometryCenter(state.geometry);
    return project(center);
}

function geometryCenter(geometry) {
    let longitude = 0;
    let latitude = 0;
    let count = 0;
    const visitCoordinates = (coordinates) => {
        if (typeof coordinates[0] === "number") {
            longitude += coordinates[0];
            latitude += coordinates[1];
            count++;
        } else coordinates.forEach(visitCoordinates);
    };
    visitCoordinates(geometry.coordinates);
    return [longitude / count, latitude / count];
}

function photosOf(visit) {
    if (Array.isArray(visit.photos)) return visit.photos;
    return visit.photo ? [visit.photo] : [];
}

function normalizePlace(value) {
    return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function visitsInMunicipality(feature) {
    const name = normalizePlace(feature.properties.name);
    return visits.filter((visit) => visit.state === "CE" && normalizePlace(visit.city) === name);
}

function attendanceFor(visit) {
    return attendanceOptions[visit.party] || unknownAttendance;
}

function partiesFor(visitsInPlace) {
    return [...new Set(visitsInPlace.map((visit) => attendanceOptions[visit.party] ? visit.party : "unknown"))];
}

function attendancePattern(parties, defs) {
    if (parties.length < 2) return null;
    const patternId = `attendance-${parties.slice().sort().join("-")}`;
    if (!defs.querySelector(`#${patternId}`)) {
        const width = parties.length * 10;
        const pattern = svgElement("pattern", { id: patternId, patternUnits: "userSpaceOnUse", width, height: width, patternTransform: "rotate(45)" });
        parties.forEach((party, index) => {
            const color = (attendanceOptions[party] || unknownAttendance).color;
            pattern.append(svgElement("rect", { x: index * 10, y: 0, width: 10, height: width, fill: color }));
        });
        defs.append(pattern);
    }
    return `url(#${patternId})`;
}

function addVisitPin(visit, project) {
    const [x, y] = visitPoint(visit, project);
    const group = svgElement("g", { class: "pin-group", tabindex: "0", role: "button", "aria-label": `${visit.place}, ${visit.city}` });
    const title = svgElement("title");
    const attendance = attendanceFor(visit);
    group.style.setProperty("--attendance-color", attendance.color);
    title.textContent = `${visit.place} · ${visit.city} · ${attendance.label}`;
    group.append(title, svgElement("circle", { class: "visit-pin-pulse", cx: x, cy: y, r: 9 }), svgElement("circle", { class: "visit-pin", cx: x, cy: y, r: 4.5 }));
    group.addEventListener("click", (event) => {
        event.stopPropagation();
        if (photosOf(visit).length) openPhoto(visit);
        else showToast(`${visit.place} · ${visit.city}`);
    });
    group.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (photosOf(visit).length) openPhoto(visit);
            else showToast(`${visit.place} · ${visit.city}`);
        }
    });
    group.addEventListener("pointerenter", () => showMapTooltip(visit, group));
    group.addEventListener("pointerleave", scheduleHideMapTooltip);
    group.addEventListener("focus", () => showMapTooltip(visit, group));
    group.addEventListener("blur", scheduleHideMapTooltip);
    elements["travel-map"].append(group);
}

function showMapTooltip(visit, pin) {
    const photos = photosOf(visit);
    if (!photos.length) return;
    window.clearTimeout(tooltipHideTimer);
    tooltipVisit = visit;
    const pinBounds = pin.getBoundingClientRect();
    const mapBounds = document.getElementById("map-stage").getBoundingClientRect();
    const tooltipWidth = 168;
    const tooltipHeight = 194;
    const left = Math.min(Math.max(pinBounds.left - mapBounds.left + 14, 8), Math.max(8, mapBounds.width - tooltipWidth - 8));
    const pinTop = pinBounds.top - mapBounds.top;
    const topCandidate = pinTop > tooltipHeight ? pinTop - tooltipHeight : pinBounds.bottom - mapBounds.top;
    const top = Math.min(Math.max(topCandidate, 8), Math.max(8, mapBounds.height - tooltipHeight - 8));
    elements["map-tooltip-image"].src = photos[0];
    elements["map-tooltip-image"].hidden = false;
    elements["map-tooltip-caption"].textContent = `${visit.place} · ${visit.city} · ${attendanceFor(visit).short}`;
    elements["map-tooltip"].classList.remove("text-only");
    elements["map-tooltip"].classList.add("has-action");
    elements["map-tooltip-open"].hidden = false;
    elements["map-tooltip"].style.left = `${left}px`;
    elements["map-tooltip"].style.top = `${top}px`;
    elements["map-tooltip"].hidden = false;
}

function showCityTooltip(city, event) {
    window.clearTimeout(tooltipHideTimer);
    const municipalityVisits = visits.filter((visit) => visit.state === "CE" && normalizePlace(visit.city) === normalizePlace(city));
    const municipalityVisit = municipalityVisits.slice().sort((a, b) => (b.date || "").localeCompare(a.date || "")).find((visit) => photosOf(visit).length) || municipalityVisits[0];
    const photos = municipalityVisit ? photosOf(municipalityVisit) : [];
    tooltipVisit = photos.length ? municipalityVisit : null;
    const attendanceLabels = [...new Set(municipalityVisits.map((visit) => attendanceFor(visit).short))];
    const mapBounds = document.getElementById("map-stage").getBoundingClientRect();
    const tooltipWidth = 190;
    const tooltipHeight = photos.length ? 194 : 42;
    const left = Math.min(Math.max(event.clientX - mapBounds.left + 12, 8), Math.max(8, mapBounds.width - tooltipWidth - 8));
    const pointerY = event.clientY - mapBounds.top;
    const topCandidate = photos.length && pointerY > tooltipHeight
        ? pointerY - tooltipHeight
        : pointerY;
    const top = Math.min(Math.max(topCandidate, 8), Math.max(8, mapBounds.height - tooltipHeight - 8));
    elements["map-tooltip-image"].hidden = !photos.length;
    if (photos.length) elements["map-tooltip-image"].src = photos[0];
    elements["map-tooltip-caption"].textContent = municipalityVisit ? `${city} · ${attendanceLabels.join(" / ")}` : `${city} · Ceará`;
    elements["map-tooltip"].classList.toggle("text-only", !photos.length);
    elements["map-tooltip"].classList.toggle("has-action", Boolean(photos.length));
    elements["map-tooltip-open"].hidden = !photos.length;
    elements["map-tooltip"].style.left = `${left}px`;
    elements["map-tooltip"].style.top = `${top}px`;
    elements["map-tooltip"].hidden = false;
}

function showStateTooltip(feature, cityLabel, event) {
    window.clearTimeout(tooltipHideTimer);
    tooltipVisit = null;
    const mapBounds = document.getElementById("map-stage").getBoundingClientRect();
    const tooltipWidth = 190;
    const left = Math.min(Math.max(event.clientX - mapBounds.left + 12, 8), Math.max(8, mapBounds.width - tooltipWidth - 8));
    const top = Math.min(Math.max(event.clientY - mapBounds.top - 38, 8), Math.max(8, mapBounds.height - 42));
    elements["map-tooltip-image"].hidden = true;
    elements["map-tooltip-caption"].textContent = `${feature.properties.name} · ${cityLabel}`;
    elements["map-tooltip"].classList.add("text-only");
    elements["map-tooltip"].classList.remove("has-action");
    elements["map-tooltip-open"].hidden = true;
    elements["map-tooltip"].style.left = `${left}px`;
    elements["map-tooltip"].style.top = `${top}px`;
    elements["map-tooltip"].hidden = false;
}

function scheduleHideMapTooltip() {
    window.clearTimeout(tooltipHideTimer);
    tooltipHideTimer = window.setTimeout(hideMapTooltip, 3000);
}

function hideMapTooltip() {
    elements["map-tooltip"].hidden = true;
}

function renderBrazil() {
    mapMode = "brazil";
    elements["travel-map"].replaceChildren();
    elements["travel-map"].setAttribute("aria-label", "Mapa interativo do Brasil");
    const allPoints = states.map((feature) => feature.geometry);
    const allCoordinates = [];
    const gather = (coordinates) => {
        if (typeof coordinates[0] === "number") allCoordinates.push(coordinates);
        else coordinates.forEach(gather);
    };
    allPoints.forEach((geometry) => gather(geometry.coordinates));
    const longitudes = allCoordinates.map((point) => point[0]);
    const latitudes = allCoordinates.map((point) => point[1]);
    const minLon = Math.min(...longitudes), maxLon = Math.max(...longitudes);
    const minLat = Math.min(...latitudes), maxLat = Math.max(...latitudes);
    const padding = 25;
    const scale = Math.min((1000 - padding * 2) / (maxLon - minLon), (700 - padding * 2) / (maxLat - minLat));
    const offsetX = (1000 - (maxLon - minLon) * scale) / 2;
    const offsetY = (700 - (maxLat - minLat) * scale) / 2;
    const mapProject = (point) => [offsetX + (point[0] - minLon) * scale, offsetY + (maxLat - point[1]) * scale];
    for (const feature of states) {
        const abbreviation = feature.properties.sigla;
        const stateVisits = visits.filter((visit) => visit.state === abbreviation);
        const visitedCities = new Set(stateVisits.map((visit) => normalizePlace(visit.city)));
        const cityCount = visitedCities.size;
        const cityLabel = `${cityCount} ${cityCount === 1 ? "cidade visitada" : "cidades visitadas"}`;
        const stateClasses = ["state-shape", ...(cityCount ? ["visited"] : []), ...(abbreviation === "CE" ? ["home-state"] : [])].join(" ");
        const path = svgElement("path", { d: geometryPath(feature.geometry, mapProject), class: stateClasses, tabindex: "0", role: "button", "aria-label": `${feature.properties.name}, ${abbreviation}, ${cityLabel}` });
        const title = svgElement("title");
        title.textContent = `${feature.properties.name} · ${cityLabel}`;
        path.append(title);
        path.addEventListener("click", () => abbreviation === "CE" ? showCeara() : showState(abbreviation));
        path.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                abbreviation === "CE" ? showCeara() : showState(abbreviation);
            }
        });
        path.addEventListener("pointerenter", (event) => showStateTooltip(feature, cityLabel, event));
        path.addEventListener("pointermove", (event) => showStateTooltip(feature, cityLabel, event));
        path.addEventListener("pointerleave", hideMapTooltip);
        elements["travel-map"].append(path);
        if (cityCount) {
            const [labelX, labelY] = mapProject(geometryCenter(feature.geometry));
            const label = svgElement("text", { class: "state-visit-label", x: labelX, y: labelY, "aria-hidden": "true" });
            label.textContent = String(cityCount);
            elements["travel-map"].append(label);
        }
    }
    elements["travel-map"].setAttribute("viewBox", "0 0 1000 700");
    elements["travel-map"].setAttribute("preserveAspectRatio", "xMidYMid meet");
    elements["map-title"].innerHTML = 'Brasil <span class="heading-note">· por descobrir</span>';
    elements["map-eyebrow"].textContent = "O PAÍS INTEIRO";
    elements["map-hint"].textContent = "Toque em um estado para chegar mais perto";
    elements["back-button"].hidden = true;
    updatePanel();
}

function showState(abbreviation) {
    selectedState = abbreviation;
    mapMode = "state";
    const feature = states.find((item) => item.properties.sigla === abbreviation);
    if (!feature) return;
    elements["travel-map"].replaceChildren();
    elements["travel-map"].setAttribute("aria-label", `Mapa de ${stateNames[abbreviation]}`);
    const project = coordinatesFromGeometry(feature.geometry, null);
    const stateShape = svgElement("path", { d: geometryPath(feature.geometry, project), class: `state-shape${abbreviation === "CE" ? " home-state" : " visited"}` });
    const title = svgElement("title");
    title.textContent = stateNames[abbreviation];
    stateShape.append(title);
    elements["travel-map"].append(stateShape);
    if (abbreviation !== "CE") {
        visits.filter((visit) => visit.state === abbreviation).forEach((visit) => addVisitPin(visit, project));
    }
    fitViewBox();
    elements["map-title"].textContent = stateNames[abbreviation];
    elements["map-eyebrow"].textContent = "UM PEDAÇO DO BRASIL";
    elements["map-hint"].textContent = abbreviation === "CE" ? "Toque no mapa para marcar um lugar" : "Um cantinho seu neste estado";
    elements["back-button"].hidden = false;
    updatePanel();
}

function showCeara() {
    showState("CE");
    mapMode = "ceara";
    const project = coordinatesFromGeometry(municipalities[0].geometry, null, municipalities.slice(1).map((feature) => feature.geometry));
    elements["travel-map"].replaceChildren();
    elements["travel-map"].setAttribute("aria-label", "Mapa dos municípios do Ceará; toque no mapa para adicionar uma lembrança");
    const defs = svgElement("defs");
    elements["travel-map"].append(defs);
    for (const feature of municipalities) {
        const municipalityVisits = visitsInMunicipality(feature);
        const parties = partiesFor(municipalityVisits);
        const fillPattern = attendancePattern(parties, defs);
        const attendanceClass = parties.length === 1 ? ` attendance-${parties[0]}` : parties.length > 1 ? " mixed" : "";
        const path = svgElement("path", { d: geometryPath(feature.geometry, project), class: `municipality-shape${municipalityVisits.length ? " visited" : ""}${attendanceClass}`, tabindex: "0", role: "button", "aria-label": feature.properties.name });
        if (fillPattern) path.style.fill = fillPattern;
        const title = svgElement("title");
        title.textContent = `${feature.properties.name} · ${municipalityVisits.length ? `${municipalityVisits.length} lembrança(s)` : "toque para marcar uma visita"}`;
        path.append(title);
        path.addEventListener("pointerenter", (event) => showCityTooltip(feature.properties.name, event));
        path.addEventListener("pointerleave", scheduleHideMapTooltip);
        path.addEventListener("click", (event) => {
            if (!isLocalEditor) {
                const visitWithPhoto = visitsInMunicipality(feature).slice()
                    .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
                    .find((visit) => photosOf(visit).length);
                if (visitWithPhoto) openPhoto(visitWithPhoto);
                return;
            }
            const point = elements["travel-map"].createSVGPoint();
            point.x = event.clientX;
            point.y = event.clientY;
            const svgPoint = point.matrixTransform(elements["travel-map"].getScreenCTM().inverse());
            clickPoint = [svgPoint.x, svgPoint.y];
            openVisitDialog(feature.properties.name, clickPoint, feature.properties.id);
        });
        path.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                if (!isLocalEditor) {
                    const visitWithPhoto = visitsInMunicipality(feature).slice()
                        .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
                        .find((visit) => photosOf(visit).length);
                    if (visitWithPhoto) openPhoto(visitWithPhoto);
                    return;
                }
                openVisitDialog(feature.properties.name, project(geometryCenter(feature.geometry)), feature.properties.id);
            }
        });
        elements["travel-map"].append(path);
    }
    fitViewBox();
    elements["map-title"].innerHTML = 'Ceará <span class="heading-note">· por dentro</span>';
    elements["map-eyebrow"].textContent = "EM CASA, COM CALMA";
    elements["map-hint"].textContent = "Municípios visitados ficam laranja · passe o mouse para ver a cidade";
    elements["panel-kicker"].textContent = "NOSSO PEDAÇO DE CASA";
    elements["panel-title"].innerHTML = 'O Ceará é<br /><em>o começo de tudo.</em>';
    elements["panel-copy"].textContent = "Municípios visitados aparecem em laranja. Passe o mouse para ver a cidade ou toque em outro município para guardar uma lembrança.";
    elements["add-visit-button"].textContent = "＋ adicionar lembrança";
    updateRecentList();
}

function updatePanel() {
    const stateVisits = mapMode === "brazil" ? visits : visits.filter((visit) => visit.state === selectedState);
    if (mapMode === "brazil") {
        elements["panel-kicker"].textContent = "PONTO DE PARTIDA";
        elements["panel-title"].innerHTML = 'O Ceará é<br /><em>o começo de tudo.</em>';
        elements["panel-copy"].textContent = "É daqui que as viagens começam. Clique no Ceará no mapa e marque os lugares que já viraram lembrança.";
        elements["add-visit-button"].textContent = "＋ adicionar lembrança";
    } else if (mapMode === "state" && selectedState !== "CE") {
        elements["panel-kicker"].textContent = "UM ESTADO, UMA HISTÓRIA";
        elements["panel-title"].innerHTML = `${stateNames[selectedState]}<br /><em>e os caminhos por lá.</em>`;
        elements["panel-copy"].textContent = stateVisits.length ? `${stateVisits.length} lembrança${stateVisits.length === 1 ? "" : "s"} registrada${stateVisits.length === 1 ? "" : "s"} neste estado. Deixe outra guardada por aqui.` : "Ainda não tem lembrança marcada por aqui. Adicione uma e seu mapa vai se preenchendo.";
        elements["add-visit-button"].textContent = "＋ adicionar lembrança";
    } else if (mapMode === "state" && selectedState === "CE") {
        elements["panel-kicker"].textContent = "NOSSO PEDAÇO DE CASA";
        elements["panel-title"].innerHTML = 'O Ceará é<br /><em>o começo de tudo.</em>';
        elements["panel-copy"].textContent = "Toque em um município no mapa para deixar um pontinho onde a história aconteceu.";
        elements["add-visit-button"].textContent = "＋ adicionar lembrança";
    }
    updateRecentList();
}

function updateRecentList() {
    const allVisible = mapMode === "brazil" ? visits : visits.filter((visit) => visit.state === selectedState);
    const query = normalizePlace(memorySearch);
    const visible = allVisible.filter((visit) => !query || normalizePlace(`${visit.city} ${visit.place} ${visit.state}`).includes(query))
        .slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    elements["recent-list"].replaceChildren();
    elements["list-title"].textContent = mapMode === "brazil" ? "ÚLTIMAS LEMBRANÇAS" : `LEMBRANÇAS EM ${selectedState}`;
    elements["list-count"].textContent = String(visible.length);
    elements["list-empty"].hidden = visible.length > 0;
    elements["list-empty"].textContent = query ? "Nenhum resultado para essa busca." : "Suas proximas historias aparecerao por aqui.";
    for (const visit of visible) {
        const item = document.createElement("li");
        item.className = "recent-item";
        const thumb = document.createElement("span");
        thumb.className = "recent-thumb";
        const photos = photosOf(visit);
        if (photos.length) {
            const image = document.createElement("img");
            image.src = photos[0];
            image.alt = "";
            const photoButton = document.createElement("button");
            photoButton.className = "recent-photo-button";
            photoButton.type = "button";
            photoButton.title = `Abrir fotos de ${visit.city}`;
            photoButton.setAttribute("aria-label", `Abrir ${photos.length} foto(s) de ${visit.city}`);
            photoButton.append(image);
            photoButton.addEventListener("click", (event) => {
                event.stopPropagation();
                openPhoto(visit);
            });
            thumb.append(photoButton);
        } else thumb.textContent = "↗";
        const text = document.createElement("span");
        text.className = "recent-name";
        const name = document.createElement("span");
        name.textContent = visit.place;
        const meta = document.createElement("span");
        meta.className = "recent-meta";
        meta.textContent = `${visit.city} · ${visit.state}`;
        const attendance = attendanceFor(visit);
        const attendanceChip = document.createElement("span");
        attendanceChip.className = "attendance-chip";
        attendanceChip.style.setProperty("--attendance-color", attendance.color);
        attendanceChip.textContent = attendance.short || attendance.label;
        attendanceChip.title = attendance.label;
        meta.append(" · ", attendanceChip);
        if (visit.driveUrl) {
            const albumLink = document.createElement("a");
            albumLink.className = "album-link";
            albumLink.href = visit.driveUrl;
            albumLink.target = "_blank";
            albumLink.rel = "noopener noreferrer";
            albumLink.textContent = "álbum ↗";
            albumLink.addEventListener("click", (event) => event.stopPropagation());
            meta.append(" · ", albumLink);
        }
        text.append(name, meta);
        const date = document.createElement("span");
        date.className = "recent-date";
        date.textContent = visit.date ? new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(`${visit.date}T12:00:00Z`)) : "";
        item.append(thumb, text, date);
        if (isLocalEditor && projectHandle) {
            const actions = document.createElement("span");
            actions.className = "visit-actions";
            const editButton = document.createElement("button");
            editButton.className = "visit-action";
            editButton.type = "button";
            editButton.title = `Editar ${visit.place}`;
            editButton.setAttribute("aria-label", `Editar ${visit.place}`);
            editButton.textContent = "✎";
            editButton.addEventListener("click", (event) => {
                event.stopPropagation();
                editVisit(visit);
            });
            const deleteButton = document.createElement("button");
            deleteButton.className = "visit-action delete-action";
            deleteButton.type = "button";
            deleteButton.title = `Apagar ${visit.place}`;
            deleteButton.setAttribute("aria-label", `Apagar ${visit.place}`);
            deleteButton.textContent = "×";
            deleteButton.addEventListener("click", (event) => {
                event.stopPropagation();
                deleteVisit(visit);
            });
            actions.append(editButton, deleteButton);
            item.append(actions);
        }
        if (photos.length) item.addEventListener("click", () => openPhoto(visit));
        elements["recent-list"].append(item);
    }
    elements["trip-count"].textContent = String(visits.length);
    elements["state-count"].textContent = String(new Set(visits.map((visit) => visit.state)).size);
}

function renderAttendanceLegend() {
    const legend = elements["attendance-legend"];
    legend.replaceChildren();
    for (const attendance of [...Object.values(attendanceOptions), unknownAttendance]) {
        const item = document.createElement("span");
        item.className = "attendance-legend-item";
        const swatch = document.createElement("span");
        swatch.className = "attendance-swatch";
        swatch.style.setProperty("--attendance-color", attendance.color);
        const label = document.createElement("span");
        label.textContent = attendance.label;
        item.append(swatch, label);
        legend.append(item);
    }
}

function updateEditorState(message) {
    elements["editor-tools"].hidden = !isLocalEditor;
    elements["add-visit-button"].hidden = !isLocalEditor;
    if (!isLocalEditor) return;
    elements["choose-project"].textContent = projectHandle ? "Pasta conectada" : "Escolher pasta Mapas";
    elements["editor-status"].textContent = message || (projectHandle ? "Fotos e viagens são gravadas nos arquivos do projeto." : "Para salvar: clique em Escolher pasta Mapas e selecione a pasta Mapas do projeto.");
    updateRecentList();
}

function openVisitDialog(city = "", point = null, municipalityId = "", visit = null) {
    clickPoint = point;
    editingVisitId = visit?.id || null;
    removedPhotoPaths = new Set();
    const form = elements["visit-form"];
    form.reset();
    const cityInput = form.elements.city;
    const stateSelect = elements["state-select"];
    stateSelect.replaceChildren(...Object.entries(stateNames).map(([code, name]) => {
        const option = document.createElement("option");
        option.value = code;
        option.textContent = name;
        return option;
    }));
    stateSelect.value = visit?.state || selectedState;
    elements["party-select"].value = visit?.party || "";
    cityInput.value = visit?.city || city;
    form.elements.place.value = visit?.place || "";
    form.elements.date.value = visit?.date || "";
    form.elements.note.value = visit?.note || "";
    form.elements.driveUrl.value = visit?.driveUrl || "";
    elements["dialog-title"].textContent = visit ? "Editar lembrança" : "Adicionar lembrança";
    elements["dialog-subtitle"].textContent = visit ? `${visit.city} · atualize os detalhes da lembrança.` : city ? `${city} · Ceará. Complete os detalhes dessa lembrança.` : "Marque um lugar especial no seu mapa.";
    elements["form-error"].textContent = "";
    elements["visit-dialog"].dataset.municipalityId = municipalityId;
    renderExistingPhotos(visit);
    elements["visit-dialog"].showModal();
    form.elements.place.focus();
}

function renderExistingPhotos(visit) {
    const container = elements["existing-photos"];
    container.replaceChildren();
    const photos = photosOf(visit || {});
    container.hidden = photos.length === 0;
    if (!photos.length) return;
    const heading = document.createElement("span");
    heading.textContent = "Fotos já salvas";
    container.append(heading);
    photos.forEach((path) => {
        const row = document.createElement("span");
        row.className = "existing-photo-row";
        const image = document.createElement("img");
        image.src = path;
        image.alt = "";
        const name = document.createElement("span");
        name.textContent = path.split("/").pop();
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "remove-photo";
        remove.textContent = "remover";
        remove.addEventListener("click", () => {
            removedPhotoPaths.add(path);
            row.remove();
            if (!container.querySelector(".existing-photo-row")) container.hidden = true;
            const remaining = photos.length - removedPhotoPaths.size;
            elements["photo-help"].textContent = `Você pode adicionar até ${Math.max(0, 3 - remaining)} foto(s) nova(s).`;
        });
        row.append(image, name, remove);
        container.append(row);
    });
}

function editVisit(visit) {
    selectedState = visit.state;
    if (!projectHandle) {
        connectProjectFolder(false, visit);
        return;
    }
    openVisitDialog(visit.city, null, "", visit);
}

function openPhoto(visit) {
    const gallery = elements["photo-gallery"];
    gallery.replaceChildren(...photosOf(visit).map((photo, index) => {
        const image = document.createElement("img");
        image.src = photo;
        image.alt = `${visit.place}, foto ${index + 1}`;
        return image;
    }));
    elements["photo-caption"].replaceChildren(document.createTextNode(`${visit.place} · ${visit.city}, ${stateNames[visit.state] || visit.state}`));
    if (visit.driveUrl) {
        const albumLink = document.createElement("a");
        albumLink.href = visit.driveUrl;
        albumLink.target = "_blank";
        albumLink.rel = "noopener noreferrer";
        albumLink.textContent = "abrir álbum do Google ↗";
        elements["photo-caption"].append(albumLink);
    }
    elements["photo-dialog"].showModal();
}

function showToast(message) {
    elements.toast.textContent = message;
    elements.toast.classList.add("visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => elements.toast.classList.remove("visible"), 3000);
}

async function projectDirectory(...path) {
    if (!projectHandle) throw new Error("Conecte primeiro a pasta do projeto.");
    let directory = projectHandle;
    for (const name of path) directory = await directory.getDirectoryHandle(name, { create: true });
    return directory;
}

async function writeProjectFile(path, contents) {
    const parts = path.split("/");
    const fileName = parts.pop();
    const directory = await projectDirectory(...parts);
    const file = await directory.getFileHandle(fileName, { create: true });
    const writable = await file.createWritable();
    await writable.write(contents);
    await writable.close();
}

async function readProjectFile(path) {
    const parts = path.split("/");
    const fileName = parts.pop();
    const directory = await projectDirectory(...parts);
    const file = await directory.getFileHandle(fileName);
    return file.getFile();
}

async function removeProjectFile(path) {
    const parts = path.split("/");
    const fileName = parts.pop();
    const directory = await projectDirectory(...parts);
    await directory.removeEntry(fileName);
}

async function writeCatalog(nextVisits) {
    await writeProjectFile("assets/data/visits.json", `${JSON.stringify({ version: 1, visits: nextVisits }, null, 2)}\n`);
}

function readLegacyVisits() {
    try {
        const legacy = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
        return Array.isArray(legacy) ? legacy.filter((visit) => visit && visit.place && visit.state) : [];
    } catch {
        return [];
    }
}

async function migrateLegacyVisits(existingVisits) {
    const knownIds = new Set(existingVisits.map((visit) => visit.id));
    const migrated = [];
    for (const legacy of readLegacyVisits()) {
        if (knownIds.has(legacy.id)) continue;
        const visit = { ...legacy, id: legacy.id || crypto.randomUUID(), photos: [] };
        for (const photo of photosOf(legacy).slice(0, 3)) {
            if (photo.startsWith("assets/photos/")) visit.photos.push(photo);
            else if (photo.startsWith("data:image/")) {
                const blob = await (await fetch(photo)).blob();
                visit.photos.push(await storePhoto(blob, visit.id, visit.city));
            }
        }
        delete visit.photo;
        migrated.push(visit);
    }
    return [...existingVisits, ...migrated];
}

async function connectProjectFolder(openFormAfterConnect = false, visitToEdit = null) {
    if (!window.showDirectoryPicker) {
        showToast("Use Chrome ou Edge pelo servidor local para escolher a pasta do projeto.");
        return;
    }
    try {
        const handle = await window.showDirectoryPicker({ mode: "readwrite", id: "por-onde-andei-project" });
        const entryPage = await handle.getFileHandle("index.html");
        const entryText = await (await entryPage.getFile()).text();
        if (!entryText.includes("Por Onde Andei")) throw new Error("Escolha a pasta do projeto Por Onde Andei, que contém o index.html principal.");
        const mapDirectory = await handle.getDirectoryHandle("assets").then((directory) => directory.getDirectoryHandle("maps"));
        await mapDirectory.getFileHandle("brazil-states.geojson");
        projectHandle = handle;
        await projectDirectory("assets", "photos");
        await projectDirectory("assets", "data");
        let projectVisits = [];
        try {
            const file = await readProjectFile("assets/data/visits.json");
            const parsed = JSON.parse(await file.text());
            projectVisits = Array.isArray(parsed) ? parsed : parsed.visits;
            if (!Array.isArray(projectVisits)) throw new Error("O catálogo de viagens não tem o formato esperado.");
        } catch (error) {
            if (error.name !== "NotFoundError") throw error;
        }
        const beforeMigration = projectVisits;
        projectVisits = await migrateLegacyVisits(projectVisits);
        if (projectVisits.length !== beforeMigration.length || !beforeMigration.length) await writeCatalog(projectVisits);
        visits = projectVisits;
        updateEditorState(`Pasta conectada: ${handle.name}. As alterações ficam nos arquivos do projeto.`);
        renderBrazil();
        showToast("Projeto conectado. Novas fotos serão salvas em assets/photos.");
        const connectedVisit = visitToEdit && visits.find((visit) => visit.id === visitToEdit.id);
        if (connectedVisit) editVisit(connectedVisit);
        else if (openFormAfterConnect) openVisitDialog();
    } catch (error) {
        projectHandle = null;
        updateEditorState();
        if (error.name !== "AbortError") showToast(error.message || "Não foi possível conectar essa pasta do projeto.");
    }
}

function compressImage(file) {
    return new Promise((resolve, reject) => {
        if (!file.type.startsWith("image/")) return reject(new Error("Escolha um arquivo de imagem."));
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("Não foi possível abrir essa foto."));
        reader.onload = () => {
            const image = new Image();
            image.onerror = () => reject(new Error("Não foi possível abrir essa foto."));
            image.onload = () => {
                const scale = Math.min(1, 1400 / Math.max(image.width, image.height));
                const canvas = document.createElement("canvas");
                canvas.width = Math.round(image.width * scale);
                canvas.height = Math.round(image.height * scale);
                canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
                canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Não foi possível preparar essa foto.")), "image/jpeg", 0.82);
            };
            image.src = String(reader.result);
        };
        reader.readAsDataURL(file);
    });
}

function cityFolderName(city) {
    return city.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "sem-cidade";
}

async function storePhoto(file, visitId, city) {
    const image = file instanceof Blob ? file : await compressImage(file);
    const fileName = `${visitId}-${crypto.randomUUID()}.jpg`;
    const photoPath = `assets/photos/${cityFolderName(city)}/${fileName}`;
    await writeProjectFile(photoPath, image);
    return photoPath;
}

async function saveVisit(event) {
    event.preventDefault();
    if (!projectHandle) {
        elements["form-error"].textContent = "Conecte a pasta do projeto antes de guardar alterações.";
        return;
    }
    const form = elements["visit-form"];
    const data = new FormData(form);
    const previous = visits.find((item) => item.id === editingVisitId);
    const newFiles = Array.from(data.getAll("photos")).filter((file) => file instanceof File && file.size > 0);
    const existingPhotos = photosOf(previous || {}).filter((path) => !removedPhotoPaths.has(path));
    if (existingPhotos.length + newFiles.length > 3) {
        elements["form-error"].textContent = `Esta lembrança terá ${existingPhotos.length} foto(s). Remova algumas para adicionar no máximo 3.`;
        return;
    }
    const driveUrl = String(data.get("driveUrl") || "").trim();
    if (driveUrl) {
        try {
            if (!["drive.google.com", "photos.google.com"].includes(new URL(driveUrl).hostname)) throw new Error();
        } catch {
            elements["form-error"].textContent = "Use um link do Google Drive ou do Google Fotos, mesmo que o álbum tenha acesso restrito.";
            return;
        }
    }
    const visit = {
        ...previous,
        id: previous?.id || crypto.randomUUID(),
        place: String(data.get("place")).trim(),
        city: String(data.get("city")).trim(),
        state: String(data.get("state")),
        party: String(data.get("party")),
        date: String(data.get("date") || ""),
        note: String(data.get("note") || "").trim(),
        driveUrl,
        photos: existingPhotos
    };
    if (visit.state === "CE") {
        const municipality = municipalities.find((feature) => feature.properties.name.localeCompare(visit.city, "pt-BR", { sensitivity: "base" }) === 0);
        if (municipality) {
            const longitudeLatitude = clickPoint
                ? reverseProject(clickPoint, municipalities)
                : geometryCenter(municipality.geometry);
            visit.lon = longitudeLatitude[0];
            visit.lat = longitudeLatitude[1];
        } else {
            delete visit.lon;
            delete visit.lat;
        }
    } else {
        delete visit.lon;
        delete visit.lat;
    }
    try {
        for (const file of newFiles) visit.photos.push(await storePhoto(file, visit.id, visit.city));
        const nextVisits = previous ? visits.map((item) => item.id === visit.id ? visit : item) : [...visits, visit];
        await writeCatalog(nextVisits);
        visits = nextVisits;
        for (const path of removedPhotoPaths) await removeProjectFile(path).catch(() => { });
    } catch (error) {
        elements["form-error"].textContent = `Não foi possível gravar no projeto: ${error.message}`;
        return;
    }
    elements["visit-dialog"].close();
    form.reset();
    editingVisitId = null;
    removedPhotoPaths.clear();
    selectedState = visit.state;
    if (visit.state === "CE") showCeara();
    else showState(visit.state);
    showToast("Lembrança e fotos salvas dentro de assets no projeto.");
}

async function deleteVisit(visit) {
    if (!projectHandle || !window.confirm(`Apagar a lembrança “${visit.place}” e as fotos dela do projeto?`)) return;
    const nextVisits = visits.filter((item) => item.id !== visit.id);
    try {
        await writeCatalog(nextVisits);
        visits = nextVisits;
        for (const path of photosOf(visit)) await removeProjectFile(path).catch(() => { });
        if (mapMode === "brazil") renderBrazil();
        else if (mapMode === "ceara") showCeara();
        else showState(selectedState);
        showToast("Lembrança removida do projeto.");
    } catch (error) {
        showToast(`Não foi possível apagar: ${error.message}`);
    }
}

function reverseProject(point, features) {
    const coords = [];
    const gather = (coordinates) => {
        if (typeof coordinates[0] === "number") coords.push(coordinates);
        else coordinates.forEach(gather);
    };
    features.forEach((feature) => gather(feature.geometry.coordinates));
    const minLon = Math.min(...coords.map((item) => item[0]));
    const maxLon = Math.max(...coords.map((item) => item[0]));
    const minLat = Math.min(...coords.map((item) => item[1]));
    const maxLat = Math.max(...coords.map((item) => item[1]));
    const padding = 14;
    const scale = Math.min((1000 - padding * 2) / (maxLon - minLon), (700 - padding * 2) / (maxLat - minLat));
    const offsetX = (1000 - (maxLon - minLon) * scale) / 2;
    const offsetY = (700 - (maxLat - minLat) * scale) / 2;
    return [minLon + (point[0] - offsetX) / scale, maxLat - (point[1] - offsetY) / scale];
}

async function start() {
    try {
        const [statesResponse, municipalitiesResponse, catalogResponse] = await Promise.all([fetch(BRAZIL_URL), fetch(CEARA_URL), fetch(CATALOG_URL)]);
        if (!statesResponse.ok || !municipalitiesResponse.ok) throw new Error("Falha ao carregar os mapas locais.");
        const [statesData, municipalitiesData] = await Promise.all([statesResponse.json(), municipalitiesResponse.json()]);
        states = statesData.features;
        municipalities = municipalitiesData.features;
        if (catalogResponse.ok) {
            const catalog = await catalogResponse.json();
            visits = Array.isArray(catalog) ? catalog : catalog.visits || [];
        }
        elements["map-loader"].hidden = true;
        updateEditorState();
        renderAttendanceLegend();
        renderBrazil();
    } catch {
        elements["map-loader"].textContent = "Não foi possível abrir os mapas. Inicie a página por um servidor local.";
    }
}

elements["back-button"].addEventListener("click", renderBrazil);
elements["add-visit-button"].addEventListener("click", () => projectHandle ? openVisitDialog() : connectProjectFolder(true));
elements["close-dialog"].addEventListener("click", () => elements["visit-dialog"].close());
elements["cancel-dialog"].addEventListener("click", () => elements["visit-dialog"].close());
elements["visit-form"].addEventListener("submit", saveVisit);
elements["close-photo"].addEventListener("click", () => elements["photo-dialog"].close());
elements["choose-project"].addEventListener("click", () => connectProjectFolder());
elements["map-tooltip-open"].addEventListener("click", (event) => {
    event.stopPropagation();
    if (tooltipVisit) openPhoto(tooltipVisit);
});
elements["map-tooltip-image"].addEventListener("click", () => {
    if (tooltipVisit) openPhoto(tooltipVisit);
});
elements["map-tooltip"].addEventListener("pointerenter", () => window.clearTimeout(tooltipHideTimer));
elements["map-tooltip"].addEventListener("pointerleave", hideMapTooltip);
elements["map-tooltip"].addEventListener("focusin", () => window.clearTimeout(tooltipHideTimer));
elements["map-tooltip"].addEventListener("focusout", (event) => {
    if (!elements["map-tooltip"].contains(event.relatedTarget)) scheduleHideMapTooltip();
});
elements["visit-dialog"].addEventListener("click", (event) => { if (event.target === elements["visit-dialog"]) elements["visit-dialog"].close(); });
elements["photo-dialog"].addEventListener("click", (event) => { if (event.target === elements["photo-dialog"]) elements["photo-dialog"].close(); });
elements["memory-search"].addEventListener("input", (event) => {
    memorySearch = event.target.value;
    updateRecentList();
});
elements["memory-search"].addEventListener("search", (event) => {
    memorySearch = event.target.value;
    updateRecentList();
});
start();
