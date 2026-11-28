import crypto from 'crypto';
import { spawn, spawnSync } from 'child_process';
import dgram from 'dgram';
import dns from 'dns/promises';
import fs from 'fs';
import http from 'http';
import https from 'https';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESK_DIR = fs.existsSync(path.join(__dirname, 'MindConnect-Desk', 'web-nodejs', 'server.js'))
  ? path.join(__dirname, 'MindConnect-Desk')
  : path.join(__dirname, 'BetterDesk');
const WEB_NODEJS_DIR = path.join(DESK_DIR, 'web-nodejs');
const SERVER_SOURCE_DIR = path.join(DESK_DIR, 'betterdesk-server');
const BIN_SERVER = fs.existsSync(path.join(__dirname, 'bin', 'mindconnect-desk-server'))
  ? path.join(__dirname, 'bin', 'mindconnect-desk-server')
  : path.join(__dirname, 'bin', 'betterdesk-server');
const RUNTIME_DIR = path.join(__dirname, 'runtime-data');
const RUSTDESK_DIR = path.join(RUNTIME_DIR, 'rustdesk');
const CONSOLE_DATA_DIR = path.join(RUNTIME_DIR, 'console');
const SECRETS_FILE = path.join(RUNTIME_DIR, '.secrets.json');
const ROOT_ENV_FILE = path.join(__dirname, '.env');

// Load optional root .env without overriding AI Studio injected Secrets
if (fs.existsSync(ROOT_ENV_FILE)) {
  try {
    for (const line of fs.readFileSync(ROOT_ENV_FILE, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq > 0) {
        const key = trimmed.slice(0, eq).trim();
        const val = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
        if (!process.env[key] && val) {
          process.env[key] = val;
        }
      }
    }
  } catch {
    // ignore optional .env read errors
  }
}

const PROXY_PORT = Number(process.env.PORT || 3000);
const CONSOLE_INTERNAL_PORT = 3001;
const GO_API_PORT = Number(process.env.GO_API_PORT || 21121);
const SIGNAL_PORT = Number(process.env.SIGNAL_PORT || 21116);
const RELAY_PORT = Number(process.env.RELAY_PORT || 21117);
const CDAP_PORT = Number(process.env.CDAP_PORT || 21122);

fs.mkdirSync(RUSTDESK_DIR, { recursive: true });
fs.mkdirSync(CONSOLE_DATA_DIR, { recursive: true });

function loadOrCreateCryptoSecrets() {
  if (fs.existsSync(SECRETS_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(SECRETS_FILE, 'utf8'));
      if (parsed.sessionSecret && parsed.panelTrustSecret && parsed.remoteTargetVaultKey) {
        return parsed;
      }
    } catch {
      // regenerate below
    }
  }
  const secrets = {
    sessionSecret: crypto.randomBytes(32).toString('hex'),
    panelTrustSecret: crypto.randomBytes(32).toString('hex'),
    remoteTargetVaultKey: crypto.randomBytes(32).toString('hex'),
  };
  fs.writeFileSync(SECRETS_FILE, JSON.stringify(secrets, null, 2), { mode: 0o600 });
  return secrets;
}

function getAppUrl() {
  const raw = String(process.env.APP_URL || '').trim();
  if (raw && raw !== 'MY_APP_URL') {
    try {
      const u = new URL(raw);
      return `${u.protocol}//${u.host}`;
    } catch {
      // fallback
    }
  }
  return `http://localhost:${PROXY_PORT}`;
}

function cleanEnvHost(val) {
  const s = String(val || '').trim();
  if (!s || s.startsWith('MY_') || s === 'Secret value') return '';
  return s;
}

function isSquarespaceParkingIp(ip) {
  return ip.startsWith('198.49.23.') || ip.startsWith('198.185.159.');
}

async function resolveUsableHost(rawHost, fallbackHost) {
  const host = cleanEnvHost(rawHost);
  if (!host) return fallbackHost;
  if (host === 'alltimesafe.com' || host.endsWith('.alltimesafe.com')) {
    try {
      const ips = await dns.resolve4(host);
      if (!ips.length || ips.every(isSquarespaceParkingIp)) {
        console.log(`[MindConnect Desk] ${host} has no live server DNS yet; using ${fallbackHost}`);
        return fallbackHost;
      }
    } catch {
      console.log(`[MindConnect Desk] ${host} does not resolve yet; using ${fallbackHost}`);
      return fallbackHost;
    }
  }
  return host;
}

