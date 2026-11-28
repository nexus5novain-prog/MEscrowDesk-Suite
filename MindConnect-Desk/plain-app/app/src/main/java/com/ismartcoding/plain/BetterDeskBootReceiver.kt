package com.ismartcoding.plain

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.ismartcoding.plain.agent.BetterDeskAgentConfig
import com.ismartcoding.plain.agent.BetterDeskAgentService

class BetterDeskBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action ?: return
        if (
            action == Intent.ACTION_BOOT_COMPLETED ||
            action == "android.intent.action.QUICKBOOT_POWERON" ||
            action == Intent.ACTION_MY_PACKAGE_REPLACED
        ) {
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
            BetterDeskAgentService.start(context.applicationContext)
        }
    }
}
