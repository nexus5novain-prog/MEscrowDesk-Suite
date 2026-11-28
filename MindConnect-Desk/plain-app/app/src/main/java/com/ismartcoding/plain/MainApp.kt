package com.ismartcoding.plain

import android.app.Application
import android.content.ComponentCallbacks2
import com.ismartcoding.plain.agent.BetterDeskAgentConfig
import com.ismartcoding.plain.agent.BetterDeskAgentService
import com.ismartcoding.plain.platform.media.clearImageMemoryCache

class MainApp : Application() {
    override fun onCreate() {
        super.onCreate()
        setAppContext(this, buildChannel = BuildConfig.CHANNEL)
        CrashHandler.install(this)
        NetworkMonitor.init(this)
        initializeApp()
        BetterDeskAgentConfig.configure(
            idServer = BuildConfig.BETTERDESK_ID_SERVER,
            idPort = BuildConfig.BETTERDESK_ID_PORT,
            relayServer = BuildConfig.BETTERDESK_RELAY_SERVER,
            relayPort = BuildConfig.BETTERDESK_RELAY_PORT,
            apiUrl = BuildConfig.BETTERDESK_API_URL,
            cdapWsUrl = BuildConfig.BETTERDESK_CDAP_WS_URL,
            serverPublicKey = BuildConfig.BETTERDESK_SERVER_KEY,
            appVersion = BuildConfig.VERSION_NAME,
        )
        BetterDeskAgentService.start(this)
    }

    override fun onTrimMemory(level: Int) {
        super.onTrimMemory(level)
        if (level >= ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN) {
            clearImageMemoryCache()
        }
    }
}
