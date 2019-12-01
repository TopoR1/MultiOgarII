class ServerStat {
    constructor(playerTracker) {
        this.playerTracker = playerTracker;
    }
    build(protocol) {
        const server = this.playerTracker.server;
        // Get server statistics
        let totalPlayers = 0;
        let alivePlayers = 0;
        let spectPlayers = 0;
        for (let i = 0; i < server.clients.length; i++) {
            const socket = server.clients[i];
            if (socket == null || !socket.isConnected)
                continue;
            totalPlayers++;
            if (socket.playerTracker.cells.length > 0)
                alivePlayers++;
            else
                spectPlayers++;
        }
        const obj = {
            'name': server.config.serverName,
            'mode': server.mode.name,
            'uptime': Math.round((server.stepDateTime - server.startTime) / 1000),
            'update': server.updateTimeAvg.toFixed(3),
            'playersTotal': totalPlayers,
            'playersAlive': alivePlayers,
            'playersSpect': spectPlayers,
            'playersLimit': server.config.serverMaxConnections
        };
        const json = JSON.stringify(obj);
        // Serialize
        const BinaryWriter = require("./BinaryWriter");
        const writer = new BinaryWriter();
        writer.writeUInt8(254); // Message Id
        writer.writeStringZeroUtf8(json); // JSON
        return writer.toBuffer();
    }
}

module.exports = ServerStat;
