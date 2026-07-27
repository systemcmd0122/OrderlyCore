const { Events, PermissionsBitField } = require('discord.js');
const chalk = require('chalk');
const { doc, getDoc, setDoc, increment, collection, query, where, orderBy, getDocs } = require('firebase/firestore');
const { ref, set, remove, get } = require('firebase/database');
const { getLevelData, getRank, calculateRequiredXp, generateLevelUpComment, handleRoleRewards } = require('../src/services/levelingService');
const { createStandardEmbed } = require('../src/utils/embedBuilder');

class MessageDeleteManager {
    constructor() {
        this.scheduledDeletions = new Map();
        this.DELETE_DELAY = 60000;
    }
    scheduleDelete(messageId, message, delay = this.DELETE_DELAY) {
        if (this.scheduledDeletions.has(messageId)) {
            clearTimeout(this.scheduledDeletions.get(messageId));
        }
        const timeoutId = setTimeout(async () => {
            try {
                if (message && !message.deleted) await message.delete();
            } catch (error) {
                if (error.code !== 10008) console.error(chalk.red('[ERROR] Error deleting voice message:'), error);
            } finally {
                this.scheduledDeletions.delete(messageId);
            }
        }, delay);
        this.scheduledDeletions.set(messageId, timeoutId);
    }
    cleanup() {
        this.scheduledDeletions.forEach(timeoutId => clearTimeout(timeoutId));
        this.scheduledDeletions.clear();
        console.log(chalk.yellow('[CLEAN] Voice message deletion schedules cleared'));
    }
}
const deleteManager = new MessageDeleteManager();


async function getLogChannelIdForVc(db, guildId, voiceChannelId) {
    if (!guildId || !voiceChannelId) return null;
    try {
        const settingsRef = doc(db, 'guild_settings', guildId);
        const docSnap = await getDoc(settingsRef);
        if (docSnap.exists()) {
            const mappings = docSnap.data().voiceChannelMappings;
            const config = mappings?.[voiceChannelId];

            // 後方互換性: 古い形式（文字列）と新しい形式（オブジェクト）の両方に対応
            if (typeof config === 'string') {
                return config;
            } else {
                return config?.textChannelId || null;
            }
        }
        return null;
    } catch (error) {
        console.error(chalk.red(`[ERROR] Error fetching log channel for VC ${voiceChannelId}:`), error);
        return null;
    }
}

async function getVcLogConfig(db, guildId, voiceChannelId) {
    if (!guildId || !voiceChannelId) return { silent: true, deleteAfter: true };
    try {
        const settingsRef = doc(db, 'guild_settings', guildId);
        const docSnap = await getDoc(settingsRef);
        if (docSnap.exists()) {
            const mappings = docSnap.data().voiceChannelMappings;
            const config = mappings?.[voiceChannelId];

            // 新しい形式の場合
            if (config && typeof config === 'object') {
                return {
                    silent: config.silent !== false,
                    deleteAfter: config.deleteAfter !== false
                };
            }
        }
        // デフォルト設定を返す
        return { silent: true, deleteAfter: true };
    } catch (error) {
        console.error(chalk.red(`[ERROR] Error fetching VC log config for ${voiceChannelId}:`), error);
        return { silent: true, deleteAfter: true };
    }
}

