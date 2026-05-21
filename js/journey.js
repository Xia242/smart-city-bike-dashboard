/*
 * Copyright (c) 2026 Wei-Chieh Hsia. All rights reserved.
 */

function onFabClick() {
    if (state.journey.state === 'riding') openParkModal(false);
    else openScanModal();
}

function openScanModal() {
    if (!state.liveData) {
        openModal(`
            <div class="modal-icon neu-in" style="color:#c2701b;">📡</div>
            <div class="modal-title">Connecting to Live Feed</div>
            <div class="modal-text">Still pairing with the city's MQTT stream. This usually takes a moment — please try again in a second.</div>
            <button class="mbtn full" onclick="closeModal()">OK</button>
        `, { interactive: false });
        return;
    }
    if (state.sheetStationId) closeSheet();
    freeze();
    let chips = "";
    state.displayData.zone_data.forEach(z => {
        const dist = getStationPreset(z.parking_id).distance;
        const disabled = (z.status !== true) ? "disabled" : "";
        const sub = (z.status !== true) ? "Station closed" : `${z.bikes} bikes available`;
        chips += `<button class="station-chip" ${disabled} onclick="scanStation('${z.parking_id}')">
            <span class="chip-dot" style="background:${(statusConfig[z.status_display] || statusConfig.NORMAL).color}"></span>
            <span class="chip-body">
                <div class="chip-name">${z.name}</div>
                <div class="chip-meta">${z.parking_id} · ${sub}</div>
            </span>
            <span class="chip-dist dist-${dist}">${dist}</span>
        </button>`;
    });
    openModal(`
        <div class="qr-frame neu-in">
            <div class="corner c-tl"></div><div class="corner c-tr"></div>
            <div class="corner c-bl"></div><div class="corner c-br"></div>
            <div class="qr-scanline"></div>
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--text-primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="3" width="7" height="7" rx="1"></rect>
                <rect x="3" y="14" width="7" height="7" rx="1"></rect><line x1="14" y1="14" x2="21" y2="14"></line>
                <line x1="14" y1="18" x2="21" y2="18"></line><line x1="18" y1="14" x2="18" y2="21"></line>
            </svg>
        </div>
        <div class="modal-title">Scan a Bike QR</div>
        <div class="modal-sub">Select the station you are scanning at</div>
        <div class="chip-stack">${chips}</div>
        <button class="mbtn ghost full" onclick="cancelJourney()">Cancel</button>
    `);
}

function scanStation(pid) {
    const preset = getStationPreset(pid);
    const zone = getZone(pid);

    if (preset.distance === "FAR") {
        openModal(`
            <div class="modal-icon neu-in" style="color:#cf5757;">⚠️</div>
            <div class="modal-title">Geofence Error</div>
            <div class="modal-text">You are currently more than <b>500 m</b> away from <b>${zone.name}</b>. Please go to the station to scan and unlock.</div>
            <div class="btn-row">
                <button class="mbtn" onclick="openScanModal()">Back</button>
                <button class="mbtn danger" onclick="cancelJourney()">Close</button>
            </div>
        `);
        return;
    }

    const bike = (zone.bike_ids || []).find(b => b.status === "AVAILABLE");
    if (!bike) {
        openModal(`
            <div class="modal-icon neu-in" style="color:#c2701b;">🚲</div>
            <div class="modal-title">No Bikes Available</div>
            <div class="modal-text">There are no available bikes at <b>${zone.name}</b> right now.</div>
            <button class="mbtn full" onclick="openScanModal()">Back</button>
        `);
        return;
    }

    state.journey.state = 'reserved';
    state.journey.bikeId = bike.bike_id;
    state.journey.originId = pid;
    setBikeStatus(pid, bike.bike_id, "RESERVED");
    if (!state.expanded.has(pid)) state.expanded.add(pid);
    render();
    showUnlockModal();
}

