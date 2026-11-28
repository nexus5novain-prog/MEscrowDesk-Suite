'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const WebSocket = require('ws');

const GO_API_PORT = Number(process.env.GO_API_PORT || 21121);
const CDAP_PORT = Number(process.env.CDAP_PORT || 21122);

function getApiKey() {
    if (process.env.BETTERDESK_API_KEY) {
        return String(process.env.BETTERDESK_API_KEY).trim();
    }
    try {
        const rootDir = path.resolve(__dirname, '..');
        const candidates = [
            path.join(rootDir, 'runtime-data', 'rustdesk', '.api_key'),
            process.env.API_KEY_PATH || '',
        ].filter(Boolean);
        for (const p of candidates) {
            if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8').trim();
        }
    } catch {
        // ignore
    }
    return '';
}

function goApiRequest(apiPath, method = 'GET', bodyObj = null, timeoutMs = 4000) {
    return new Promise((resolve, reject) => {
        const apiKey = getApiKey();
        const headers = { 'Accept': 'application/json' };
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

        let bodyStr = '';
        if (bodyObj !== null && bodyObj !== undefined) {
            bodyStr = JSON.stringify(bodyObj);
            headers['Content-Type'] = 'application/json';
            headers['Content-Length'] = Buffer.byteLength(bodyStr);
        }

        const req = http.request(
            {
                hostname: '127.0.0.1',
                port: GO_API_PORT,
                path: apiPath,
                method,
                headers,
                timeout: timeoutMs,
            },
            (res) => {
                let raw = '';
                res.on('data', (c) => { raw += c; });
                res.on('end', () => {
                    let parsed = null;
                    try { parsed = raw ? JSON.parse(raw) : {}; } catch { parsed = { raw }; }
                    resolve({ statusCode: res.statusCode || 500, data: parsed });
                });
            }
        );

        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error(`Go API timeout on ${apiPath}`));
        });
        if (bodyStr) req.write(bodyStr);
        req.end();
    });
}

async function getEnrolledDevices() {
    const [cdapRes, peerRes] = await Promise.all([
        goApiRequest('/api/cdap/devices').catch(() => ({ statusCode: 500, data: {} })),
        goApiRequest('/api/devices').catch(() => ({ statusCode: 500, data: {} })),
    ]);

    const cdapList = Array.isArray(cdapRes.data?.devices) ? cdapRes.data.devices : [];
    const peerRaw = peerRes.data;
    const peerList = Array.isArray(peerRaw) ? peerRaw : (peerRaw?.data || peerRaw?.devices || []);

    const byId = new Map();

    for (const d of cdapList) {
        const id = d.id || d.device_id || d.uuid || '';
        if (!id) continue;
        byId.set(id, {
            id,
            device_id: id,
            name: d.name || d.manifest?.device?.name || d.hostname || id,
            platform: d.platform || 'android',
            online: d.online !== false,
            cdapOnline: true,
            capabilities: d.manifest?.capabilities || [],
            widgets: d.manifest?.widgets || [],
            last_seen: d.last_heartbeat || d.connected_at || null,
            source: 'cdap',
        });
    }

    for (const p of peerList) {
        const id = p.id || p.device_id || p.uuid || '';
        if (!id) continue;
        const existing = byId.get(id);
        if (existing) {
            existing.hostname = p.hostname || existing.name;
            existing.ip = p.ip || p.last_ip || '';
            existing.enrolled = true;
        } else {
            byId.set(id, {
                id,
                device_id: id,
                name: p.hostname || p.alias || p.name || id,
                platform: p.platform || 'unknown',
                online: !!p.online,
                cdapOnline: false,
                ip: p.ip || p.last_ip || '',
                enrolled: true,
                source: 'peers',
            });
        }
    }

    return Array.from(byId.values());
}

