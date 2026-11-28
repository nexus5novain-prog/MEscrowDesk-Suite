package com.ismartcoding.plain.agent

import kotlinx.coroutines.flow.StateFlow

enum class AgentConnectionState {
    DISCONNECTED,
    ENROLLING,
    CONNECTING,
    ONLINE,
    ERROR,
}

data class AgentUiState(
    val supported: Boolean = false,
    val connectionState: AgentConnectionState = AgentConnectionState.DISCONNECTED,
    val statusMessage: String = "",
    val deviceId: String = "",
    val serverEndpoint: String = "ais-dev-unon5nqil4g25vunmiwtjk-917930534895.us-east1.run.app",
    val accessibilityEnabled: Boolean = false,
    val projectionActive: Boolean = false,
)

expect object AgentBridge {
    val state: StateFlow<AgentUiState>
    fun requestScreenCapture()
    fun openAccessibilitySettings()
    fun reconnect()
    fun refreshPermissions()
}
