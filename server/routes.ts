import type { Server } from "bun";
import fs from 'fs';
import path from 'path';
import { ADMIN_PASSWORD } from './config';

const PROJECT_ROOT = path.resolve(import.meta.dir, '..');

export async function handleRequest(req: Request, server: Server<any>): Promise<Response | undefined> {
    const url = new URL(req.url);


    // Static Files
    let filePath = url.pathname;
    if (filePath === '/') filePath = '/index.html';
    else if (filePath === '/game') filePath = '/game.html';
    const publicDir = path.join(PROJECT_ROOT, 'public');
    const file = Bun.file(path.join(publicDir, filePath));
    return new Response(file);
}