async function addVcExpAndLevelUp(client, oldState, stayDuration) {
    if (!stayDuration || stayDuration <= 0) return;

    const { guild, member } = oldState;
    const { id: guildId } = guild;
    const { id: userId } = member;

    const minutesStayed = Math.floor(stayDuration / 60000);
    if (minutesStayed <= 0) return;

    const xpGained = minutesStayed * 5;
    const db = client.db;

    const userData = await getLevelData(db, guildId, userId);
    const oldLevel = userData.level;
    userData.xp += xpGained;
    console.log(chalk.blue(`[XP] Added ${xpGained} XP to ${member.user.tag} for ${minutesStayed} minutes in VC. New Total (pre-calc): ${userData.xp}`));

    let leveledUp = false;
    let requiredXp = calculateRequiredXp(userData.level);

    while (userData.xp >= requiredXp) {
        userData.xp -= requiredXp;
        userData.level += 1;
        leveledUp = true;
        requiredXp = calculateRequiredXp(userData.level);
    }

    const userRef = doc(db, 'levels', `${guildId}_${userId}`);
    await setDoc(userRef, userData, { merge: true });

    if (leveledUp) {
        console.log(chalk.green(`[LEVEL UP] ${member.user.tag} reached level ${userData.level} from VC activity!`));

        const settingsRef = doc(db, 'guild_settings', guildId);
        const settingsSnap = await getDoc(settingsRef);
        const settings = settingsSnap.exists() ? settingsSnap.data() : {};

        const awardedRoles = await handleRoleRewards(member, oldLevel, userData.level, settings);

        if (settings.levelUpChannel) {
            const targetChannel = await client.channels.fetch(settings.levelUpChannel).catch(() => null);
            if (targetChannel && targetChannel.isTextBased()) {
                const awesomeComment = await generateLevelUpComment(client, member.user, userData.level, guild.name);

                const usersRef = collection(db, 'levels');
                const q = query(usersRef, where('guildId', '==', guildId), orderBy('level', 'desc'), orderBy('xp', 'desc'));
                const snapshot = await getDocs(q);
                let rank = -1;
                snapshot.docs.forEach((doc, index) => {
                    if (doc.data().userId === userId) {
                        rank = index + 1;
                    }
                });

                const progress = requiredXp > 0 ? Math.floor((userData.xp / requiredXp) * 20) : 0;
                const progressBar = `**[** \`${'#'.repeat(progress)}${'-'.repeat(20 - progress)}\` **]**`;

                const levelUpEmbed = createStandardEmbed({
                    color: 0x00FFFF,
                    author: { name: `LEVEL UP! (VC) - ${member.displayName}`, iconURL: member.user.displayAvatarURL() },
                    title: `《 RANK UP: ${oldLevel}  ->  ${userData.level} 》`,
                    description: awesomeComment,
                    thumbnail: member.user.displayAvatarURL({ dynamic: true, size: 256 }),
                    fields: [
                        {
                            name: '[Status] 現在のステータス',
                            value: `**サーバー内順位:** **${rank !== -1 ? `#${rank}` : 'N/A'}**\n**総メッセージ数:** **${(userData.messageCount || 0).toLocaleString()}** 回`,
                            inline: false
                        },
                        {
                            name: `[Next] 次のレベルまで (Lv. ${userData.level + 1})`,
                            value: `あと **${Math.floor(requiredXp - userData.xp).toLocaleString()}** XP\n${progressBar} **${Math.floor(userData.xp).toLocaleString()}** / **${requiredXp.toLocaleString()}**`,
                            inline: false
                        }
                    ],
                    footer: { text: `ボイスチャンネルでの活動、お疲れ様です！ | ${guild.name}`, iconURL: guild.iconURL() }
                });

                if (awardedRoles && awardedRoles.length > 0) {
                    levelUpEmbed.addFields({
                        name: '[Award] 獲得したロール報酬',
                        value: awardedRoles.map(r => r.toString()).join('\n'),
                        inline: false
                    });
                }

                try {
                    await targetChannel.send({ embeds: [levelUpEmbed] });
                } catch (error) {
                    console.error(chalk.red('VCレベルアップ通知の送信に失敗しました:'), error);
                }
            }
        }
    }
}

async function updateUserStayTime(db, guildId, userId, stayDuration) {
    if (!stayDuration || stayDuration <= 0) return;
    try {
        const statsRef = doc(db, 'voice_stats', `${guildId}_${userId}`);
        await setDoc(statsRef, {
            totalStayTime: increment(stayDuration),
            guildId, userId, updatedAt: new Date(),
        }, { merge: true });
        console.log(chalk.blue(`[STATS] Voice stats updated for ${userId}. Added ${Math.round(stayDuration / 1000)}s`));
    } catch (error) {
        console.error(chalk.red(`[ERROR] Error updating user stay time for ${userId}:`), error);
    }
}

