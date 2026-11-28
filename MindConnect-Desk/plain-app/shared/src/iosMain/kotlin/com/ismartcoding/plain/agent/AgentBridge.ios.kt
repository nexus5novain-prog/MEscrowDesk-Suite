package com.ismartcoding.plain.agent

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

actual object AgentBridge {
    private val emptyState = MutableStateFlow(AgentUiState(supported = false))

    actual val state: StateFlow<AgentUiState> = emptyState.asStateFlow()

    actual fun requestScreenCapture() = Unit

    actual fun openAccessibilitySettings() = Unit

    actual fun reconnect() = Unit

    actual fun refreshPermissions() = Unit
}