const cryptoSecrets = loadOrCreateCryptoSecrets();
const appUrl = getAppUrl();
const defaultServerHost = (() => {
  try {
    const h = new URL(appUrl).hostname;
    if (h && h !== 'localhost' && h !== '127.0.0.1') return h;
  } catch {}
  return '127.0.0.1';
})();
let publicServerId = defaultServerHost;
let publicRelayServer = defaultServerHost;
let panelPublicHost = defaultServerHost;
let publicApiUrl = cleanEnvHost(process.env.PUBLIC_API_URL)
  || (appUrl.startsWith('https://') ? appUrl : `http://${defaultServerHost}:${GO_API_PORT}`);
const adminPassword = cleanEnvHost(process.env.ADMIN_PASSWORD) || 'GhostShell@4';
const enrollmentMode = cleanEnvHost(process.env.ENROLLMENT_MODE) || 'open';

let goServerProc = null;
let consoleProc = null;
let ntpSocket = null;
let ntpRefreshTimer = null;
let shuttingDown = false;

function writeNtpTimestamp(buf, offset, unixMs) {
  const NTP_EPOCH_OFFSET = 2208988800;
  const secs = Math.floor(unixMs / 1000) + NTP_EPOCH_OFFSET;
  const msRemainder = ((unixMs % 1000) + 1000) % 1000;
  const frac = Math.floor((msRemainder / 1000) * 0x100000000);
  buf.writeUInt32BE(secs >>> 0, offset);
  buf.writeUInt32BE(frac >>> 0, offset + 4);
}

function startLocalNtpBridge() {
  let clockOffsetMs = 0;

  const refreshHttpsClock = () => {
    const req = https.request('https://www.google.com/generate_204', { method: 'HEAD', timeout: 3000 }, (res) => {
      res.resume();
      const dateHdr = res.headers.date;
      if (dateHdr) {
        const remoteMs = Date.parse(dateHdr);
        if (Number.isFinite(remoteMs)) {
          const delta = remoteMs - Date.now();
          // HTTP Date has 1-second resolution; only adjust if real skew exceeds 1.5s
          clockOffsetMs = Math.abs(delta) > 1500 ? delta : 0;
        }
      }
    });
    req.on('error', () => {});
    req.on('timeout', () => req.destroy());
    req.end();
  };

  refreshHttpsClock();
  ntpRefreshTimer = setInterval(refreshHttpsClock, 10 * 60 * 1000);
  ntpRefreshTimer.unref();

  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4');
    ntpSocket = sock;

    sock.on('message', (msg, rinfo) => {
      if (!msg || msg.length < 48) return;
      const recvMs = Date.now() + clockOffsetMs;
      const resp = Buffer.alloc(48);
      resp[0] = 0x24; // LI=0, VN=4, Mode=4 (server)
      resp[1] = 2;    // Stratum 2 (HTTPS/Cloud Run synchronized)
      resp[2] = 6;    // Poll interval
      resp[3] = 0xec; // Precision (-20)
      resp.writeUInt32BE(0x00000100, 4);  // Root delay
      resp.writeUInt32BE(0x00000100, 8);  // Root dispersion
      resp.write('GOOG', 12, 'ascii');    // Reference ID
      writeNtpTimestamp(resp, 16, recvMs);
      msg.copy(resp, 24, 40, 48);         // Originate timestamp from client
      writeNtpTimestamp(resp, 32, recvMs);
      const txMs = Date.now() + clockOffsetMs;
      writeNtpTimestamp(resp, 40, txMs);
      sock.send(resp, rinfo.port, rinfo.address);
    });

    sock.on('error', (err) => {
      console.warn(`[MindConnect Desk] Local NTP bridge warning: ${err.message}`);
      resolve(false);
    });

    sock.bind(123, '127.0.0.1', () => {
      console.log('[MindConnect Desk] Local SNTP bridge listening on 127.0.0.1:123');
      resolve(true);
    });
  });
}

