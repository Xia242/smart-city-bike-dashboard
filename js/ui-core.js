/*
 * Copyright (c) 2026 Wei-Chieh Hsia. All rights reserved.
 */

function render() {
    if (!state.displayData) return;
    document.getElementById("total-bikes").innerText = state.displayData.total_bikes;

    const zoneCount = state.displayData.zone_data.length;
    const sub = document.getElementById("sp-sub");
    if (sub) sub.innerText = `${zoneCount} Smart Zone${zoneCount === 1 ? '' : 's'} · Live`;

    state.displayData.zone_data.forEach(zone => updateMapOrb(zone));

    if (state.sheetStationId) {
        const zone = getZone(state.sheetStationId);
        if (zone) renderSheetBody(zone);
    }
}

function updateMapOrb(zone) {
    const preset = getStationPreset(zone.parking_id);
    if (!preset) return;
    let orb = document.getElementById("orb-" + zone.parking_id);
    if (!orb) {
        orb = document.createElement("div");
        orb.className = "map-orb";
        orb.id = "orb-" + zone.parking_id;
        orb.style.left = preset.mapX + "%";
        orb.style.top = preset.mapY + "%";
        orb.addEventListener("click", () => openSheet(zone.parking_id));

        orb.appendChild(document.createTextNode(""));

        const nm = document.createElement("div");
        nm.className = "map-orb-name";
        nm.innerText = zone.name
            .replace(" Station", "")
            .replace("Hanyang Univ. ", "")
            .replace("Student ", "");
        orb.appendChild(nm);

        const eta = document.createElement("div");
        eta.className = "map-orb-eta";
        eta.style.display = "none";
        orb.appendChild(eta);

        document.getElementById("map-fullscreen").appendChild(orb);
    }
    const cfg = statusConfig[zone.status_display] || statusConfig["NORMAL"];
    const tint = zone.status ? cfg.color : "var(--text-secondary)";
    orb.style.setProperty("--orb-tint", tint);
    orb.style.background = tint;
    orb.style.boxShadow = zone.status
        ? `0 0 18px ${cfg.glow}, 0 4px 10px rgba(48, 60, 80, 0.18)`
        : "0 4px 10px rgba(48, 60, 80, 0.18)";
    orb.childNodes[0].nodeValue = zone.status ? zone.bikes : "—";

    const eta = orb.querySelector(".map-orb-eta");
    if (eta) {
        const m = zone.depletion_eta_min;
        if (zone.status && m !== null && m !== undefined && m <= ETA_BADGE_THRESHOLD_MIN) {
            const label = m < 5 ? "Est. < 5 min" : `Est. < ${m} min`;
            eta.innerText = label;
            eta.style.display = "block";
        } else {
            eta.style.display = "none";
        }
    }
}

function openSheet(pid) {
    state.sheetStationId = pid;
    const zone = getZone(pid);
    if (!zone) return;
    renderSheetBody(zone);
    document.getElementById("bottom-sheet").classList.add("show");
    document.getElementById("sheet-scrim").classList.add("show");
    document.getElementById("bottom-sheet").setAttribute("aria-hidden", "false");
    document.getElementById("fab").classList.add("hide");
}

function closeSheet() {
    state.sheetStationId = null;
    document.getElementById("bottom-sheet").classList.remove("show");
    document.getElementById("sheet-scrim").classList.remove("show");
    document.getElementById("bottom-sheet").setAttribute("aria-hidden", "true");
    document.getElementById("fab").classList.remove("hide");
}

function renderSheetBody(zone) {
    const cfg = statusConfig[zone.status_display] || statusConfig["NORMAL"];
    const isOpen = zone.status === true;
    const body = document.getElementById("sheet-body");
    const prevScroll = body ? body.scrollTop : 0;

    const t = zone.context_tags || {};
    let tags = "";
    if (t.rush_hour) tags += `<span class="tag rush">⚡ Rush Hour</span>`;
    if (t.holiday) tags += `<span class="tag holiday">🎌 Holiday</span>`;
    if (t.event && t.event !== "None") tags += `<span class="tag event">🎤 ${t.event}</span>`;
    if (!tags) tags = `<span class="tag calm">○ Normal Hours</span>`;

    const hc = zone.historical_compare || "0%";
    const dir = hc.trim().startsWith("-") ? "down" : "up";

    let etaHtml = "";
    if (isOpen && zone.depletion_eta_min !== null && zone.depletion_eta_min !== undefined
        && zone.depletion_eta_min <= ETA_BADGE_THRESHOLD_MIN) {
        const m = zone.depletion_eta_min;
        const label = m < 5 ? "less than 5 min" : `~${m} min`;
        etaHtml = `<div class="eta-strip">
            <span class="eta-icon">📉</span>
            <div>Depletion forecast — <b>${label}</b> at current net-flow.</div>
        </div>`;
    }

    const trendSvg = buildTrendChart(zone);

    const bikes = zone.bike_ids || [];
    const dockedCount = bikes.filter(b => b.status !== "TAKEN").length;
    const isExp = state.expanded.has(zone.parking_id);
    let rows = "";
    bikes.forEach(b => {
        rows += `<div class="bike-row neu-in">
            <span class="bike-id">🚲 ${b.bike_id}</span>
            <span class="bike-pill pill-${b.status}">${b.status}</span>
        </div>`;
    });
    if (!bikes.length) rows = `<div class="modal-sub" style="padding:6px 0;">No bikes docked.</div>`;

    document.getElementById("sheet-body").innerHTML = `
        <div class="sheet-head">
            <div class="sheet-head-left">
                <div class="sheet-zone-label">${zone.parking_id} · ${zone.area}</div>
                <div class="sheet-zone-name">
                    ${zone.name}
                    <span class="open-badge ${isOpen ? 'open' : 'closed'}">
                        <span class="dot"></span>${isOpen ? 'Open' : 'Closed'}
                    </span>
                </div>
                <div class="sheet-area">Status: <b style="color:${isOpen ? cfg.color : 'var(--text-secondary)'}">${isOpen ? cfg.text : 'Closed'}</b></div>
            </div>
            <div class="sheet-count neu-in">
                <div class="sheet-count-num">${zone.bikes}</div>
                <div class="sheet-count-label">Bikes</div>
            </div>
        </div>
        <div class="tag-row">${tags}</div>
        ${etaHtml}
        <div class="hist">vs. avg today: <b class="${dir}">${hc}</b>
            ${zone.net_flow_per_min !== undefined
              ? ` · net flow <b>${zone.net_flow_per_min >= 0 ? '+' : ''}${zone.net_flow_per_min.toFixed(2)}</b>/min`
              : ''}
        </div>
        <div class="trend-card neu-in">
            <div class="trend-head">
                <div class="trend-title">Bike count · 3h history + 1h forecast</div>
                <div class="trend-legend">
                    <span class="lg past">Past</span>
                    <span class="lg future">Forecast</span>
                </div>
            </div>
            ${trendSvg}
        </div>
        <div class="bike-toggle neu-in ${isExp ? 'open' : ''}" onclick="togglePanel('${zone.parking_id}')">
            <span>🚲 Bike Details (${dockedCount})</span>
            <svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
        </div>
        <div class="bike-panel ${isExp ? 'open' : ''}" id="panel-${zone.parking_id}">
            <div class="bike-panel-inner">${rows}</div>
        </div>
    `;

    if (body) body.scrollTop = prevScroll;
}

