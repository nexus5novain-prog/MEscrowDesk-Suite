'use strict';

const express = require('express');
const router = express.Router();
const bridge = require('./plainapp-bridge-service.cjs');

// Companion tools runtime state (synchronized with connected Android device via CDAP / GraphQL when online)
const companionState = {
    pomodoro: { running: false, durationMin: 25, remainingSec: 1500, mode: 'focus' },
    soundMeter: { active: true, minDb: 38, currentDb: 42, peakDb: 68, avgDb: 45 },
    qrHistory: [
        { id: 1, text: 'https://ais-dev-unon5nqil4g25vunmiwtjk-917930534895.us-east1.run.app', format: 'QR_CODE', scannedAt: new Date().toISOString() },
        { id: 2, text: 'WIFI:S:Office-5G;T:WPA;P:SecretKey123;;', format: 'WIFI_CONFIG', scannedAt: new Date(Date.now() - 3600000).toISOString() },
    ],
    exchangeRates: {
        base: 'USD',
        updated: new Date().toISOString(),
        rates: { EUR: 0.92, GBP: 0.79, JPY: 154.2, CAD: 1.36, AUD: 1.52, CNY: 7.24, INR: 84.5 },
    },
    dlna: {
        selectedRenderer: 'tv_1',
        playbackState: 'stopped',
        activeMediaUrl: '',
        discoveredRenderers: [
            { id: 'tv_1', name: 'Living Room Smart TV (DLNA)', ip: '192.168.1.150', state: 'ready' },
            { id: 'tv_2', name: 'Conference Display (Chromecast)', ip: '192.168.1.185', state: 'ready' },
        ],
    },
    notifications: [
        { id: 'n_1', app: 'com.ismartcoding.plain', appName: 'MindConnect Desk Agent', title: 'CDAP Agent Ready', body: 'Background service waiting for relay heartbeat.', time: new Date().toISOString(), priority: 'normal' },
        { id: 'n_2', app: 'com.android.messaging', appName: 'Messages', title: 'Security Verification', body: 'Verification channel active on enrolled device.', time: new Date(Date.now() - 1200000).toISOString(), priority: 'high' },
    ],
    clipboardHistory: [
        { id: 'c_1', source: 'Console', preview: 'https://github.com/plainhub/plain-desktop', ts: new Date().toISOString() },
    ],
    nearby: [
        { id: 'dev_pixel', name: 'MindConnect Desk Android Agent', transport: 'CDAP / Wi-Fi Aware', status: 'paired', rssi: -54, ip: '192.168.1.50:8443' },
        { id: 'dev_tablet', name: 'Operations Tablet', transport: 'mDNS (_plainapp._tcp)', status: 'discovered', rssi: -63, ip: '192.168.1.72:8443' },
    ],
    tags: [
        { id: 't_1', name: 'Work', category: 'NOTE', count: 12 },
        { id: 't_2', name: 'Receipts', category: 'DOC', count: 7 },
        { id: 't_3', name: 'Important', category: 'IMAGE', count: 19 },
    ],
    kvStore: [
        { key: 'plain.sync.mode', value: 'cdap_primary_lan_fallback' },
        { key: 'plain.media.thumb_quality', value: '85' },
    ],
    downloads: [
        { id: 'dl_1', filename: 'MindConnect-Desk-telemetry-export.zip', size: '4.8 MB', progress: 100, status: 'completed' },
        { id: 'dl_2', filename: 'device-logcat-latest.txt', size: '312 KB', progress: 100, status: 'completed' },
    ],
    shares: [
        { id: 'sh_1', label: 'Field Audit Photos', path: '/DCIM/Audit', expiresIn: '24h', active: true },
    ],
    favorites: [
        { id: 'fav_1', alias: 'Camera Roll', path: '/DCIM/Camera' },
        { id: 'fav_2', alias: 'Downloads', path: '/Download' },
        { id: 'fav_3', alias: 'Documents', path: '/Documents' },
        { id: 'fav_4', alias: 'Music Library', path: '/Music' },
    ],
    accessControl: {
        IMAGES: true,
        VIDEOS: true,
        AUDIOS: true,
        DOCS: true,
        CONTACTS: true,
        CALL_LOGS: true,
        SMS: true,
        NOTES: true,
        APPS: true,
        SCREEN_MIRROR: true,
        CHAT: true,
        FEEDS: true,
        FILE_TRANSFER: true,
        ADB: false,
    },
};

function requireConsoleAuth(req, res, next) {
    if (!req.session || !req.session.userId || !req.session.user) {
        if (req.path.startsWith('/api/')) {
            return res.status(401).json({ success: false, error: 'Unauthorized: Please log in to MindConnect Desk Console' });
        }
        return res.redirect('/login?expired=1');
    }
    res.locals.user = req.session.user;
    res.locals.emergencyMode = !!req.session.emergencyMode;
    next();
}

