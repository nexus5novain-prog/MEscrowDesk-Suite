package com.ismartcoding.plain.agent

/**
 * ID and Relay server configuration for connecting MEscrowDesk Android Agent
 * directly to BetterDesk ID/Relay servers over WAN / network infrastructure.
 */
object BetterDeskAgentConfig {
    @Volatile
    var idServer: String = "104.207.90.103"
        private set

    @Volatile
    var idPort: Int = 21116
        private set

    @Volatile
    var relayServer: String = "104.207.90.103"
        private set

    @Volatile
    var relayPort: Int = 21117
        private set

    @Volatile
    var apiUrl: String = "http://104.207.90.103:21121"
        private set

    @Volatile
    var cdapWsUrl: String = "ws://104.207.90.103:21122/cdap"
        private set

    @Volatile
    var serverPublicKey: String = "ddU+/IrwdxX+Y/CGwJK7Ap3/lGNvYrLMTXcizekHlWo="
        private set

    @Volatile
    var appVersion: String = "4.0.0"
        private set

    fun configure(
        idServer: String = BetterDeskAgentConfig.idServer,
        idPort: Int = BetterDeskAgentConfig.idPort,
        relayServer: String = BetterDeskAgentConfig.relayServer,
        relayPort: Int = BetterDeskAgentConfig.relayPort,
        apiUrl: String = BetterDeskAgentConfig.apiUrl,
        cdapWsUrl: String = BetterDeskAgentConfig.cdapWsUrl,
        serverPublicKey: String = BetterDeskAgentConfig.serverPublicKey,
        appVersion: String = BetterDeskAgentConfig.appVersion,
    ) {
        if (idServer.isNotBlank()) BetterDeskAgentConfig.idServer = idServer.trim()
        if (idPort > 0) BetterDeskAgentConfig.idPort = idPort
        if (relayServer.isNotBlank()) BetterDeskAgentConfig.relayServer = relayServer.trim()
        if (relayPort > 0) BetterDeskAgentConfig.relayPort = relayPort
        if (apiUrl.isNotBlank()) BetterDeskAgentConfig.apiUrl = apiUrl.trim().trimEnd('/')
        if (cdapWsUrl.isNotBlank()) BetterDeskAgentConfig.cdapWsUrl = cdapWsUrl.trim()
        if (serverPublicKey.isNotBlank()) BetterDeskAgentConfig.serverPublicKey = serverPublicKey.trim()
        if (appVersion.isNotBlank()) BetterDeskAgentConfig.appVersion = appVersion.trim()
    }
}