function showUnlockModal() {
    const zone = getZone(state.journey.originId);
    openModal(`
        <div class="bike-focus neu-in">
            <span class="bike-pill pill-RESERVED">Reserved</span>
            <span class="bf-id">${state.journey.bikeId}</span>
            <span class="modal-sub">${zone.name} · ${zone.parking_id}</span>
        </div>
        <div class="modal-text">This bike is reserved for you. Unlock now to start your ride.</div>
        <div class="btn-row">
            <button class="mbtn danger" onclick="cancelUnlock()">Cancel</button>
            <button class="mbtn go" onclick="confirmUnlock()">Unlock</button>
        </div>
        <button class="mbtn ghost full" onclick="immediatePark()">Unlock &amp; lock immediately (don't ride)</button>
    `);
}

function cancelUnlock() {
    resetJourney();
    closeModal();
    resumeLive();
}

function confirmUnlock() {
    const zone = getZone(state.journey.originId);
    setBikeStatus(state.journey.originId, state.journey.bikeId, "TAKEN");
    zone.bikes = Math.max(0, zone.bikes - 1);
    state.displayData.total_bikes = Math.max(0, state.displayData.total_bikes - 1);
    state.journey.state = 'riding';
    render();
    startRiding();
    closeModal();
}

function startRiding() {
    setFab('riding');
    state.rideStart = Date.now();
    const banner = document.getElementById("ride-banner");
    document.getElementById("ride-text").innerText = "Riding " + state.journey.bikeId;
    banner.classList.add("show");
    state.rideInterval = setInterval(() => {
        const s = Math.floor((Date.now() - state.rideStart) / 1000);
        const m = String(Math.floor(s / 60)).padStart(2, "0");
        const ss = String(s % 60).padStart(2, "0");
        document.getElementById("ride-timer").innerText = `${m}:${ss}`;
    }, 1000);
}

function stopRiding() {
    clearInterval(state.rideInterval);
    document.getElementById("ride-banner").classList.remove("show");
    setFab('idle');
}

function openParkModal(immediate) {
    let chips = "";
    state.displayData.zone_data.forEach(z => {
        const closed = z.status !== true;
        chips += `<button class="station-chip" ${closed ? 'disabled' : ''} onclick="beginVerification('${z.parking_id}')">
            <span class="chip-dot" style="background:${(statusConfig[z.status_display] || statusConfig.NORMAL).color}"></span>
            <span class="chip-body">
                <div class="chip-name">${z.name}</div>
                <div class="chip-meta">${z.parking_id} · ${closed ? 'Closed' : z.bikes + ' bikes docked'}</div>
            </span>
        </button>`;
    });
    openModal(`
        <div class="modal-icon neu-in" style="color:#c2701b;">🅿️</div>
        <div class="modal-title">${immediate ? 'Lock Bike Here' : 'End Ride — Return Bike'}</div>
        <div class="modal-sub">Choose the station you are returning ${state.journey.bikeId} to</div>
        <div class="chip-stack">${chips}</div>
        <button class="mbtn ghost full" onclick="closeParkModal()">Keep Riding</button>
    `);
}

function closeParkModal() {
    if (state.journey.state === 'reserved') { showUnlockModal(); }
    else { closeModal(); }
}

