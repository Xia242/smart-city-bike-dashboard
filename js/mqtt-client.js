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
        const payload = JSON.parse(message.payloadString);
        
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
