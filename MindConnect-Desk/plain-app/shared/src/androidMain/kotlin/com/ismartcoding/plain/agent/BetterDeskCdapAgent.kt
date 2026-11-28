package com.ismartcoding.plain.agent

import android.app.ActivityManager
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.BatteryManager
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.HandlerThread
import android.os.StatFs
import android.util.Base64
import com.google.crypto.tink.subtle.Ed25519Sign
import com.ismartcoding.plain.MainActivity
import com.ismartcoding.plain.rust.native.RustNativeBindings
import com.ismartcoding.plain.activityManager
import com.ismartcoding.plain.batteryManager
import com.ismartcoding.plain.clipboardManager
import com.ismartcoding.plain.features.screenmirror.ScreenMirrorControlAction
import com.ismartcoding.plain.features.screenmirror.ScreenMirrorControlInput
import com.ismartcoding.plain.lib.logcat.LogCat
import com.ismartcoding.plain.platform.isUPlus
import com.ismartcoding.plain.services.PlainAccessibilityService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.floatOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString.Companion.toByteString
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.charset.StandardCharsets
import java.security.SecureRandom
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.UUID
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Native MEscrowDesk CDAP Android Agent.
 * Auto-enrolls via POST /api/devices/register with Ed25519 identity proof,
 * maintains a persistent cdap-v1 WebSocket session to the configured MindConnect Desk
 * server, and bridges telemetry, clipboard, files, screen capture, and touch.
 */
object BetterDeskCdapAgent {
    private const val TAG = "MEscrowDeskAgent"
    private const val PREFS_NAME = "betterdesk_agent_identity"
    private const val KEY_DEVICE_ID = "device_id"
    private const val KEY_UUID = "device_uuid"
    private const val KEY_PRIV_B64 = "ed25519_priv_b64"
    private const val KEY_PUB_B64 = "ed25519_pub_b64"
    private const val KEY_DEVICE_TOKEN = "device_token"
    private const val KEY_SERVER_FINGERPRINT = "enrolled_server_fingerprint"
    private const val FRAME_HEADER_SIZE = 64

    private val json = Json { ignoreUnknownKeys = true }
    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val started = AtomicBoolean(false)

    private val _uiState = MutableStateFlow(AgentUiState(supported = true))
    val uiState: StateFlow<AgentUiState> = _uiState.asStateFlow()

