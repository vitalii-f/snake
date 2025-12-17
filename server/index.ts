import type { Server } from "bun";
import { GameRoom } from './game/GameRoom';
import { handleRequest } from './routes';
import type { Player, Point } from './types';
import { prisma } from './prisma';
import { getRandomColor } from './config';

const rooms = {
    standard: new GameRoom('standard'),
    rewind: new GameRoom('rewind')
};

let server: Server<any>;

try {
    server = Bun.serve({
        port: 3021,
        async fetch(req, server) {
            if (server.upgrade(req)) return;
            return await handleRequest(req, server);
        },
        websocket: {
            open(ws) {
                ws.data = { id: crypto.randomUUID() };
                console.log(`Connection opened: ${ws.data.id}`);
            },
            async message(ws, message) {
                const id = (ws.data as any).id;
                const data = JSON.parse(message as string);

                if (data.type === 'join') {
                    const name = data.name || 'Guest';
                    const mode = (data.mode === 'rewind' ? 'rewind' : 'standard') as 'standard' | 'rewind';
                    const room = rooms[mode];

                    const color = data.color || getRandomColor();

                    const player: Player = {
                        id,
                        streak: 0,
                        xp: 0,
                        level: 1,
                        bestScore: 0,
                        achievements: [],
                        body: [{ x: 5, y: 5 }],
                        velocity: { x: 0, y: 0 },
                        color,
                        score: 0,
                        name,
                        lastMoveTime: Date.now(),
                        mode: mode,
                        hasMoved: false
                    };
                    room.resetPlayer(player);

                    // Validate Color
                    if (data.color && /^#[0-9A-F]{6}$/i.test(data.color)) {
                        const r = parseInt(data.color.slice(1, 3), 16);
                        const g = parseInt(data.color.slice(3, 5), 16);
                        const b = parseInt(data.color.slice(5, 7), 16);
                        const dist = Math.sqrt(Math.pow(r - 255, 2) + Math.pow(g - 0, 2) + Math.pow(b - 85, 2));
                        if (dist > 60) player.color = data.color;
                    }

                    // Enforce Unique Color in Room
                    const usedColors = new Set(Array.from(room.players.values()).map(p => p.color));
                    if (usedColors.has(player.color)) {
                        for (let i = 0; i < 20; i++) {
                            const randomColor = '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0').toUpperCase();
                            if (!usedColors.has(randomColor)) {
                                player.color = randomColor;
                                break;
                            }
                        }
                    }

                    // DB Load
                    try {
                        const dbPlayer = await prisma.player.upsert({
                            where: { nickname: name },
                            update: {},
                            create: { nickname: name }
                        });
                        player.dbId = dbPlayer.id;
                        player.xp = dbPlayer.xp;
                        player.level = dbPlayer.level;
                        player.bestScore = dbPlayer.bestScore;
                        player.achievements = JSON.parse(dbPlayer.achievements as string || '[]');
                        console.log(`Loaded profile for ${name} in ${mode}: Lvl ${player.level}`);
                    } catch (e) {
                        console.error("DB Error on Join:", e);
                    }

                    // Join Room
                    room.addPlayer(id, player);
                    ws.subscribe(`game-${mode}`);
                    ws.data.mode = mode; // Store mode in WS data for fast lookup
                    console.log(`Player ${name} (${id}) joined room ${mode}`);
                    return;
                }

                // Handle other messages
                const mode = (ws.data as any).mode;
                if (!mode) return; // Not joined yet
                const room = rooms[mode as 'standard' | 'rewind'];
                const player = room.players.get(id);
                if (!player) return;

                if (data.type === 'move') {
                    const { x, y } = data.direction;
                    // Prevent 180 turn
                    if (player.velocity.x + x === 0 && player.velocity.y + y === 0 && player.body.length > 1) {
                        return;
                    }
                    player.velocity = { x, y };
                    player.hasMoved = true;
                }

                if (data.type === 'rewind') {
                    if (room.mode !== 'rewind') return;
                    if (player.body.length <= 5) return;

                    player.body.pop();
                    player.body.pop();

                    room.restoreStateAndSpawnGhosts(player.id);
                    server.publish(`game-rewind`, JSON.stringify({ type: 'rewind_effect' }));
                }

                if (data.type === 'ping') {
                    ws.send(JSON.stringify({ type: 'pong', timestamp: data.timestamp }));
                }
            },
            close(ws) {
                const id = (ws.data as any).id;
                const mode = (ws.data as any).mode;
                if (mode && rooms[mode as 'standard' | 'rewind']) {
                    rooms[mode as 'standard' | 'rewind'].removePlayer(id);
                    console.log(`Player ${id} left room ${mode}`);
                }
            }
        }
    });

    console.log(`Listening on localhost:${server.port}`);
} catch (e) {
    console.error("FAILED TO START SERVER:", e);
    process.exit(1);
}

// Game Loop
setInterval(() => {
    rooms.standard.update(server);
    rooms.rewind.update(server);
}, 50);
