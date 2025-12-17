export type Point = { x: number, y: number };

export type Player = {
    id: string;
    body: Point[];
    velocity: Point;
    color: string;
    score: number;
    name: string;
    lastMoveTime: number;
    streak: number;
    // Database fields
    xp: number;
    level: number;
    bestScore: number;
    achievements: string[]; // JSON array
    dbId?: string;
    mode: 'standard' | 'rewind';
    hasMoved: boolean;
};

export type Ghost = {
    body: Point[];
    path: Point[][]; // Future moves to replay
    color: string;
    createdAt: number;
};

export type GameSnapshot = {
    players: { id: string, body: Point[], color: string }[];
    food: Point;
    timestamp: number;
};
