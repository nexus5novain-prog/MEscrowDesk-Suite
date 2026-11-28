package com.ismartcoding.plain.agent

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.projection.MediaProjection
import android.os.Handler
import android.os.Looper
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleService
import com.ismartcoding.plain.lib.extensions.parcelable
import com.ismartcoding.plain.lib.logcat.LogCat
import com.ismartcoding.plain.mediaProjectionManager
import com.ismartcoding.plain.ui.platform.notifications.NotificationHelper

class BetterDeskAgentService : LifecycleService() {
    @Volatile
    private var ownedProjection: MediaProjection? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
        NotificationHelper.ensureDefaultChannel()
    }

    @SuppressLint("InlinedApi")
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)

        val resultCode = intent?.getIntExtra(EXTRA_PROJECTION_CODE, Int.MIN_VALUE) ?: Int.MIN_VALUE
        val resultData: Intent? = intent?.parcelable(EXTRA_PROJECTION_DATA)
        val hasProjectionGrant = resultCode == Activity.RESULT_OK && resultData != null

        if (hasProjectionGrant) {
            attachDedicatedProjection(resultCode, resultData!!)
        } else {
            promoteForeground(withProjection = ownedProjection != null)
        }

        BetterDeskCdapAgent.start(this)
        return START_STICKY
    }

    @SuppressLint("InlinedApi")
    private fun promoteForeground(withProjection: Boolean) {
        val deviceId = BetterDeskCdapAgent.getDeviceId(this)
        val notification = NotificationHelper.createServiceNotification(
            context = this,
            title = "MindConnect Desk Agent Online",
            description = "ID: $deviceId • ${BetterDeskAgentConfig.idServer}",
        )
        val fgsType = if (withProjection) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC or ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
        } else {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
        }
        runCatching {
            ServiceCompat.startForeground(this, notificationId, notification, fgsType)
        }.onFailure {
            LogCat.w("BetterDeskAgentService startForeground warning: ${it.message}")
        }
    }

    @SuppressLint("InlinedApi")
    private fun attachDedicatedProjection(resultCode: Int, resultData: Intent) {
        val deviceId = BetterDeskCdapAgent.getDeviceId(this)
        val notification = NotificationHelper.createServiceNotification(
            context = this,
            title = "MindConnect Desk Agent Online",
            description = "ID: $deviceId • ${BetterDeskAgentConfig.idServer}",
        )
        val fgsType = ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC or ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION

        var projection: MediaProjection? = null
        try {
            ServiceCompat.startForeground(this, notificationId, notification, fgsType)
        } catch (se: SecurityException) {
            LogCat.w("BetterDeskAgentService projection FGS AppOp fallback: ${se.message}")
            projection = runCatching { mediaProjectionManager.getMediaProjection(resultCode, resultData) }.getOrNull()
            if (projection != null) {
                runCatching {
                    ServiceCompat.startForeground(this, notificationId, notification, fgsType)
                }.onFailure {
                    LogCat.e("BetterDeskAgentService FGS retry failed: ${it.message}")
                    projection.stop()
                    promoteForeground(withProjection = false)
                    return
                }
            } else {
                promoteForeground(withProjection = false)
                return
            }
        }

        if (projection == null) {
            projection = runCatching { mediaProjectionManager.getMediaProjection(resultCode, resultData) }.getOrElse {
                LogCat.e("BetterDeskAgentService getMediaProjection failed: ${it.message}")
                null
            }
        }

        if (projection == null) {
            promoteForeground(withProjection = false)
            return
        }

        runCatching { ownedProjection?.stop() }
        ownedProjection = projection
        projection.registerCallback(object : MediaProjection.Callback() {
            override fun onStop() {
                if (ownedProjection === projection) {
                    ownedProjection = null
                    BetterDeskCdapAgent.attachMediaProjection(null, fromAgentService = true)
                    promoteForeground(withProjection = false)
                }
            }
        }, Handler(Looper.getMainLooper()))
        BetterDeskCdapAgent.attachMediaProjection(projection, fromAgentService = true)
    }

    override fun onDestroy() {
        instance = null
        runCatching { ownedProjection?.stop() }
        ownedProjection = null
        BetterDeskCdapAgent.attachMediaProjection(null, fromAgentService = true)
        BetterDeskCdapAgent.stop()
        super.onDestroy()
    }

    companion object {
        private const val EXTRA_PROJECTION_CODE = "agent_projection_code"
        private const val EXTRA_PROJECTION_DATA = "agent_projection_data"
        private val notificationId: Int by lazy { NotificationHelper.generateId() }

        @Volatile
        private var instance: BetterDeskAgentService? = null

        fun start(context: Context) {
            BetterDeskCdapAgent.start(context)
            runCatching {
                ContextCompat.startForegroundService(
                    context,
                    Intent(context, BetterDeskAgentService::class.java),
                )
            }
        }

        fun grantScreenCapture(context: Context, resultCode: Int, data: Intent) {
            val intent = Intent(context, BetterDeskAgentService::class.java).apply {
                putExtra(EXTRA_PROJECTION_CODE, resultCode)
                putExtra(EXTRA_PROJECTION_DATA, data)
            }
            runCatching {
                ContextCompat.startForegroundService(context, intent)
            }
        }
    }
}