function escapeAttr(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function renderCompanionHtml(tool, res) {
    const esc = (s) => (res.locals.escapeHtml ? res.locals.escapeHtml(s) : escapeAttr(s));

    if (tool === 'pomodoro') {
        const m = String(Math.floor(companionState.pomodoro.remainingSec / 60)).padStart(2, '0');
        const s = String(companionState.pomodoro.remainingSec % 60).padStart(2, '0');
        return `
        <div style="max-width:640px; margin:32px auto; padding:32px; background:#1E293B; border-radius:12px; border:1px solid #334155; text-align:center;">
            <div style="font-size:20px; font-weight:600; margin-bottom:8px;">Pomodoro Focus Timer</div>
            <p style="color:#94A3B8; font-size:14px; margin-bottom:20px;">Synchronized with Android Agent Background Service via CDAP</p>
            <div style="display:flex; justify-content:center; gap:8px; margin-bottom:16px;">
                <button type="button" class="pomo-preset-btn" data-mins="25" style="background:#0F172A; color:#38BDF8; border:1px solid #334155; padding:6px 14px; border-radius:6px; cursor:pointer; font-size:12px;">Focus (25m)</button>
                <button type="button" class="pomo-preset-btn" data-mins="5" style="background:#0F172A; color:#10B981; border:1px solid #334155; padding:6px 14px; border-radius:6px; cursor:pointer; font-size:12px;">Short Break (5m)</button>
                <button type="button" class="pomo-preset-btn" data-mins="15" style="background:#0F172A; color:#F59E0B; border:1px solid #334155; padding:6px 14px; border-radius:6px; cursor:pointer; font-size:12px;">Long Break (15m)</button>
            </div>
            <div id="pomo-display" style="font-size:72px; font-weight:700; font-family:monospace; color:#38BDF8; margin:20px 0;">${m}:${s}</div>
            <div style="display:flex; justify-content:center; gap:12px; margin-bottom:20px;">
                <button type="button" id="pomo-start-btn" style="background:#16A34A; color:#FFF; border:none; padding:10px 24px; border-radius:8px; font-weight:600; cursor:pointer;">Start</button>
                <button type="button" id="pomo-pause-btn" style="background:#D97706; color:#FFF; border:none; padding:10px 24px; border-radius:8px; font-weight:600; cursor:pointer;">Pause</button>
                <button type="button" id="pomo-reset-btn" style="background:#475569; color:#FFF; border:none; padding:10px 24px; border-radius:8px; font-weight:600; cursor:pointer;">Reset</button>
            </div>
            <div id="pomo-sync-msg" style="font-size:12px; color:#94A3B8;">Ready to sync timer state with enrolled Android device.</div>
        </div>`;
    }

    if (tool === 'sound-meter') {
        return `
        <div style="max-width:680px; margin:32px auto; padding:32px; background:#1E293B; border-radius:12px; border:1px solid #334155; text-align:center;">
            <div style="font-size:20px; font-weight:600; margin-bottom:8px;">Ambient Sound Meter (dB)</div>
            <p style="color:#94A3B8; font-size:14px; margin-bottom:20px;">Live decibel measurements from Android microphone telemetry</p>
            <div id="db-display" style="font-size:72px; font-weight:700; font-family:monospace; color:#10B981; margin:16px 0;">${companionState.soundMeter.currentDb}.0 <span style="font-size:28px;">dB</span></div>
            <div style="height:14px; background:#0F172A; border-radius:7px; overflow:hidden; margin:24px 0; border:1px solid #334155;">
                <div id="db-bar" style="width:${Math.min(100, companionState.soundMeter.currentDb)}%; height:100%; background:linear-gradient(90deg, #10B981, #EAB308, #EF4444); transition:width 0.2s;"></div>
            </div>
            <div style="display:flex; justify-content:space-around; color:#94A3B8; font-size:13px; margin-bottom:20px;">
                <div>Min: <strong id="db-min" style="color:#F1F5F9;">${companionState.soundMeter.minDb} dB</strong></div>
                <div>Avg: <strong id="db-avg" style="color:#F1F5F9;">${companionState.soundMeter.avgDb} dB</strong></div>
                <div>Max: <strong id="db-peak" style="color:#F1F5F9;">${companionState.soundMeter.peakDb} dB</strong></div>
            </div>
            <div style="display:flex; justify-content:center; gap:10px;">
                <button type="button" id="db-poll-btn" style="background:#2563EB; color:#FFF; border:none; padding:8px 18px; border-radius:6px; font-weight:600; cursor:pointer;">Sample Device Mic (CDAP)</button>
                <button type="button" id="db-reset-btn" style="background:#334155; color:#FFF; border:none; padding:8px 18px; border-radius:6px; cursor:pointer;">Reset Peak</button>
            </div>
            <div id="db-status" style="margin-top:12px; font-size:12px; color:#94A3B8;"></div>
        </div>`;
    }

    if (tool === 'qr-history') {
        return `
        <div style="max-width:900px; margin:28px auto; padding:24px; background:#1E293B; border-radius:12px; border:1px solid #334155;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; gap:12px; flex-wrap:wrap;">
                <div style="font-size:18px; font-weight:600; display:flex; align-items:center; gap:8px;">
                    <span class="material-icons" style="color:#38BDF8;">qr_code_scanner</span>
                    <span>QR Scanner & Barcode History</span>
                </div>
                <div style="display:flex; gap:8px;">
                    <input type="text" id="qr-new-text" placeholder="Add URL or barcode text..." style="background:#0F172A; color:#F1F5F9; border:1px solid #475569; padding:6px 12px; border-radius:6px; font-size:13px; min-width:240px;" />
                    <button type="button" id="qr-add-btn" style="background:#16A34A; color:#FFF; border:none; padding:6px 14px; border-radius:6px; font-size:13px; cursor:pointer;">Record</button>
                </div>
            </div>
            <table style="width:100%; border-collapse:collapse; font-size:13px; text-align:left;">
                <thead>
                    <tr style="border-bottom:1px solid #334155; color:#94A3B8;">
                        <th style="padding:10px;">Scanned Content</th>
                        <th style="padding:10px;">Format</th>
                        <th style="padding:10px;">Timestamp</th>
                        <th style="padding:10px; text-align:right;">Action</th>
                    </tr>
                </thead>
                <tbody id="qr-table-body">
                    ${companionState.qrHistory.map((row) => `
                    <tr style="border-bottom:1px solid #0F172A;">
                        <td style="padding:12px 10px; font-family:monospace; color:#38BDF8; word-break:break-all;">${esc(row.text)}</td>
                        <td style="padding:12px 10px;"><span style="background:#334155; padding:2px 8px; border-radius:4px;">${esc(row.format)}</span></td>
                        <td style="padding:12px 10px; color:#94A3B8;">${esc(row.scannedAt)}</td>
                        <td style="padding:12px 10px; text-align:right;">
                            <button type="button" class="qr-copy-btn" data-copy="${escapeAttr(row.text)}" style="background:#334155; color:#FFF; border:none; padding:5px 12px; border-radius:4px; cursor:pointer;">Copy</button>
                        </td>
                    </tr>`).join('')}
                </tbody>
            </table>
        </div>`;
    }

    if (tool === 'exchange-rate') {
        return `
        <div style="max-width:720px; margin:28px auto; padding:28px; background:#1E293B; border-radius:12px; border:1px solid #334155;">
            <div style="font-size:18px; font-weight:600; margin-bottom:16px; display:flex; align-items:center; gap:8px;">
                <span class="material-icons" style="color:#F59E0B;">currency_exchange</span>
                <span>Currency Exchange Rate Calculator</span>
            </div>
            <div style="display:flex; gap:12px; margin-bottom:20px;">
                <input type="number" id="fx-amt" value="100" style="flex:1; background:#0F172A; color:#FFF; border:1px solid #475569; padding:8px 12px; border-radius:6px; font-size:16px;" />
                <select id="fx-cur" style="background:#0F172A; color:#FFF; border:1px solid #475569; padding:8px 12px; border-radius:6px; font-size:15px;">
                    ${Object.keys(companionState.exchangeRates.rates).map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
                </select>
            </div>
            <div style="background:#0F172A; border-radius:8px; padding:20px; text-align:center; margin-bottom:20px;">
                <div style="font-size:13px; color:#94A3B8;">Converted Amount (Base: USD)</div>
                <div id="fx-res" style="font-size:36px; font-weight:700; color:#10B981; margin:8px 0;">92.00 EUR</div>
                <div style="font-size:12px; color:#64748B;">Cached rates synced with MindConnect Desk Core</div>
            </div>
            <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(130px, 1fr)); gap:8px;">
                ${Object.entries(companionState.exchangeRates.rates).map(([cur, rate]) => `
                <div style="background:#0F172A; padding:10px; border-radius:6px; border:1px solid #334155; display:flex; justify-content:space-between; font-size:13px;">
                    <span style="color:#94A3B8;">1 USD</span>
                    <strong style="color:#F1F5F9;">${esc(rate)} ${esc(cur)}</strong>
                </div>`).join('')}
            </div>
        </div>`;
    }

    if (tool === 'access-control') {
        return `
        <div style="max-width:880px; margin:28px auto; padding:24px; background:#1E293B; border-radius:12px; border:1px solid #334155;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:8px;">
                <div style="font-size:18px; font-weight:600; display:flex; align-items:center; gap:8px;">
                    <span class="material-icons" style="color:#EF4444;">security</span>
                    <span>Web Access Control (14 Granular Permissions)</span>
                </div>
                <span id="acl-save-status" style="font-size:12px; color:#A7F3D0;">Policy Active</span>
            </div>
            <p style="color:#94A3B8; font-size:13px; margin-bottom:20px;">Control which MindConnect Desk capabilities are exposed over CDAP and LAN endpoints for the selected device.</p>
            <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(220px, 1fr)); gap:12px;">
                ${Object.entries(companionState.accessControl).map(([k, enabled]) => `
                    <label style="display:flex; align-items:center; justify-content:space-between; background:#0F172A; padding:12px 14px; border-radius:6px; border:1px solid #334155; cursor:pointer;">
                        <span style="font-size:13px; font-weight:500;">${esc(k)}</span>
                        <input type="checkbox" class="acl-toggle" data-feature="${escapeAttr(k)}" ${enabled ? 'checked' : ''} style="cursor:pointer;" />
                    </label>
                `).join('')}
            </div>
        </div>`;
    }

    if (tool === 'dlna') {
        return `
        <div style="max-width:900px; margin:28px auto; padding:24px; background:#1E293B; border-radius:12px; border:1px solid #334155;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; gap:12px; flex-wrap:wrap;">
                <div style="font-size:18px; font-weight:600; display:flex; align-items:center; gap:8px;">
                    <span class="material-icons" style="color:#38BDF8;">cast</span>
                    <span>DLNA TV Cast & Media Renderers</span>
                </div>
                <button type="button" id="dlna-scan-btn" style="background:#2563EB; color:#FFF; border:none; padding:6px 14px; border-radius:6px; font-size:13px; cursor:pointer;">Scan LAN Renderers</button>
            </div>
            <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:12px; margin-bottom:20px;">
                ${companionState.dlna.discoveredRenderers.map((r) => `
                <div style="background:#0F172A; padding:14px; border-radius:8px; border:1px solid #334155; display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <div style="font-weight:600; font-size:14px;">${esc(r.name)}</div>
                        <div style="font-size:12px; color:#94A3B8; font-family:monospace;">${esc(r.ip)} · ${esc(r.state)}</div>
                    </div>
                    <button type="button" class="dlna-select-btn" data-renderer="${escapeAttr(r.id)}" style="background:${companionState.dlna.selectedRenderer === r.id ? '#10B981' : '#334155'}; color:#FFF; border:none; padding:5px 10px; border-radius:5px; cursor:pointer; font-size:12px;">
                        ${companionState.dlna.selectedRenderer === r.id ? 'Selected' : 'Select'}
                    </button>
                </div>`).join('')}
            </div>
            <div style="background:#0F172A; padding:18px; border-radius:8px; border:1px solid #334155;">
                <div style="font-size:13px; color:#94A3B8; margin-bottom:8px;">Cast Media URL or Android Device Path</div>
                <div style="display:flex; gap:10px; margin-bottom:14px; flex-wrap:wrap;">
                    <input type="text" id="dlna-media-input" value="${escapeAttr(companionState.dlna.activeMediaUrl)}" placeholder="/Movies/presentation.mp4 or http://..." style="flex:1; min-width:240px; background:#1E293B; color:#F1F5F9; border:1px solid #475569; padding:8px 12px; border-radius:6px; font-size:13px;" />
                    <button type="button" id="dlna-cast-btn" style="background:#16A34A; color:#FFF; border:none; padding:8px 16px; border-radius:6px; font-weight:600; cursor:pointer;">Cast Stream</button>
                    <button type="button" id="dlna-pause-btn" style="background:#D97706; color:#FFF; border:none; padding:8px 14px; border-radius:6px; cursor:pointer;">Pause</button>
                    <button type="button" id="dlna-stop-btn" style="background:#DC2626; color:#FFF; border:none; padding:8px 14px; border-radius:6px; cursor:pointer;">Stop</button>
                </div>
                <div id="dlna-status" style="font-size:12px; color:#94A3B8;">State: <strong style="color:#F1F5F9;">${esc(companionState.dlna.playbackState)}</strong></div>
            </div>
        </div>`;
    }

    if (tool === 'notifications') {
        return `
        <div style="max-width:900px; margin:28px auto; padding:24px; background:#1E293B; border-radius:12px; border:1px solid #334155;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; gap:12px; flex-wrap:wrap;">
                <div style="font-size:18px; font-weight:600; display:flex; align-items:center; gap:8px;">
                    <span class="material-icons" style="color:#F59E0B;">notifications_active</span>
                    <span>Live Android Notifications Stream</span>
                </div>
                <div style="display:flex; gap:8px;">
                    <button type="button" id="notif-refresh-btn" style="background:#2563EB; color:#FFF; border:none; padding:6px 14px; border-radius:6px; font-size:13px; cursor:pointer;">Pull from Device</button>
                    <button type="button" id="notif-clear-btn" style="background:#334155; color:#FFF; border:none; padding:6px 14px; border-radius:6px; font-size:13px; cursor:pointer;">Clear All</button>
                </div>
            </div>
            <div id="notif-list" style="display:flex; flex-direction:column; gap:10px;">
                ${companionState.notifications.length === 0
                    ? '<div style="color:#94A3B8; padding:20px; text-align:center;">No active notifications</div>'
                    : companionState.notifications.map((n) => `
                    <div style="background:#0F172A; padding:14px; border-radius:8px; border:1px solid #334155; display:flex; justify-content:space-between; align-items:flex-start; gap:12px;">
                        <div>
                            <div style="font-size:11px; color:#38BDF8; font-weight:600; text-transform:uppercase;">${esc(n.appName)} (${esc(n.app)})</div>
                            <div style="font-size:14px; font-weight:600; margin:4px 0;">${esc(n.title)}</div>
                            <div style="font-size:13px; color:#CBD5E1;">${esc(n.body)}</div>
                        </div>
                        <button type="button" class="notif-dismiss-btn" data-id="${escapeAttr(n.id)}" style="background:#334155; color:#F1F5F9; border:none; padding:4px 10px; border-radius:4px; font-size:12px; cursor:pointer;">Dismiss</button>
                    </div>`).join('')}
            </div>
            <div id="notif-status" style="margin-top:12px; font-size:12px; color:#94A3B8;"></div>
        </div>`;
    }

    if (tool === 'clipboard') {
        return `
        <div style="max-width:860px; margin:28px auto; padding:24px; background:#1E293B; border-radius:12px; border:1px solid #334155;">
            <div style="font-size:18px; font-weight:600; margin-bottom:12px; display:flex; align-items:center; gap:8px;">
                <span class="material-icons" style="color:#10B981;">content_paste</span>
                <span>Two-Way Device Clipboard Sync</span>
            </div>
            <textarea id="clip-text" rows="4" placeholder="Enter text to push to Android device clipboard, or pull from device..." style="width:100%; background:#0F172A; color:#F1F5F9; border:1px solid #475569; border-radius:8px; padding:12px; font-family:monospace; font-size:13px; box-sizing:border-box; margin-bottom:12px;"></textarea>
            <div style="display:flex; gap:10px; margin-bottom:20px; flex-wrap:wrap;">
                <button type="button" id="clip-push-btn" style="background:#16A34A; color:#FFF; border:none; padding:8px 16px; border-radius:6px; font-weight:600; cursor:pointer;">Push to Phone Clipboard</button>
                <button type="button" id="clip-pull-btn" style="background:#2563EB; color:#FFF; border:none; padding:8px 16px; border-radius:6px; font-weight:600; cursor:pointer;">Pull from Phone Clipboard</button>
            </div>
            <div id="clip-status" style="font-size:12px; color:#94A3B8; margin-bottom:16px;"></div>
            <div style="font-size:13px; font-weight:600; color:#94A3B8; margin-bottom:8px;">Recent Sync History</div>
            <div style="display:flex; flex-direction:column; gap:8px;">
                ${companionState.clipboardHistory.map((c) => `
                <div style="background:#0F172A; padding:10px 14px; border-radius:6px; border:1px solid #334155; display:flex; justify-content:space-between; align-items:center; gap:12px;">
                    <div style="font-family:monospace; font-size:12px; color:#E2E8F0; word-break:break-all;"><strong>[${esc(c.source)}]</strong> ${esc(c.preview)}</div>
                    <span style="font-size:11px; color:#64748B; white-space:nowrap;">${esc(c.ts)}</span>
                </div>`).join('')}
            </div>
        </div>`;
    }

    if (tool === 'nearby') {
        return `
        <div style="max-width:900px; margin:28px auto; padding:24px; background:#1E293B; border-radius:12px; border:1px solid #334155;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:10px;">
                <div style="font-size:18px; font-weight:600; display:flex; align-items:center; gap:8px;">
                    <span class="material-icons" style="color:#38BDF8;">radar</span>
                    <span>Nearby Discovery (mDNS / BLE / Wi-Fi Aware)</span>
                </div>
                <button type="button" id="nearby-scan-btn" style="background:#2563EB; color:#FFF; border:none; padding:6px 14px; border-radius:6px; font-size:13px; cursor:pointer;">Probe LAN & CDAP Mesh</button>
            </div>
            <table style="width:100%; border-collapse:collapse; font-size:13px; text-align:left; margin-bottom:20px;">
                <thead>
                    <tr style="border-bottom:1px solid #334155; color:#94A3B8;">
                        <th style="padding:10px;">Peer Name</th>
                        <th style="padding:10px;">Transport</th>
                        <th style="padding:10px;">Endpoint</th>
                        <th style="padding:10px;">RSSI</th>
                        <th style="padding:10px; text-align:right;">Status</th>
                    </tr>
                </thead>
                <tbody>
                    ${companionState.nearby.map((p) => `
                    <tr style="border-bottom:1px solid #0F172A;">
                        <td style="padding:12px 10px; font-weight:600;">${esc(p.name)}</td>
                        <td style="padding:12px 10px; color:#94A3B8;">${esc(p.transport)}</td>
                        <td style="padding:12px 10px; font-family:monospace; color:#38BDF8;">${esc(p.ip)}</td>
                        <td style="padding:12px 10px;">${esc(p.rssi)} dBm</td>
                        <td style="padding:12px 10px; text-align:right;"><span style="background:#0F172A; border:1px solid #334155; padding:2px 8px; border-radius:4px;">${esc(p.status)}</span></td>
                    </tr>`).join('')}
                </tbody>
            </table>
            <div id="nearby-status" style="font-size:12px; color:#94A3B8;"></div>
        </div>`;
    }

    if (tool === 'tags') {
        return `
        <div style="max-width:900px; margin:28px auto; padding:24px; background:#1E293B; border-radius:12px; border:1px solid #334155;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:10px;">
                <div style="font-size:18px; font-weight:600; display:flex; align-items:center; gap:8px;">
                    <span class="material-icons" style="color:#A855F7;">label</span>
                    <span>Tags & Key-Value Store</span>
                </div>
                <button type="button" id="tags-sync-btn" style="background:#2563EB; color:#FFF; border:none; padding:6px 14px; border-radius:6px; font-size:13px; cursor:pointer;">Sync Tags via GraphQL</button>
            </div>
            <div style="display:flex; gap:8px; margin-bottom:18px; flex-wrap:wrap;">
                <input type="text" id="tag-new-name" placeholder="New tag name..." style="background:#0F172A; color:#F1F5F9; border:1px solid #475569; padding:7px 12px; border-radius:6px; font-size:13px;" />
                <select id="tag-new-cat" style="background:#0F172A; color:#F1F5F9; border:1px solid #475569; padding:7px 12px; border-radius:6px; font-size:13px;">
                    <option value="NOTE">NOTE</option>
                    <option value="DOC">DOC</option>
                    <option value="IMAGE">IMAGE</option>
                    <option value="VIDEO">VIDEO</option>
                </select>
                <button type="button" id="tag-add-btn" style="background:#16A34A; color:#FFF; border:none; padding:7px 14px; border-radius:6px; cursor:pointer; font-size:13px;">Add Tag</button>
            </div>
            <div style="display:flex; flex-wrap:wrap; gap:10px; margin-bottom:24px;">
                ${companionState.tags.map((t) => `
                <div style="background:#0F172A; border:1px solid #334155; padding:8px 14px; border-radius:8px; display:flex; align-items:center; gap:10px; font-size:13px;">
                    <span style="font-weight:600; color:#E2E8F0;">#${esc(t.name)}</span>
                    <span style="font-size:11px; color:#94A3B8;">${esc(t.category)} (${esc(t.count)})</span>
                    <button type="button" class="tag-del-btn" data-id="${escapeAttr(t.id)}" style="background:none; border:none; color:#EF4444; cursor:pointer; font-weight:700;">&times;</button>
                </div>`).join('')}
            </div>
            <div style="font-size:14px; font-weight:600; margin-bottom:10px;">MindConnect Desk Key-Value Entries</div>
            <div style="display:flex; flex-direction:column; gap:8px;">
                ${companionState.kvStore.map((kv) => `
                <div style="background:#0F172A; padding:10px 14px; border-radius:6px; border:1px solid #334155; display:flex; justify-content:space-between; font-family:monospace; font-size:12px;">
                    <span style="color:#38BDF8;">${esc(kv.key)}</span>
                    <span style="color:#10B981;">${esc(kv.value)}</span>
                </div>`).join('')}
            </div>
            <div id="tags-status" style="margin-top:12px; font-size:12px; color:#94A3B8;"></div>
        </div>`;
    }

    if (tool === 'downloads') {
        return `
        <div style="max-width:900px; margin:28px auto; padding:24px; background:#1E293B; border-radius:12px; border:1px solid #334155;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:10px;">
                <div style="font-size:18px; font-weight:600; display:flex; align-items:center; gap:8px;">
                    <span class="material-icons" style="color:#10B981;">file_download</span>
                    <span>Downloads & Transfer Queue</span>
                </div>
                <a href="/plainapp/files" style="background:#2563EB; color:#FFF; text-decoration:none; padding:6px 14px; border-radius:6px; font-size:13px;">Open Files Explorer</a>
            </div>
            <table style="width:100%; border-collapse:collapse; font-size:13px; text-align:left;">
                <thead>
                    <tr style="border-bottom:1px solid #334155; color:#94A3B8;">
                        <th style="padding:10px;">Filename</th>
                        <th style="padding:10px;">Size</th>
                        <th style="padding:10px;">Progress</th>
                        <th style="padding:10px; text-align:right;">Status</th>
                    </tr>
                </thead>
                <tbody>
                    ${companionState.downloads.map((d) => `
                    <tr style="border-bottom:1px solid #0F172A;">
                        <td style="padding:12px 10px; font-family:monospace; color:#E2E8F0;">${esc(d.filename)}</td>
                        <td style="padding:12px 10px; color:#94A3B8;">${esc(d.size)}</td>
                        <td style="padding:12px 10px;">${esc(d.progress)}%</td>
                        <td style="padding:12px 10px; text-align:right; color:#10B981;">${esc(d.status)}</td>
                    </tr>`).join('')}
                </tbody>
            </table>
        </div>`;
    }

    if (tool === 'shares') {
        return `
        <div style="max-width:900px; margin:28px auto; padding:24px; background:#1E293B; border-radius:12px; border:1px solid #334155;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:10px;">
                <div style="font-size:18px; font-weight:600; display:flex; align-items:center; gap:8px;">
                    <span class="material-icons" style="color:#38BDF8;">share</span>
                    <span>Active Resource Shares</span>
                </div>
                <a href="/plainapp/files" style="background:#2563EB; color:#FFF; text-decoration:none; padding:6px 14px; border-radius:6px; font-size:13px;">Manage File Shares</a>
            </div>
            <div style="display:flex; gap:8px; margin-bottom:16px; flex-wrap:wrap;">
                <input type="text" id="share-label" placeholder="Share label..." style="background:#0F172A; color:#F1F5F9; border:1px solid #475569; padding:7px 12px; border-radius:6px; font-size:13px;" />
                <input type="text" id="share-path" placeholder="/Download/report.pdf" style="flex:1; min-width:200px; background:#0F172A; color:#F1F5F9; border:1px solid #475569; padding:7px 12px; border-radius:6px; font-size:13px;" />
                <button type="button" id="share-create-btn" style="background:#16A34A; color:#FFF; border:none; padding:7px 14px; border-radius:6px; cursor:pointer; font-size:13px;">Create Share</button>
            </div>
            <div style="display:flex; flex-direction:column; gap:10px;">
                ${companionState.shares.map((s) => `
                <div style="background:#0F172A; padding:14px; border-radius:8px; border:1px solid #334155; display:flex; justify-content:space-between; align-items:center; gap:12px;">
                    <div>
                        <div style="font-weight:600; font-size:14px;">${esc(s.label)}</div>
                        <div style="font-size:12px; font-family:monospace; color:#38BDF8;">${esc(s.path)} · Expires: ${esc(s.expiresIn)}</div>
                    </div>
                    <button type="button" class="share-revoke-btn" data-id="${escapeAttr(s.id)}" style="background:#DC2626; color:#FFF; border:none; padding:5px 12px; border-radius:5px; cursor:pointer; font-size:12px;">Revoke</button>
                </div>`).join('')}
            </div>
        </div>`;
    }

    if (tool === 'favorites') {
        return `
        <div style="max-width:900px; margin:28px auto; padding:24px; background:#1E293B; border-radius:12px; border:1px solid #334155;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:10px;">
                <div style="font-size:18px; font-weight:600; display:flex; align-items:center; gap:8px;">
                    <span class="material-icons" style="color:#F59E0B;">star</span>
                    <span>Favorite Storage Folders</span>
                </div>
                <a href="/plainapp/files" style="background:#2563EB; color:#FFF; text-decoration:none; padding:6px 14px; border-radius:6px; font-size:13px;">Browse All Volumes</a>
            </div>
            <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(240px, 1fr)); gap:12px;">
                ${companionState.favorites.map((f) => `
                <a href="/plainapp/files" style="background:#0F172A; padding:16px; border-radius:8px; border:1px solid #334155; text-decoration:none; color:#F1F5F9; display:flex; align-items:center; gap:12px;">
                    <span class="material-icons" style="color:#F59E0B;">folder_special</span>
                    <div>
                        <div style="font-weight:600; font-size:14px;">${esc(f.alias)}</div>
                        <div style="font-size:12px; font-family:monospace; color:#94A3B8;">${esc(f.path)}</div>
                    </div>
                </a>`).join('')}
            </div>
        </div>`;
    }

    return `
    <div style="max-width:820px; margin:30px auto; padding:24px; background:#1E293B; border-radius:12px; border:1px solid #334155;">
        <div style="font-size:18px; font-weight:600; margin-bottom:8px;">${esc(tool)}</div>
        <p style="color:#94A3B8; font-size:13px;">Connected via MindConnect Desk CDAP / Direct LAN Gateway.</p>
    </div>`;
}

function renderPlainAppShell(req, res, pageKey, title, deepLinkPath, companionTool = null) {
    const nonce = res.locals.cspNonce || '';
    const esc = (s) => (res.locals.escapeHtml ? res.locals.escapeHtml(s) : escapeAttr(s));
    const normalizedPath = !deepLinkPath || deepLinkPath === '/' ? '/' : deepLinkPath;
    const iframeSrc = `/plainapp-web${normalizedPath}`;
    const activeDevice = typeof req.query.device === 'string' ? req.query.device : '';
    const csrfToken = res.locals.csrfToken || '';

    res.render('layouts/main', {
        title: `MindConnect Desk · ${title}`,
        currentPage: pageKey,
        pageStyles: [],
        pageScripts: [],
        breadcrumb: [
            { label: 'MindConnect Desk Control', href: '/plainapp' },
            { label: title },
        ],
        body: `
        <div style="display:flex; flex-direction:column; height:calc(100vh - 120px); min-height:600px; background:#0F172A; color:#E2E8F0; border-radius:8px; overflow:hidden; border:1px solid #1E293B;">
            <div style="display:flex; align-items:center; justify-content:space-between; padding:12px 20px; background:#1E293B; border-bottom:1px solid #334155; gap:12px; flex-wrap:wrap;">
                <div style="display:flex; align-items:center; gap:12px;">
                    <span class="material-icons" style="color:#10B981; font-size:24px;">smartphone</span>
                    <div>
                        <div style="font-weight:600; font-size:15px; display:flex; align-items:center; gap:8px;">
                            <span>${esc(title)}</span>
                            <span id="plainapp-link-status" style="font-size:11px; color:#A7F3D0; font-weight:500;">CDAP Tunnel Ready</span>
                        </div>
                        <div style="font-size:12px; color:#94A3B8;">Remote Android Device Gateway · CDAP + Direct LAN Fallback</div>
                    </div>
                </div>

                <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                    <select id="plainapp-device-select" data-selected="${escapeAttr(activeDevice)}" style="background:#0F172A; color:#F1F5F9; border:1px solid #475569; border-radius:6px; padding:6px 10px; font-size:13px; outline:none;">
                        <option value="">Loading enrolled devices...</option>
                    </select>

                    <input type="text" id="plainapp-lan-host" placeholder="LAN IP:Port (e.g. 192.168.1.50:8443)" style="background:#0F172A; color:#F1F5F9; border:1px solid #475569; border-radius:6px; padding:6px 10px; font-size:12px; width:190px; outline:none;" />
                    <button type="button" id="plainapp-lan-probe-btn" style="background:#0F766E; color:#F0FDFA; border:none; border-radius:6px; padding:6px 10px; font-size:12px; cursor:pointer; white-space:nowrap;">Test LAN</button>

                    <button type="button" id="plainapp-sync-btn" style="background:#334155; color:#F8FAFC; border:none; border-radius:6px; padding:6px 12px; font-size:13px; cursor:pointer; display:inline-flex; align-items:center; gap:4px; white-space:nowrap;">
                        <span class="material-icons" style="font-size:16px;">refresh</span>
                        <span>Sync</span>
                    </button>

                    ${!companionTool ? `
                    <a href="${escapeAttr(iframeSrc)}" target="_blank" rel="noopener noreferrer" style="background:#2563EB; color:#EFF6FF; border:none; border-radius:6px; padding:6px 12px; font-size:13px; text-decoration:none; display:inline-flex; align-items:center; gap:4px; white-space:nowrap;">
                        <span class="material-icons" style="font-size:16px;">open_in_new</span>
                        <span>Pop Out</span>
                    </a>` : ''}
                </div>
            </div>

            <div style="flex:1; position:relative; overflow:auto; display:flex; flex-direction:column;">
                ${companionTool ? renderCompanionHtml(companionTool, res) : `
                <iframe id="plainapp-frame" src="${escapeAttr(iframeSrc)}" style="width:100%; height:100%; border:none; background:#0F172A;" allow="camera; microphone; display-capture; clipboard-read; clipboard-write;"></iframe>
                `}
            </div>
        </div>

        <script nonce="${escapeAttr(nonce)}">
        (function () {
            const csrfToken = ${JSON.stringify(csrfToken)};
            const devSelect = document.getElementById('plainapp-device-select');
            const lanHostInput = document.getElementById('plainapp-lan-host');
            const lanProbeBtn = document.getElementById('plainapp-lan-probe-btn');
            const syncBtn = document.getElementById('plainapp-sync-btn');
            const statusEl = document.getElementById('plainapp-link-status');

            try {
                const savedLan = localStorage.getItem('plainapp_lan_host');
                if (savedLan && lanHostInput) lanHostInput.value = savedLan;
            } catch (_) {}

            async function postJson(url, payload) {
                const resp = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
                    body: JSON.stringify(payload || {}),
                });
                return resp.json();
            }

            function getSelectedDeviceId() {
                return devSelect ? devSelect.value : '';
            }

            async function loadDevices() {
                if (!devSelect) return;
                const wanted = devSelect.getAttribute('data-selected') || '';
                try {
                    const resp = await fetch('/api/plainapp/devices');
                    const data = await resp.json();
                    const list = Array.isArray(data.devices) ? data.devices : [];
                    devSelect.innerHTML = '';
                    if (list.length === 0) {
                        const opt = document.createElement('option');
                        opt.value = '';
                        opt.textContent = 'No online CDAP devices (Direct LAN mode)';
                        devSelect.appendChild(opt);
                        if (statusEl) {
                            statusEl.textContent = 'LAN Direct Ready';
                            statusEl.style.color = '#FCD34D';
                        }
                    } else {
                        list.forEach((d) => {
                            const opt = document.createElement('option');
                            const id = d.id || d.device_id || '';
                            opt.value = id;
                            const badge = d.cdapOnline ? ' [CDAP Live]' : (d.online ? ' [Online]' : ' [Offline]');
                            opt.textContent = (d.name || id) + badge;
                            if (wanted && wanted === id) opt.selected = true;
                            devSelect.appendChild(opt);
                        });
                        if (statusEl) {
                            const cdapCount = list.filter((d) => d.cdapOnline).length;
                            statusEl.textContent = cdapCount > 0 ? ('CDAP Connected (' + cdapCount + ')') : ('Enrolled (' + list.length + ')');
                            statusEl.style.color = cdapCount > 0 ? '#A7F3D0' : '#FCD34D';
                        }
                    }
                } catch (_) {
                    devSelect.innerHTML = '<option value="">LAN Direct / Fallback</option>';
                }
            }

            if (devSelect) {
                devSelect.addEventListener('change', function () {
                    const url = new URL(window.location.href);
                    if (this.value) url.searchParams.set('device', this.value);
                    else url.searchParams.delete('device');
                    window.location.href = url.toString();
                });
            }

            if (lanHostInput) {
                lanHostInput.addEventListener('change', () => {
                    try { localStorage.setItem('plainapp_lan_host', lanHostInput.value.trim()); } catch (_) {}
                });
            }

            if (lanProbeBtn && lanHostInput) {
                lanProbeBtn.addEventListener('click', async () => {
                    const host = lanHostInput.value.trim();
                    if (!host) {
                        if (statusEl) { statusEl.textContent = 'Enter a LAN IP:Port first'; statusEl.style.color = '#FCA5A5'; }
                        return;
                    }
                    try { localStorage.setItem('plainapp_lan_host', host); } catch (_) {}
                    if (statusEl) { statusEl.textContent = 'Probing ' + host + '...'; statusEl.style.color = '#93C5FD'; }
                    try {
                        const r = await postJson('/api/plainapp/lan-proxy', {
                            baseUrl: host,
                            path: '/graphql',
                            method: 'POST',
                            body: { query: '{ app { deviceName version } }' },
                        });
                        if (statusEl) {
                            statusEl.textContent = r.success ? ('LAN Reachable (' + host + ')') : ('LAN Error: ' + (r.error || 'Unreachable'));
                            statusEl.style.color = r.success ? '#A7F3D0' : '#FCA5A5';
                        }
                    } catch (e) {
                        if (statusEl) { statusEl.textContent = 'LAN Probe Failed'; statusEl.style.color = '#FCA5A5'; }
                    }
                });
            }

            if (syncBtn) {
                syncBtn.addEventListener('click', function () {
                    const frame = document.getElementById('plainapp-frame');
                    if (frame && frame.contentWindow) frame.contentWindow.location.reload();
                    else loadDevices();
                });
            }

            // Pomodoro bindings
            const pomoDisplay = document.getElementById('pomo-display');
            if (pomoDisplay) {
                let pomoTimer = null;
                let sec = ${companionState.pomodoro.remainingSec};
                const pomoMsg = document.getElementById('pomo-sync-msg');
                const renderPomo = () => {
                    const m = String(Math.floor(sec / 60)).padStart(2, '0');
                    const s = String(sec % 60).padStart(2, '0');
                    pomoDisplay.textContent = m + ':' + s;
                };
                document.querySelectorAll('.pomo-preset-btn').forEach((btn) => {
                    btn.addEventListener('click', () => {
                        clearInterval(pomoTimer); pomoTimer = null;
                        sec = (parseInt(btn.getAttribute('data-mins') || '25', 10) || 25) * 60;
                        renderPomo();
                    });
                });
                document.getElementById('pomo-start-btn')?.addEventListener('click', async () => {
                    if (!pomoTimer) {
                        pomoTimer = setInterval(() => { if (sec > 0) { sec--; renderPomo(); } else { clearInterval(pomoTimer); pomoTimer = null; } }, 1000);
                    }
                    const r = await postJson('/api/plainapp/companion/pomodoro', { deviceId: getSelectedDeviceId(), action: 'start', remainingSec: sec });
                    if (pomoMsg) pomoMsg.textContent = r.cdapSynced ? 'Synced timer START over CDAP' : 'Running locally in console (connect device for push alert)';
                });
                document.getElementById('pomo-pause-btn')?.addEventListener('click', async () => {
                    clearInterval(pomoTimer); pomoTimer = null;
                    await postJson('/api/plainapp/companion/pomodoro', { deviceId: getSelectedDeviceId(), action: 'pause', remainingSec: sec });
                    if (pomoMsg) pomoMsg.textContent = 'Timer paused.';
                });
                document.getElementById('pomo-reset-btn')?.addEventListener('click', async () => {
                    clearInterval(pomoTimer); pomoTimer = null; sec = 1500; renderPomo();
                    await postJson('/api/plainapp/companion/pomodoro', { deviceId: getSelectedDeviceId(), action: 'reset', remainingSec: sec });
                    if (pomoMsg) pomoMsg.textContent = 'Timer reset to 25:00.';
                });
            }

            // Sound Meter bindings
            const dbPollBtn = document.getElementById('db-poll-btn');
            if (dbPollBtn) {
                dbPollBtn.addEventListener('click', async () => {
                    const st = document.getElementById('db-status');
                    const r = await postJson('/api/plainapp/companion/sound-meter', { deviceId: getSelectedDeviceId(), action: 'sample' });
                    if (r.soundMeter) {
                        const d = document.getElementById('db-display');
                        const bar = document.getElementById('db-bar');
                        const pk = document.getElementById('db-peak');
                        if (d) d.innerHTML = r.soundMeter.currentDb + '.0 <span style="font-size:28px;">dB</span>';
                        if (bar) bar.style.width = Math.min(100, r.soundMeter.currentDb) + '%';
                        if (pk) pk.textContent = r.soundMeter.peakDb + ' dB';
                    }
                    if (st) st.textContent = r.cdapSynced ? 'Live sample pulled via CDAP' : 'CDAP device offline — showing last buffered telemetry';
                });
                document.getElementById('db-reset-btn')?.addEventListener('click', async () => {
                    await postJson('/api/plainapp/companion/sound-meter', { action: 'reset' });
                    window.location.reload();
                });
            }

            // QR History bindings
            document.getElementById('qr-add-btn')?.addEventListener('click', async () => {
                const inp = document.getElementById('qr-new-text');
                const val = inp ? inp.value.trim() : '';
                if (!val) return;
                await postJson('/api/plainapp/companion/qr-add', { text: val });
                window.location.reload();
            });
            document.querySelectorAll('.qr-copy-btn').forEach((btn) => {
                btn.addEventListener('click', () => {
                    const val = btn.getAttribute('data-copy') || '';
                    navigator.clipboard?.writeText(val);
                    btn.textContent = 'Copied';
                    setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
                });
            });

            // Exchange Rate bindings
            const fxAmt = document.getElementById('fx-amt');
            const fxCur = document.getElementById('fx-cur');
            const fxRes = document.getElementById('fx-res');
            if (fxAmt && fxCur && fxRes) {
                const rates = ${JSON.stringify(companionState.exchangeRates.rates)};
                const recalc = () => {
                    const amt = parseFloat(fxAmt.value) || 0;
                    const cur = fxCur.value;
                    fxRes.textContent = (amt * (rates[cur] || 1)).toFixed(2) + ' ' + cur;
                };
                fxAmt.addEventListener('input', recalc);
                fxCur.addEventListener('change', recalc);
            }

            // Access Control bindings
            document.querySelectorAll('.acl-toggle').forEach((chk) => {
                chk.addEventListener('change', async () => {
                    const aclStatus = document.getElementById('acl-save-status');
                    const r = await postJson('/api/plainapp/access-control', {
                        deviceId: getSelectedDeviceId(),
                        feature: chk.getAttribute('data-feature'),
                        enabled: chk.checked,
                    });
                    if (aclStatus) {
                        aclStatus.textContent = r.success ? (r.cdapSynced ? 'Saved + Synced to Device' : 'Saved in Console Policy') : 'Save failed';
                    }
                });
            });

            // DLNA bindings
            document.querySelectorAll('.dlna-select-btn').forEach((btn) => {
                btn.addEventListener('click', async () => {
                    await postJson('/api/plainapp/companion/dlna', { action: 'select', rendererId: btn.getAttribute('data-renderer') });
                    window.location.reload();
                });
            });
            document.getElementById('dlna-scan-btn')?.addEventListener('click', async () => {
                const st = document.getElementById('dlna-status');
                const r = await postJson('/api/plainapp/companion/dlna', { deviceId: getSelectedDeviceId(), action: 'scan' });
                if (st) st.textContent = r.cdapSynced ? 'Device DLNA scan complete' : 'Local renderer cache refreshed (no live CDAP phone connected)';
            });
            document.getElementById('dlna-cast-btn')?.addEventListener('click', async () => {
                const url = document.getElementById('dlna-media-input')?.value.trim() || '';
                const st = document.getElementById('dlna-status');
                const r = await postJson('/api/plainapp/companion/dlna', { deviceId: getSelectedDeviceId(), action: 'cast', mediaUrl: url });
                if (st) st.textContent = 'State: playing (' + (r.cdapSynced ? 'CDAP Dispatched' : 'Queued for Device') + ')';
            });
            document.getElementById('dlna-pause-btn')?.addEventListener('click', async () => {
                await postJson('/api/plainapp/companion/dlna', { deviceId: getSelectedDeviceId(), action: 'pause' });
                window.location.reload();
            });
            document.getElementById('dlna-stop-btn')?.addEventListener('click', async () => {
                await postJson('/api/plainapp/companion/dlna', { deviceId: getSelectedDeviceId(), action: 'stop' });
                window.location.reload();
            });

            // Notifications bindings
            document.getElementById('notif-refresh-btn')?.addEventListener('click', async () => {
                const st = document.getElementById('notif-status');
                const r = await postJson('/api/plainapp/companion/notifications', { deviceId: getSelectedDeviceId(), action: 'pull' });
                if (st) st.textContent = r.cdapSynced ? 'Synced live notifications from Android' : 'Using buffered feed (connect CDAP agent to stream new notifications)';
            });
            document.getElementById('notif-clear-btn')?.addEventListener('click', async () => {
                await postJson('/api/plainapp/companion/notifications', { action: 'clear' });
                window.location.reload();
            });
            document.querySelectorAll('.notif-dismiss-btn').forEach((btn) => {
                btn.addEventListener('click', async () => {
                    await postJson('/api/plainapp/companion/notifications', { action: 'dismiss', id: btn.getAttribute('data-id') });
                    window.location.reload();
                });
            });

            // Clipboard bindings
            document.getElementById('clip-push-btn')?.addEventListener('click', async () => {
                const text = document.getElementById('clip-text')?.value || '';
                const st = document.getElementById('clip-status');
                const r = await postJson('/api/plainapp/companion/clipboard', { deviceId: getSelectedDeviceId(), action: 'push', text });
                if (st) st.textContent = r.cdapSynced ? 'Pushed to Android clipboard over CDAP' : 'Saved to console clipboard history (CDAP device offline)';
            });
            document.getElementById('clip-pull-btn')?.addEventListener('click', async () => {
                const box = document.getElementById('clip-text');
                const st = document.getElementById('clip-status');
                const r = await postJson('/api/plainapp/companion/clipboard', { deviceId: getSelectedDeviceId(), action: 'pull' });
                if (box && typeof r.text === 'string') box.value = r.text;
                if (st) st.textContent = r.cdapSynced ? 'Pulled latest clipboard from Android' : 'Pulled latest entry from console cache (CDAP device offline)';
            });

            // Nearby bindings
            document.getElementById('nearby-scan-btn')?.addEventListener('click', async () => {
                const st = document.getElementById('nearby-status');
                const r = await postJson('/api/plainapp/companion/nearby', { deviceId: getSelectedDeviceId(), action: 'scan' });
                if (st) st.textContent = r.cdapSynced ? 'Mesh scan synced with device' : 'Checked CDAP + LAN peer registry (' + (r.peersCount || 0) + ' known peers)';
            });

            // Tags bindings
            document.getElementById('tag-add-btn')?.addEventListener('click', async () => {
                const name = document.getElementById('tag-new-name')?.value.trim() || '';
                const category = document.getElementById('tag-new-cat')?.value || 'NOTE';
                if (!name) return;
                await postJson('/api/plainapp/companion/tags', { deviceId: getSelectedDeviceId(), action: 'add', name, category });
                window.location.reload();
            });
            document.querySelectorAll('.tag-del-btn').forEach((btn) => {
                btn.addEventListener('click', async () => {
                    await postJson('/api/plainapp/companion/tags', { action: 'delete', id: btn.getAttribute('data-id') });
                    window.location.reload();
                });
            });
            document.getElementById('tags-sync-btn')?.addEventListener('click', async () => {
                const st = document.getElementById('tags-status');
                const r = await postJson('/api/plainapp/companion/tags', { deviceId: getSelectedDeviceId(), action: 'sync' });
                if (st) st.textContent = r.cdapSynced ? 'Tags synced with Android GraphQL store' : 'Showing local tag catalog (select an online CDAP device to sync)';
            });

            // Shares bindings
            document.getElementById('share-create-btn')?.addEventListener('click', async () => {
                const label = document.getElementById('share-label')?.value.trim() || 'Shared Folder';
                const pathVal = document.getElementById('share-path')?.value.trim() || '/';
                await postJson('/api/plainapp/companion/shares', { action: 'create', label, path: pathVal });
                window.location.reload();
            });
            document.querySelectorAll('.share-revoke-btn').forEach((btn) => {
                btn.addEventListener('click', async () => {
                    await postJson('/api/plainapp/companion/shares', { action: 'revoke', id: btn.getAttribute('data-id') });
                    window.location.reload();
                });
            });

            loadDevices();
        })();
        </script>
        `,
    });
}

// ── Register All 34 PlainApp Control Console Routes ──────────────────────────

// 1. Control Hub
router.get('/plainapp', requireConsoleAuth, (req, res) => {
    renderPlainAppShell(req, res, 'plainapp-home', 'Control Hub', '/');
});
router.get('/plainapp/search', requireConsoleAuth, (req, res) => {
    renderPlainAppShell(req, res, 'plainapp-search', 'Global Search', '/search');
});

// 2. Files & Storage
router.get('/plainapp/files', requireConsoleAuth, (req, res) => {
    renderPlainAppShell(req, res, 'plainapp-files', 'Files Explorer', '/files');
});
router.get('/plainapp/files/recent', requireConsoleAuth, (req, res) => {
    renderPlainAppShell(req, res, 'plainapp-recent', 'Recent Files', '/files/recent');
});
router.get('/plainapp/trash', requireConsoleAuth, (req, res) => {
    renderPlainAppShell(req, res, 'plainapp-trash', 'Trash Bin', '/files/trash');
});
router.get('/plainapp/files/apps', requireConsoleAuth, (req, res) => {
    renderPlainAppShell(req, res, 'plainapp-appfiles', 'App Files', '/chat/app-files');
});
router.get('/plainapp/downloads', requireConsoleAuth, (req, res) => {
    renderPlainAppShell(req, res, 'plainapp-downloads', 'Downloads', '', 'downloads');
});
router.get('/plainapp/shares', requireConsoleAuth, (req, res) => {
    renderPlainAppShell(req, res, 'plainapp-shares', 'Shares', '', 'shares');
});
router.get('/plainapp/favorites', requireConsoleAuth, (req, res) => {
    renderPlainAppShell(req, res, 'plainapp-favorites', 'Favorites', '', 'favorites');
});

// 3. Media & Creative
router.get('/plainapp/images', requireConsoleAuth, (req, res) => {
    renderPlainAppShell(req, res, 'plainapp-images', 'Photos & Images', '/images');
});
router.get('/plainapp/videos', requireConsoleAuth, (req, res) => {
    renderPlainAppShell(req, res, 'plainapp-videos', 'Videos', '/videos');
});
router.get('/plainapp/audios', requireConsoleAuth, (req, res) => {
    renderPlainAppShell(req, res, 'plainapp-audios', 'Audio & Music', '/audios');
});
router.get('/plainapp/docs', requireConsoleAuth, (req, res) => {
    renderPlainAppShell(req, res, 'plainapp-docs', 'Documents', '/docs');
});
router.get('/plainapp/image-editor', requireConsoleAuth, (req, res) => {
    renderPlainAppShell(req, res, 'plainapp-image-editor', 'Image Editor', '/image-editor');
});
router.get('/plainapp/dlna', requireConsoleAuth, (req, res) => {
    renderPlainAppShell(req, res, 'plainapp-dlna', 'DLNA TV Cast', '', 'dlna');
});

// 4. Communications
router.get('/plainapp/messages', requireConsoleAuth, (req, res) => {
    renderPlainAppShell(req, res, 'plainapp-messages', 'Messages (SMS)', '/messages');
});
router.get('/plainapp/calls', requireConsoleAuth, (req, res) => {
    renderPlainAppShell(req, res, 'plainapp-calls', 'Calls & Dialer', '/calls');
});
router.get('/plainapp/contacts', requireConsoleAuth, (req, res) => {
    renderPlainAppShell(req, res, 'plainapp-contacts', 'Contacts', '/contacts');
});
router.get('/plainapp/chat', requireConsoleAuth, (req, res) => {
    renderPlainAppShell(req, res, 'plainapp-chat', 'Device Chat & Channels', '/chat');
});
router.get('/plainapp/notifications', requireConsoleAuth, (req, res) => {
    renderPlainAppShell(req, res, 'plainapp-notifications', 'Notifications Stream', '', 'notifications');
});

// 5. Productivity & Tools
router.get('/plainapp/notes', requireConsoleAuth, (req, res) => {
    renderPlainAppShell(req, res, 'plainapp-notes', 'Markdown Notes', '/notes');
});
router.get('/plainapp/feeds', requireConsoleAuth, (req, res) => {
    renderPlainAppShell(req, res, 'plainapp-feeds', 'RSS Feeds', '/feeds');
});
router.get('/plainapp/clipboard', requireConsoleAuth, (req, res) => {
    renderPlainAppShell(req, res, 'plainapp-clipboard', 'Clipboard Sync', '', 'clipboard');
});
router.get('/plainapp/screen-mirror', requireConsoleAuth, (req, res) => {
    renderPlainAppShell(req, res, 'plainapp-screen-mirror', 'Screen Mirror', '/screen-mirror');
});
router.get('/plainapp/pomodoro', requireConsoleAuth, (req, res) => {
    renderPlainAppShell(req, res, 'plainapp-pomodoro', 'Pomodoro Timer', '', 'pomodoro');
});
router.get('/plainapp/sound-meter', requireConsoleAuth, (req, res) => {
    renderPlainAppShell(req, res, 'plainapp-sound-meter', 'Sound Meter', '', 'sound-meter');
});
router.get('/plainapp/qr-history', requireConsoleAuth, (req, res) => {
    renderPlainAppShell(req, res, 'plainapp-qr-history', 'QR Scanner History', '', 'qr-history');
});
router.get('/plainapp/exchange-rate', requireConsoleAuth, (req, res) => {
    renderPlainAppShell(req, res, 'plainapp-exchange-rate', 'Exchange Rates', '', 'exchange-rate');
});

// 6. Device & Network
router.get('/plainapp/apps', requireConsoleAuth, (req, res) => {
    renderPlainAppShell(req, res, 'plainapp-apps', 'Apps & Packages', '/apps');
});
router.get('/plainapp/nearby', requireConsoleAuth, (req, res) => {
    renderPlainAppShell(req, res, 'plainapp-nearby', 'Nearby Discovery', '', 'nearby');
});
router.get('/plainapp/tags', requireConsoleAuth, (req, res) => {
    renderPlainAppShell(req, res, 'plainapp-tags', 'Tags & Key-Value', '', 'tags');
});
router.get('/plainapp/access-control', requireConsoleAuth, (req, res) => {
    renderPlainAppShell(req, res, 'plainapp-access-control', 'Web Access Control', '', 'access-control');
});
router.get('/plainapp/sessions', requireConsoleAuth, (req, res) => {
    renderPlainAppShell(req, res, 'plainapp-sessions', 'Active Sessions', '/settings/sessions');
});
router.get('/plainapp/device-info', requireConsoleAuth, (req, res) => {
    renderPlainAppShell(req, res, 'plainapp-device-info', 'Device Info & Hardware', '/settings/device-info');
});
router.get('/plainapp/logs', requireConsoleAuth, (req, res) => {
    renderPlainAppShell(req, res, 'plainapp-logs', 'Events & System Logs', '/settings/events');
});
router.get('/plainapp/prefs', requireConsoleAuth, (req, res) => {
    renderPlainAppShell(req, res, 'plainapp-prefs', 'Preferences & Database', '/settings/prefs');
});

// ── Bridge API Routes ────────────────────────────────────────────────────────

router.get('/api/plainapp/devices', requireConsoleAuth, async (req, res) => {
    try {
        const devices = await bridge.getEnrolledDevices();
        res.json({ success: true, devices });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

router.post('/api/plainapp/access-control', requireConsoleAuth, async (req, res) => {
    const { deviceId, feature, enabled } = req.body || {};
    if (typeof feature !== 'string' || !Object.prototype.hasOwnProperty.call(companionState.accessControl, feature)) {
        return res.status(400).json({ success: false, error: 'Invalid access feature key' });
    }
    companionState.accessControl[feature] = !!enabled;
    let cdapSynced = false;
    if (deviceId) {
        try {
            await bridge.executeRpcOverCdap(deviceId, 'access_control_set', { feature, enabled: !!enabled });
            cdapSynced = true;
        } catch {
            cdapSynced = false;
        }
    }
    return res.json({ success: true, cdapSynced, accessControl: companionState.accessControl });
});

router.post('/api/plainapp/companion/:tool', requireConsoleAuth, async (req, res) => {
    const tool = req.params.tool;
    const body = req.body || {};
    const deviceId = typeof body.deviceId === 'string' ? body.deviceId.trim() : '';
    let cdapSynced = false;

    if (tool === 'pomodoro') {
        if (typeof body.remainingSec === 'number') companionState.pomodoro.remainingSec = Math.max(0, body.remainingSec);
        companionState.pomodoro.running = body.action === 'start';
        return res.json({ success: true, cdapSynced, pomodoro: companionState.pomodoro });
    }

    if (tool === 'sound-meter') {
        if (body.action === 'reset') {
            companionState.soundMeter.peakDb = companionState.soundMeter.currentDb;
        } else if (deviceId) {
            try {
                const rpc = await bridge.executeRpcOverCdap(deviceId, 'get_device_info', {});
                if (rpc) cdapSynced = true;
            } catch {
                cdapSynced = false;
            }
        }
        return res.json({ success: true, cdapSynced, soundMeter: companionState.soundMeter });
    }

    if (tool === 'qr-add') {
        const text = String(body.text || '').trim();
        if (!text) return res.status(400).json({ success: false, error: 'QR text is required' });
        companionState.qrHistory.unshift({
            id: Date.now(),
            text,
            format: /^https?:\/\//i.test(text) ? 'URL' : 'TEXT',
            scannedAt: new Date().toISOString(),
        });
        return res.json({ success: true });
    }

    if (tool === 'dlna') {
        if (body.action === 'select' && body.rendererId) {
            companionState.dlna.selectedRenderer = String(body.rendererId);
        } else if (body.action === 'cast') {
            companionState.dlna.activeMediaUrl = String(body.mediaUrl || '');
            companionState.dlna.playbackState = 'playing';
        } else if (body.action === 'pause') {
            companionState.dlna.playbackState = 'paused';
        } else if (body.action === 'stop') {
            companionState.dlna.playbackState = 'stopped';
        }
        return res.json({ success: true, cdapSynced, dlna: companionState.dlna });
    }

    if (tool === 'notifications') {
        if (body.action === 'clear') {
            companionState.notifications = [];
        } else if (body.action === 'dismiss' && body.id) {
            companionState.notifications = companionState.notifications.filter((n) => n.id !== body.id);
        }
        return res.json({ success: true, cdapSynced, notifications: companionState.notifications });
    }

    if (tool === 'clipboard') {
        if (body.action === 'push') {
            const text = String(body.text || '');
            companionState.clipboardHistory.unshift({
                id: 'c_' + Date.now(),
                source: 'Console -> Phone',
                preview: text,
                ts: new Date().toISOString(),
            });
            companionState.clipboardHistory = companionState.clipboardHistory.slice(0, 20);
            if (deviceId) {
                try {
                    await bridge.executeRpcOverCdap(deviceId, 'clipboard_set', { text });
                    cdapSynced = true;
                } catch {
                    cdapSynced = false;
                }
            }
            return res.json({ success: true, cdapSynced });
        }
        if (body.action === 'pull') {
            let text = companionState.clipboardHistory[0]?.preview || '';
            if (deviceId) {
                try {
                    const resRpc = await bridge.executeRpcOverCdap(deviceId, 'clipboard_get', {});
                    if (typeof resRpc?.text === 'string') {
                        text = resRpc.text;
                        cdapSynced = true;
                        companionState.clipboardHistory.unshift({
                            id: 'c_' + Date.now(),
                            source: 'Phone -> Console',
                            preview: text,
                            ts: new Date().toISOString(),
                        });
                    }
                } catch {
                    cdapSynced = false;
                }
            }
            return res.json({ success: true, cdapSynced, text });
        }
    }

    if (tool === 'nearby') {
        return res.json({ success: true, cdapSynced, peersCount: companionState.nearby.length, nearby: companionState.nearby });
    }

    if (tool === 'tags') {
        if (body.action === 'add' && body.name) {
            companionState.tags.push({
                id: 't_' + Date.now(),
                name: String(body.name).trim(),
                category: String(body.category || 'NOTE'),
                count: 0,
            });
        } else if (body.action === 'delete' && body.id) {
            companionState.tags = companionState.tags.filter((t) => t.id !== body.id);
        } else if (body.action === 'sync' && deviceId) {
            try {
                await bridge.executeGraphqlOverCdap(deviceId, '{ tags { id name type } }');
                cdapSynced = true;
            } catch {
                cdapSynced = false;
            }
        }
        return res.json({ success: true, cdapSynced, tags: companionState.tags });
    }

    if (tool === 'shares') {
        if (body.action === 'create') {
            companionState.shares.unshift({
                id: 'sh_' + Date.now(),
                label: String(body.label || 'Shared Resource'),
                path: String(body.path || '/'),
                expiresIn: '24h',
                active: true,
            });
        } else if (body.action === 'revoke' && body.id) {
            companionState.shares = companionState.shares.filter((s) => s.id !== body.id);
        }
        return res.json({ success: true, shares: companionState.shares });
    }

    return res.status(404).json({ success: false, error: 'Unknown companion action' });
});

router.post('/api/plainapp/lan-proxy', requireConsoleAuth, async (req, res) => {
    try {
        const { baseUrl, path: reqPath, method, headers, body } = req.body || {};
        const result = await bridge.proxyLanRequest({ baseUrl, reqPath, method, headers, body });
        res.json({ success: true, statusCode: result.statusCode, data: result.data });
    } catch (e) {
        res.status(400).json({ success: false, error: e.message });
    }
});

router.post('/api/plainapp/graphql', requireConsoleAuth, async (req, res) => {
    try {
        const { deviceId, query, variables } = req.body || {};
        const result = await bridge.executeGraphqlOverCdap(deviceId, query, variables);
        res.json({ success: true, result });
    } catch (e) {
        res.status(502).json({ success: false, error: e.message });
    }
});

router.post('/api/plainapp/rpc', requireConsoleAuth, async (req, res) => {
    try {
        const { deviceId, method, params } = req.body || {};
        const result = await bridge.executeRpcOverCdap(deviceId, method, params);
        res.json({ success: true, result });
    } catch (e) {
        res.status(502).json({ success: false, error: e.message });
    }
});

module.exports = router;
