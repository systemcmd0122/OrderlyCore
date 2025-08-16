const { Events } = require('discord.js');
const chalk = require('chalk');
const { getFirestore, doc, setDoc, collection, addDoc, query, where, orderBy, limit, getDocs, getDoc } = require('firebase/firestore');

// ボイス状態の種類を定義
const VOICE_ACTIONS = {
    JOIN: 'join',
    LEAVE: 'leave',
    MOVE: 'move'
};

// メッセージ削除管理クラス
class MessageDeleteManager {
    constructor() {
        this.scheduledDeletions = new Map();
        this.DELETE_DELAY = 60000; // 1分 = 60000ミリ秒
    }

    scheduleDelete(messageId, message, delay = this.DELETE_DELAY) {
        if (this.scheduledDeletions.has(messageId)) {
            clearTimeout(this.scheduledDeletions.get(messageId));
        }
        const timeoutId = setTimeout(async () => {
            try {
                // メッセージが既に削除されていないか確認
                if (message && !message.deleted) {
                    await message.delete();
                    console.log(chalk.gray(`🗑️ Voice message auto-deleted: ${messageId}`));
                }
            } catch (error) {
                // "Unknown Message"エラーは、既に削除された場合に発生するため無視
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

// 特定のVCに対応するログチャンネルIDをFirestoreから取得する関数
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

// ボイスログをFirestoreに保存する関数
async function saveVoiceLog(db, logData) {
    try {
        const voiceLogsRef = collection(db, 'voice_logs');
        const docRef = await addDoc(voiceLogsRef, {
            ...logData,
            timestamp: new Date(),
            created_at: new Date()
        });
        
        console.log(chalk.blue(`📝 Voice log saved to Firestore: ${docRef.id}`));
        return docRef.id;
    } catch (error) {
        console.error(chalk.red('❌ Error saving voice log to Firestore:'), error);
        return null;
    }
}

// ボイス統計を更新する関数
async function updateVoiceStats(db, userId, guildId, action, channelId, channelName) {
    try {
        const statsRef = doc(db, 'voice_stats', `${guildId}_${userId}`);
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD形式

        const statsData = {
            user_id: userId,
            guild_id: guildId,
            last_channel_id: channelId,
            last_channel_name: channelName,
            last_action: action,
            last_activity: new Date(),
            updated_at: new Date()
        };

        const dailyStatsData = {
            [`daily_stats.${today}.${action}_count`]: 1,
            [`daily_stats.${today}.channels.${channelId}`]: channelName
        };

        await setDoc(statsRef, {
            ...statsData,
            ...dailyStatsData
        }, { merge: true });

        console.log(chalk.blue(`📊 Voice stats updated for user: ${userId}`));
    } catch (error) {
        console.error(chalk.red('❌ Error updating voice stats:'), error);
    }
}

// ボイスチャンネル参加時の処理
async function handleVoiceJoin(db, newState, logChannelId) {
    try {
        const channel = newState.guild.channels.cache.get(logChannelId);
        if (!channel || !channel.isTextBased()) return;

        const message = await channel.send(`🎤 **${newState.member.displayName}** が **${newState.channel.name}** に参加しました`);
        deleteManager.scheduleDelete(message.id, message);
        
        console.log(chalk.green(`✅ Voice Join: ${newState.member.user.username} -> ${newState.channel.name}`));
        
        await saveVoiceLog(db, { action: VOICE_ACTIONS.JOIN, user_id: newState.member.user.id, username: newState.member.user.username, display_name: newState.member.displayName, guild_id: newState.guild.id, guild_name: newState.guild.name, channel_id: newState.channelId, channel_name: newState.channel.name, log_channel_id: logChannelId, message_id: message.id });
        await updateVoiceStats(db, newState.member.user.id, newState.guild.id, VOICE_ACTIONS.JOIN, newState.channelId, newState.channel.name);
    } catch (error) { 
        console.error(chalk.red('❌ Error handling voice join:'), error); 
    }
}

// ボイスチャンネル退出時の処理
async function handleVoiceLeave(db, oldState, logChannelId) {
    try {
        const channel = oldState.guild.channels.cache.get(logChannelId);
        if (!channel || !channel.isTextBased()) return;

        const message = await channel.send(`👋 **${oldState.member.displayName}** が **${oldState.channel.name}** から退出しました`);
        deleteManager.scheduleDelete(message.id, message);
        
        console.log(chalk.green(`✅ Voice Leave: ${oldState.member.user.username} <- ${oldState.channel.name}`));
        
        await saveVoiceLog(db, { action: VOICE_ACTIONS.LEAVE, user_id: oldState.member.user.id, username: oldState.member.user.username, display_name: oldState.member.displayName, guild_id: oldState.guild.id, guild_name: oldState.guild.name, channel_id: oldState.channelId, channel_name: oldState.channel.name, log_channel_id: logChannelId, message_id: message.id });
        await updateVoiceStats(db, oldState.member.user.id, oldState.guild.id, VOICE_ACTIONS.LEAVE, oldState.channelId, oldState.channel.name);
    } catch (error) { 
        console.error(chalk.red('❌ Error handling voice leave:'), error); 
    }
}

// ボイスチャンネル移動時の処理
async function handleVoiceMove(db, oldState, newState, oldLogChannelId, newLogChannelId) {
    try {
        if (oldLogChannelId && newLogChannelId && oldLogChannelId === newLogChannelId) {
            const channel = newState.guild.channels.cache.get(newLogChannelId);
            if (!channel || !channel.isTextBased()) return;

            const moveMessage = await channel.send(`↪️ **${newState.member.displayName}** が ${oldState.channel.name} から **${newState.channel.name}** に移動しました`);
            deleteManager.scheduleDelete(moveMessage.id, moveMessage);
            
            console.log(chalk.green(`✅ Voice Move: ${newState.member.user.username} ${oldState.channel.name} -> ${newState.channel.name}`));
            await saveVoiceLog(db, { action: VOICE_ACTIONS.MOVE, user_id: newState.member.user.id, username: newState.member.user.username, display_name: newState.member.displayName, guild_id: newState.guild.id, guild_name: newState.guild.name, old_channel_id: oldState.channelId, old_channel_name: oldState.channel.name, new_channel_id: newState.channelId, new_channel_name: newState.channel.name, log_channel_id: newLogChannelId, message_id: moveMessage.id });
        } else {
            if (oldLogChannelId) {
                await handleVoiceLeave(db, oldState, oldLogChannelId);
            }
            if (newLogChannelId) {
                await handleVoiceJoin(db, newState, newLogChannelId);
            }
        }
        await updateVoiceStats(db, newState.member.user.id, newState.guild.id, VOICE_ACTIONS.MOVE, newState.channelId, newState.channel.name);
    } catch (error) { 
        console.error(chalk.red('❌ Error handling voice move:'), error); 
    }
}

// ボイス統計を取得する関数
async function getVoiceStats(db, guildId, userId = null) {
    try {
        let queryRef = collection(db, 'voice_stats');
        let q = query(queryRef, where('guild_id', '==', guildId));
        if (userId) {
            q = query(q, where('user_id', '==', userId));
        }
        
        const querySnapshot = await getDocs(q);
        const stats = [];
        querySnapshot.forEach((doc) => stats.push({ id: doc.id, ...doc.data() }));
        return stats;
    } catch (error) {
        console.error(chalk.red('❌ Error getting voice stats:'), error);
        return [];
    }
}

// ボイスログの履歴を取得する関数
async function getVoiceHistory(db, guildId, userId = null, limitCount = 50) {
    try {
        let queryRef = collection(db, 'voice_logs');
        let q = query(queryRef, where('guild_id', '==', guildId), orderBy('timestamp', 'desc'), limit(limitCount));
        if (userId) {
            q = query(q, where('user_id', '==', userId));
        }
        
        const querySnapshot = await getDocs(q);
        const history = [];
        querySnapshot.forEach((doc) => history.push({ id: doc.id, ...doc.data() }));
        return history;
    } catch (error) {
        console.error(chalk.red('❌ Error getting voice history:'), error);
        return [];
    }
}

// 古いボイスログをクリーンアップする関数
async function cleanupOldLogs(db, maxAge = 7 * 24 * 60 * 60 * 1000) { // デフォルト7日
    try {
        const cutoffDate = new Date(Date.now() - maxAge);
        const oldLogsQuery = query(collection(db, 'voice_logs'), where('timestamp', '<', cutoffDate), limit(100));
        const querySnapshot = await getDocs(oldLogsQuery);
        
        const deletePromises = querySnapshot.docs.map(doc => doc.ref.delete());
        await Promise.all(deletePromises);
        
        if (deletePromises.length > 0) {
            console.log(chalk.blue(`🧹 Cleaned up ${deletePromises.length} old voice logs`));
        }
        return deletePromises.length;
    } catch (error) {
        console.error(chalk.red('❌ Error cleaning up old voice logs:'), error);
        return 0;
    }
}

module.exports = {
    name: Events.VoiceStateUpdate,
    async execute(oldState, newState, client) {
        if (newState.member?.user.bot) return;

        const db = client.db;
        if (!db) {
            console.error(chalk.red('❌ Firestore database instance not found'));
            return;
        }
        const guildId = newState.guild?.id || oldState.guild?.id;
        if (!guildId) return;

        try {
            // 参加
            if (!oldState.channelId && newState.channelId) {
                const logChannelId = await getLogChannelIdForVc(db, guildId, newState.channelId);
                if (logChannelId) await handleVoiceJoin(db, newState, logChannelId);
            } 
            // 退出
            else if (oldState.channelId && !newState.channelId) {
                const logChannelId = await getLogChannelIdForVc(db, guildId, oldState.channelId);
                if (logChannelId) await handleVoiceLeave(db, oldState, logChannelId);
            } 
            // 移動
            else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
                const oldLogChannelId = await getLogChannelIdForVc(db, guildId, oldState.channelId);
                const newLogChannelId = await getLogChannelIdForVc(db, guildId, newState.channelId);
                if (oldLogChannelId || newLogChannelId) {
                   await handleVoiceMove(db, oldState, newState, oldLogChannelId, newLogChannelId);
                }
            }
        } catch (error) {
            console.error(chalk.red('❌ Error in voice state update handler:'), error);
        }
    },

    async getStats(client, guildId, userId = null) {
        if (!client.db) throw new Error('Firestore database instance not found');
        return await getVoiceStats(client.db, guildId, userId);
    },

    async getHistory(client, guildId, userId = null, limit = 50) {
        if (!client.db) throw new Error('Firestore database instance not found');
        return await getVoiceHistory(client.db, guildId, userId, limit);
    },

    async cleanup(client, maxAge = 7 * 24 * 60 * 60 * 1000) {
        if (!client.db) throw new Error('Firestore database instance not found');
        return await cleanupOldLogs(client.db, maxAge);
    },

    shutdown() {
        deleteManager.cleanup();
        console.log(chalk.yellow('🔄 Voice state log module shutdown completed'));
    },

    VOICE_ACTIONS
};