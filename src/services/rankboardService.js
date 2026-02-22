const { EmbedBuilder } = require('discord.js');
const { collection, query, where, getDocs, orderBy, limit } = require('firebase/firestore');
const { ref, get } = require('firebase/database');
const chalk = require('chalk');
const { calculateRequiredXp } = require('./levelingService');

async function updateRankboards(client) {
    if (!client.isReady()) return;
    console.log(chalk.cyan('[Rankboard] Starting periodic update...'));
    const db = client.db;
    const rtdb = client.rtdb;
    const settingsCol = collection(db, 'guild_settings');
    const q = query(settingsCol, where('rankBoard', '!=', null));

    try {
        const snapshot = await getDocs(q);
        if (snapshot.empty) {
            console.log(chalk.cyan('[Rankboard] No active rankboards found.'));
            return;
        }

        for (const guildSettingsDoc of snapshot.docs) {
            const settings = guildSettingsDoc.data();
            const guildId = guildSettingsDoc.id;
            const rankBoardConfig = settings.rankBoard;

            if (!rankBoardConfig || !rankBoardConfig.channelId || !rankBoardConfig.messageId) {
                continue;
            }

            const guild = await client.guilds.fetch(guildId).catch(err => {
                console.error(chalk.red(`[Rankboard] Failed to fetch guild ${guildId}`), err);
                return null;
            });
            if (!guild) continue;

            try {
                const levelsRef = collection(db, 'levels');
                const levelQuery = query(
                    levelsRef,
                    where('guildId', '==', guildId),
                    orderBy('level', 'desc'),
                    orderBy('xp', 'desc'),
                    limit(10)
                );
                const levelSnapshot = await getDocs(levelQuery);
                const userStats = [];
                levelSnapshot.forEach(doc => {
                    const data = doc.data();
                    userStats.push({
                        userId: data.userId,
                        level: data.level || 0,
                        xp: data.xp || 0,
                    });
                });

                const allSessionsRef = ref(rtdb, `voiceSessions/${guild.id}`);
                const allSessionsSnapshot = await get(allSessionsRef);
                const onlineUsers = allSessionsSnapshot.exists() ? allSessionsSnapshot.val() : {};

                const finalStats = userStats.map(stat => {
                    let currentXp = stat.xp;
                    if (onlineUsers[stat.userId]) {
                        const sessionDurationMs = Date.now() - onlineUsers[stat.userId].joinedAt;
                        const minutesStayed = Math.floor(sessionDurationMs / 60000);
                        const vcXpGained = minutesStayed * 5;
                        currentXp += vcXpGained;
                    }
                    return { ...stat, finalXp: currentXp };
                });

                finalStats.sort((a, b) => {
                    if (b.level !== a.level) {
                        return b.level - a.level;
                    }
                    return b.finalXp - a.finalXp;
                });

                const rankEmbed = new EmbedBuilder()
                    .setColor(0x00FFFF)
                    .setTitle(`🏆 ${guild.name} リアルタイムランキング`)
                    .setThumbnail(guild.iconURL({ dynamic: true }))
                    .setTimestamp()
                    .setFooter({ text: '🟢: VC参加中 | 5分ごとに更新' });

                if (finalStats.length === 0) {
                    rankEmbed.setDescription('まだデータがありません。');
                } else {
                    const rankPromises = finalStats.map(async (stat, index) => {
                        const member = await guild.members.fetch(stat.userId).catch(() => null);
                        const medal = ['🥇', '🥈', '🥉'][index] || `**#${index + 1}**`;
                        const requiredXp = calculateRequiredXp(stat.level);
                        const isOnline = onlineUsers[stat.userId] ? '🟢' : '';

                        return `${medal} ${isOnline} **${member ? member.displayName : '不明なユーザー'}**\n> LV: \`${stat.level}\` | XP: \`${stat.finalXp.toLocaleString()} / ${requiredXp.toLocaleString()}\``;
                    });
                    const rankStrings = await Promise.all(rankPromises);
                    rankEmbed.setDescription(rankStrings.join('\n\n'));
                }

                const channel = await client.channels.fetch(rankBoardConfig.channelId).catch(() => null);
                if (channel) {
                    const message = await channel.messages.fetch(rankBoardConfig.messageId).catch(() => null);
                    if (message) {
                        await message.edit({ embeds: [rankEmbed] });
                    }
                }
            } catch (error) {
                console.error(chalk.red(`[Rankboard] Error updating board for guild ${guildId}:`), error);
            }
        }
    } catch (error) {
        console.error(chalk.red('[Rankboard] Failed to query for guild settings:'), error);
    }
}

module.exports = {
    updateRankboards
};