async function sendVcLog(logChannel, content, config) {
    if (!logChannel?.isTextBased()) return null;

    try {
        // デフォルト設定を適用（新規互換性のため）
        const silent = config?.silent !== false;
        const deleteAfter = config?.deleteAfter !== false;

        // log message を送信
        const flags = silent ? ['SuppressNotifications'] : [];
        const message = await logChannel.send({
            content: content,
            ...(flags.length > 0 && { flags })
        });

        // deleteAfter が true の場合のみ、60秒後に削除をスケジュール
        if (deleteAfter) {
            deleteManager.scheduleDelete(message.id, message);
        }

        return message;
    } catch (error) {
        console.error(chalk.red('[ERROR] Error sending VC log:'), error);
        return null;
    }
}

async function handleVoiceJoin(newState, client) {
    const { guild, channel, member } = newState;
    const { db, rtdb } = client;

    const sessionRef = ref(rtdb, `voiceSessions/${guild.id}/${member.id}`);
    await set(sessionRef, { channelId: channel.id, channelName: channel.name, joinedAt: Date.now() });
    console.log(chalk.green(`[SESSION] started for ${member.user.tag} in ${channel.name}`));

    const logChannelId = await getLogChannelIdForVc(db, guild.id, channel.id);
    if (logChannelId) {
        try {
            const logChannel = guild.channels.cache.get(logChannelId);
            const config = await getVcLogConfig(db, guild.id, channel.id);
            await sendVcLog(logChannel, `[JOIN] **${member.displayName}** が **${channel.name}** に参加しました`, config);
        } catch (error) {
            console.error(chalk.red('[ERROR] Error sending join log:'), error);
        }
    }
}

async function handleVoiceLeave(oldState, client) {
    const { guild, channel, member } = oldState;
    const { db, rtdb } = client;

    const sessionRef = ref(rtdb, `voiceSessions/${guild.id}/${member.id}`);
    const sessionSnapshot = await get(sessionRef);

    if (sessionSnapshot.exists()) {
        const sessionData = sessionSnapshot.val();
        const stayDuration = Date.now() - sessionData.joinedAt;

        await updateUserStayTime(db, guild.id, member.id, stayDuration);
        await addVcExpAndLevelUp(client, oldState, stayDuration);

        await remove(sessionRef);
        console.log(chalk.yellow(`[SESSION] ended for ${member.user.tag}. Duration: ${Math.round(stayDuration / 1000)}s`));
    }

    await cleanupAfkTracking(rtdb, guild.id, member.id);

    const logChannelId = await getLogChannelIdForVc(db, guild.id, channel.id);
    if (logChannelId) {
        try {
            const logChannel = guild.channels.cache.get(logChannelId);
            const config = await getVcLogConfig(db, guild.id, channel.id);
            await sendVcLog(logChannel, `[EXIT] **${member.displayName}** が **${channel.name}** から退出しました`, config);
        } catch (error) {
            console.error(chalk.red('[ERROR] Error sending leave log:'), error);
        }
    }
}

async function cleanupAfkTracking(rtdb, guildId, userId) {
    try {
        const afkCondRef = ref(rtdb, `afkConditions/${guildId}/${userId}`);
        await remove(afkCondRef);

        const afkActivityRef = ref(rtdb, `afkActivity/${guildId}/${userId}`);
        await remove(afkActivityRef);

        const afkTrackRef = ref(rtdb, `afkTracking/${guildId}/${userId}`);
        const snap = await get(afkTrackRef);
        if (snap.exists()) {
            const afkData = snap.val();
            const memberRef = ref(rtdb, `voiceSessions/${guildId}/${userId}`);
            const sessionSnap = await get(memberRef);

            if (!sessionSnap.exists() && afkData && !afkData.manual) {
                await remove(afkTrackRef);
                console.log(chalk.gray(`[AFK] Auto AFK tracking cleaned up for user ${userId} (left VC)`));
            }
        }
    } catch (error) {
        console.error(chalk.red('[AFK] Error cleaning up AFK tracking:'), error);
    }
}

