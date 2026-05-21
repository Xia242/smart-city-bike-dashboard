/*
 * Copyright (c) 2026 Wei-Chieh Hsia. All rights reserved.
 */

const BROKER = "broker.hivemq.com";
const PORT = 8884;
const TOPIC = "smartcity/hanyang/bikeshare/state";
const CLIENT_ID = "citybike_neu_" + Math.random().toString(16).substring(2, 10);

const statusConfig = {
    "NORMAL":               { text: "Good",     color: "var(--orb-green)",  glow: "var(--orb-green-glow)"  },
    "CRITICAL_EMPTY":       { text: "Empty",    color: "var(--orb-red)",    glow: "var(--orb-red-glow)"    },
    "CRITICAL_OVERCROWDED": { text: "Moderate", color: "var(--orb-orange)", glow: "var(--orb-orange-glow)" }
};

const STATION_PRESET = {
    "ST-01": { distance: "NEAR", mapX: 26, mapY: 42 },
    "ST-02": { distance: "FAR",  mapX: 62, mapY: 22 },
    "ST-03": { distance: "FAR",  mapX: 78, mapY: 58 }
};

const FALLBACK_SLOTS = [
    { mapX: 22, mapY: 78 },
    { mapX: 50, mapY: 82 },
    { mapX: 80, mapY: 86 },
    { mapX: 40, mapY: 14 },
    { mapX: 14, mapY: 18 },
];
const fallbackAssigned = {};

function getStationPreset(parkingId) {
    if (STATION_PRESET[parkingId]) return STATION_PRESET[parkingId];
    if (fallbackAssigned[parkingId]) return fallbackAssigned[parkingId];
    const usedCount = Object.keys(fallbackAssigned).length;
    const slot = FALLBACK_SLOTS[usedCount % FALLBACK_SLOTS.length];
    fallbackAssigned[parkingId] = { distance: "FAR", mapX: slot.mapX, mapY: slot.mapY };
    return fallbackAssigned[parkingId];
}

const ETA_BADGE_THRESHOLD_MIN = 10;

const state = {
    liveData: null,
    displayData: null,
    modalOpen: false,
    sheetStationId: null,
    expanded: new Set(),
    journey: {
        state: 'idle',
        bikeId: null,
        originId: null,
        returnId: null,
        rfidFail: false
    },
    rideStart: null,
    rideInterval: null,
    client: null
};

function getZone(pid) {
    return state.displayData ? state.displayData.zone_data.find(z => z.parking_id === pid) : null;
}

function setBikeStatus(pid, bikeId, status) {
    const z = getZone(pid);
    if (!z) return;
    const b = (z.bike_ids || []).find(x => x.bike_id === bikeId);
    if (b) b.status = status;
}
