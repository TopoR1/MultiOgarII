// Library imports
const http = require('http');

// Project imports
const Entity = require('./entity');
const Vec2 = require('./modules/Vec2');
const Logger = require('./modules/Logger');
let {QuadNode, Quad} = require('./modules/QuadNode.js');

// Server implementation
class Server {
    constructor() {
        // Location of source files - For renaming or moving source files!
        this.srcFiles = "../src";

        // Startup
        this.run = true;
        this.version = '1.6.2';
        this.httpServer = null;
        this.lastNodeId = 1;
        this.lastPlayerId = 1;
        this.clients = [];
        this.socketCount = 0;
        this.largestClient = null; // Required for spectators
        this.nodes = []; // Total nodes
        this.nodesVirus = []; // Virus nodes
        this.nodesFood = []; // Food nodes
        this.nodesEjected = []; // Ejected nodes
        this.nodesPlayer = []; // Player nodes
        this.movingNodes = []; // For move engine
        this.leaderboard = []; // For leaderboard
        this.leaderboardType = -1; // No type
        const BotLoader = require('./ai/BotLoader');
        this.bots = new BotLoader(this);

        // Main loop tick
        this.startTime = Date.now();
        this.stepDateTime = 0;
        this.timeStamp = 0;
        this.updateTime = 0;
        this.updateTimeAvg = 0;
        this.timerLoopBind = null;
        this.mainLoopBind = null;
        this.ticks = 0;
        this.disableSpawn = false;

        // Config
        this.config = require("./config.js");
        this.ipBanList = [];
        this.minionTest = [];
        this.userList = [];
        this.badWords = [];
        this.loadFiles();

        // Set border, quad-tree
        this.setBorder(this.config.borderWidth, this.config.borderHeight);
        this.quadTree = new QuadNode(this.border);
    }
    start() {
        this.timerLoopBind = this.timerLoop.bind(this);
        this.mainLoopBind = this.mainLoop.bind(this);
        // Set up gamemode(s)
        const Gamemode = require('./gamemodes');
        this.mode = Gamemode.get(this.config.serverGamemode);
        this.mode.onServerInit(this);
        // Client Binding
        const bind = `${this.config.clientBind}`;
        this.clientBind = bind.split(' - ');
        // Start the server
        this.httpServer = http.createServer();
        const wsOptions = {
            server: this.httpServer,
            perMessageDeflate: false,
            maxPayload: 4096
        };
        Logger.info(`WebSocket: ${this.config.serverWsModule}`);
        this.WebSocket = require(this.config.serverWsModule);
        this.wsServer = new this.WebSocket.Server(wsOptions);
        this.wsServer.on('error', this.onServerSocketError.bind(this));
        this.wsServer.on('connection', this.onClientSocketOpen.bind(this));
        this.httpServer.listen(
            this.config.serverPort,
            this.config.serverBind,
            this.onHttpServerOpen.bind(this)
        );
        // Start stats port (if needed)
        if (this.config.serverStatsPort > 0) {
            this.startStatsServer(this.config.serverStatsPort);
        }
    }
    onHttpServerOpen() {
        // Start Main Loop
        setTimeout(this.timerLoopBind, 1);
        // Done
        Logger.info(`Game server started, on port ${this.config.serverPort}`);
        Logger.info(`Current game mode is ${this.mode.name}`);
        // Player bots (Experimental)
        if (this.config.serverBots) {
            for (let i = 0; i < this.config.serverBots; i++)
                this.bots.addBot();
            Logger.info(`Added ${this.config.serverBots} player bots`);
        }
        this.spawnCells(this.config.virusAmount, this.config.foodAmount);
    }
    addNode(node) {
        // Add to quad-tree & node list
        const x = node.position.x;
        const y = node.position.y;
        const s = node._size;
        node.quadItem = {
            cell: node,
            bound: new Quad(x - s, y - s, x + s, y + s)
        };
        this.quadTree.insert(node.quadItem);
        this.nodes.push(node);
        // Special on-add actions
        node.onAdd(this);
    }
    onServerSocketError(error) {
        Logger.error(`WebSocket: ${error.code} - ${error.message}`);
        switch (error.code) {
            case "EADDRINUSE":
                Logger.error(`Server could not bind to port ${this.config.serverPort}!`);
                Logger.error(
                    "Please close out of Skype or change 'serverPort' in the config to a different number."
                );
                break;
            case "EACCES":
                Logger.error("Please make sure you are running MultiOgarII with root privileges.");
                break;
        }
        process.exit(1); // Exits the program
    }
    onClientSocketOpen(ws, req) {
        const req = req || ws.upgradeReq;
        const logip = `${ws._socket.remoteAddress}:${ws._socket.remotePort}`;
        ws.on('error', err => {
            Logger.writeError(`[${logip}] ${err.stack}`);
        });
        if (this.config.serverMaxConnections && this.socketCount >= this.config.serverMaxConnections) {
            ws.close(1000, "No slots");
            return;
        }
        if (this.checkIpBan(ws._socket.remoteAddress)) {
            ws.close(1000, "IP banned");
            return;
        }
        if (this.config.serverIpLimit) {
            let ipConnections = 0;
            for (let i = 0; i < this.clients.length; i++) {
                const socket = this.clients[i];
                if (!socket.isConnected || socket.remoteAddress != ws._socket.remoteAddress)
                    continue;
                ipConnections++;
            }
            if (ipConnections >= this.config.serverIpLimit) {
                ws.close(1000, "IP limit reached");
                return;
            }
        }
        if (this.config.clientBind.length && req.headers.origin.indexOf(this.clientBind) < 0) {
            ws.close(1000, "Client not allowed");
            return;
        }
        ws.isConnected = true;
        ws.remoteAddress = ws._socket.remoteAddress;
        ws.remotePort = ws._socket.remotePort;
        ws.lastAliveTime = Date.now();
        Logger.write(
            `CONNECTED ${ws.remoteAddress}:${ws.remotePort}, origin: "${req.headers.origin}"`
        );
        const PlayerTracker = require('./PlayerTracker');
        ws.playerTracker = new PlayerTracker(this, ws);
        const PacketHandler = require('./PacketHandler');
        ws.packetHandler = new PacketHandler(this, ws);
        const PlayerCommand = require('./modules/PlayerCommand');
        ws.playerCommand = new PlayerCommand(this, ws.playerTracker);
        const self = this;
        ws.on('message', message => {
            if (self.config.serverWsModule === "uws")
                // uws gives ArrayBuffer - convert it to Buffer
                message = parseInt(process.version[1]) < 6 ? Buffer.from(message) : Buffer.from(message);
            if (!message.length)
                return;
            if (message.length > 256) {
                ws.close(1009, "Spam");
                return;
            }
            ws.packetHandler.handleMessage(message);
        });
        ws.on('error', error => {
            ws.packetHandler.sendPacket = function(data) { };
        });
        ws.on('close', reason => {
            if (ws._socket && ws._socket.destroy != null && typeof ws._socket.destroy == 'function') {
                ws._socket.destroy();
            }
            self.socketCount--;
            ws.isConnected = false;
            ws.packetHandler.sendPacket = function(data) { };
            ws.closeReason = {
                reason: ws._closeCode,
                message: ws._closeMessage
            };
            ws.closeTime = Date.now();
            Logger.write(
                `DISCONNECTED ${ws.remoteAddress}:${ws.remotePort}, code: ${ws._closeCode}, reason: "${ws._closeMessage}", name: "${ws.playerTracker._name}"`
            );
        });
        this.socketCount++;
        this.clients.push(ws);
        // Check for external minions
        this.checkMinion(ws, req);
    }
    checkMinion(ws, req) {
        // Check headers (maybe have a config for this?)
        if (!req.headers['user-agent'] || !req.headers['cache-control'] ||
            req.headers['user-agent'].length < 50) {
            ws.playerTracker.isMinion = true;
        }
        // External minion detection
        if (this.config.serverMinionThreshold) {
            if ((ws.lastAliveTime - this.startTime) / 1000 >= this.config.serverMinionIgnoreTime) {
                if (this.minionTest.length >= this.config.serverMinionThreshold) {
                    ws.playerTracker.isMinion = true;
                    for (let i = 0; i < this.minionTest.length; i++) {
                        const playerTracker = this.minionTest[i];
                        if (!playerTracker.socket.isConnected)
                            continue;
                        playerTracker.isMinion = true;
                    }
                    if (this.minionTest.length)
                        this.minionTest.splice(0, 1);
                }
                this.minionTest.push(ws.playerTracker);
            }
        }
        // Add server minions if needed
        if (this.config.serverMinions && !ws.playerTracker.isMinion) {
            for (let i = 0; i < this.config.serverMinions; i++) {
                this.bots.addMinion(ws.playerTracker);
            }
        }
    }
    checkIpBan(ipAddress) {
        if (!this.ipBanList || !this.ipBanList.length || ipAddress == "127.0.0.1") {
            return false;
        }
        if (this.ipBanList.indexOf(ipAddress) >= 0) {
            return true;
        }
        const ipBin = ipAddress.split('.');
        if (ipBin.length != 4) {
            // unknown IP format
            return false;
        }
        const subNet2 = `${ipBin[0]}.${ipBin[1]}.*.*`;
        if (this.ipBanList.indexOf(subNet2) >= 0) {
            return true;
        }
        const subNet1 = `${ipBin[0]}.${ipBin[1]}.${ipBin[2]}.*`;
        if (this.ipBanList.indexOf(subNet1) >= 0) {
            return true;
        }
        return false;
    }
    setBorder(width, height) {
        const hw = width / 2;
        const hh = height / 2;
        this.border = new Quad(-hw, -hh, hw, hh);
        this.border.width = width;
        this.border.height = height;
    }
    getRandomColor() {
        // get random
        const colorRGB = [0xFF, 0x07, (Math.random() * 256) >> 0];
        colorRGB.sort(() => {
            return 0.5 - Math.random();
        });
        // return random
        return {
            r: colorRGB[0],
            g: colorRGB[1],
            b: colorRGB[2]
        };
    }
    removeNode(node) {
        // Remove from quad-tree
        node.isRemoved = true;
        this.quadTree.remove(node.quadItem);
        node.quadItem = null;
        // Remove from node lists
        let i = this.nodes.indexOf(node);
        if (i > -1)
            this.nodes.splice(i, 1);
        i = this.movingNodes.indexOf(node);
        if (i > -1)
            this.movingNodes.splice(i, 1);
        // Special on-remove actions
        node.onRemove(this);
    }
    updateClients() {
        // check dead clients
        const len = this.clients.length;
        for (let i = 0; i < len;) {
            if (!this.clients[i]) {
                i++;
                continue;
            }
            this.clients[i].playerTracker.checkConnection();
            if (this.clients[i].playerTracker.isRemoved || this.clients[i].isCloseRequest)
                // remove dead client
                this.clients.splice(i, 1);
            else
                i++;
        }
        // update
        for (let i = 0; i < len; i++) {
            if (!this.clients[i])
                continue;
            this.clients[i].playerTracker.updateTick();
        }
        for (let i = 0; i < len; i++) {
            if (!this.clients[i])
                continue;
            this.clients[i].playerTracker.sendUpdate();
        }
        // check minions
        for (let i = 0, test = this.minionTest.length; i < test;) {
            if (!this.minionTest[i]) {
                i++;
                continue;
            }
            const date = new Date() - this.minionTest[i].connectedTime;
            if (date > this.config.serverMinionInterval)
                this.minionTest.splice(i, 1);
            else
                i++;
        }
    }
    updateLeaderboard() {
        // Update leaderboard with the gamemode's method
        this.leaderboard = [];
        this.leaderboardType = -1;
        this.mode.updateLB(this, this.leaderboard);
        if (!this.mode.specByLeaderboard) {
            // Get client with largest score if gamemode doesn't have a leaderboard
            const clients = this.clients.valueOf();
            // Use sort function
            clients.sort((a, b) => {
                return b.playerTracker._score - a.playerTracker._score;
            });
            this.largestClient = null;
            if (clients[0])
                this.largestClient = clients[0].playerTracker;
        }
        else {
            this.largestClient = this.mode.rankOne;
        }
    }
    onChatMessage(from, to, message) {
        if (!message || !(message = message.trim()))
            return;
        if (!this.config.serverChat || (from && from.isMuted)) {
            // chat is disabled or player is muted
            return;
        }
        if (from && message.length && message[0] == '/') {
            // player command
            from.socket.playerCommand.processMessage(from, message);
            return;
        }
        if (message.length > 64) {
            message = message.slice(0, 64);
        }
        if (this.config.serverChatAscii) {
            for (let i = 0; i < message.length; i++) {
                if ((message.charCodeAt(i) < 0x20 || message.charCodeAt(i) > 0x7F) && from) {
                    this.sendChatMessage(null, from, "Message failed - You can use ASCII text only!");
                    return;
                }
            }
        }
        if (this.checkBadWord(message) && from && this.config.badWordFilter === 1) {
            this.sendChatMessage(
                null,
                from,
                "Message failed - Stop insulting others! Keep calm and be friendly please."
            );
            return;
        }
        this.sendChatMessage(from, to, message);
    }
    checkBadWord(value) {
        if (!value)
            return false;
        value = ` ${value.toLowerCase().trim()} `;
        for (let i = 0; i < this.badWords.length; i++) {
            if (value.indexOf(this.badWords[i]) >= 0) {
                return true;
            }
        }
        return false;
    }
    sendChatMessage(from, to, message) {
        for (let i = 0, len = this.clients.length; i < len; i++) {
            if (!this.clients[i])
                continue;
            if (!to || to == this.clients[i].playerTracker) {
                const Packet = require('./packet');
                if (this.config.separateChatForTeams && this.mode.haveTeams) {
                    //  from equals null if message from server
                    if (from == null || from.team === this.clients[i].playerTracker.team) {
                        this.clients[i].packetHandler.sendPacket(new Packet.ChatMessage(from, message));
                    }
                }
                else {
                    this.clients[i].packetHandler.sendPacket(new Packet.ChatMessage(from, message));
                }
            }
        }
    }
    timerLoop() {
        const timeStep = 40; // vanilla: 40
        const ts = Date.now();
        const dt = ts - this.timeStamp;
        if (dt < timeStep - 5) {
            setTimeout(this.timerLoopBind, timeStep - 5);
            return;
        }
        if (dt > 120)
            this.timeStamp = ts - timeStep;
        // update average, calculate next
        this.updateTimeAvg += 0.5 * (this.updateTime - this.updateTimeAvg);
        this.timeStamp += timeStep;
        setTimeout(this.mainLoopBind, 0);
        setTimeout(this.timerLoopBind, 0);
    }
    mainLoop() {
        this.stepDateTime = Date.now();
        const tStart = process.hrtime();
        const self = this;
        // Restart
        if (this.ticks > this.config.serverRestart) {
            this.httpServer = null;
            this.wsServer = null;
            this.run = true;
            this.lastNodeId = 1;
            this.lastPlayerId = 1;
            for (let i = 0; i < this.clients.length; i++) {
                const client = this.clients[i];
                client.close();
            }
            ;
            this.nodes = [];
            this.nodesVirus = [];
            this.nodesFood = [];
            this.nodesEjected = [];
            this.nodesPlayer = [];
            this.movingNodes = [];
            if (this.config.serverBots) {
                for (let i = 0; i < this.config.serverBots; i++)
                    this.bots.addBot();
                Logger.info(`Added ${this.config.serverBots} player bots`);
            }
            ;
            this.commands;
            this.ticks = 0;
            this.startTime = Date.now();
            this.setBorder(this.config.borderWidth, this.config.borderHeight);
            this.quadTree = new QuadNode(this.border, 64, 32);
        }
        ;
        // Loop main functions
        if (this.run) {
            // Move moving nodes first
            this.movingNodes.forEach((cell) => {
                if (cell.isRemoved)
                    return;
                // Scan and check for ejected mass / virus collisions
                this.boostCell(cell);
                this.quadTree.find(cell.quadItem.bound, check => {
                    const m = self.checkCellCollision(cell, check);
                    if (cell.type == 3 && check.type == 3 && !self.config.mobilePhysics)
                        self.resolveRigidCollision(m);
                    else
                        self.resolveCollision(m);
                });
                if (!cell.isMoving)
                    this.movingNodes = null;
            });
            // Update players and scan for collisions
            const eatCollisions = [];
            this.nodesPlayer.forEach((cell) => {
                if (cell.isRemoved)
                    return;
                // Scan for eat/rigid collisions and resolve them
                this.quadTree.find(cell.quadItem.bound, check => {
                    const m = self.checkCellCollision(cell, check);
                    if (self.checkRigidCollision(m))
                        self.resolveRigidCollision(m);
                    else if (check != cell)
                        eatCollisions.unshift(m);
                });
                this.movePlayer(cell, cell.owner);
                this.boostCell(cell);
                this.autoSplit(cell, cell.owner);
                // Decay player cells once per second
                if (((this.ticks + 3) % 25) === 0)
                    this.updateSizeDecay(cell);
                // Remove external minions if necessary
                if (cell.owner.isMinion) {
                    cell.owner.socket.close(1000, "Minion");
                    this.removeNode(cell);
                }
            });
            eatCollisions.forEach((m) => {
                this.resolveCollision(m);
            });
            this.mode.onTick(this);
            this.ticks++;
        }
        if (!this.run && this.mode.IsTournament)
            this.ticks++;
        this.updateClients();
        // update leaderboard
        if (((this.ticks + 7) % 25) === 0)
            this.updateLeaderboard(); // once per second
        // ping server tracker
        if (this.config.serverTracker && (this.ticks % 750) === 0)
            this.pingServerTracker(); // once per 30 seconds
        // update-update time
        const tEnd = process.hrtime(tStart);
        this.updateTime = tEnd[0] * 1e3 + tEnd[1] / 1e6;
    }
    // update remerge first
    movePlayer(cell, client) {
        if (client.socket.isConnected == false || client.frozen || !client.mouse)
            return; // Do not move
        // get movement from vector
        const d = client.mouse.difference(cell.position);
        const move = cell.getSpeed(d.dist()); // movement speed
        if (!move)
            return; // avoid jittering
        cell.position.add(d.product(move));
        // update remerge
        const time = this.config.playerRecombineTime, base = Math.max(time, cell._size * 0.2) * 25;
        // instant merging conditions
        if (!time || client.rec || client.mergeOverride) {
            cell._canRemerge = cell.boostDistance < 100;
            return; // instant merge
        }
        // regular remerge time
        cell._canRemerge = cell.getAge() >= base;
    }
    // decay player cells
    updateSizeDecay(cell) {
        let rate = this.config.playerDecayRate, cap = this.config.playerDecayCap;
        if (!rate || cell._size <= this.config.playerMinSize)
            return;
        // remove size from cell at decay rate
        if (cap && cell._mass > cap)
            rate *= 10;
        const decay = 1 - rate * this.mode.decayMod;
        cell.setSize(Math.sqrt(cell.radius * decay));
    }
    boostCell(cell) {
        if (cell.isMoving && !cell.boostDistance || cell.isRemoved) {
            cell.boostDistance = 0;
            cell.isMoving = false;
            return;
        }
        // decay boost-speed from distance
        const speed = cell.boostDistance / 9; // val: 87
        cell.boostDistance -= speed; // decays from speed
        cell.position.add(cell.boostDirection.product(speed));
        // update boundries
        cell.checkBorder(this.border);
        this.updateNodeQuad(cell);
    }
    autoSplit(cell, client) {
        // get size limit based off of rec mode
        if (client.rec)
            let maxSize = 1e9; // increase limit for rec (1 bil)
        else
            maxSize = this.config.playerMaxSize;
        // check size limit
        if (client.mergeOverride || cell._size < maxSize)
            return;
        if (client.cells.length >= this.config.playerMaxCells || this.config.mobilePhysics) {
            // cannot split => just limit
            cell.setSize(maxSize);
        }
        else {
            // split in random direction
            const angle = Math.random() * 2 * Math.PI;
            this.splitPlayerCell(client, cell, angle, cell._mass * .5);
        }
    }
    updateNodeQuad(node) {
        // update quad tree
        const item = node.quadItem.bound;
        item.minx = node.position.x - node._size;
        item.miny = node.position.y - node._size;
        item.maxx = node.position.x + node._size;
        item.maxy = node.position.y + node._size;
        this.quadTree.remove(node.quadItem);
        this.quadTree.insert(node.quadItem);
    }
    // Checks cells for collision
    checkCellCollision(cell, check) {
        const p = check.position.difference(cell.position);
        // create collision manifold
        return {
            cell: cell,
            check: check,
            d: p.dist(),
            p: p // check - cell position
        };
    }
    // Checks if collision is rigid body collision
    checkRigidCollision(m) {
        if (!m.cell.owner || !m.check.owner)
            return false;
        if (m.cell.owner != m.check.owner) {
            // Minions don't collide with their team when the config value is 0
            if (this.mode.haveTeams && m.check.owner.isMi || m.cell.owner.isMi && this.config.minionCollideTeam === 0) {
                return false;
            }
            else {
                // Different owners => same team
                return this.mode.haveTeams &&
                    m.cell.owner.team == m.check.owner.team;
            }
        }
        const r = this.config.mobilePhysics ? 1 : 13;
        if (m.cell.getAge() < r || m.check.getAge() < r) {
            return false; // just splited => ignore
        }
        return !m.cell._canRemerge || !m.check._canRemerge;
    }
    // Resolves rigid body collisions
    resolveRigidCollision(m) {
        const push = (m.cell._size + m.check._size - m.d) / m.d;
        if (push <= 0 || m.d == 0)
            return; // do not extrude
        // body impulse
        const rt = m.cell.radius + m.check.radius;
        const r1 = push * m.cell.radius / rt;
        const r2 = push * m.check.radius / rt;
        // apply extrusion force
        m.cell.position.subtract(m.p.product(r2));
        m.check.position.add(m.p.product(r1));
    }
    // Resolves non-rigid body collision
    resolveCollision(m) {
        let cell = m.cell;
        let check = m.check;
        if (cell._size > check._size) {
            cell = m.check;
            check = m.cell;
        }
        // Do not resolve removed
        if (cell.isRemoved || check.isRemoved)
            return;
        // check eating distance
        check.div = this.config.mobilePhysics ? 20 : 3;
        if (m.d >= check._size - cell._size / check.div) {
            return; // too far => can't eat
        }
        // collision owned => ignore, resolve, or remerge
        if (cell.owner && cell.owner == check.owner) {
            if (cell.getAge() < 13 || check.getAge() < 13)
                return; // just splited => ignore
        }
        else if (check._size < cell._size * 1.15 || !check.canEat(cell))
            return; // Cannot eat or cell refuses to be eaten
        // Consume effect
        check.onEat(cell);
        cell.onEaten(check);
        cell.killer = check;
        // Remove cell
        this.removeNode(cell);
    }
    splitPlayerCell(client, parent, angle, mass) {
        const size = Math.sqrt(mass * 100);
        const size1 = Math.sqrt(parent.radius - size * size);
        // Too small to split
        if (!size1 || size1 < this.config.playerMinSize)
            return;
        // Remove size from parent cell
        parent.setSize(size1);
        // Create cell and add it to node list
        const newCell = new Entity.PlayerCell(this, client, parent.position, size);
        newCell.setBoost(this.config.splitVelocity * Math.pow(size, 0.0122), angle);
        this.addNode(newCell);
    }
    randomPos() {
        return new Vec2(this.border.minx + this.border.width * Math.random(),
            this.border.miny + this.border.height * Math.random());
    }
    spawnFood() {
        const cell = new Entity.Food(this, null, this.randomPos(), this.config.foodMinSize);
        if (this.config.foodMassGrow) {
            const maxGrow = this.config.foodMaxSize - cell._size;
            cell.setSize(cell._size += maxGrow * Math.random());
        }
        cell.color = this.getRandomColor();
        this.addNode(cell);
    }
    spawnVirus() {
        const virus = new Entity.Virus(this, null, this.randomPos(), this.config.virusMinSize);
        if (!this.willCollide(virus))
            this.addNode(virus);
    }
    spawnCells(virusCount, foodCount) {
        for (let i = 0; i < foodCount; i++) {
            this.spawnFood();
        }
        for (let ii = 0; ii < virusCount; ii++) {
            this.spawnVirus();
        }
    }
    spawnPlayer(player, pos) {
        if (this.disableSpawn)
            return; // Not allowed to spawn!
        // Check for special starting size
        let size = this.config.playerStartSize;
        if (player.spawnmass)
            size = player.spawnmass;
        // Check if can spawn from ejected mass
        const index = ~~(this.nodesEjected.length * Math.random());
        const eject = this.nodesEjected[index]; // Randomly selected
        if (Math.random() <= this.config.ejectSpawnPercent &&
            eject && eject.boostDistance < 1) {
            // Spawn from ejected mass
            pos = eject.position.clone();
            player.color = eject.color;
            size = Math.max(size, eject._size * 1.15);
        }
        // Spawn player safely (do not check minions)
        const cell = new Entity.PlayerCell(this, player, pos, size);
        if (this.willCollide(cell) && !player.isMi)
            pos = this.randomPos(); // Not safe => retry
        this.addNode(cell);
        // Set initial mouse coords
        player.mouse.assign(pos);
    }
    willCollide(cell) {
        let x = cell.position.x;
        let y = cell.position.y;
        const r = cell._size;
        const bound = new Quad(x - r, y - r, x + r, y + r);
        return this.quadTree.find(bound, n => n.type == 0);
    }
    splitCells(client) {
        // Split cell order decided by cell age
        const cellToSplit = [];
        for (let i = 0; i < client.cells.length; i++)
            cellToSplit.push(client.cells[i]);
        // Split split-able cells
        cellToSplit.forEach((cell) => {
            const d = client.mouse.difference(cell.position);
            if (d.distSquared() < 1) {
                d.x = 1, d.y = 0;
            }
            if (cell._size < this.config.playerMinSplitSize)
                return; // cannot split
            // Get maximum cells for rec mode
            if (client.rec)
                let max = 200; // rec limit
            else
                max = this.config.playerMaxCells;
            if (client.cells.length >= max)
                return;
            // Now split player cells
            this.splitPlayerCell(client, cell, d.angle(), cell._mass * .5);
        });
    }
    canEjectMass(client) {
        if (client.lastEject === null) {
            // first eject
            client.lastEject = this.ticks;
            return true;
        }
        const dt = this.ticks - client.lastEject;
        if (dt < this.config.ejectCooldown) {
            // reject (cooldown)
            return false;
        }
        client.lastEject = this.ticks;
        return true;
    }
    ejectMass(client) {
        if (!this.canEjectMass(client) || client.frozen)
            return;
        for (let i = 0; i < client.cells.length; i++) {
            const cell = client.cells[i];
            if (cell._size < this.config.playerMinEjectSize) continue;
            const loss = this.config.ejectSizeLoss;
            const newSize = cell.radius - loss * loss;
            const minSize = this.config.playerMinSize;
            if (newSize < 0 || newSize < minSize * minSize)
                continue; // Too small to eject
            cell.setSize(Math.sqrt(newSize));

            const d = client.mouse.difference(cell.position);
            const sq = d.dist();
            d.x = sq > 1 ? d.x / sq : 1;
            d.y = sq > 1 ? d.y / sq : 0;

            // Get starting position
            const pos = cell.position.sum(d.product(cell._size));
            const angle = d.angle() + (Math.random() * .6) - .3;
            // Create cell and add it to node list
            let ejected;
            if (this.config.ejectVirus) {
                ejected = new Entity.Virus(this, null, pos, this.config.ejectSize);
            } else {
                ejected = new Entity.EjectedMass(this, null, pos, this.config.ejectSize);
            }
            ejected.color = cell.color;
            ejected.setBoost(this.config.ejectVelocity, angle);
            this.addNode(ejected);
        }
    }
    shootVirus(parent, angle) {
        // Create virus and add it to node list
        const pos = parent.position.clone();
        const newVirus = new Entity.Virus(this, null, pos, this.config.virusMinSize);
        newVirus.setBoost(this.config.virusVelocity, angle);
        this.addNode(newVirus);
    }
    loadFiles() {
        const fs = require("fs")
        //Logger.setVerbosity(this.config.logVerbosity);
        //Logger.setFileVerbosity(this.config.logFileVerbosity);
        // Load bad words
        const fileNameBadWords = `${this.srcFiles}/badwords.txt`;
        try {
            if (!fs.existsSync(fileNameBadWords)) {
                Logger.warn(`${fileNameBadWords} not found`);
            }
            else {
                let words = fs.readFileSync(fileNameBadWords, 'utf-8');
                words = words.split(/[\r\n]+/);
                words = words.map(arg => {
                    return ` ${arg.trim().toLowerCase()} `; // Formatting
                });
                words = words.filter(arg => {
                    return arg.length > 2;
                });
                this.badWords = words;
                Logger.info(`${this.badWords.length} bad words loaded`);
            }
        }
        catch (err) {
            Logger.error(err.stack);
            Logger.error(`Failed to load ${fileNameBadWords}: ${err.message}`);
        }
        // Load user list
        const UserRoleEnum = require(`${this.srcFiles}/enum/UserRoleEnum`);
        const fileNameUsers = `${this.srcFiles}/enum/userRoles.json`;
        try {
            this.userList = [];
            if (!fs.existsSync(fileNameUsers)) {
                Logger.warn(`${fileNameUsers} is missing.`);
                return;
            }
            const usersJson = fs.readFileSync(fileNameUsers, 'utf-8');
            const list = JSON.parse(usersJson.trim());
            for (let i = 0; i < list.length;) {
                const item = list[i];
                if (!item.hasOwnProperty("ip") ||
                    !item.hasOwnProperty("password") ||
                    !item.hasOwnProperty("role") ||
                    !item.hasOwnProperty("name")) {
                    list.splice(i, 1);
                    continue;
                }
                if (!item.password || !item.password.trim()) {
                    Logger.warn(`User account "${item.name}" disabled`);
                    list.splice(i, 1);
                    continue;
                }
                if (item.ip)
                    item.ip = item.ip.trim();
                item.password = item.password.trim();
                if (!UserRoleEnum.hasOwnProperty(item.role)) {
                    Logger.warn(`Unknown user role: ${item.role}`);
                    item.role = UserRoleEnum.USER;
                }
                else {
                    item.role = UserRoleEnum[item.role];
                }
                item.name = (item.name || "").trim();
                i++;
            }
            this.userList = list;
            Logger.info(`${this.userList.length} user records loaded.`);
        }
        catch (err) {
            Logger.error(err.stack);
            Logger.error(`Failed to load ${fileNameUsers}: ${err.message}`);
        }
        // Load ip ban list
        const fileNameIpBan = `${this.srcFiles}/ipbanlist.txt`;
        try {
            if (fs.existsSync(fileNameIpBan)) {
                // Load and input the contents of the ipbanlist file
                this.ipBanList = fs.readFileSync(fileNameIpBan, "utf8").split(/[\r\n]+/).filter(x => {
                    return x != ''; // filter empty lines
                });
                Logger.info(`${this.ipBanList.length} IP ban records loaded.`);
            }
            else {
                Logger.warn(`${fileNameIpBan} is missing.`);
            }
        }
        catch (err) {
            Logger.error(err.stack);
            Logger.error(`Failed to load ${fileNameIpBan}: ${err.message}`);
        }
        // Convert config settings
        this.config.serverRestart = this.config.serverRestart === 0 ? 1e999 : this.config.serverRestart * 1500;
    }
    startStatsServer(port) {
        // Create stats
        this.stats = "Test";
        this.getStats();
        // Show stats
        this.httpServer = http.createServer(function(req, res) {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.writeHead(200);
            res.end(this.stats);
        }.bind(this));
        this.httpServer.on('error', err => {
            Logger.error(`Failed to start stats server: ${err.message}`);
        });
        const getStatsBind = this.getStats.bind(this);
        this.httpServer.listen(port, function() {
            // Stats server
            Logger.info(`Started stats server on port ${port}`);
            setInterval(getStatsBind, this.config.serverStatsUpdate * 1000);
        }.bind(this));
    }
    getStats() {
        // Get server statistics
        let totalPlayers = 0;
        let alivePlayers = 0;
        let spectatePlayers = 0;
        for (let i = 0, len = this.clients.length; i < len; i++) {
            const socket = this.clients[i];
            if (!socket || !socket.isConnected || socket.playerTracker.isMi)
                continue;
            totalPlayers++;
            if (socket.playerTracker.cells.length)
                alivePlayers++;
            else
                spectatePlayers++;
        }
        const s = {
            'server_name': this.config.serverName,
            'server_chat': this.config.serverChat ? "true" : "false",
            'border_width': this.border.width,
            'border_height': this.border.height,
            'gamemode': this.mode.name,
            'max_players': this.config.serverMaxConnections,
            'current_players': totalPlayers,
            'alive': alivePlayers,
            'spectators': spectatePlayers,
            'update_time': this.updateTimeAvg.toFixed(3),
            'uptime': Math.round((this.stepDateTime - this.startTime) / 1000 / 60),
            'start_time': this.startTime
        };
        this.stats = JSON.stringify(s);
    }
    // Pings the server tracker, should be called every 30 seconds
    // To list us on the server tracker located at http://ogar.mivabe.nl/master
    pingServerTracker() {
        // Get server statistics
        const os = require('os');
        let totalPlayers = 0;
        let alivePlayers = 0;
        let spectatePlayers = 0;
        let robotPlayers = 0;
        for (let i = 0, len = this.clients.length; i < len; i++) {
            const socket = this.clients[i];
            if (!socket || socket.isConnected == false)
                continue;
            if (socket.isConnected == null) {
                robotPlayers++;
            }
            else {
                totalPlayers++;
                if (socket.playerTracker.cells.length)
                    alivePlayers++;
                else
                    spectatePlayers++;
            }
        }
        // ogar.mivabe.nl/master
        const data = `current_players=${totalPlayers}&alive=${alivePlayers}&spectators=${spectatePlayers}&max_players=${this.config.serverMaxConnections}&sport=${this.config.serverPort}&gamemode=[**] ${this.mode.name}&agario=true&name=Unnamed Server&opp=${os.platform()} ${os.arch()}&uptime=${process.uptime()}&version=MultiOgarII ${this.version}&start_time=${this.startTime}`;
        trackerRequest({
            host: 'ogar.mivabe.nl',
            port: 80,
            path: '/master',
            method: 'POST'
        }, 'application/x-www-form-urlencoded', data);
    }
};

function trackerRequest(options, type, body) {
    if (options.headers == null) options.headers = {};
    options.headers['user-agent'] = `MultiOgarII${this.version}`;
    options.headers['content-type'] = type;
    options.headers['content-length'] = body == null ? 0 : Buffer.byteLength(body, 'utf8');
    const req = http.request(options, res => {
        if (res.statusCode != 200) {
            Logger.writeError(`[Tracker][${options.host}]: statusCode = ${res.statusCode}`);
            return;
        }
        res.setEncoding('utf8');
    });
    req.on('error', err => {
        Logger.writeError(`[Tracker][${options.host}]: ${err}`);
    });
    req.shouldKeepAlive = false;
    req.on('close', () => {
        req.destroy();
    });
    req.write(body);
    req.end();
}

module.exports = Server;
