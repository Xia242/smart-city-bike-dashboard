/*
 * Copyright (c) 2026 Wei-Chieh Hsia. All rights reserved.
 */

function connectMQTT() {
    document.getElementById("connection-text").innerText = "Connecting";
    setTitleDot("var(--orb-orange)", "var(--orb-orange-glow)");
    state.client = new Paho.Client(BROKER, PORT, "/mqtt", CLIENT_ID);
    state.client.onConnectionLost = onConnectionLost;
    state.client.onMessageArrived = onMessageArrived;
    state.client.connect({ onSuccess: onConnect, onFailure: onFailure, timeout: 10, useSSL: true });
}

function onConnect() {
    document.getElementById("connection-text").innerText = "CityBike";
    setTitleDot("var(--orb-green)", "var(--orb-green-glow)");
    state.client.subscribe(TOPIC);
    state.client.subscribe(TOPIC + "/reply/" + CLIENT_ID);
    syncJourney();
}

function onFailure() {
    setTitleDot("var(--orb-red)", "var(--orb-red-glow)");
    setTimeout(connectMQTT, 3000);
}

function onConnectionLost() {
    document.getElementById("connection-text").innerText = "Offline";
    setTitleDot("var(--orb-red)", "var(--orb-red-glow)");
    setTimeout(connectMQTT, 3000);
}

function onMessageArrived(message) {
    try {
        if (message.payloadString.length > 1000000) throw new Error('Message too large');
        const payload = JSON.parse(message.payloadString);
        if (message.destinationName === TOPIC + "/reply/" + CLIENT_ID) {
            const pending = pendingRequests.get(payload.request_id);
            if (!pending) return;
            if (payload.ok !== true) { const error = new Error(String(payload.error || 'Command rejected')); error.rejected = true; pending.reject(error); return; }
            validatePayload(payload.snapshot);
            state.liveData = payload.snapshot;
            pending.resolve(payload);
            return;
        }
        validatePayload(payload);
        
        if (payload.type === "FULL") {
            state.liveData = payload;
        } else if (payload.type === "DELTA" && state.liveData) {
            // Merge Delta to save bandwidth
            state.liveData.timestamp = payload.timestamp;
            state.liveData.total_bikes = payload.total_bikes;
            payload.zone_data.forEach(dz => {
                const z = state.liveData.zone_data.find(x => x.parking_id === dz.parking_id);
                if (z) {
                    z.bikes = dz.bikes;
                    z.status_display = dz.status_display;
                    z.bike_ids = dz.bike_ids;
                    z.net_flow_per_min = dz.net_flow_per_min;
                    z.depletion_eta_min = dz.depletion_eta_min;
                }
            });
        } else {
            // Ignore DELTA payloads until the first FULL payload establishes the baseline
            return;
        }

        if (state.journey.state === 'idle' && !state.modalOpen) {
            state.displayData = state.liveData;
            render();
        }
    } catch (e) {
        console.error("Data parsing error", e);
    }
}

// Validate before mutating the baseline. IDs are also used in HTML attributes and handlers.
function validatePayload(p) {
    const text = x => typeof x === 'string' && x.length <= 500;
    const id = x => typeof x === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(x);
    const count = x => Number.isInteger(x) && x >= 0 && x <= 100000;
    const number = x => Number.isFinite(x) && Math.abs(x) <= 100000;
    if (!p || !['FULL', 'DELTA'].includes(p.type) || !text(p.timestamp) || !count(p.total_bikes) ||
        !Array.isArray(p.zone_data) || p.zone_data.length > 200) throw new Error('Invalid payload');
    const stations = new Set(), bikes = new Set();
    for (const z of p.zone_data) {
        if (!z || !id(z.parking_id) || stations.has(z.parking_id) || !count(z.bikes) ||
            !Object.hasOwn(statusConfig,z.status_display) || !number(z.net_flow_per_min) ||
            !(z.depletion_eta_min === null || (number(z.depletion_eta_min) && z.depletion_eta_min >= 0)) ||
            !Array.isArray(z.bike_ids) || z.bike_ids.length > 2000 || z.bikes !== z.bike_ids.length)
            throw new Error('Invalid station');
        stations.add(z.parking_id);
        for (const b of z.bike_ids) {
            if (!b || !id(b.bike_id) || bikes.has(b.bike_id) || !['AVAILABLE','RESERVED'].includes(b.status))
                throw new Error('Invalid bike');
            bikes.add(b.bike_id);
        }
        if (p.type === 'FULL') {
            if (!text(z.name) || !text(z.area) || typeof z.status !== 'boolean' || !text(z.historical_compare) ||
                !z.context_tags || typeof z.context_tags.rush_hour !== 'boolean' ||
                typeof z.context_tags.holiday !== 'boolean' || !text(z.context_tags.event)) throw new Error('Invalid metadata');
            for (const key of ['history','forecast']) {
                if (!Array.isArray(z[key]) || z[key].length > 1000 ||
                    z[key].some(point => !point || !text(point.t) || !number(point.count) || point.count < 0))
                    throw new Error('Invalid chart data');
            }
        }
    }
}

const pendingRequests = new Map();
const retryRequests = new Map();
async function sendCommand(action, stationId, bikeId) {
    if (state.pendingCommand) throw new Error('Another action is still pending');
    if (!state.client || !state.client.isConnected()) throw new Error('Connection lost. Reconnect and retry.');
    state.pendingCommand = true;
    const key = JSON.stringify([action, stationId, bikeId]);
    const requestId = retryRequests.get(key) || CLIENT_ID + '_' + Date.now() + '_' + Math.random().toString(16).slice(2);
    retryRequests.set(key, requestId);
    let timer;
    try {
        const response = await new Promise((resolve, reject) => {
            pendingRequests.set(requestId, {resolve, reject});
            let attempts = 0;
            const publish = () => {
                if (++attempts > 3) { reject(new Error('No response from simulator. Please retry.')); return; }
                const message = new Paho.Message(JSON.stringify({request_id:requestId, client_id:CLIENT_ID,
                    action, station_id:stationId, bike_id:bikeId}));
                message.destinationName = TOPIC + '/command';
                try { state.client.send(message); } catch (e) { reject(e); return; }
                timer = setTimeout(publish, 3000);
            };
            publish();
        });
        retryRequests.delete(key);
        freeze();
        render();
        return response;
    } catch (error) {
        if (error.rejected) retryRequests.delete(key);
        throw error;
    } finally {
        clearTimeout(timer);
        pendingRequests.delete(requestId);
        state.pendingCommand = false;
    }
}

function showCommandError(error) {
    // Keep the current journey so the user can retry safely.
    alert(error.message);
}

async function syncJourney() {
    if (state.pendingCommand) return;
    try {
        const response = await sendCommand('sync', '', '');
        const j = response.journey;
        if (!j) {
            resetJourney();
            closeModal();
            resumeLive();
            return;
        }
        if (!['reserved','riding'].includes(j.state) ||
            !/^[A-Za-z0-9_-]{1,80}$/.test(j.bikeId) || !getZone(j.originId)) throw new Error('Invalid journey');
        resetJourney();
        state.journey = {state:j.state, bikeId:j.bikeId, originId:j.originId, returnId:null, rfidFail:false};
        if (j.state === 'reserved') showUnlockModal();
        else { startRiding(Number.isFinite(j.rideStart) ? j.rideStart : Date.now()); closeModal(); }
    } catch (error) {
        console.warn('Journey synchronization failed', error.message);
    }
}
