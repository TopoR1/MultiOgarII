const Mode = require('./Mode');

class FFA extends Mode {
    constructor() {
        super();
        this.ID = 0;
        this.name = "Free For All";
        this.specByLeaderboard = true;
    }
    // Gamemode Specific Functions
    onPlayerSpawn(server, player) {
        player.color = server.getRandomColor();
        // Spawn player
        server.spawnPlayer(player, server.randomPos());
    }
    updateLB(server, lb) {
        server.leaderboardType = this.packetLB;
        for (let i = 0, pos = 0; i < server.clients.length; i++) {
            const player = server.clients[i].playerTracker;
            if (player.isRemoved || !player.cells.length ||
                player.socket.isConnected == false || (!server.config.minionsOnLeaderboard && player.isMi))
                continue;
            for (let j = 0; j < pos; j++)
                if (lb[j]._score < player._score)
                    break;
            lb.splice(j, 0, player);
            pos++;
        }
        this.rankOne = lb[0];
    }
}

module.exports = FFA;
FFA.prototype = new Mode();