function waitForGoHealth(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  const apiKeyPath = path.join(RUSTDESK_DIR, '.api_key');

  return new Promise((resolve) => {
    const attempt = () => {
      if (Date.now() > deadline) {
        resolve(false);
        return;
      }
      const req = http.get(`http://127.0.0.1:${GO_API_PORT}/api/health`, (res) => {
        res.resume();
        if (res.statusCode >= 200 && res.statusCode < 400 && fs.existsSync(apiKeyPath)) {
          resolve(true);
        } else {
          setTimeout(attempt, 250);
        }
      });
      req.on('error', () => setTimeout(attempt, 250));
      req.setTimeout(1000, () => {
        req.destroy();
        setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

function ensureServerTlsCert() {
  const certFile = process.env.TLS_CERT || path.join(RUSTDESK_DIR, 'server-tls.crt');
  const keyFile = process.env.TLS_KEY || path.join(RUSTDESK_DIR, 'server-tls.key');
  if (fs.existsSync(certFile) && fs.existsSync(keyFile)) {
    return { certFile, keyFile, ready: true };
  }
  fs.mkdirSync(path.dirname(certFile), { recursive: true });
  const cn = (publicServerId || 'localhost').slice(0, 60);
  const sanEntries = [`DNS:localhost`, `IP:127.0.0.1`];
  if (net.isIP(cn)) sanEntries.push(`IP:${cn}`);
  else if (cn && cn !== 'localhost') sanEntries.push(`DNS:${cn}`);

  const gen = spawnSync(
    'openssl',
    [
      'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1',
      '-nodes', '-days', '3650',
      '-keyout', keyFile,
      '-out', certFile,
      '-subj', `/CN=${cn}/O=MindConnect Desk`,
      '-addext', `subjectAltName=${sanEntries.join(',')}`,
    ],
    { encoding: 'utf8' }
  );
  if (gen.status === 0 && fs.existsSync(certFile) && fs.existsSync(keyFile)) {
    try { fs.chmodSync(keyFile, 0o600); } catch {}
    console.log(`[MindConnect Desk] Generated Signal/Relay TLS certificate (${certFile})`);
    return { certFile, keyFile, ready: true };
  }
  console.warn(`[MindConnect Desk] Unable to generate TLS cert: ${gen.stderr || gen.error?.message || 'unknown error'}`);
  return { certFile: '', keyFile: '', ready: false };
}

function startGoServer() {
  const tls = ensureServerTlsCert();
  const env = { ...process.env };
  delete env.PORT;
  Object.assign(env, {
    SIGNAL_PORT: String(SIGNAL_PORT),
    RELAY_PORT: String(RELAY_PORT),
    GO_API_PORT: String(GO_API_PORT),
    API_PORT: String(GO_API_PORT),
    CDAP_ENABLED: cleanEnvHost(process.env.CDAP_ENABLED) || 'Y',
    CDAP_PORT: String(CDAP_PORT),
    CDAP_TLS: cleanEnvHost(process.env.CDAP_TLS) || 'N',
    CDAP_TLS_REQUIRED: cleanEnvHost(process.env.CDAP_TLS_REQUIRED) || 'N',
    SIGNAL_RATE_LIMIT_PER_IP: cleanEnvHost(process.env.SIGNAL_RATE_LIMIT_PER_IP) || '20',
    ENCRYPTED_ONLY: cleanEnvHost(process.env.ENCRYPTED_ONLY) || '1',
    DB_URL: path.join(RUSTDESK_DIR, 'db_v2.sqlite3'),
    AUTH_DB_PATH: path.join(CONSOLE_DATA_DIR, 'auth.db'),
    DATA_DIR: CONSOLE_DATA_DIR,
    CONSOLE_DATA_DIR: CONSOLE_DATA_DIR,
    RENDEZVOUS_SERVERS: publicServerId,
    RELAY_SERVERS: publicRelayServer,
    TRUST_PROXY: cleanEnvHost(process.env.TRUST_PROXY) || 'Y',
    TRUSTED_PROXIES: cleanEnvHost(process.env.TRUSTED_PROXIES) || '127.0.0.1/32,::1/128',
    PANEL_SIGNAL_PROXY_CIDRS: cleanEnvHost(process.env.PANEL_SIGNAL_PROXY_CIDRS) || '127.0.0.0/8,::1/128',
    WS_ALLOWED_ORIGINS: cleanEnvHost(process.env.WS_ALLOWED_ORIGINS) || appUrl,
    API_WS_ALLOWED_ORIGINS: cleanEnvHost(process.env.API_WS_ALLOWED_ORIGINS) || appUrl,
    SESSION_SECRET: cryptoSecrets.sessionSecret,
    PANEL_TRUST_SECRET: cryptoSecrets.panelTrustSecret,
    REMOTE_TARGET_VAULT_KEY: cryptoSecrets.remoteTargetVaultKey,
    ENROLLMENT_MODE: enrollmentMode,
    ENROLLMENT_MODE_ENV_OVERRIDE: 'N',
    ...(tls.ready ? {
      TLS_CERT: tls.certFile,
      TLS_KEY: tls.keyFile,
      TLS_SIGNAL: 'Y',
      TLS_RELAY: 'Y',
    } : {}),
    NTP_SERVERS: cleanEnvHost(process.env.NTP_SERVERS) || '127.0.0.1',
    BILLING_MAX_CLOCK_SKEW_MS: '2000',
    BILLING_REQUIRE_SYNCED_CLOCK: '1',
    BILLING_TRUST_OS_NTP: 'Y',
    INIT_ADMIN_USER: 'admin',
    INIT_ADMIN_PASS: adminPassword,
  });

  const args = [
    '-mode', 'all',
    '-port', String(SIGNAL_PORT),
    '-relay-port', String(RELAY_PORT),
    '-api-port', String(GO_API_PORT),
    '-cdap',
    '-cdap-port', String(CDAP_PORT),
    '-key-file', path.join(RUSTDESK_DIR, 'id_ed25519'),
    '-db', path.join(RUSTDESK_DIR, 'db_v2.sqlite3'),
    '-relay-servers', publicRelayServer,
    '-rendezvous-servers', publicServerId,
    '-init-admin-user', 'admin',
    '-init-admin-pass', adminPassword,
  ];

  console.log(`[MindConnect Desk] Starting ID/relay server (ID :${SIGNAL_PORT}, Relay :${RELAY_PORT}, API :${GO_API_PORT}, CDAP :${CDAP_PORT}, Enrollment: ${enrollmentMode})...`);
  goServerProc = spawn(BIN_SERVER, args, {
    cwd: RUSTDESK_DIR,
    env,
    stdio: 'inherit',
  });

  goServerProc.on('error', (err) => {
    console.error(`[MindConnect Desk] Failed to spawn ID/relay server: ${err.message}`);
  });

  goServerProc.on('exit', (code, signal) => {
    console.error(`[MindConnect Desk] ID/relay server exited (code=${code}, signal=${signal})`);
    if (!shuttingDown) {
      setTimeout(startGoServer, 2000);
    }
  });
}

function startConsoleServer() {
  const apiKeyPath = path.join(RUSTDESK_DIR, '.api_key');
  const pubKeyPath = path.join(RUSTDESK_DIR, 'id_ed25519.pub');
  const apiKey = fs.existsSync(apiKeyPath) ? fs.readFileSync(apiKeyPath, 'utf8').trim() : '';
  const pubKey = fs.existsSync(pubKeyPath) ? fs.readFileSync(pubKeyPath, 'utf8').trim() : '';

  const env = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(CONSOLE_INTERNAL_PORT),
    HOST: '127.0.0.1',
    TRUST_PROXY: '1',
    TRUSTED_PROXIES: cleanEnvHost(process.env.TRUSTED_PROXIES) || '127.0.0.1/32,::1/128',
    HTTPS_ENABLED: 'false',
    API_ENABLED: 'false',
    SERVER_BACKEND: 'betterdesk',
    HBBS_API_URL: `http://127.0.0.1:${GO_API_PORT}/api`,
    BETTERDESK_API_URL: `http://127.0.0.1:${GO_API_PORT}/api`,
    BETTERDESK_API_KEY: apiKey,
    HBBS_API_KEY: apiKey,
    GO_API_PORT: String(GO_API_PORT),
    KEYS_PATH: RUSTDESK_DIR,
    RUSTDESK_PATH: RUSTDESK_DIR,
    RUSTDESK_DIR: RUSTDESK_DIR,
    DATA_DIR: CONSOLE_DATA_DIR,
    DB_PATH: path.join(RUSTDESK_DIR, 'db_v2.sqlite3'),
    AUTH_DB_PATH: path.join(CONSOLE_DATA_DIR, 'auth.db'),
    PUB_KEY_PATH: pubKeyPath,
    API_KEY_PATH: apiKeyPath,
    PANEL_PUBLIC_HOST: panelPublicHost,
    PANEL_PUBLIC_URL: cleanEnvHost(process.env.PANEL_PUBLIC_URL) || appUrl,
    PUBLIC_SERVER_ID: publicServerId,
    PUBLIC_RELAY_SERVER: publicRelayServer,
    PUBLIC_API_URL: publicApiUrl,
    PUBLIC_SERVER_KEY: cleanEnvHost(process.env.PUBLIC_SERVER_KEY) || pubKey,
    RELAY_SERVERS: publicRelayServer,
    CDAP_ENABLED: cleanEnvHost(process.env.CDAP_ENABLED) || 'Y',
    CDAP_PORT: String(CDAP_PORT),
    CDAP_TLS: cleanEnvHost(process.env.CDAP_TLS) || 'N',
    CDAP_TLS_REQUIRED: cleanEnvHost(process.env.CDAP_TLS_REQUIRED) || 'N',
    BETTERDESK_ID_SERVER: cleanEnvHost(process.env.BETTERDESK_ID_SERVER) || publicServerId,
    BETTERDESK_ID_PORT: cleanEnvHost(process.env.BETTERDESK_ID_PORT) || (appUrl.startsWith('https://') ? '443' : String(SIGNAL_PORT)),
    BETTERDESK_RELAY_SERVER: cleanEnvHost(process.env.BETTERDESK_RELAY_SERVER) || publicRelayServer,
    BETTERDESK_RELAY_PORT: cleanEnvHost(process.env.BETTERDESK_RELAY_PORT) || (appUrl.startsWith('https://') ? '443' : String(RELAY_PORT)),
    BETTERDESK_CDAP_WS_URL: cleanEnvHost(process.env.BETTERDESK_CDAP_WS_URL) || (appUrl.startsWith('https://') ? `wss://${panelPublicHost}/cdap` : `ws://${panelPublicHost}:${CDAP_PORT}/cdap`),
    BETTERDESK_SERVER_KEY: cleanEnvHost(process.env.BETTERDESK_SERVER_KEY) || pubKey,
    ENROLLMENT_MODE: enrollmentMode,
    WS_ALLOWED_ORIGINS: cleanEnvHost(process.env.WS_ALLOWED_ORIGINS) || appUrl,
    WS_HBBS_HOST: cleanEnvHost(process.env.WS_HBBS_HOST) || '127.0.0.1',
    WS_HBBS_PORT: String(process.env.WS_HBBS_PORT || SIGNAL_PORT),
    WS_HBBR_HOST: cleanEnvHost(process.env.WS_HBBR_HOST) || '127.0.0.1',
    WS_HBBR_PORT: String(process.env.WS_HBBR_PORT || RELAY_PORT),
    SESSION_SECRET: cryptoSecrets.sessionSecret,
    PANEL_TRUST_SECRET: cryptoSecrets.panelTrustSecret,
    REMOTE_TARGET_VAULT_KEY: cryptoSecrets.remoteTargetVaultKey,
    DEFAULT_ADMIN_USERNAME: 'admin',
    DEFAULT_ADMIN_PASSWORD: adminPassword,
    BACKEND_PANEL_GROUPING: 'go',
  };

  console.log(`[MindConnect Desk] Starting MindConnect Desk console with MindConnect Desk extensions on 127.0.0.1:${CONSOLE_INTERNAL_PORT}...`);
  const hookFile = path.join(__dirname, 'console-extensions', 'plainapp-console-hook.cjs');
  const spawnArgs = fs.existsSync(hookFile) ? ['-r', hookFile, 'server.js'] : ['server.js'];
  consoleProc = spawn(process.execPath, spawnArgs, {
    cwd: WEB_NODEJS_DIR,
    env,
    stdio: 'inherit',
  });

  consoleProc.on('error', (err) => {
    console.error(`[MindConnect Desk] Failed to spawn web-nodejs: ${err.message}`);
  });

  consoleProc.on('exit', (code, signal) => {
    console.error(`[MindConnect Desk] web-nodejs exited (code=${code}, signal=${signal})`);
    if (!shuttingDown) {
      setTimeout(startConsoleServer, 2000);
    }
  });
}

function rewriteResponseHeaders(rawHeaders, isHttpsOrigin) {
  const next = { ...rawHeaders };
  delete next['x-frame-options'];
  if (typeof next['content-security-policy'] === 'string') {
    next['content-security-policy'] = next['content-security-policy']
      .replace(
        /frame-ancestors\s+'self'/gi,
        "frame-ancestors 'self' https://aistudio.google.com https://*.google.com https://*.googleusercontent.com"
      )
      .replace(/connect-src\s+'self'\s+ws:/gi, "connect-src 'self' ws: wss:");
  }
  if (isHttpsOrigin && next['set-cookie']) {
    const cookies = Array.isArray(next['set-cookie']) ? next['set-cookie'] : [next['set-cookie']];
    next['set-cookie'] = cookies.map((c) => {
      let updated = c.replace(/;\s*SameSite=(Lax|Strict)/gi, '; SameSite=None');
      if (!/;\s*SameSite=/i.test(updated)) updated += '; SameSite=None';
      if (!/;\s*Secure\b/i.test(updated)) updated += '; Secure';
      if (!/;\s*Partitioned\b/i.test(updated)) updated += '; Partitioned';
      return updated;
    });
  }
  return next;
}

function startProxy() {
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/plainapp-web')) {
      const plainDist = path.join(DESK_DIR, 'plain-web', 'dist');
      let subPath = req.url.slice('/plainapp-web'.length).split('?')[0];
      if (!subPath || subPath === '/') subPath = '/index.html';
      let filePath = path.join(plainDist, subPath);
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(plainDist, 'index.html');
      }
      if (fs.existsSync(filePath)) {
        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes = {
          '.html': 'text/html; charset=utf-8',
          '.js': 'application/javascript',
          '.css': 'text/css',
          '.svg': 'image/svg+xml',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.webp': 'image/webp',
          '.ico': 'image/x-icon',
          '.json': 'application/json',
          '.wasm': 'application/wasm',
          '.map': 'application/json',
          '.woff2': 'font/woff2',
          '.woff': 'font/woff',
          '.ttf': 'font/ttf',
        };
        const contentType = mimeTypes[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        fs.createReadStream(filePath).pipe(res);
        return;
      }
    }

    if (req.url === '/gdrive' || req.url === '/gdrive/') {
      try {
        const html = fs.readFileSync(path.join(__dirname, 'public', 'gdrive.html'), 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Error loading gdrive.html: ' + e.message);
      }
      return;
    }

    if (req.url === '/firebase-config') {
      try {
        const configRaw = fs.readFileSync(path.join(__dirname, 'firebase-applet-config.json'), 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(configRaw);
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    if (req.url === '/api/project-files') {
      try {
        const paths = ['package.json', 'metadata.json', 'firebase-applet-config.json', 'run-mindconnect-desk.mjs', 'README.md'];
        const files = [];
        for (const p of paths) {
          const full = path.join(__dirname, p);
          if (fs.existsSync(full)) {
            const stat = fs.statSync(full);
            files.push({
              path: p,
              size: stat.size,
              content: fs.readFileSync(full, 'utf8')
            });
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(files));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    const reqPathname = String(req.url || '/').split('?')[0];
    if (
      reqPathname === '/MindConnect-Desk-Suite-latest.zip' ||
      reqPathname === '/MEscrowDesk-Suite-latest.zip' ||
      reqPathname === '/api/download/project-zip' ||
      reqPathname === '/download-zip' ||
      reqPathname === '/download'
    ) {
      const candidates = [
        path.join(__dirname, 'public', 'MindConnect-Desk-Suite-latest.zip'),
        path.join(__dirname, 'public', 'MEscrowDesk-Suite-latest.zip'),
      ];
      const zipPath = candidates.find((p) => fs.existsSync(p));
      if (zipPath) {
        const stat = fs.statSync(zipPath);
        const dlName = path.basename(zipPath);
        res.writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${dlName}"`,
          'Content-Length': stat.size,
          'Cache-Control': 'no-cache',
        });
        if (req.method === 'HEAD') {
          res.end();
          return;
        }
        fs.createReadStream(zipPath).pipe(res);
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Project ZIP is being prepared, please retry shortly.');
      return;
    }

    const isGoAgentRoute =
      reqPathname === '/api/devices/register' ||
      reqPathname === '/api/devices/register/status' ||
      reqPathname.startsWith('/api/devices/self/') ||
      reqPathname === '/api/server/pubkey' ||
      reqPathname === '/api/health';

    const proxyTargetPort = isGoAgentRoute ? GO_API_PORT : CONSOLE_INTERNAL_PORT;

    const fwdProto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
    const originHdr = String(req.headers.origin || req.headers.referer || '').toLowerCase();
    const hostHdr = String(req.headers['x-forwarded-host'] || req.headers.host || '').toLowerCase();
    const isProxied = Boolean(
      req.headers['x-forwarded-for'] ||
      req.headers['x-real-ip'] ||
      req.headers['sec-fetch-site'] ||
      req.headers['sec-fetch-dest']
    );
    const isHttpsOrigin =
      fwdProto === 'https' ||
      originHdr.startsWith('https://') ||
      (appUrl.startsWith('https://') && (isProxied || (!hostHdr.startsWith('127.0.0.1') && !hostHdr.startsWith('localhost'))));

    const headers = {
      ...req.headers,
      'x-forwarded-for': req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1',
      'x-forwarded-proto': fwdProto || 'http',
      'x-forwarded-host': req.headers['x-forwarded-host'] || req.headers.host || `${panelPublicHost}:${PROXY_PORT}`,
    };

    const proxyReq = http.request(
      {
        hostname: '127.0.0.1',
        port: proxyTargetPort,
        path: req.url,
        method: req.method,
        headers,
      },
      (proxyRes) => {
        const finalHeaders = rewriteResponseHeaders(proxyRes.headers, isHttpsOrigin);
        res.writeHead(proxyRes.statusCode || 502, finalHeaders);
        proxyRes.pipe(res);
      }
    );

    proxyReq.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<html><body style="background:#0f172a;color:#e2e8f0;font-family:sans-serif;padding:2rem;"><h2>MindConnect Desk Console starting...</h2><p>Waiting for MindConnect Desk server initialization. Refresh in a moment.</p><script>setTimeout(()=>location.reload(),1500)</script></body></html>');
      }
    });

    req.pipe(proxyReq);
  });

  server.on('upgrade', (req, clientSocket, head) => {
    const reqPathname = String(req.url || '/').split('?')[0];
    const targetPort = reqPathname === '/cdap' ? CDAP_PORT : CONSOLE_INTERNAL_PORT;
    const upstreamSocket = net.connect(targetPort, '127.0.0.1', () => {
      const headerLines = [];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        headerLines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      }
      upstreamSocket.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${headerLines.join('\r\n')}\r\n\r\n`);
      if (head && head.length) upstreamSocket.write(head);
      upstreamSocket.pipe(clientSocket);
      clientSocket.pipe(upstreamSocket);
    });
    upstreamSocket.on('error', () => clientSocket.destroy());
    clientSocket.on('error', () => upstreamSocket.destroy());
  });

  server.listen(PROXY_PORT, '0.0.0.0', () => {
    console.log(`[MindConnect Desk] Live gateway listening on http://0.0.0.0:${PROXY_PORT}`);
    console.log(`[MindConnect Desk] ID=${publicServerId} | Relay=${publicRelayServer} | Panel=${panelPublicHost} | Enrollment=${enrollmentMode}`);
  });
}

function shutdown() {
  shuttingDown = true;
  if (ntpRefreshTimer) clearInterval(ntpRefreshTimer);
  try { ntpSocket?.close(); } catch {}
  consoleProc?.kill('SIGTERM');
  goServerProc?.kill('SIGTERM');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

function ensureRuntimeArtifacts() {
  const consoleEntry = path.join(WEB_NODEJS_DIR, 'server.js');
  const consolePkg = path.join(WEB_NODEJS_DIR, 'package.json');
  const consoleConfig = path.join(WEB_NODEJS_DIR, 'config', 'config.js');
  const consoleLangEn = path.join(WEB_NODEJS_DIR, 'lang', 'en.json');
  const deskGit = path.join(DESK_DIR, '.git');

  let needsRestore =
    !fs.existsSync(consoleEntry) ||
    !fs.existsSync(consolePkg) ||
    !fs.existsSync(consoleConfig) ||
    !fs.existsSync(consoleLangEn);

  if (!needsRestore && fs.existsSync(deskGit)) {
    const deletedCheck = spawnSync('git', ['-C', DESK_DIR, 'ls-files', '--deleted'], {
      encoding: 'utf8',
    });
    if (deletedCheck.status === 0 && deletedCheck.stdout.trim().length > 0) {
      needsRestore = true;
    }
  }

  if (needsRestore && fs.existsSync(deskGit)) {
    console.log('[MindConnect Desk] Restoring missing tracked files in desktop checkout...');
    const checkout = spawnSync('git', ['-C', DESK_DIR, 'checkout', '--', '.'], {
      cwd: __dirname,
      stdio: 'inherit',
    });
    if (checkout.status !== 0) {
      console.warn('[MindConnect Desk] git checkout restore failed.');
    }
  }

  if (!fs.existsSync(consoleEntry) || !fs.existsSync(consolePkg)) {
    throw new Error(`Console runtime files not found at ${WEB_NODEJS_DIR}`);
  }

  if (!fs.existsSync(BIN_SERVER)) {
    if (!fs.existsSync(path.join(SERVER_SOURCE_DIR, 'go.mod'))) {
      throw new Error(`MindConnect Desk server source not found at ${SERVER_SOURCE_DIR}`);
    }
    const binDir = path.dirname(BIN_SERVER);
    fs.mkdirSync(binDir, { recursive: true });

    let goBin = 'go';
    const goCandidates = [
      '/usr/local/go/bin/go',
      '/tmp/go/bin/go',
      path.join(__dirname, '.local', 'go', 'bin', 'go'),
    ];
    const hasPathGo = spawnSync('go', ['version'], { stdio: 'ignore' }).status === 0;
    if (!hasPathGo) {
      const existingGo = goCandidates.find((p) => fs.existsSync(p));
      if (existingGo) {
        goBin = existingGo;
      } else {
        console.log('[MindConnect Desk] Go compiler not found; downloading Go 1.26.11 toolchain to /tmp/go...');
        const dl = spawnSync(
          'sh',
          [
            '-c',
            'curl -fsSL https://go.dev/dl/go1.26.11.linux-amd64.tar.gz -o /tmp/go.tar.gz && rm -rf /tmp/go && tar -C /tmp -xzf /tmp/go.tar.gz && rm -f /tmp/go.tar.gz',
          ],
          { stdio: 'inherit' }
        );
        if (dl.status === 0 && fs.existsSync('/tmp/go/bin/go')) {
          goBin = '/tmp/go/bin/go';
        }
      }
    }

    console.log(`[MindConnect Desk] Building the ID/relay server from local source using ${goBin}...`);
    const goEnv = { ...process.env, PATH: `${path.dirname(goBin)}:${process.env.PATH || ''}` };
    const build = spawnSync(goBin, ['build', '-o', BIN_SERVER, '.'], {
      cwd: SERVER_SOURCE_DIR,
      env: goEnv,
      stdio: 'inherit',
    });
    if (build.status !== 0 || !fs.existsSync(BIN_SERVER)) {
      throw new Error(`Failed to build ID/relay server (exit ${build.status ?? 'unknown'})`);
    }
    fs.chmodSync(BIN_SERVER, 0o755);
  }

  const expressDir = path.join(WEB_NODEJS_DIR, 'node_modules', 'express');
  if (!fs.existsSync(expressDir)) {
    console.log('[MindConnect Desk] Missing web-nodejs/node_modules; running npm ci --omit=dev...');
    const res = spawnSync(
      'npm',
      ['--prefix', WEB_NODEJS_DIR, 'ci', '--omit=dev', '--no-audit', '--no-fund'],
      { cwd: WEB_NODEJS_DIR, stdio: 'inherit' }
    );
    if (res.status !== 0) {
      throw new Error(`npm ci failed in web-nodejs (exit ${res.status})`);
    }
  }

  const plainWebDir = path.join(DESK_DIR, 'plain-web');
  const plainWebDist = path.join(plainWebDir, 'dist', 'index.html');
  if (fs.existsSync(path.join(plainWebDir, 'package.json')) && !fs.existsSync(plainWebDist)) {
    if (!fs.existsSync(path.join(plainWebDir, 'node_modules', 'vite'))) {
      console.log('[MindConnect Desk] Missing plain-web/node_modules; installing...');
      spawnSync('npm', ['--prefix', plainWebDir, 'install', '--no-audit', '--no-fund'], {
        cwd: plainWebDir,
        stdio: 'inherit',
      });
    }
    console.log('[MindConnect Desk] Building plain-web SPA bundle...');
    const bld = spawnSync('npm', ['--prefix', plainWebDir, 'run', 'build'], {
      cwd: plainWebDir,
      stdio: 'inherit',
    });
    if (bld.status !== 0) {
      console.warn(`[MindConnect Desk] plain-web build exited with code ${bld.status}`);
    }
  }
}

async function main() {
  publicServerId = await resolveUsableHost(
    process.env.PUBLIC_SERVER_ID || process.env.PANEL_PUBLIC_HOST || defaultServerHost,
    defaultServerHost
  );
  publicRelayServer = await resolveUsableHost(
    process.env.PUBLIC_RELAY_SERVER || defaultServerHost,
    publicServerId
  );
  panelPublicHost = await resolveUsableHost(process.env.PANEL_PUBLIC_HOST || publicServerId, publicServerId);
  if (!cleanEnvHost(process.env.PUBLIC_API_URL)) {
    publicApiUrl = appUrl.startsWith('https://')
      ? appUrl
      : `http://${publicServerId}:${GO_API_PORT}`;
  }

  startProxy();
  ensureRuntimeArtifacts();
  await startLocalNtpBridge();
  startGoServer();
  const ready = await waitForGoHealth(15000);
  if (!ready) {
    console.warn('[MindConnect Desk] ID/relay server health timeout reached; starting console anyway.');
  }
  startConsoleServer();
}

main().catch((err) => {
  console.error(`[MindConnect Desk] Fatal startup error: ${err?.stack || err}`);
  process.exit(1);
});
