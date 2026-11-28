# MindConnect Desk & MEscrowDesk Unified Suite — Merge & Repair Plan

Unifies the newer GitHub **MindConnect Desk** codebase with the local workspace's runnable server infrastructure, build fixes, and downloadable ZIP archive delivery, correcting every broken runtime and CI build step across the web console, Android agent APK, and live hosting proxy.

---

## User Review & Critical Decisions

> [!IMPORTANT] This plan merges both codebases automatically as requested (`"merge both and correct everything broken"`). Review the unified choices below and click **Proceed** to execute.

- **Unified Branding & Runtime Compatibility**: Adopt the newer **MindConnect Desk** UI, control panel, and Android/CI branding from GitHub while keeping automatic runtime fallback to the local desktop/relay binaries so the live server boots without manual renaming or modifying upstream core server files.
- **Android Rust / ONNX Build Fix**: Disable the `ai-image-search` Cargo feature and supply a safe shared-library stub fallback when upstream ONNX Runtime source cloning returns 404, unblocking the Android APK build on GitHub Actions.
- **Clean Server Host & ZIP Download Delivery**: Preserve dynamic preview hostname fallback when running locally alongside explicit `104.207.90.103` WAN ID/Relay configuration for the Android agent, and serve a freshly packaged full-repository `.zip` archive from a dedicated pre-proxy endpoint.

---

## 1. Overview & Core Concept

- **What It Does**: Merges two diverged versions of the full-stack remote device management suite—combining GitHub's complete Kotlin Multiplatform UI, complete Vue web panel sources, MindConnect Desk rebranding, and explicit API/CDAP URL CI flags with the local workspace's live Go ID/Relay + Node.js console runtime, ONNX/Gradle/NDK build repairs, and direct full-repo `.zip` download endpoint.
- **Target Audience / Persona**: Operators and administrators managing enrolled Android devices over LAN and WAN infrastructure from a single unified web control console, plus developers downloading the complete ready-to-build repository bundle or CI-built Android APK.
- **Key Value**: Eliminates split-brain divergence between local hosting and GitHub, restores 100% passing GitHub Actions APK builds, keeps the live web console running immediately on port 3000, and exposes an up-to-date downloadable ZIP of the entire unified suite.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Web Console & Control Hub**: Operator logs into the hosted console on port 3000, navigates the injected MindConnect Desk Control sidebar (34+ companion views, media/file/device tools, and 14 access-control toggles), and interacts with the embedded Vue web control surface connected over the CDAP tunnel.
  2. **Android Agent Enrollment & WAN Relay**: Android APK boots foreground ID/Relay/CDAP connectivity targeting `104.207.90.103` (ID `:21116`, Relay `:21117`, API `:21121`, CDAP WebSocket `:21122`) so devices remain reachable outside local Wi-Fi.
  3. **Complete Repository ZIP Download**: User visits the download route on the hosted server to stream a freshly generated, clean `.zip` archive of the merged codebase (excluding heavy build caches and `.git` history while preserving prebuilt web assets).
  4. **Automated APK Release**: Pushing the merged code to GitHub triggers the CI workflow, compiling Rust native libs + Kotlin Multiplatform + Android debug APK and uploading the downloadable artifact.
- **Visual Identity & Theme**:
  - *Aesthetic Direction*: Industrial dark-mode systems operations console (`#0F172A` slate surfaces, crisp emerald `#10B981` status accents, high-contrast tabular readouts) paired with Material-3 adaptive surfaces in the embedded web panel and Android companion app.
  - *Typography & Hierarchy*: Clean sans-serif UI labels (`--font-sans`), monospaced host/port/device IDs, and clear collapsible sidebar section headers.
  - *Component Styling & Layout*: CSP-safe server-rendered HTML/CSS cards, nonce-authorized client handlers (no inline event attributes), and responsive grid layouts for toggles, metrics, and companion controls.
- **Interactive Feedback & Motion**: Automatic console startup recovery screen if the internal Node process is still warming up, clear `Content-Disposition` attachment headers on archive downloads, and live build/status verification on GitHub Actions.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Runtime Directory & Binary Fallback Resolution**
  - *Chosen Approach*: Configure the server bootstrapper to probe both the MindConnect Desk directory/binary names and the existing local server directory/binary names at startup, falling back gracefully without touching upstream server source files.
  - *Why*: GitHub's merged runner script points to renamed directories/binaries that are `.gitignore`d and absent on disk; fallback resolution fixes server crashes immediately while keeping upstream core server files completely clean.
  - *Alternatives Considered*: Renaming or duplicating the binary directories manually on disk (would pollute workspace state and break on future upstream syncs).
