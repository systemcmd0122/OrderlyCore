// systemcmd0122/overseer/overseer-394ca3129fcc24030a0ae314b6b57cd13daba62c/events/voiceStateLog.js
const { Events } = require('discord.js');
const chalk = require('chalk');
const { getFirestore, doc, getDoc, setDoc, updateDoc, increment } = require('firebase/firestore');
const { getDatabase, ref, set, remove, get } = require('firebase/database');

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
                if (error.code !== 10008) console.error(chalk.red('❌ Error deleting voice message:'), error);
            } finally {
                this.scheduledDeletions.delete(messageId);
            }
        }, delay);
        this.scheduledDeletions.set(messageId, timeoutId);
    }
    cleanup() {
        this.scheduledDeletions.forEach(timeoutId => clearTimeout(timeoutId));
        this.scheduledDeletions.clear();
        console.log(chalk.yellow('🧹 Voice message deletion schedules cleared'));
    }
}
const deleteManager = new MessageDeleteManager();

const calculateRequiredXp = (level) => 5 * (level ** 2) + 50 * level + 100;

async function getLevelData(db, guildId, userId) {
    const userRef = doc(db, 'levels', `${guildId}_${userId}`);
    const docSnap = await getDoc(userRef);
    if (docSnap.exists()) {
        const data = docSnap.data();
        if (typeof data.level === 'undefined') data.level = 0;
        return data;
    }
    return { guildId, userId, xp: 0, level: 0, messageCount: 0, lastMessageTimestamp: 0 };
}

async function getLogChannelIdForVc(db, guildId, voiceChannelId) {
    if (!guildId || !voiceChannelId) return null;
    try {
        const settingsRef = doc(db, 'guild_settings', guildId);
        const docSnap = await getDoc(settingsRef);
        if (docSnap.exists()) {
            const mappings = docSnap.data().voiceChannelMappings;
            return mappings?.[voiceChannelId] || null;
        }
        return null;
    } catch (error) {
        console.error(chalk.red(`❌ Error fetching log channel for VC ${voiceChannelId}:`), error);
        return null;
    }
}

async function addVcExpAndLevelUp(client, guildId, userId, stayDuration) {
    if (!stayDuration || stayDuration <= 0) return;

    const minutesStayed = Math.floor(stayDuration / 60000);
    if (minutesStayed <= 0) return;

    const xpGained = minutesStayed * 5;
    const db = client.db;

    // 1. ユーザーデータを取得
    const userData = await getLevelData(db, guildId, userId);

    // 2. ローカル変数でXPを更新
    userData.xp += xpGained;
    console.log(chalk.blue(`[XP] Added ${xpGained} XP to ${userId} for ${minutesStayed} minutes in VC. New Total (pre-calc): ${userData.xp}`));

    let leveledUp = false;
    let requiredXp = calculateRequiredXp(userData.level);

    // 3. レベルアップ判定と計算
    while (userData.xp >= requiredXp) {
        userData.xp -= requiredXp;
        userData.level += 1;
        leveledUp = true;
        requiredXp = calculateRequiredXp(userData.level);
    }

    // 4. 計算後の最終データをFirestoreに保存
    const userRef = doc(db, 'levels', `${guildId}_${userId}`);
    await setDoc(userRef, userData, { merge: true });

    if (leveledUp) {
        console.log(chalk.green(`[LEVEL UP] ${userId} reached level ${userData.level} from VC activity!`));
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
        console.log(chalk.blue(`📊 Voice stats updated for ${userId}. Added ${Math.round(stayDuration / 1000)}s`));
    } catch (error) {
        console.error(chalk.red(`❌ Error updating user stay time for ${userId}:`), error);
    }
}

async function handleVoiceJoin(newState, client) {
    const { guild, channel, member } = newState;
    const { db, rtdb } = client;

    const sessionRef = ref(rtdb, `voiceSessions/${guild.id}/${member.id}`);
    await set(sessionRef, { channelId: channel.id, channelName: channel.name, joinedAt: Date.now() });
    console.log(chalk.green(`🔴 RTDB Session started for ${member.user.tag} in ${channel.name}`));
    
    const logChannelId = await getLogChannelIdForVc(db, guild.id, channel.id);
    if (logChannelId) {
        try {
            const logChannel = guild.channels.cache.get(logChannelId);
            if (logChannel?.isTextBased()) {
                const message = await logChannel.send(`🎤 **${member.displayName}** が **${channel.name}** に参加しました`);
                deleteManager.scheduleDelete(message.id, message);
            }
        } catch (error) {
            console.error(chalk.red('❌ Error sending join log:'), error);
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
        await addVcExpAndLevelUp(client, guild.id, member.id, stayDuration);
        
        await remove(sessionRef);
        console.log(chalk.yellow(`🔴 RTDB Session ended for ${member.user.tag}. Duration: ${Math.round(stayDuration / 1000)}s`));
    }

    const logChannelId = await getLogChannelIdForVc(db, guild.id, channel.id);
    if (logChannelId) {
        try {
            const logChannel = guild.channels.cache.get(logChannelId);
            if (logChannel?.isTextBased()) {
                const message = await logChannel.send(`👋 **${member.displayName}** が **${channel.name}** から退出しました`);
                deleteManager.scheduleDelete(message.id, message);
            }
        } catch (error) {
            console.error(chalk.red('❌ Error sending leave log:'), error);
        }
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
            if (!oldChannelId && newChannelId) await handleVoiceJoin(newState, client);
            else if (oldChannelId && !newChannelId) await handleVoiceLeave(oldState, client);
            else if (oldChannelId && newChannelId && oldChannelId !== newChannelId) {
                await handleVoiceLeave(oldState, client);
                await handleVoiceJoin(newState, client);

                const logDestId = await getLogChannelIdForVc(db, newState.guild.id, newState.channelId) || await getLogChannelIdForVc(db, oldState.guild.id, oldState.channelId);
                if (logDestId) {
                    try {
                        const logChannel = newState.guild.channels.cache.get(logDestId);
                        if (logChannel?.isTextBased()) {
                           const message = await logChannel.send(`↪️ **${newState.member.displayName}** が ${oldState.channel.name} から **${newState.channel.name}** に移動しました`);
                           deleteManager.scheduleDelete(message.id, message);
                        }
                    } catch(error) {
                        console.error(chalk.red('❌ Error sending move log:'), error);
                    }
                }
            }
        } catch (error) {
            console.error(chalk.red('❌ Error in voice state update handler:'), error);
        }
    },
    shutdown() {
        deleteManager.cleanup();
        console.log(chalk.yellow('🔄 Voice state log module shutdown completed'));
    },
};