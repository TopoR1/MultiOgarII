const BinaryWriter = require("./BinaryWriter");

class ClearAll {
    build() {
        const writer = new BinaryWriter();
        writer.writeUInt8(0x12);
        return writer.toBuffer();
    }
}

module.exports = ClearAll;
