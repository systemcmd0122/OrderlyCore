// systemcmd0122/overseer/overseer-394ca3129fcc24030a0ae314b6b57cd13daba62c/events/voiceStateLog.js
const { Events, EmbedBuilder } = require('discord.js');
const chalk = require('chalk');
const { getFirestore, doc, getDoc, setDoc, updateDoc, increment, collection, query, where, orderBy, getDocs } = require('firebase/firestore');
const { getDatabase, ref, set, remove, get } = require('firebase/database');

// メッセージ削除管理クラス
class MessageDeleteManager {
    constructor() {
        this.scheduledDeletions = new Map();
        this.DELETE_DELAY = 60000; // 1分
    }
    scheduleDelete(messageId, message, delay = this.DELETE_DELAY) {
        if (this.scheduledDeletions.has(messageId)) {
            clearTimeout(this.scheduledDeletions.get(messageId));
        }
        const timeoutId = setTimeout(async () => {
            try {
                if (message && !message.deleted) {
                    await message.delete();
                }
            } catch (error) {
                if (error.code !== 10008) {
                    console.error(chalk.red('❌ Error deleting voice message:'), error);
                }
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

// ===== ▼▼▼▼▼ 修正箇所（ファイル全体で共有する関数を追加） ▼▼▼▼▼ =====
const calculateRequiredXp = (level) => 5 * (level ** 2) + 50 * level + 100;

async function getLevelData(db, guildId, userId) {
    const userRef = doc(db, 'levels', `${guildId}_${userId}`);
    const docSnap = await getDoc(userRef);
    if (docSnap.exists()) {
        const data = docSnap.data();
        if (typeof data.level === 'undefined') {
            data.level = 0;
        }
        return data;
    }
    return {
        guildId,
        userId,
        xp: 0,
        level: 0,
        messageCount: 0,
        lastMessageTimestamp: 0
    };
}
// ===== ▲▲▲▲▲ 修正ここまで ▲▲▲▲▲ =====


// 特定のVCに対応するログチャンネルIDをFirestoreから取得
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

// VC滞在時間に応じてXPを付与し、レベルアップ処理を行う関数
async function addVcExpAndLevelUp(client, guildId, userId, stayDuration) {
    if (!stayDuration || stayDuration <= 0) return;

    const minutesStayed = Math.floor(stayDuration / 60000);
    if (minutesStayed <= 0) return;

    const xpGained = minutesStayed * 5;
    const db = client.db;
    const userRef = doc(db, 'levels', `${guildId}_${userId}`);

    // まずXPを加算
    try {
        await updateDoc(userRef, { xp: increment(xpGained) });
    } catch (error) {
        if (error.code === 'not-found') {
            await setDoc(userRef, {
                guildId, userId, xp: xpGained, level: 0, messageCount: 0, lastMessageTimestamp: 0
            });
        } else {
            console.error(chalk.red(`❌ Error adding VC XP for ${userId}:`), error);
            return; // エラーならここで中断
        }
    }
     console.log(chalk.blue(`[XP] Added ${xpGained} XP to ${userId} for ${minutesStayed} minutes in VC.`));

    // XP加算後にレベルアップ判定
    const updatedUserData = await getLevelData(db, guildId, userId);
    let { level, xp } = updatedUserData;
    let requiredXp = calculateRequiredXp(level);
    let leveledUp = false;

    while (xp >= requiredXp) {
        xp -= requiredXp;
        level += 1;
        leveledUp = true;
        requiredXp = calculateRequiredXp(level);
    }

    if (leveledUp) {
        await updateDoc(userRef, { level, xp });
        console.log(chalk.green(`[LEVEL UP] ${userId} reached level ${level} from VC activity!`));
        // ここではレベルアップ通知は送信しない（メッセージ起因のみとする）
    }
}


// Firestoreに滞在時間を加算更新する関数
async function updateUserStayTime(db, guildId, userId, stayDuration) {
    if (!stayDuration || stayDuration <= 0) return;
    try {
        const statsRef = doc(db, 'voice_stats', `${guildId}_${userId}`);
        await setDoc(statsRef, {
            totalStayTime: increment(stayDuration),
            guildId: guildId,
            userId: userId,
            updatedAt: new Date(),
        }, { merge: true });
        console.log(chalk.blue(`📊 Voice stats updated for ${userId}. Added ${Math.round(stayDuration / 1000)}s`));
    } catch (error) {
        console.error(chalk.red(`❌ Error updating user stay time for ${userId}:`), error);
    }
}

// VC参加時の処理
async function handleVoiceJoin(newState, client) {
    const { guild, channel, member } = newState;
    const { db, rtdb } = client;

    const sessionRef = ref(rtdb, `voiceSessions/${guild.id}/${member.id}`);
    const sessionData = {
        channelId: channel.id,
        channelName: channel.name,
        joinedAt: Date.now()
    };
    await set(sessionRef, sessionData);
    console.log(chalk.green(`🔴 RTDB Session started for ${member.user.tag} in ${channel.name}`));
    
    const logChannelId = await getLogChannelIdForVc(db, guild.id, channel.id);
    if (logChannelId) {
        try {
            const logChannel = guild.channels.cache.get(logChannelId);
            if (logChannel && logChannel.isTextBased()) {
                const message = await logChannel.send(`🎤 **${member.displayName}** が **${channel.name}** に参加しました`);
                deleteManager.scheduleDelete(message.id, message);
            }
        } catch (error) {
            console.error(chalk.red('❌ Error sending join log:'), error);
        }
    }
}

// VC退出時の処理
async function handleVoiceLeave(oldState, client) {
    const { guild, channel, member } = oldState;
    const { db, rtdb } = client;

    const sessionRef = ref(rtdb, `voiceSessions/${guild.id}/${member.id}`);
    const sessionSnapshot = await get(sessionRef);
    
    if (sessionSnapshot.exists()) {
        const sessionData = sessionSnapshot.val();
        const stayDuration = Date.now() - sessionData.joinedAt;
        
        await updateUserStayTime(db, guild.id, member.id, stayDuration);
        
        // ===== ▼▼▼▼▼ 修正箇所 ▼▼▼▼▼ =====
        // XP付与とレベルアップ判定をまとめた関数を呼び出す
        await addVcExpAndLevelUp(client, guild.id, member.id, stayDuration);
        // ===== ▲▲▲▲▲ 修正ここまで ▲▲▲▲▲ =====
        
        await remove(sessionRef);
        console.log(chalk.yellow(`🔴 RTDB Session ended for ${member.user.tag}. Duration: ${Math.round(stayDuration / 1000)}s`));
    }

    const logChannelId = await getLogChannelIdForVc(db, guild.id, channel.id);
    if (logChannelId) {
        try {
            const logChannel = guild.channels.cache.get(logChannelId);
            if (logChannel && logChannel.isTextBased()) {
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
        if (!db || !rtdb) {
            console.error(chalk.red('❌ Firestore or Realtime DB instance not found'));
            return;
        }

        const oldChannelId = oldState.channelId;
        const newChannelId = newState.channelId;

        try {
            if (!oldChannelId && newChannelId) {
                await handleVoiceJoin(newState, client);
            } 
            else if (oldChannelId && !newChannelId) {
                await handleVoiceLeave(oldState, client);
            } 
            else if (oldChannelId && newChannelId && oldChannelId !== newChannelId) {
                await handleVoiceLeave(oldState, client);
                await handleVoiceJoin(newState, client);

                const oldLogChannelId = await getLogChannelIdForVc(db, oldState.guild.id, oldState.channelId);
                const newLogChannelId = await getLogChannelIdForVc(db, newState.guild.id, newState.channelId);
                const logDestId = newLogChannelId || oldLogChannelId;
                if (logDestId) {
                    try {
                        const logChannel = newState.guild.channels.cache.get(logDestId);
                        if (logChannel && logChannel.isTextBased()) {
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