async function updateLastActionAt(rtdb, guildId, userId) {
    try {
        const actionRef = ref(rtdb, `afkActivity/${guildId}/${userId}`);
        await set(actionRef, { lastActionAt: Date.now() });
    } catch (error) {
        console.error(chalk.red('[AFK] Error updating lastActionAt:'), error);
    }
}

module.exports = {
    name: Events.VoiceStateUpdate,
    async execute(oldState, newState, client) {
        if (newState.member?.user.bot) return;
        const { db, rtdb } = client;
        if (!db || !rtdb) return;

        const oldChannelId = oldState.channelId;
        const newChannelId = newState.channelId;

        try {
            if (newChannelId) {
                await updateLastActionAt(rtdb, newState.guild.id, newState.member.id);
            }
            if (!oldChannelId && newChannelId) {
                // VC参加
                await handleVoiceJoin(newState, client);
            } else if (oldChannelId && !newChannelId) {
                // VC退出
                await handleVoiceLeave(oldState, client);
            } else if (oldChannelId && newChannelId && oldChannelId !== newChannelId) {
                // VC移動 - 退出と参加の統計情報処理は行うが、ログメッセージは「移動」のみ送信
                const { guild, member } = oldState;
                const { db, rtdb } = client;

                // セッション終了処理（統計のため）
                const sessionRef = ref(rtdb, `voiceSessions/${guild.id}/${member.id}`);
                const sessionSnapshot = await get(sessionRef);

                if (sessionSnapshot.exists()) {
                    const sessionData = sessionSnapshot.val();
                    const stayDuration = Date.now() - sessionData.joinedAt;

                    await updateUserStayTime(db, guild.id, member.id, stayDuration);
                    await addVcExpAndLevelUp(client, oldState, stayDuration);

                    await remove(sessionRef);
                    console.log(chalk.yellow(`[SESSION] ended for ${member.user.tag}. Duration: ${Math.round(stayDuration / 1000)}s`));
                }

                await cleanupAfkTracking(rtdb, guild.id, member.id);

                // 新しいセッション開始
                const newSessionRef = ref(rtdb, `voiceSessions/${guild.id}/${member.id}`);
                await set(newSessionRef, { channelId: newState.channelId, channelName: newState.channel.name, joinedAt: Date.now() });
                console.log(chalk.green(`[SESSION] started for ${member.user.tag} in ${newState.channel.name}`));

                // 移動ログのみ送信
                const logDestId = await getLogChannelIdForVc(db, newState.guild.id, newState.channelId) || await getLogChannelIdForVc(db, oldState.guild.id, oldState.channelId);
                if (logDestId) {
                    try {
                        const logChannel = newState.guild.channels.cache.get(logDestId);
                        let config;
                        if (await getLogChannelIdForVc(db, newState.guild.id, newState.channelId) === logDestId) {
                            config = await getVcLogConfig(db, newState.guild.id, newState.channelId);
                        } else {
                            config = await getVcLogConfig(db, oldState.guild.id, oldState.channelId);
                        }
                        await sendVcLog(logChannel, `[MOVE] **${newState.member.displayName}** が **${oldState.channel.name}** から **${newState.channel.name}** に移動しました`, config);
                    } catch (error) {
                        console.error(chalk.red('[ERROR] Error sending move log:'), error);
                    }
                }
            }
        } catch (error) {
            console.error(chalk.red('[ERROR] Error in voice state update handler:'), error);
        }
    },
    shutdown() {
        deleteManager.cleanup();
        console.log(chalk.yellow('[INFO] Voice state log module shutdown completed'));
    },
};