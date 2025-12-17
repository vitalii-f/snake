export const GRID_SIZE = 20;
export const TILE_COUNT = 20;
export const ADMIN_PASSWORD = 'snake_dev_123';
export const COLORS = ['#00FF9D', '#00F3FF', '#FFFF00', '#FF00FF', '#0000FF'];

export function getRandomColor() {
    return COLORS[Math.floor(Math.random() * COLORS.length)];
}
