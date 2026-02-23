const { collection, query, where, getDocs, orderBy, limit } = require('firebase/firestore');
const { ref, get } = require('firebase/database');
const chalk = require('chalk');
const { calculateRequiredXp } = require('./levelingService');
const { createStandardEmbed, COLORS } = require('../utils/embedBuilder');

async function updateRankboards(client) {
    if (!client.isReady()) return;
    console.log(chalk.cyan('[Rankboard] Starting periodic update...'));
    const db = client.db;
    const rtdb = client.rtdb;
    const settingsCol = collection(db, 'guild_settings');
    const q = query(settingsCol, where('rankBoard', '!=', null));

    try {
        const snapshot = await getDocs(q);
        if (snapshot.empty) return;

        for (const guildSettingsDoc of snapshot.docs) {
            const settings = guildSettingsDoc.data();
            const guildId = guildSettingsDoc.id;
            const rankBoardConfig = settings.rankBoard;

            if (!rankBoardConfig || !rankBoardConfig.channelId || !rankBoardConfig.messageId) continue;

            const guild = await client.guilds.fetch(guildId).catch(() => null);
            if (!guild) continue;

            try {
                const levelsRef = collection(db, 'levels');
                const levelQuery = query(levelsRef, where('guildId', '==', guildId), orderBy('level', 'desc'), orderBy('xp', 'desc'), limit(10));
                const levelSnapshot = await getDocs(levelQuery);
                const userStats = levelSnapshot.docs.map(doc => {
                    const data = doc.data();
                    return { userId: data.userId, level: data.level || 0, xp: data.xp || 0 };
                });

                const allSessionsRef = ref(rtdb, `voiceSessions/${guild.id}`);
                const allSessionsSnapshot = await get(allSessionsRef);
                const onlineUsers = allSessionsSnapshot.exists() ? allSessionsSnapshot.val() : {};

                const finalStats = userStats.map(stat => {
                    let currentXp = stat.xp;
                    if (onlineUsers[stat.userId]) {
                        const sessionDurationMs = Date.now() - onlineUsers[stat.userId].joinedAt;
                        const minutesStayed = Math.floor(sessionDurationMs / 60000);
                        currentXp += minutesStayed * 5;
                    }
                    return { ...stat, finalXp: currentXp };
                }).sort((a, b) => b.level !== a.level ? b.level - a.level : b.finalXp - a.finalXp);

                const rankEmbed = createStandardEmbed({
                    title: `[RANKING] ${guild.name}`,
                    color: COLORS.PRIMARY,
                    thumbnail: guild.iconURL(),
                    footer: { text: '[ON] VC参加中 | 定期更新システム' }
                });

                if (finalStats.length === 0) {
                    rankEmbed.setDescription('データがありません。');
                } else {
                    const rankPromises = finalStats.map(async (stat, index) => {
                        const member = await guild.members.fetch(stat.userId).catch(() => null);
                        const medal = ['1st', '2nd', '3rd'][index] || `#${index + 1}`;
                        const reqXp = calculateRequiredXp(stat.level);
                        const isOnline = onlineUsers[stat.userId] ? '[ON]' : '';
                        return `**${medal}** ${isOnline} **${member ? member.displayName : 'Unknown'}**\n> LV: \`${stat.level}\` | XP: \`${stat.finalXp.toLocaleString()} / ${reqXp.toLocaleString()}\``;
                    });
                    const rankStrings = await Promise.all(rankPromises);
                    rankEmbed.setDescription(rankStrings.join('\n\n'));
                }

                const channel = await client.channels.fetch(rankBoardConfig.channelId).catch(() => null);
                if (channel) {
                    const message = await channel.messages.fetch(rankBoardConfig.messageId).catch(() => null);
                    if (message) await message.edit({ embeds: [rankEmbed] });
                }
            } catch (error) {
                console.error(chalk.red(`[Rankboard] Update failure for ${guildId}:`), error);
            }
        }
    } catch (error) {
        console.error(chalk.red('[Rankboard] Query failure:'), error);
    }
}

module.exports = {
    updateRankboards
};