    private val httpClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .pingInterval(25, TimeUnit.SECONDS)
            .build()
    }

    private data class AgentIdentity(
        val deviceId: String,
        val uuid: String,
        val privateKey: ByteArray,
        val publicKeyB64: String,
    )

    @Volatile
    private var appContextRef: Context? = null

    @Volatile
    private var activeWebSocket: WebSocket? = null

    @Volatile
    private var heartbeatJob: Job? = null

    @Volatile
    private var mainLoopJob: Job? = null

    @Volatile
    private var activeDesktopSessionId: String? = null

    @Volatile
    private var desktopCaptureJob: Job? = null

    @Volatile
    private var mediaProjectionRef: MediaProjection? = null

    @Volatile
    private var projectionFromAgentService: Boolean = false

    private var captureVirtualDisplay: VirtualDisplay? = null
    private var captureImageReader: ImageReader? = null
    private var captureThread: HandlerThread? = null

    fun start(context: Context) {
        val appCtx = context.applicationContext
        appContextRef = appCtx
        val identity = loadOrCreateIdentity(appCtx)
        _uiState.update {
            it.copy(
                supported = true,
                deviceId = identity.deviceId,
                serverEndpoint = BetterDeskAgentConfig.idServer,
                accessibilityEnabled = PlainAccessibilityService.isEnabled(appCtx),
                projectionActive = mediaProjectionRef != null,
            )
        }
        if (!started.compareAndSet(false, true)) return
        registerNetworkCallback(appCtx)

        mainLoopJob = scope.launch {
            var backoffMs = 2_000L
            while (isActive) {
                try {
                    val ctx = appContextRef ?: break
                    val currentIdentity = loadOrCreateIdentity(ctx)
                    val token = ensureEnrolled(ctx, currentIdentity)
                    if (token.isNullOrBlank()) {
                        delay(backoffMs)
                        backoffMs = (backoffMs * 2).coerceAtMost(30_000L)
                        continue
                    }
                    backoffMs = 2_000L
                    connectCdapSession(ctx, currentIdentity, token)
                } catch (t: Throwable) {
                    LogCat.e("$TAG: agent loop error: ${t.message}")
                    _uiState.update {
                        it.copy(
                            connectionState = AgentConnectionState.ERROR,
                            statusMessage = t.message ?: "Connection error",
                        )
                    }
                }
                delay(backoffMs)
                backoffMs = (backoffMs * 2).coerceAtMost(60_000L)
            }
        }
    }

    fun stop() {
        started.set(false)
        stopDesktopSession()
        heartbeatJob?.cancel()
        heartbeatJob = null
        mainLoopJob?.cancel()
        mainLoopJob = null
        activeWebSocket?.close(1000, "agent stopped")
        activeWebSocket = null
        _uiState.update {
            it.copy(
                connectionState = AgentConnectionState.DISCONNECTED,
                statusMessage = "Stopped",
            )
        }
    }

    fun reconnectNow(context: Context) {
        appContextRef = context.applicationContext
        stop()
        start(context)
    }

    @Volatile
    private var networkCallbackRegistered = false

    private fun registerNetworkCallback(context: Context) {
        if (networkCallbackRegistered) return
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return
        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()
        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                val state = _uiState.value.connectionState
                if (started.get() && (state == AgentConnectionState.ERROR || state == AgentConnectionState.DISCONNECTED)) {
                    val ctx = appContextRef ?: return
                    scope.launch {
                        delay(500L)
                        if (started.get() && activeWebSocket == null) {
                            reconnectNow(ctx)
                        }
                    }
                }
            }
        }
        runCatching {
            cm.registerNetworkCallback(request, cb)
            networkCallbackRegistered = true
        }
    }

    fun refreshPermissions(context: Context) {
        val appCtx = context.applicationContext
        appContextRef = appCtx
        val identity = loadOrCreateIdentity(appCtx)
        _uiState.update {
            it.copy(
                supported = true,
                deviceId = identity.deviceId,
                serverEndpoint = BetterDeskAgentConfig.idServer,
                accessibilityEnabled = PlainAccessibilityService.isEnabled(appCtx),
                projectionActive = mediaProjectionRef != null,
            )
        }
    }

    /**
     * Attaches a MediaProjection for live JPEG frame streaming over CDAP
     * without requiring the stock RustDesk app.
     */
    fun attachMediaProjection(projection: MediaProjection?, fromAgentService: Boolean = false) {
        if (projection == null && !fromAgentService && projectionFromAgentService) {
            return
        }
        mediaProjectionRef = projection
        projectionFromAgentService = projection != null && fromAgentService
        if (projection == null) {
            stopDesktopSession()
        }
        _uiState.update {
            it.copy(projectionActive = projection != null)
        }
    }

    fun getDeviceId(context: Context): String = loadOrCreateIdentity(context).deviceId

    private fun loadOrCreateIdentity(context: Context): AgentIdentity {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        var deviceId = prefs.getString(KEY_DEVICE_ID, null)
        var uuid = prefs.getString(KEY_UUID, null)
        var privB64 = prefs.getString(KEY_PRIV_B64, null)
        var pubB64 = prefs.getString(KEY_PUB_B64, null)

        if (deviceId.isNullOrBlank() || uuid.isNullOrBlank() || privB64.isNullOrBlank() || pubB64.isNullOrBlank()) {
            val suffix = ByteArray(4).also { SecureRandom().nextBytes(it) }
                .joinToString("") { "%02X".format(it) }
            deviceId = "MESCROW-$suffix"
            uuid = UUID.randomUUID().toString()
            val kp = Ed25519Sign.KeyPair.newKeyPair()
            privB64 = Base64.encodeToString(kp.privateKey, Base64.NO_WRAP)
            pubB64 = Base64.encodeToString(kp.publicKey, Base64.NO_WRAP)
            prefs.edit()
                .putString(KEY_DEVICE_ID, deviceId)
                .putString(KEY_UUID, uuid)
                .putString(KEY_PRIV_B64, privB64)
                .putString(KEY_PUB_B64, pubB64)
                .apply()
        }

        return AgentIdentity(
            deviceId = deviceId,
            uuid = uuid,
            privateKey = Base64.decode(privB64, Base64.NO_WRAP),
            publicKeyB64 = pubB64,
        )
    }

    private fun ensureEnrolled(context: Context, identity: AgentIdentity): String? {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val serverFingerprint = "${BetterDeskAgentConfig.apiUrl}|${BetterDeskAgentConfig.serverPublicKey}"
        val savedFingerprint = prefs.getString(KEY_SERVER_FINGERPRINT, null)
        if (savedFingerprint != null && savedFingerprint != serverFingerprint) {
            prefs.edit().remove(KEY_DEVICE_TOKEN).apply()
        }
        val cachedToken = prefs.getString(KEY_DEVICE_TOKEN, null)
        if (!cachedToken.isNullOrBlank() && savedFingerprint == serverFingerprint) return cachedToken

        val path = "/api/devices/register"
        val url = "${BetterDeskAgentConfig.apiUrl}$path"
        val timestamp = DateTimeFormatter.ISO_INSTANT.format(Instant.now().atOffset(ZoneOffset.UTC))
        val nonce = UUID.randomUUID().toString()
        val payloadToSign = "bd-enrollment-v1\nPOST\n$path\n${identity.deviceId}\n${identity.publicKeyB64}\n$timestamp\n$nonce"
        val signer = Ed25519Sign(identity.privateKey)
        val sigB64 = Base64.encodeToString(
            signer.sign(payloadToSign.toByteArray(StandardCharsets.UTF_8)),
            Base64.NO_WRAP,
        )

        _uiState.update {
            it.copy(
                connectionState = AgentConnectionState.ENROLLING,
                statusMessage = "Enrolling with ${BetterDeskAgentConfig.idServer}",
            )
        }

        val bodyJson = buildJsonObject {
            put("device_id", identity.deviceId)
            put("uuid", identity.uuid)
            put("hostname", "${Build.MANUFACTURER} ${Build.MODEL}".trim())
            put("platform", "android")
            put("version", BetterDeskAgentConfig.appVersion)
            put("device_type", "betterdesk")
            put("tags", "android,mescrowdesk")
            put("public_key", identity.publicKeyB64)
        }.toString()

        val req = Request.Builder()
            .url(url)
            .header("X-BD-Enrollment-Timestamp", timestamp)
            .header("X-BD-Enrollment-Nonce", nonce)
            .header("X-BD-Enrollment-Signature", sigB64)
            .post(bodyJson.toRequestBody(jsonMediaType))
            .build()

        httpClient.newCall(req).execute().use { resp ->
            val raw = resp.body.string()
            if (!resp.isSuccessful) {
                LogCat.w("$TAG: enrollment HTTP ${resp.code}: $raw")
                _uiState.update {
                    it.copy(
                        connectionState = AgentConnectionState.ERROR,
                        statusMessage = "Enrollment failed (HTTP ${resp.code})",
                    )
                }
                return null
            }
            val obj = runCatching { json.parseToJsonElement(raw).jsonObject }.getOrNull() ?: return null
            val status = obj["status"]?.jsonPrimitive?.content.orEmpty()
            val token = obj["device_token"]?.jsonPrimitive?.content.orEmpty()
            if (status == "approved" && token.isNotBlank()) {
                prefs.edit()
                    .putString(KEY_DEVICE_TOKEN, token)
                    .putString(KEY_SERVER_FINGERPRINT, serverFingerprint)
                    .apply()
                LogCat.d("$TAG: enrolled device ${identity.deviceId} against ${BetterDeskAgentConfig.idServer}")
                return token
            }
            LogCat.w("$TAG: enrollment status=$status (token present=${token.isNotBlank()})")
            _uiState.update {
                it.copy(
                    connectionState = AgentConnectionState.ERROR,
                    statusMessage = "Enrollment pending ($status)",
                )
            }
            return null
        }
    }

    private suspend fun connectCdapSession(context: Context, identity: AgentIdentity, deviceToken: String) {
        val doneSignal = AtomicBoolean(false)
        _uiState.update {
            it.copy(
                connectionState = AgentConnectionState.CONNECTING,
                statusMessage = "Connecting to ${BetterDeskAgentConfig.idServer}",
            )
        }
        val request = Request.Builder()
            .url(BetterDeskAgentConfig.cdapWsUrl)
            .header("Sec-WebSocket-Protocol", "cdap-v1")
            .build()

        val listener = object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                activeWebSocket = webSocket
                val authPayload = buildJsonObject {
                    put("method", "device_token")
                    put("device_id", identity.deviceId)
                    put("token", deviceToken)
                    put("client_version", BetterDeskAgentConfig.appVersion)
                }
                sendEnvelope(webSocket, "auth", authPayload)
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                scope.launch {
                    handleServerMessage(context, webSocket, identity, text)
                }
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(1000, null)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                _uiState.update {
                    it.copy(
                        connectionState = AgentConnectionState.DISCONNECTED,
                        statusMessage = reason.ifBlank { "Disconnected" },
                    )
                }
                cleanupConnection(doneSignal)
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                if (response?.code == 401 || response?.code == 403) {
                    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                        .edit().remove(KEY_DEVICE_TOKEN).apply()
                }
                LogCat.w("$TAG: CDAP WS failure (${response?.code}): ${t.message}")
                _uiState.update {
                    it.copy(
                        connectionState = AgentConnectionState.ERROR,
                        statusMessage = t.message ?: "Connection failed",
                    )
                }
                cleanupConnection(doneSignal)
            }
        }

        httpClient.newWebSocket(request, listener)
        while (!doneSignal.get() && started.get()) {
            delay(1_000L)
        }
    }

    private fun cleanupConnection(doneSignal: AtomicBoolean) {
        stopDesktopSession()
        heartbeatJob?.cancel()
        heartbeatJob = null
        activeWebSocket = null
        doneSignal.set(true)
    }

    private fun handleServerMessage(
        context: Context,
        ws: WebSocket,
        identity: AgentIdentity,
        rawText: String,
    ) {
        val msg = runCatching { json.parseToJsonElement(rawText).jsonObject }.getOrNull() ?: return
        val type = msg["type"]?.jsonPrimitive?.content ?: return
        val payload = msg["payload"] as? JsonObject ?: buildJsonObject {}

        when (type) {
            "auth_result" -> {
                val ok = payload["success"]?.jsonPrimitive?.booleanOrNull == true
                if (!ok) {
                    val err = payload["error"]?.jsonPrimitive?.content ?: "auth rejected"
                    LogCat.w("$TAG: auth failed: $err")
                    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                        .edit().remove(KEY_DEVICE_TOKEN).apply()
                    _uiState.update {
                        it.copy(
                            connectionState = AgentConnectionState.ERROR,
                            statusMessage = "Auth rejected: $err",
                        )
                    }
                    ws.close(1008, err)
                    return
                }
                _uiState.update {
                    it.copy(
                        connectionState = AgentConnectionState.ONLINE,
                        statusMessage = "Connected to ${BetterDeskAgentConfig.idServer}",
                        accessibilityEnabled = PlainAccessibilityService.isEnabled(context),
                        projectionActive = mediaProjectionRef != null,
                    )
                }
                sendManifest(context, ws, identity)
                startHeartbeatLoop(context, ws)
            }

            "ping" -> sendEnvelope(ws, "pong", buildJsonObject {})

            "command" -> handleCommand(context, ws, payload)

            "clipboard_set" -> {
                val format = payload["format"]?.jsonPrimitive?.content ?: "text"
                val data = payload["data"]?.jsonPrimitive?.content.orEmpty()
                if (format == "text") {
                    runCatching {
                        clipboardManager.setPrimaryClip(ClipData.newPlainText("MEscrowDesk", data))
                    }
                }
            }

            "file_list" -> handleFileList(ws, payload)
            "file_read" -> handleFileRead(ws, payload)
            "file_write" -> handleFileWrite(ws, payload)
            "file_delete" -> handleFileDelete(ws, payload)

            "plainapp_graphql" -> handlePlainAppGraphql(ws, payload)
            "plainapp_rpc" -> handlePlainAppRpc(context, ws, payload)

            "desktop_start" -> handleDesktopStart(context, ws, payload)
            "desktop_input" -> handleDesktopInput(context, payload)
            "desktop_end" -> stopDesktopSession()
        }
    }

    private fun sendManifest(context: Context, ws: WebSocket, identity: AgentIdentity) {
        val manifest = buildJsonObject {
            put("manifest_version", "1.0")
            put("device", buildJsonObject {
                put("name", "${Build.MANUFACTURER} ${Build.MODEL}".trim())
                put("type", "os_agent")
                put("vendor", Build.MANUFACTURER)
                put("model", Build.MODEL)
                put("firmware", "Android ${Build.VERSION.RELEASE} (SDK ${Build.VERSION.SDK_INT})")
                put("serial", identity.deviceId)
                put("tags", buildJsonArray {
                    add(JsonPrimitive("android"))
                    add(JsonPrimitive("mescrowdesk"))
                })
            })
            put("bridge", buildJsonObject {
                put("name", "MEscrowDesk Android Agent")
                put("version", BetterDeskAgentConfig.appVersion)
                put("protocol", "cdap-v1")
                put("target_host", BetterDeskAgentConfig.idServer)
                put("target_port", BetterDeskAgentConfig.idPort)
            })
            put("capabilities", buildJsonArray {
                add(JsonPrimitive("telemetry"))
                add(JsonPrimitive("commands"))
                add(JsonPrimitive("remote_desktop"))
                add(JsonPrimitive("mouse_input"))
                add(JsonPrimitive("keyboard_input"))
                add(JsonPrimitive("file_transfer"))
                add(JsonPrimitive("clipboard"))
                add(JsonPrimitive("screenshot"))
            })
            put("heartbeat_interval", 15)
            put("widgets", buildJsonArray {
                add(buildJsonObject {
                    put("id", "battery_pct")
                    put("type", "gauge")
                    put("label", "Battery Level")
                    put("group", "Device")
                    put("unit", "%")
                    put("min", 0)
                    put("max", 100)
                })
                add(buildJsonObject {
                    put("id", "memory_pct")
                    put("type", "gauge")
                    put("label", "Memory Used")
                    put("group", "Device")
                    put("unit", "%")
                    put("min", 0)
                    put("max", 100)
                })
                add(buildJsonObject {
                    put("id", "storage_pct")
                    put("type", "gauge")
                    put("label", "Storage Used")
                    put("group", "Device")
                    put("unit", "%")
                    put("min", 0)
                    put("max", 100)
                })
                add(buildJsonObject {
                    put("id", "accessibility_ready")
                    put("type", "led")
                    put("label", "Remote Touch Control")
                    put("group", "Agent")
                    put("value", PlainAccessibilityService.isEnabled(context))
                })
                add(buildJsonObject {
                    put("id", "screen_share_ready")
                    put("type", "led")
                    put("label", "Screen Capture Ready")
                    put("group", "Agent")
                    put("value", mediaProjectionRef != null)
                })
                add(buildJsonObject {
                    put("id", "server_endpoint")
                    put("type", "text")
                    put("label", "ID / Relay Server")
                    put("group", "Agent")
                    put("value", "${BetterDeskAgentConfig.idServer}:${BetterDeskAgentConfig.idPort}")
                    put("readonly", true)
                })
                add(buildJsonObject {
                    put("id", "plainapp_graphql")
                    put("type", "text")
                    put("label", "PlainApp GraphQL Bridge")
                    put("group", "PlainApp")
                    put("value", "ready")
                })
                add(buildJsonObject {
                    put("id", "plainapp_rpc")
                    put("type", "text")
                    put("label", "PlainApp RPC Bridge")
                    put("group", "PlainApp")
                    put("value", "ready")
                })
            })
        }
        sendEnvelope(ws, "register", buildJsonObject { put("manifest", manifest) })
    }

    private fun startHeartbeatLoop(context: Context, ws: WebSocket) {
        heartbeatJob?.cancel()
        heartbeatJob = scope.launch {
            while (isActive && activeWebSocket === ws) {
                val batteryPct = runCatching {
                    batteryManager.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY).coerceIn(0, 100)
                }.getOrDefault(0)
                val memInfo = ActivityManager.MemoryInfo()
                runCatching { activityManager.getMemoryInfo(memInfo) }
                val memPct = if (memInfo.totalMem > 0) {
                    ((memInfo.totalMem - memInfo.availMem).toDouble() / memInfo.totalMem.toDouble()) * 100.0
                } else 0.0
                val diskPct = runCatching {
                    val stat = StatFs(Environment.getExternalStorageDirectory().absolutePath)
                    val total = stat.totalBytes.toDouble()
                    val avail = stat.availableBytes.toDouble()
                    if (total > 0) ((total - avail) / total) * 100.0 else 0.0
                }.getOrDefault(0.0)

                val accessibilityReady = PlainAccessibilityService.isEnabled(context)
                val projectionReady = mediaProjectionRef != null
                _uiState.update {
                    it.copy(
                        accessibilityEnabled = accessibilityReady,
                        projectionActive = projectionReady,
                    )
                }

                val hb = buildJsonObject {
                    put("metrics", buildJsonObject {
                        put("cpu", 0.0)
                        put("memory", memPct)
                        put("disk", diskPct)
                    })
                    put("widget_values", buildJsonObject {
                        put("battery_pct", batteryPct)
                        put("memory_pct", memPct.toInt())
                        put("storage_pct", diskPct.toInt())
                        put("accessibility_ready", accessibilityReady)
                        put("screen_share_ready", projectionReady)
                        put("server_endpoint", "${BetterDeskAgentConfig.idServer}:${BetterDeskAgentConfig.idPort}")
                    })
                }
                sendEnvelope(ws, "heartbeat", hb)
                delay(15_000L)
            }
        }
    }

    private fun handleCommand(context: Context, ws: WebSocket, payload: JsonObject) {
        val commandId = payload["command_id"]?.jsonPrimitive?.content.orEmpty()
        val action = payload["action"]?.jsonPrimitive?.content.orEmpty()
        val widgetId = payload["widget_id"]?.jsonPrimitive?.content.orEmpty()
        val cmdValue = payload["value"] as? JsonObject

        when (widgetId) {
            "plainapp_graphql" -> {
                val resultObj = executePlainAppGraphqlObject(cmdValue ?: buildJsonObject {})
                sendEnvelope(ws, "command_response", buildJsonObject {
                    put("command_id", commandId)
                    put("status", "ok")
                    put("result", resultObj)
                })
                return
            }

            "plainapp_rpc" -> {
                val method = cmdValue?.get("method")?.jsonPrimitive?.content.orEmpty()
                val params = cmdValue?.get("params") as? JsonObject ?: buildJsonObject {}
                val rpcResult = executePlainAppRpcObject(context, method, params)
                sendEnvelope(ws, "command_response", buildJsonObject {
                    put("command_id", commandId)
                    put("status", "ok")
                    put("result", rpcResult)
                })
                return
            }
        }

        val status = when {
            widgetId == "open_app" || action == "open_app" -> {
                runCatching {
                    val i = Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    context.startActivity(i)
                }
                "ok"
            }
            else -> "ok"
        }

        sendEnvelope(ws, "command_response", buildJsonObject {
            put("command_id", commandId)
            put("status", status)
        })
    }

    private fun handleDesktopStart(context: Context, ws: WebSocket, payload: JsonObject) {
        val sessionId = payload["session_id"]?.jsonPrimitive?.content.orEmpty()
        if (sessionId.isBlank()) return
        val quality = (payload["quality"]?.jsonPrimitive?.intOrNull ?: 65).coerceIn(20, 95)
        val fps = (payload["fps"]?.jsonPrimitive?.intOrNull ?: 20).coerceIn(5, 30)

        val projection = mediaProjectionRef
        if (projection == null) {
            sendEnvelope(ws, "desktop_consent_denied", buildJsonObject {
                put("session_id", sessionId)
                put("reason", "Screen capture permission has not been granted in MEscrowDesk on this Android device.")
            })
            return
        }

        stopDesktopSession()
        activeDesktopSessionId = sessionId

        val size = PlainAccessibilityService.getScreenSize(context)
        val targetWidth = size.x.coerceAtMost(720).coerceAtLeast(360)
        val targetHeight = if (size.x > 0) ((targetWidth.toFloat() / size.x) * size.y).toInt().coerceAtLeast(360) else 1280
        val densityDpi = context.resources.displayMetrics.densityDpi

        val thread = HandlerThread("MEscrowDeskCapture").apply { start() }
        captureThread = thread
        val handler = Handler(thread.looper)

        val reader = ImageReader.newInstance(targetWidth, targetHeight, PixelFormat.RGBA_8888, 2)
        captureImageReader = reader
        val minIntervalMs = (1000L / fps).coerceAtLeast(33L)
        var lastSentAt = 0L

        reader.setOnImageAvailableListener({ r ->
            val now = System.currentTimeMillis()
            val img = runCatching { r.acquireLatestImage() }.getOrNull() ?: return@setOnImageAvailableListener
            try {
                if (now - lastSentAt < minIntervalMs || activeDesktopSessionId != sessionId) return@setOnImageAvailableListener
                lastSentAt = now

                val plane = img.planes[0]
                val buffer = plane.buffer
                val pixelStride = plane.pixelStride
                val rowStride = plane.rowStride
                val rowPadding = rowStride - pixelStride * targetWidth
                val bitmapWidth = targetWidth + rowPadding / pixelStride

                val rawBmp = Bitmap.createBitmap(bitmapWidth, targetHeight, Bitmap.Config.ARGB_8888)
                rawBmp.copyPixelsFromBuffer(buffer)
                val cropped = if (bitmapWidth != targetWidth) {
                    Bitmap.createBitmap(rawBmp, 0, 0, targetWidth, targetHeight).also { rawBmp.recycle() }
                } else {
                    rawBmp
                }

                val baos = ByteArrayOutputStream()
                cropped.compress(Bitmap.CompressFormat.JPEG, quality, baos)
                cropped.recycle()
                val jpegBytes = baos.toByteArray()

                val packet = ByteArray(FRAME_HEADER_SIZE + jpegBytes.size)
                val idBytes = sessionId.toByteArray(StandardCharsets.UTF_8)
                System.arraycopy(idBytes, 0, packet, 0, idBytes.size.coerceAtMost(FRAME_HEADER_SIZE))
                System.arraycopy(jpegBytes, 0, packet, FRAME_HEADER_SIZE, jpegBytes.size)
                ws.send(packet.toByteString(0, packet.size))
            } catch (e: Exception) {
                LogCat.e("$TAG: frame encode error: ${e.message}")
            } finally {
                img.close()
            }
        }, handler)

        val vdFlags = if (isUPlus()) 0 else DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR
        captureVirtualDisplay = runCatching {
            projection.createVirtualDisplay(
                "MEscrowDeskAgentDisplay",
                targetWidth,
                targetHeight,
                densityDpi,
                vdFlags,
                reader.surface,
                null,
                handler,
            )
        }.getOrElse { err ->
            LogCat.w("$TAG: VirtualDisplay unavailable (${err.message})")
            stopDesktopSession()
            sendEnvelope(ws, "desktop_consent_denied", buildJsonObject {
                put("session_id", sessionId)
                put("reason", err.message ?: "Unable to capture screen")
            })
            null
        }
    }

    private fun stopDesktopSession() {
        activeDesktopSessionId = null
        desktopCaptureJob?.cancel()
        desktopCaptureJob = null
        runCatching { captureVirtualDisplay?.release() }
        captureVirtualDisplay = null
        runCatching { captureImageReader?.close() }
        captureImageReader = null
        runCatching { captureThread?.quitSafely() }
        captureThread = null
    }

    private fun handleDesktopInput(context: Context, payload: JsonObject) {
        val service = PlainAccessibilityService.instance ?: return
        val size = PlainAccessibilityService.getScreenSize(context)
        val sw = size.x.coerceAtLeast(1)
        val sh = size.y.coerceAtLeast(1)

        val inputType = payload["type"]?.jsonPrimitive?.content.orEmpty()
        val xRaw = payload["x"]?.jsonPrimitive?.floatOrNull
        val yRaw = payload["y"]?.jsonPrimitive?.floatOrNull
        val normX = xRaw?.let { if (it > 1f) it / sw.toFloat() else it }
        val normY = yRaw?.let { if (it > 1f) it / sh.toFloat() else it }

        val control = when (inputType) {
            "mousedown" -> ScreenMirrorControlInput(ScreenMirrorControlAction.TOUCH_DOWN, x = normX, y = normY)
            "mousemove" -> ScreenMirrorControlInput(ScreenMirrorControlAction.TOUCH_MOVE, x = normX, y = normY)
            "mouseup" -> ScreenMirrorControlInput(ScreenMirrorControlAction.TOUCH_UP, x = normX, y = normY)
            "click", "tap" -> ScreenMirrorControlInput(ScreenMirrorControlAction.TAP, x = normX, y = normY)
            "wheel" -> ScreenMirrorControlInput(
                ScreenMirrorControlAction.SCROLL,
                x = normX ?: 0.5f,
                y = normY ?: 0.5f,
                deltaX = payload["delta_x"]?.jsonPrimitive?.floatOrNull ?: 0f,
                deltaY = payload["delta_y"]?.jsonPrimitive?.floatOrNull ?: 0f,
            )
            "keydown" -> when (payload["key"]?.jsonPrimitive?.content) {
                "Escape", "BrowserBack" -> ScreenMirrorControlInput(ScreenMirrorControlAction.BACK)
                "Home" -> ScreenMirrorControlInput(ScreenMirrorControlAction.HOME)
                else -> null
            }
            else -> null
        } ?: return

        service.dispatchControl(control, sw, sh)
    }

    private fun safeResolvePath(rawPath: String): File? {
        val root = Environment.getExternalStorageDirectory().canonicalFile
        val rel = rawPath.trim().trimStart('/')
        val target = if (rel.isEmpty() || rel == ".") root else File(root, rel).canonicalFile
        val rootPath = root.path
        val targetPath = target.path
        if (targetPath != rootPath && !targetPath.startsWith("$rootPath${File.separator}")) {
            return null
        }
        return target
    }

    private fun handleFileList(ws: WebSocket, payload: JsonObject) {
        val sessionId = payload["session_id"]?.jsonPrimitive?.content.orEmpty()
        val requestId = payload["request_id"]?.jsonPrimitive?.content.orEmpty()
        val reqPath = payload["path"]?.jsonPrimitive?.content ?: "/"
        val dir = safeResolvePath(reqPath)
        if (dir == null || !dir.exists() || !dir.isDirectory) {
            sendEnvelope(ws, "file_list_response", buildJsonObject {
                put("session_id", sessionId)
                put("request_id", requestId)
                put("path", reqPath)
                put("entries", buildJsonArray {})
                put("error", "Directory not accessible")
            })
            return
        }
        val entries = dir.listFiles().orEmpty().sortedWith(compareBy({ !it.isDirectory }, { it.name.lowercase() }))
        sendEnvelope(ws, "file_list_response", buildJsonObject {
            put("session_id", sessionId)
            put("request_id", requestId)
            put("path", reqPath)
            put("entries", buildJsonArray {
                entries.forEach { f ->
                    add(buildJsonObject {
                        put("name", f.name)
                        put("is_dir", f.isDirectory)
                        put("size", if (f.isDirectory) 0L else f.length())
                        put("modified", DateTimeFormatter.ISO_INSTANT.format(Instant.ofEpochMilli(f.lastModified())))
                    })
                }
            })
        })
    }

    private fun handleFileRead(ws: WebSocket, payload: JsonObject) {
        val sessionId = payload["session_id"]?.jsonPrimitive?.content.orEmpty()
        val requestId = payload["request_id"]?.jsonPrimitive?.content.orEmpty()
        val reqPath = payload["path"]?.jsonPrimitive?.content.orEmpty()
        val file = safeResolvePath(reqPath)
        if (file == null || !file.exists() || !file.isFile) {
            sendEnvelope(ws, "file_read_response", buildJsonObject {
                put("session_id", sessionId)
                put("request_id", requestId)
                put("path", reqPath)
                put("data", "")
                put("size", 0L)
                put("offset", 0L)
                put("done", true)
                put("error", "File not accessible")
            })
            return
        }
        val bytes = file.readBytes()
        sendEnvelope(ws, "file_read_response", buildJsonObject {
            put("session_id", sessionId)
            put("request_id", requestId)
            put("path", reqPath)
            put("data", Base64.encodeToString(bytes, Base64.NO_WRAP))
            put("size", bytes.size.toLong())
            put("offset", 0L)
            put("done", true)
        })
    }

    private fun handleFileWrite(ws: WebSocket, payload: JsonObject) {
        val sessionId = payload["session_id"]?.jsonPrimitive?.content.orEmpty()
        val requestId = payload["request_id"]?.jsonPrimitive?.content.orEmpty()
        val reqPath = payload["path"]?.jsonPrimitive?.content.orEmpty()
        val dataB64 = payload["data"]?.jsonPrimitive?.content.orEmpty()
        val file = safeResolvePath(reqPath)
        if (file == null) {
            sendEnvelope(ws, "file_write_response", buildJsonObject {
                put("session_id", sessionId)
                put("request_id", requestId)
                put("path", reqPath)
                put("written", 0L)
                put("error", "Invalid path")
            })
            return
        }
        file.parentFile?.mkdirs()
        val bytes = Base64.decode(dataB64, Base64.DEFAULT)
        file.writeBytes(bytes)
        sendEnvelope(ws, "file_write_response", buildJsonObject {
            put("session_id", sessionId)
            put("request_id", requestId)
            put("path", reqPath)
            put("written", bytes.size.toLong())
        })
    }

    private fun handleFileDelete(ws: WebSocket, payload: JsonObject) {
        val sessionId = payload["session_id"]?.jsonPrimitive?.content.orEmpty()
        val requestId = payload["request_id"]?.jsonPrimitive?.content.orEmpty()
        val reqPath = payload["path"]?.jsonPrimitive?.content.orEmpty()
        val file = safeResolvePath(reqPath)
        val ok = file != null && file.exists() && file.deleteRecursively()
        sendEnvelope(ws, "file_delete_response", buildJsonObject {
            put("session_id", sessionId)
            put("request_id", requestId)
            put("path", reqPath)
            put("error", if (ok) "" else "Delete failed")
        })
    }

    private fun executePlainAppGraphqlObject(payload: JsonObject): JsonObject {
        val query = payload["query"]?.jsonPrimitive?.content.orEmpty()
        val variables = payload["variables"] as? JsonObject
        val reqJson = buildJsonObject {
            put("query", query)
            if (variables != null) put("variables", variables)
        }.toString()
        val result = runCatching {
            RustNativeBindings.graphql(reqJson)
        }.getOrElse { e ->
            buildJsonObject {
                put("errors", buildJsonArray {
                    add(buildJsonObject { put("message", e.message ?: "GraphQL execution failed") })
                })
            }.toString()
        }
        return runCatching { json.parseToJsonElement(result).jsonObject }.getOrNull() ?: buildJsonObject {
            put("raw", result)
        }
    }

    private fun executePlainAppRpcObject(context: Context, method: String, params: JsonObject): JsonObject {
        return buildJsonObject {
            put("method", method)
            when (method) {
                "get_device_info" -> {
                    val batteryPct = runCatching {
                        batteryManager.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY).coerceIn(0, 100)
                    }.getOrDefault(0)
                    put("device_model", "${Build.MANUFACTURER} ${Build.MODEL}")
                    put("android_version", Build.VERSION.RELEASE)
                    put("sdk_int", Build.VERSION.SDK_INT)
                    put("battery_pct", batteryPct)
                    put("accessibility_enabled", PlainAccessibilityService.isEnabled(context))
                    put("projection_active", mediaProjectionRef != null)
                    put("status", "ok")
                }
                "clipboard_get" -> {
                    val text = runCatching {
                        val clip = clipboardManager.primaryClip
                        if (clip != null && clip.itemCount > 0) {
                            clip.getItemAt(0).coerceToText(context)?.toString().orEmpty()
                        } else ""
                    }.getOrDefault("")
                    put("text", text)
                    put("status", "ok")
                }
                "clipboard_set" -> {
                    val text = params["text"]?.jsonPrimitive?.content.orEmpty()
                    val ok = runCatching {
                        clipboardManager.setPrimaryClip(ClipData.newPlainText("MEscrowDesk", text))
                        true
                    }.getOrDefault(false)
                    put("text", text)
                    put("status", if (ok) "ok" else "error")
                }
                "open_app" -> {
                    runCatching {
                        val i = Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        context.startActivity(i)
                    }
                    put("status", "ok")
                }
                "ping" -> {
                    put("pong", System.currentTimeMillis())
                    put("status", "ok")
                }
                else -> {
                    put("status", "unsupported_method")
                }
            }
        }
    }

    private fun handlePlainAppGraphql(ws: WebSocket, payload: JsonObject) {
        val requestId = payload["request_id"]?.jsonPrimitive?.content.orEmpty()
        val resultObj = executePlainAppGraphqlObject(payload)
        sendEnvelope(ws, "plainapp_graphql_response", buildJsonObject {
            put("request_id", requestId)
            put("result", resultObj)
        })
    }

    private fun handlePlainAppRpc(context: Context, ws: WebSocket, payload: JsonObject) {
        val requestId = payload["request_id"]?.jsonPrimitive?.content.orEmpty()
        val method = payload["method"]?.jsonPrimitive?.content.orEmpty()
        val params = payload["params"] as? JsonObject ?: buildJsonObject {}
        val resp = buildJsonObject {
            put("request_id", requestId)
            executePlainAppRpcObject(context, method, params).forEach { (k, v) -> put(k, v) }
        }
        sendEnvelope(ws, "plainapp_rpc_response", resp)
    }

    private fun sendEnvelope(ws: WebSocket, type: String, payload: JsonObject) {
        val msg = buildJsonObject {
            put("type", type)
            put("timestamp", DateTimeFormatter.ISO_INSTANT.format(Instant.now()))
            put("payload", payload)
        }.toString()
        ws.send(msg)
    }
}