function togglePanel(pid) {
    if (state.expanded.has(pid)) state.expanded.delete(pid); else state.expanded.add(pid);
    const panel = document.getElementById("panel-" + pid);
    const toggle = panel.previousElementSibling;
    panel.classList.toggle("open");
    toggle.classList.toggle("open");
}

function openModal(html, opts) {
    opts = opts || {};
    state.modalOpen = opts.interactive !== false;
    document.getElementById("modal").innerHTML = html;
    document.getElementById("overlay").classList.add("show");
}

function closeModal() {
    state.modalOpen = false;
    document.getElementById("overlay").classList.remove("show");
}

function resumeLive() {
    if (state.liveData) {
        state.displayData = state.liveData;
        render();
    }
}

function freeze() {
    state.displayData = state.liveData ? JSON.parse(JSON.stringify(state.liveData)) : state.displayData;
}

function setTitleDot(color, glow) {
    const d = document.getElementById("title-dot");
    if (!d) return;
    d.style.background = color;
    d.style.boxShadow = `0 0 6px ${glow}`;
}

function openTutorial() {
    openModal(`
        <div class="modal-icon neu-in" style="color:var(--accent-blue);">?</div>
        <div class="modal-title">Quick Guide</div>
        <div class="modal-sub">A 30-second tour of the dashboard</div>
        <div class="tut-step neu-in">
            <div class="tut-step-num">1</div>
            <div class="tut-step-body">
                <div class="tut-step-title">Tap a map marker</div>
                <div class="tut-step-text">Each pin shows the live bike count. Tap to slide up the station's details, history, and forecast.</div>
            </div>
        </div>
        <div class="tut-step neu-in">
            <div class="tut-step-num">2</div>
            <div class="tut-step-body">
                <div class="tut-step-title">Watch the colours &amp; ETA</div>
                <div class="tut-step-text">Green is healthy, orange busy, red almost empty. Red pins get an <b>Est. &lt; N min</b> badge from the net-flow forecast.</div>
            </div>
        </div>
        <div class="tut-step neu-in">
            <div class="tut-step-num">3</div>
            <div class="tut-step-body">
                <div class="tut-step-title">Scan to ride</div>
                <div class="tut-step-text">Use the bottom button to start the full borrow / ride / return demo, including geofence checks and the 15-second RFID rule.</div>
            </div>
        </div>
        <button class="mbtn primary full" onclick="closeModal()">Got it</button>
    `, { interactive: false });
}

function setFab(mode) {
    const fab = document.getElementById("fab");
    const label = document.getElementById("fab-label");
    if (mode === 'riding') { fab.classList.add("riding"); label.innerText = "End Ride"; }
    else                   { fab.classList.remove("riding"); label.innerText = "Scan to Ride"; }
}

function toggleTheme() {
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    const newTheme = isDark ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", newTheme);
    localStorage.setItem("citybike-theme", newTheme);
    updateThemeIcon(newTheme === "dark");
}

function updateThemeIcon(isDark) {
    const icon = document.getElementById("theme-icon");
    if (!icon) return;
    if (isDark) {
        // Moon icon for dark mode (click to switch to light)
        icon.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>';
    } else {
        // Sun icon for light mode (click to switch to dark)
        icon.innerHTML = '<circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>';
    }
}

function initTheme() {
    const savedTheme = localStorage.getItem("citybike-theme");
    if (savedTheme === "dark") {
        document.documentElement.setAttribute("data-theme", "dark");
        updateThemeIcon(true);
    }
}
