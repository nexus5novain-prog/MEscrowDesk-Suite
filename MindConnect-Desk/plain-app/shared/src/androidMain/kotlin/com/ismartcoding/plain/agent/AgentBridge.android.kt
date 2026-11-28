package com.ismartcoding.plain.agent

import com.ismartcoding.plain.appContextOrNull
import com.ismartcoding.plain.events.RequestAgentScreenCaptureEvent
import com.ismartcoding.plain.lib.sendEvent
import com.ismartcoding.plain.services.PlainAccessibilityService
import kotlinx.coroutines.flow.StateFlow

actual object AgentBridge {
    actual val state: StateFlow<AgentUiState> = BetterDeskCdapAgent.uiState

    actual fun requestScreenCapture() {
        sendEvent(RequestAgentScreenCaptureEvent)
    }

    actual fun openAccessibilitySettings() {
        val ctx = appContextOrNull ?: return
        PlainAccessibilityService.openAccessibilitySettings(ctx)
    }

    actual fun reconnect() {
        val ctx = appContextOrNull ?: return
        BetterDeskCdapAgent.reconnectNow(ctx)
    }

    actual fun refreshPermissions() {
        val ctx = appContextOrNull ?: return
        BetterDeskCdapAgent.refreshPermissions(ctx)
    }
}
