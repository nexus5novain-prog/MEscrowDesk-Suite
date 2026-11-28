package com.ismartcoding.plain.ui.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.ismartcoding.plain.agent.AgentBridge
import com.ismartcoding.plain.agent.AgentConnectionState
import com.ismartcoding.plain.agent.AgentUiState
import com.ismartcoding.plain.i18n.Res
import com.ismartcoding.plain.i18n.copied_to_clipboard_format
import com.ismartcoding.plain.ui.base.CopyIconButton
import com.ismartcoding.plain.ui.base.HorizontalSpace
import com.ismartcoding.plain.ui.base.PDivider
import com.ismartcoding.plain.ui.base.PFilledButton
import com.ismartcoding.plain.ui.base.POutlinedButton
import com.ismartcoding.plain.ui.base.PStatusBadge
import com.ismartcoding.plain.ui.base.PTextButton
import com.ismartcoding.plain.ui.base.VerticalSpace
import com.ismartcoding.plain.ui.components.BadgeType
import com.ismartcoding.plain.ui.components.ButtonSize
import com.ismartcoding.plain.ui.components.ButtonType
import com.ismartcoding.plain.ui.components.ToastManager
import org.jetbrains.compose.resources.stringResource

@Composable
fun AgentStatusSection(
    state: AgentUiState,
    modifier: Modifier = Modifier,
) {
    val (statusLabel, badgeType) = when (state.connectionState) {
        AgentConnectionState.ONLINE -> "Online" to BadgeType.SUCCESS
        AgentConnectionState.ENROLLING -> "Enrolling…" to BadgeType.INFO
        AgentConnectionState.CONNECTING -> "Connecting…" to BadgeType.INFO
        AgentConnectionState.ERROR -> "Error" to BadgeType.DANGER
        AgentConnectionState.DISCONNECTED -> "Offline" to BadgeType.NEUTRAL
    }

    Column(modifier = modifier.fillMaxWidth().padding(16.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = "MEscrowDesk Agent",
                    style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold),
                    color = MaterialTheme.colorScheme.onSurface,
                )
                VerticalSpace(2.dp)
                Text(
                    text = state.serverEndpoint,
                    style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            HorizontalSpace(12.dp)
            PStatusBadge(text = statusLabel, type = badgeType)
        }

        if (state.statusMessage.isNotBlank() && state.connectionState != AgentConnectionState.ONLINE) {
            VerticalSpace(8.dp)
            Text(
                text = state.statusMessage,
                style = MaterialTheme.typography.bodySmall,
                color = if (state.connectionState == AgentConnectionState.ERROR) {
                    MaterialTheme.colorScheme.error
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant
                },
            )
        }

        VerticalSpace(12.dp)
        Surface(
            modifier = Modifier.fillMaxWidth(),
            color = MaterialTheme.colorScheme.surfaceContainerLow,
            shape = MaterialTheme.shapes.small,
        ) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(start = 12.dp, top = 8.dp, bottom = 8.dp, end = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = "Device ID",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    VerticalSpace(2.dp)
                    Text(
                        text = state.deviceId.ifBlank { "Initializing…" },
                        style = MaterialTheme.typography.titleSmall.copy(
                            fontFamily = FontFamily.Monospace,
                            fontWeight = FontWeight.SemiBold,
                        ),
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                }
                if (state.deviceId.isNotBlank()) {
                    val copiedText = stringResource(Res.string.copied_to_clipboard_format, state.deviceId)
                    CopyIconButton(
                        text = state.deviceId,
                        clipLabel = "MEscrowDesk Device ID",
                        onCopied = { ToastManager.showSuccessToast(copiedText) },
                    )
                }
            }
        }

        VerticalSpace(12.dp)
        PDivider()
        VerticalSpace(12.dp)

        AgentPermissionRow(
            title = "Screen Capture",
            subtitle = if (state.projectionActive) {
                "Screen sharing active for remote sessions"
            } else {
                "Allow screen capture for remote view"
            },
            ready = state.projectionActive,
            readyLabel = "Active",
            actionLabel = "Enable Share",
            useTonalPrimary = true,
            onAction = { AgentBridge.requestScreenCapture() },
        )

        VerticalSpace(12.dp)

        AgentPermissionRow(
            title = "Remote Touch",
            subtitle = if (state.accessibilityEnabled) {
                "MEscrowDesk Remote Control enabled"
            } else {
                "Enable accessibility service for touch control"
            },
            ready = state.accessibilityEnabled,
            readyLabel = "Ready",
            actionLabel = "Enable Touch",
            useTonalPrimary = false,
            onAction = { AgentBridge.openAccessibilitySettings() },
        )

        VerticalSpace(8.dp)
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(
                text = "ID :21116 • Relay :21117",
                style = MaterialTheme.typography.labelSmall.copy(fontFamily = FontFamily.Monospace),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            PTextButton(
                text = "Reconnect",
                onClick = { AgentBridge.reconnect() },
            )
        }
    }
}

@Composable
private fun AgentPermissionRow(
    title: String,
    subtitle: String,
    ready: Boolean,
    readyLabel: String,
    actionLabel: String,
    useTonalPrimary: Boolean,
    onAction: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = title,
                style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold),
                color = MaterialTheme.colorScheme.onSurface,
            )
            VerticalSpace(2.dp)
            Text(
                text = subtitle,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        HorizontalSpace(12.dp)
        if (ready) {
            PStatusBadge(text = readyLabel, type = BadgeType.SUCCESS)
        } else if (useTonalPrimary) {
            PFilledButton(
                text = actionLabel,
                onClick = onAction,
                type = ButtonType.TONAL,
                buttonSize = ButtonSize.SMALL,
            )
        } else {
            POutlinedButton(
                text = actionLabel,
                onClick = onAction,
                buttonSize = ButtonSize.SMALL,
            )
        }
    }
}
