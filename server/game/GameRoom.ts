import type { Server } from "bun";
import type { Player, Ghost, GameSnapshot, Point } from '../types';
import { TILE_COUNT } from '../config';
import { savePlayerProgress } from '../db';

export class GameRoom {
    public players = new Map<string, Player>();
    public ghosts: Ghost[] = [];
    public history: GameSnapshot[] = [];
    public food: Point = { x: 10, y: 10 };
    public sessionHighScore = 0;
    public sessionBestPlayer = '';
    public mode: 'standard' | 'rewind';

    private HISTORY_BUFFER_SIZE = 100;
    private MOVE_INTERVAL = 100;

    constructor(mode: 'standard' | 'rewind') {
        this.mode = mode;
        this.spawnFood();
    }

    addPlayer(id: string, player: Player) {
        this.players.set(id, player);
    }

    removePlayer(id: string) {
        const player = this.players.get(id);
        if (player) {
            savePlayerProgress(player);
            this.players.delete(id);
        }
    }

    resetPlayer(player: Player) {
        player.body = [
            { x: Math.floor(Math.random() * TILE_COUNT), y: Math.floor(Math.random() * TILE_COUNT) }
        ];
        player.velocity = { x: 0, y: 0 };
        player.score = 0;
        player.lastMoveTime = Date.now();
        player.streak = 0;
        player.hasMoved = false;
    }

    spawnFood() {
        let valid = false;
        while (!valid) {
            this.food = {
                x: Math.floor(Math.random() * TILE_COUNT),
                y: Math.floor(Math.random() * TILE_COUNT)
            };

            valid = true;
            for (const player of this.players.values()) {
                for (const segment of player.body) {
                    if (this.food.x === segment.x && this.food.y === segment.y) {
                        valid = false;
                        break;
                    }
                }
                if (!valid) break;
            }
        }
    }

    saveSnapshot() {
        // Deep copy players
        const playersSnap = Array.from(this.players.values()).map(p => ({
            id: p.id,
            body: JSON.parse(JSON.stringify(p.body)),
            color: p.color
        }));

        this.history.push({
            players: playersSnap,
            food: { ...this.food },
            timestamp: Date.now()
        });

        if (this.history.length > this.HISTORY_BUFFER_SIZE) {
            this.history.shift();
        }
    }

    restoreStateAndSpawnGhosts(initiatorId: string) {
        if (this.history.length < 60) return;
        const targetIndex = Math.max(0, this.history.length - 60);
        const snapshot = this.history[targetIndex];
        if (!snapshot) return;

        // Create Ghosts
        const recordedPaths = new Map<string, Point[][]>();
        for (let i = targetIndex; i < this.history.length; i++) {
            const snap = this.history[i];
            if (!snap) continue;
            snap.players.forEach(p => {
                if (!recordedPaths.has(p.id)) recordedPaths.set(p.id, []);
                const pathList = recordedPaths.get(p.id);
                if (pathList) pathList.push(p.body);
            });
        }

        recordedPaths.forEach((path, pid) => {
            if (path.length > 0) {
                const pParams = this.history[targetIndex]?.players.find(p => p.id === pid);
                const color = pParams ? pParams.color : '#ffffff';
                this.ghosts.push({
                    body: path[0],
                    path: path,
                    // Parse color to rgba for ghost transparency
                    color: `rgba(${parseInt(color.slice(1, 3), 16)}, ${parseInt(color.slice(3, 5), 16)}, ${parseInt(color.slice(5, 7), 16)}, 0.5)`,
                    createdAt: Date.now()
                });
            }
        });

        // Restore State
        snapshot.players.forEach(snapP => {
            const liveP = this.players.get(snapP.id);
            if (liveP) {
                liveP.body = JSON.parse(JSON.stringify(snapP.body));
            }
        });

        this.food = { ...snapshot.food };
        this.history.length = targetIndex + 1;
        console.log(`[${this.mode}] TIME REWIND! Initiated by ${initiatorId}`);
    }

    update(server: Server<any>) {
        this.saveSnapshot();

        // Update Ghosts
        for (let i = this.ghosts.length - 1; i >= 0; i--) {
            const ghost = this.ghosts[i];
            if (!ghost) continue;
            if (ghost.path.length > 0) {
                ghost.body = ghost.path.shift()!;
            } else {
                this.ghosts.splice(i, 1);
            }
        }

        const now = Date.now();
        for (const player of this.players.values()) {
            if (player.velocity.x === 0 && player.velocity.y === 0) continue;

            if (now - player.lastMoveTime < this.MOVE_INTERVAL) continue;
            player.lastMoveTime = now;

            if (!player.body.length) continue;
            const head = { ...player.body[0] };
            if (head.x === undefined || head.y === undefined) continue;

            head.x += player.velocity.x;
            head.y += player.velocity.y;

            // Wall Collision
            if (head.x < 0 || head.x >= TILE_COUNT || head.y < 0 || head.y >= TILE_COUNT) {
                savePlayerProgress(player);
                this.resetPlayer(player);
                continue;
            }

            // Ghost Collision
            let hitGhost = false;
            for (const ghost of this.ghosts) {
                for (const seg of ghost.body) {
                    if (head.x === seg.x && head.y === seg.y) {
                        hitGhost = true;
                        break;
                    }
                }
                if (hitGhost) break;
            }
            if (hitGhost) {
                savePlayerProgress(player);
                this.resetPlayer(player);
                continue;
            }

            // Player Collision (only within this room)
            let collided = false;
            for (const other of this.players.values()) {
                if (!other.hasMoved) continue;
                for (const segment of other.body) {
                    if (head.x === segment.x && head.y === segment.y) {
                        collided = true;
                        break;
                    }
                }
                if (collided) break;
            }
            if (collided) {
                savePlayerProgress(player);
                this.resetPlayer(player);
                continue;
            }

            player.body.unshift(head);

            if (head.x === this.food.x && head.y === this.food.y) {
                player.score += 10;
                player.streak = (player.streak || 0) + 1;
                if (player.streak === 5) {
                    const miracle = { type: 'christmas_miracle', playerId: player.id };
                    server.publish(`game-${this.mode}`, JSON.stringify(miracle));
                }
                this.spawnFood();
            } else {
                player.body.pop();
            }

            if (player.score > this.sessionHighScore) {
                this.sessionHighScore = player.score;
                this.sessionBestPlayer = player.name;
            }
            if (player.score > player.bestScore) {
                player.bestScore = player.score;
            }
        }

        // Broadcast State
        const state = {
            players: Array.from(this.players.values()).map(p => ({ ...p, dbId: undefined })),
            ghosts: this.ghosts,
            food: this.food,
            sessionHighScore: this.sessionHighScore,
            sessionBestPlayer: this.sessionBestPlayer
        };
        server.publish(`game-${this.mode}`, JSON.stringify(state));
    }
}