function beginVerification(returnId) {
    state.journey.returnId = returnId;
    state.journey.rfidFail = false;
    const zone = getZone(returnId);

    if (state.journey.originId && state.journey.originId !== returnId) {
        const origin = getZone(state.journey.originId);
        if (origin) {
            origin.bike_ids = (origin.bike_ids || []).filter(b => b.bike_id !== state.journey.bikeId);
        }
    }

    if (!zone.bike_ids.find(b => b.bike_id === state.journey.bikeId)) {
        zone.bike_ids.push({ bike_id: state.journey.bikeId, status: "PARKING" });
    } else {
        const existing = zone.bike_ids.find(b => b.bike_id === state.journey.bikeId);
        existing.status = "PARKING";
    }

    openModal(`
        <div class="bike-focus neu-in">
            <span class="bike-pill pill-PARKING">Parking</span>
            <span class="bf-id">${state.journey.bikeId}</span>
            <span class="modal-sub">${zone.name} · ${zone.parking_id}</span>
        </div>
        <div class="modal-title" style="font-size:0.98rem;">⏳ Matching RFID signal &amp; virtual geofence...</div>
        <div class="prog-track neu-in"><div class="prog-fill" id="prog-fill"></div></div>
        <div class="verify-caption neu-in">
            <b>15-Second Rule:</b> the dock holds verification briefly to filter out passer-by noise — only a bike that stays inside the geofence is registered as returned.
        </div>
        <button class="rfid-test" id="rfid-btn" onclick="toggleRfidFail()">🔧 Simulate RFID Failure: OFF</button>
    `);

    const dur = 3000 + Math.random() * 2000;
    const fill = document.getElementById("prog-fill");
    requestAnimationFrame(() => {
        fill.style.transition = `width ${dur}ms linear`;
        fill.style.width = "100%";
    });
    setTimeout(() => finishVerification(), dur + 120);
}

function toggleRfidFail() {
    state.journey.rfidFail = !state.journey.rfidFail;
    const btn = document.getElementById("rfid-btn");
    if (!btn) return;
    btn.classList.toggle("armed", state.journey.rfidFail);
    btn.innerText = "🔧 Simulate RFID Failure: " + (state.journey.rfidFail ? "ON" : "OFF");
}

function finishVerification() {
    const zone = getZone(state.journey.returnId);

    if (state.journey.rfidFail) {
        openModal(`
            <div class="modal-icon neu-in" style="color:#cf5757;">📡</div>
            <div class="modal-title">RFID Not Detected</div>
            <div class="modal-text">The dock's RFID reader could not detect ${state.journey.bikeId}. Please wait for the system to re-pair automatically, or contact on-site staff to complete the return with a hand-held scanner.</div>
            <div class="btn-row">
                <button class="mbtn primary" onclick="retryVerification()">Retry Pairing</button>
                <button class="mbtn" onclick="forceComplete()">Staff Assisted</button>
            </div>
        `);
        return;
    }

    const b = zone.bike_ids.find(x => x.bike_id === state.journey.bikeId);
    if (b) b.status = "AVAILABLE";
    zone.bikes += 1;
    state.displayData.total_bikes += 1;
    render();

    openModal(`
        <div class="modal-icon neu-in" style="color:#1f9d6b;">✓</div>
        <div class="modal-title">Return Successful</div>
        <div class="modal-text"><b>${state.journey.bikeId}</b> has been registered at <b>${zone.name}</b> and is now available for the next rider.</div>
        <button class="mbtn go full" onclick="endJourney()">Done</button>
    `);
}

function retryVerification() {
    const rid = state.journey.returnId;
    const z = getZone(rid);
    z.bike_ids = z.bike_ids.filter(x => x.bike_id !== state.journey.bikeId);
    beginVerification(rid);
}

function forceComplete() {
    state.journey.rfidFail = false;
    finishVerification();
}

function resetJourney() {
    state.journey = { state: 'idle', bikeId: null, originId: null, returnId: null, rfidFail: false };
    stopRiding();
}

function cancelJourney() {
    resetJourney();
    closeModal();
    resumeLive();
}

function endJourney() {
    resetJourney();
    closeModal();
    resumeLive();
}

function immediatePark() {
    const zone = getZone(state.journey.originId);
    setBikeStatus(state.journey.originId, state.journey.bikeId, "TAKEN");
    zone.bikes = Math.max(0, zone.bikes - 1);
    state.displayData.total_bikes = Math.max(0, state.displayData.total_bikes - 1);
    state.journey.state = 'riding';
    render();
    startRiding();
    openParkModal(true);
}