function executeCdapWidgetCommand(deviceId, widgetId, action, value, timeoutMs = 10000) {
    if (!deviceId || !/^[A-Za-z0-9._:-]{1,64}$/.test(String(deviceId))) {
        return Promise.reject(new Error('Valid enrolled CDAP deviceId is required'));
    }

    return new Promise((resolve, reject) => {
        const apiKey = getApiKey();
        const wsHeaders = apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {};
        const ws = new WebSocket(
            `ws://127.0.0.1:${GO_API_PORT}/api/ws/events?filter=cdap_command_response`,
            { headers: wsHeaders }
        );

        let settled = false;
        let expectedCommandId = null;
        const bufferedEvents = [];

        const finish = (err, res) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try { ws.close(); } catch { /* ignore */ }
            if (err) reject(err);
            else resolve(res);
        };

        const timer = setTimeout(() => {
            finish(new Error('CDAP command timed out waiting for device response (10s)'));
        }, timeoutMs);

        const processEvent = (evt) => {
            const data = evt?.data;
            if (!data || !expectedCommandId || data.command_id !== expectedCommandId) return false;
            try {
                const payload = data.result ? JSON.parse(data.result) : {};
                if (payload.status && payload.status !== 'ok') {
                    finish(new Error(payload.error_message || `CDAP command status: ${payload.status}`));
                    return true;
                }
                finish(null, payload.result !== undefined ? payload.result : payload);
                return true;
            } catch (e) {
                finish(new Error('Failed to parse CDAP response payload'));
                return true;
            }
        };

        ws.on('message', (raw) => {
            try {
                const evt = JSON.parse(raw.toString());
                if (expectedCommandId) {
                    processEvent(evt);
                } else {
                    bufferedEvents.push(evt);
                }
            } catch {
                // ignore malformed event
            }
        });

        ws.on('error', (err) => {
            finish(new Error(`Go event stream error: ${err.message}`));
        });

        ws.on('open', async () => {
            try {
                const resp = await goApiRequest(
                    `/api/cdap/devices/${encodeURIComponent(deviceId)}/command`,
                    'POST',
                    { widget_id: widgetId, action, value, reason: 'plainapp-console' },
                    timeoutMs
                );
                if (resp.statusCode < 200 || resp.statusCode >= 300) {
                    const errMsg = resp.data?.error || `CDAP HTTP ${resp.statusCode}`;
                    finish(new Error(errMsg));
                    return;
                }
                expectedCommandId = resp.data?.command_id || null;
                if (!expectedCommandId) {
                    finish(null, resp.data);
                    return;
                }
                for (const evt of bufferedEvents) {
                    if (processEvent(evt)) return;
                }
            } catch (err) {
                finish(err);
            }
        });
    });
}

function executeGraphqlOverCdap(deviceId, query, variables = {}) {
    return executeCdapWidgetCommand(deviceId, 'plainapp_graphql', 'query', { query, variables });
}

function executeRpcOverCdap(deviceId, method, params = {}) {
    return executeCdapWidgetCommand(deviceId, 'plainapp_rpc', 'execute', { method, params });
}

function isSafeLanHost(host) {
    if (!host || typeof host !== 'string') return false;
    const trimmed = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
    if (trimmed.startsWith('169.254.') || trimmed === 'metadata.google.internal' || trimmed === '0.0.0.0') {
        return false;
    }
    return /^(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}|localhost|127\.0\.0\.1)$/.test(trimmed);
}

function proxyLanRequest({ baseUrl, reqPath = '/graphql', method = 'POST', headers = {}, body = null, timeoutMs = 6000 }) {
    return new Promise((resolve, reject) => {
        let parsed;
        try {
            const candidate = /^https?:\/\//i.test(String(baseUrl || '')) ? String(baseUrl) : `http://${baseUrl}`;
            parsed = new URL(candidate);
        } catch {
            return reject(new Error('Invalid LAN endpoint URL'));
        }

        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return reject(new Error('Only http and https protocols are allowed'));
        }

        if (!isSafeLanHost(parsed.hostname)) {
            return reject(new Error('LAN proxy only permits private RFC1918 LAN IPv4 addresses or localhost'));
        }

        const safePath = String(reqPath || '/').startsWith('/') ? String(reqPath || '/') : `/${reqPath}`;
        const upperMethod = ['GET', 'POST', 'HEAD'].includes(String(method || 'POST').toUpperCase())
            ? String(method || 'POST').toUpperCase()
            : 'POST';

        const transport = parsed.protocol === 'https:' ? https : http;
        const port = parsed.port ? Number(parsed.port) : (parsed.protocol === 'https:' ? 443 : 80);
        const payload = body == null ? null : (typeof body === 'string' ? body : JSON.stringify(body));

        const outHeaders = { 'Accept': 'application/json' };
        if (headers && typeof headers === 'object') {
            for (const [k, v] of Object.entries(headers)) {
                if (/^[A-Za-z0-9-]+$/.test(k) && typeof v === 'string') {
                    outHeaders[k] = v;
                }
            }
        }
        if (payload !== null && !outHeaders['Content-Type']) {
            outHeaders['Content-Type'] = 'application/json';
            outHeaders['Content-Length'] = String(Buffer.byteLength(payload));
        }

        const req = transport.request(
            {
                hostname: parsed.hostname,
                port,
                path: safePath,
                method: upperMethod,
                headers: outHeaders,
                timeout: timeoutMs,
                rejectUnauthorized: false,
            },
            (res) => {
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => {
                    const text = Buffer.concat(chunks).toString('utf8');
                    let json = null;
                    try { json = JSON.parse(text); } catch { /* plain text */ }
                    resolve({
                        statusCode: res.statusCode || 200,
                        data: json !== null ? json : text,
                    });
                });
            }
        );

        req.on('error', (err) => reject(new Error(`LAN connection failed: ${err.message}`)));
        req.on('timeout', () => {
            req.destroy();
            reject(new Error(`LAN connection timeout (${timeoutMs}ms)`));
        });

        if (payload !== null && upperMethod !== 'GET' && upperMethod !== 'HEAD') {
            req.write(payload);
        }
        req.end();
    });
}

module.exports = {
    CDAP_PORT,
    getEnrolledDevices,
    executeGraphqlOverCdap,
    executeRpcOverCdap,
    isSafeLanHost,
    proxyLanRequest,
};
