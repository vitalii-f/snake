import { prisma } from './prisma';
import type { Player } from './types';

export async function savePlayerProgress(player: Player) {
    if (!player.dbId) return;

    try {
        const currentScore = player.score;

        // Simple achievement check
        const newAchievements = [...player.achievements];
        if (currentScore >= 100 && !newAchievements.includes('Score 100')) newAchievements.push('Score 100');
        if (player.streak >= 10 && !newAchievements.includes('Streak 10')) newAchievements.push('Streak 10');

        const updated = await prisma.player.update({
            where: { id: player.dbId },
            data: {
                xp: { increment: currentScore },
                bestScore: { set: Math.max(player.bestScore, currentScore) },
                achievements: JSON.stringify(newAchievements),
                updatedAt: new Date()
            }
        });

        // Recalculate level based on new XP
        let newLevel = Math.floor(updated.xp / 1000) + 1;
        if (newLevel > updated.level) {
            await prisma.player.update({
                where: { id: player.dbId },
                data: { level: newLevel }
            });
        }

        // Update in-memory player object
        player.xp = updated.xp;
        player.level = newLevel;
        player.achievements = newAchievements;

        console.log(`Saved progress for ${player.name}: +${currentScore} XP. New Lvl: ${newLevel}`);
    } catch (e) {
        console.error(`Failed to save player ${player.name}:`, e);
    }
}