- **Decision 2: Disabling `ai-image-search` + Safe Native Library Stub in Rust Build**
  - *Chosen Approach*: Remove `ai-image-search` from the Android Rust crate's enabled feature flags and generate a minimal compiled shared-library stub only if the ONNX Runtime artifact is absent, paired with explicit API-28 NDK Clang resolution and `ui-check` module inclusion.
  - *Why*: Upstream ONNX Runtime source cloning (`v1.30.0`) fails with HTTP 404 / Git exit code 128 on GitHub Actions runners; removing the optional AI image search feature restores reliable compilation of core remote control, BLE, media, and preference storage without altering runtime transport.
  - *Alternatives Considered*: Building full ONNX Runtime from an unofficial mirror (high maintenance risk, 30+ minute CI compile times, and fragile hash checks).
- **Decision 3: Unified Pre-Proxy Download Route & Clean Archive Packaging**
  - *Chosen Approach*: Intercept clean download paths (handling query strings and `HEAD`/`GET` requests) in the root HTTP proxy prior to forwarding to the internal console, rebuild the `.zip` archive after the full code merge + Vue frontend build, and restart the dev server so port 3000 serves the new route immediately.
  - *Why*: Unrestarted servers or missing `HEAD`/pathname normalization return 404 from the downstream console router; handling it cleanly at the edge guarantees zero-auth frictionless download.
  - *Alternatives Considered*: Routing downloads through the downstream Express extension (would block unauthenticated curl/browser downloads behind console login).

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

- **Architecture & Component Diagram**:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Unified Root Host & HTTP Proxy (:3000)               │
│  ┌──────────────────────┐  ┌─────────────────────┐  ┌────────────────┐  │
│  │ Static Control Panel │  │ Pre-Proxy ZIP Route │  │ Auto-TLS & Go  │  │
│  │ (Merged Vue Dist)    │  │ Streams Clean Suite │  │ ID/Relay Boot  │  │
│  └──────────┬───────────┘  └─────────────────────┘  └───────┬────────┘  │
│             │                                               │           │
│             ▼                                               ▼           │
│  ┌────────────────────────────────────┐        ┌─────────────────────┐  │
│  │ Internal Console + Hook Extensions │◄──────►│ ID (:21116)         │  │
│  │ (34+ Views, 14 ACL Toggles, CDAP)  │        │ Relay (:21117)      │  │
│  └────────────────────────────────────┘        │ API/CDAP (:21121-22)│  │
└────────────────────────────────────────────────┴────────────▲────────┴──┘
                                                              │ WAN/CDAP
                                                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│               GitHub Actions CI & Android Agent APK (arm64-v8a)         │
│  ┌──────────────────────┐  ┌─────────────────────┐  ┌────────────────┐  │
│  │ Complete Kotlin UI   │  │ Rust Native Core    │  │ WAN ID/Relay   │  │
│  │ & Multiplatform Code │─►│ (ONNX Stub/No-AI)   │─►│ 104.207.90.103 │  │
│  └──────────────────────┘  └─────────────────────┘  └────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

- **Data Model & State**:
  - Runtime cryptographic secrets, console sessions, companion state (Pomodoro, sound meter, QR history, FX rates, DLNA renderers, notifications, clipboard, nearby devices, tags, downloads, shares, favorites, and 14 access-control toggles) persist inside the runtime data directory and console extension store.
  - Device enrollment state connects Android agent IDs and Ed25519 server public keys across the Go ID/Relay/CDAP bridge and Express control routes.
- **Interactive Component & State Mapping**:
  - **Root Proxy Router**: Normalizes request pathnames cleanly, handles `GET`/`HEAD` requests for `/download` and suite archive URLs with accurate `Content-Length` headers, serves rebuilt static assets for the embedded control panel, and proxies remaining console traffic with forwarded origin/TLS headers.
  - **Console Extension Loader**: Registers sidebar navigation, MindConnect Desk branding, permission hooks, and interactive CSP-compliant companion routes.
  - **Android Native & CI Pipeline**: Compiles complete Kotlin Multiplatform modules, runs `ui-check` policy/collection checks, compiles `aarch64-linux-android` Rust library without the broken ONNX clone step, injects `104.207.90.103` server endpoints and Ed25519 key via Gradle properties, packages `arm64-v8a` debug APK, and uploads the verified CI artifact.
- **Key Sequences & Verification**:
  1. Synchronize complete source modules from GitHub `main` (`plain-web` full views, `plain-app` complete Kotlin UI + `tests`, MindConnect Desk extensions, and updated CI workflows) into the workspace while preserving local runtime directories (`BetterDesk/`, `bin/`).
  2. Apply the repaired Rust Cargo configuration, Gradle ONNX/Clang fallback, `ui-check` module, fallback binary/folder resolution in the Node launcher, host fallback logic, and `HEAD`/`GET` ZIP download routing.
  3. Rebuild the Vue web bundle so static distribution assets reflect the merged views, run syntax/lint validation, generate the complete suite `.zip` archive, and restart the live server on port 3000 to verify live HTTP responses (`200 OK` on console and `200 OK` on `.zip` download).
  4. Commit and push the merged, repaired repository to GitHub `main` (without leaking any credentials in tracked files) and monitor the triggered GitHub Actions run until the Android APK build succeeds and uploads its artifact.
