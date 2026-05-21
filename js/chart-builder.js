/*
 * Copyright (c) 2026 Wei-Chieh Hsia. All rights reserved.
 */

/* ============================================================
   TREND CHART (inline SVG area chart, no external libs)
============================================================ */
function buildTrendChart(zone) {
    const past = (zone.history || []).map(p => p.count);
    const fut  = (zone.forecast || []).map(p => p.count);

    if (past.length === 0 && fut.length === 0) {
        return `<svg class="trend-chart" viewBox="0 0 360 120"></svg>`;
    }

    // Merge for y-scale computation
    const all = [...past, ...fut];
    const yMin = 0;
    const yMaxRaw = Math.max(...all, 5);
    const yMax = Math.ceil(yMaxRaw * 1.15);

    const W = 360, H = 120;
    const padL = 28, padR = 10, padT = 8, padB = 22;   // padB larger to host axis labels
    const innerW = W - padL - padR;
    const innerH = H - padT - padB;

    const totalPoints = past.length + fut.length;
    const stepX = innerW / Math.max(1, totalPoints - 1);

    const xy = (i, v) => {
        const x = padL + stepX * i;
        const y = padT + innerH - ((v - yMin) / (yMax - yMin)) * innerH;
        return [x, y];
    };

    // Build path strings
    const pastPts = past.map((v, i) => xy(i, v));
    const futPtsCorrected = fut.map((v, i) => xy(past.length + i, v));

    const toLine = pts => pts.map((p, idx) => `${idx === 0 ? "M" : "L"} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
    const pastPath = toLine(pastPts);

    const futLinkPts = past.length ? [pastPts[pastPts.length - 1], ...futPtsCorrected] : futPtsCorrected;
    const futPath = toLine(futLinkPts);

    let pastArea = "";
    if (pastPts.length) {
        pastArea = pastPath
            + ` L ${pastPts[pastPts.length - 1][0].toFixed(1)} ${(padT + innerH).toFixed(1)}`
            + ` L ${pastPts[0][0].toFixed(1)} ${(padT + innerH).toFixed(1)} Z`;
    }
    let futArea = "";
    if (futLinkPts.length > 1) {
        futArea = toLine(futLinkPts)
            + ` L ${futLinkPts[futLinkPts.length - 1][0].toFixed(1)} ${(padT + innerH).toFixed(1)}`
            + ` L ${futLinkPts[0][0].toFixed(1)} ${(padT + innerH).toFixed(1)} Z`;
    }

    // y-axis ticks
    const ticks = [yMax, Math.round(yMax / 2), 0];
    const tickMarks = ticks.map(v => {
        const [, y] = xy(0, v);
        return `<text x="2" y="${(y + 3).toFixed(1)}" fill="var(--text-secondary)"
                    font-size="8" font-weight="600">${v}</text>
                <line x1="${padL - 2}" x2="${W - padR}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"
                    stroke="var(--shadow-dark)" stroke-width="0.6" stroke-dasharray="2 3" opacity="0.5"/>`;
    }).join("");

    let divider = "";
    let nowX = null;
    if (past.length && fut.length) {
        nowX = padL + (past.length - 0.5) * stepX;
        divider = `<line x1="${nowX.toFixed(1)}" x2="${nowX.toFixed(1)}" y1="${padT}" y2="${padT + innerH}"
                       stroke="var(--accent-blue)" stroke-width="0.8" stroke-dasharray="2 3" opacity="0.6"/>
                   <circle cx="${nowX.toFixed(1)}" cy="${(padT + innerH).toFixed(1)}" r="2.5"
                       fill="var(--accent-blue)"/>`;
    } else if (past.length) {
        nowX = padL + (past.length - 1) * stepX;
    }

    const axisY = H - 6;
    const leftX = padL;
    const rightX = W - padR;
    let axisLabels = `
        <text x="${leftX}"  y="${axisY}" font-size="8" font-weight="600"
              fill="var(--text-secondary)" text-anchor="start">3h ago</text>
        <text x="${rightX}" y="${axisY}" font-size="8" font-weight="600"
              fill="var(--text-secondary)" text-anchor="end">+1h</text>`;
    if (nowX !== null) {
        axisLabels += `
        <text x="${nowX.toFixed(1)}" y="${axisY}" font-size="8" font-weight="700"
              fill="var(--accent-blue)" text-anchor="middle">Now</text>`;
    }

    return `<svg class="trend-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
        ${tickMarks}
        ${pastArea ? `<path d="${pastArea}" fill="var(--accent-blue)" opacity="0.18"/>` : ''}
        ${futArea  ? `<path d="${futArea}"  fill="var(--accent-blue)" opacity="0.08"/>` : ''}
        ${pastPath ? `<path d="${pastPath}" stroke="var(--accent-blue)" stroke-width="1.8"
                          fill="none" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
        ${futLinkPts.length > 1 ? `<path d="${futPath}" stroke="var(--accent-blue)" stroke-width="1.8"
                          stroke-dasharray="4 3" fill="none" stroke-linecap="round" stroke-linejoin="round"
                          opacity="0.75"/>` : ''}
        ${divider}
        ${axisLabels}
    </svg>`;
}
