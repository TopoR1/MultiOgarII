class SetBorder {
    constructor(playerTracker, border, gameType, serverName) {
        this.playerTracker = playerTracker;
        this.border = border;
        this.gameType = gameType;
        this.serverName = serverName;
    }
    build(protocol) {
        const scrambleX = this.playerTracker.scrambleX;
        const scrambleY = this.playerTracker.scrambleY;
        if (this.gameType == null) {
            const buffer = Buffer.alloc(33);
            buffer.writeUInt8(0x40, 0, true);
            buffer.writeDoubleLE(this.border.minx + scrambleX, 1, true);
            buffer.writeDoubleLE(this.border.miny + scrambleY, 9, true);
            buffer.writeDoubleLE(this.border.maxx + scrambleX, 17, true);
            buffer.writeDoubleLE(this.border.maxy + scrambleY, 25, true);
            return buffer;
        }
        const BinaryWriter = require("./BinaryWriter");
        const writer = new BinaryWriter();
        writer.writeUInt8(0x40); // Packet ID
        writer.writeDouble(this.border.minx + scrambleX);
        writer.writeDouble(this.border.miny + scrambleY);
        writer.writeDouble(this.border.maxx + scrambleX);
        writer.writeDouble(this.border.maxy + scrambleY);
        writer.writeUInt32(this.gameType >> 0);
        let name = this.serverName;
        if (name == null)
            name = "";
        if (protocol < 6)
            writer.writeStringZeroUnicode(name);
        else
            writer.writeStringZeroUtf8(name);
        return writer.toBuffer();
    }
}

module.exports = SetBorder;
