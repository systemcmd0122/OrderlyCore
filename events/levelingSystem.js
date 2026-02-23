const { Events } = require('discord.js');
const { doc, getDoc, setDoc } = require('firebase/firestore');
const { getLevelData, getRank, calculateRequiredXp, generateLevelUpComment, handleRoleRewards } = require('../src/services/levelingService');
const { createStandardEmbed, COLORS } = require('../src/utils/embedBuilder');

async function handleMessage(message, client) {
    if (!message.guild || message.author.bot) return;

    const { guild, author, member } = message;
    const db = client.db;
    
    const userData = await getLevelData(db, guild.id, author.id);
    const now = Date.now();
    if (now - (userData.lastMessageTimestamp || 0) < 60000) return;

    const xpGained = Math.floor(Math.random() * 11) + 15;
    userData.xp += xpGained;
    userData.messageCount += 1;
    userData.lastMessageTimestamp = now;

    let leveledUp = false;
    const oldLevel = userData.level;
    let requiredXp = calculateRequiredXp(userData.level);

    while (userData.xp >= requiredXp) {
        userData.xp -= requiredXp;
        userData.level += 1;
        leveledUp = true;
        requiredXp = calculateRequiredXp(userData.level);
    }

    const userRef = doc(db, 'levels', `${guild.id}_${author.id}`);
    await setDoc(userRef, userData, { merge: true });

    if (leveledUp) {
        const settingsRef = doc(db, 'guild_settings', guild.id);
        const settingsSnap = await getDoc(settingsRef);
        const settings = settingsSnap.exists() ? settingsSnap.data() : {};
        
        const awardedRoles = await handleRoleRewards(member, oldLevel, userData.level, settings);

        if (settings.levelUpChannel) {
            const targetChannel = await client.channels.fetch(settings.levelUpChannel).catch(() => null);
            if (targetChannel && targetChannel.isTextBased()) {
                const comment = await generateLevelUpComment(client, author, userData.level, guild.name);
                const rank = await getRank(db, guild.id, author.id);
                
                const progress = requiredXp > 0 ? Math.floor((userData.xp / requiredXp) * 20) : 0;
                const progressBar = `\`${'#'.repeat(progress)}${'-'.repeat(20 - progress)}\` **${Math.floor((userData.xp / requiredXp) * 100)}%**`;

                const embed = createStandardEmbed({
                    author: { name: `LEVEL UP: ${author.displayName}`, iconURL: author.displayAvatarURL() },
                    title: `《 RANK UP: ${oldLevel} -> ${userData.level} 》`,
                    description: comment,
                    color: COLORS.SUCCESS,
                    thumbnail: author.displayAvatarURL({ dynamic: true, size: 256 }),
                    fields: [
                        {
                            name: '[STATUS] 統計',
                            value: `順位: **${rank !== -1 ? `#${rank}` : 'N/A'}**\n総メッセージ: **${userData.messageCount.toLocaleString()}** 回`,
                            inline: true
                        },
                        {
                            name: `[NEXT] Lv. ${userData.level + 1}`,
                            value: `残り: **${Math.floor(requiredXp - userData.xp).toLocaleString()}** XP\n${progressBar}`,
                            inline: false
                        }
                    ],
                    footer: { text: `システム管理: ${guild.name}`, iconURL: guild.iconURL() }
                });
                
                if (awardedRoles && awardedRoles.length > 0) {
                    embed.addFields({
                        name: '[AWARD] 獲得したロール報酬',
                        value: awardedRoles.map(r => r.toString()).join(', '),
                        inline: false
                    });
                }

                await targetChannel.send({ embeds: [embed] }).catch(() => {});
            }
        }
    }
}

module.exports = (client) => {
    client.on(Events.MessageCreate, (message) => handleMessage(message, client));
};
