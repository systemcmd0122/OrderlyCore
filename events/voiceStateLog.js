const { Events } = require('discord.js');
const chalk = require('chalk');
const { getFirestore, doc, getDoc, setDoc, increment } = require('firebase/firestore');
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
                // メッセージが既にない場合はエラーコード10008が返るため、無視する
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

// Firestoreに滞在時間を加算更新する関数
async function updateUserStayTime(db, guildId, userId, stayDuration) {
    // 滞在時間が0以下の場合は記録しない
    if (!stayDuration || stayDuration <= 0) return;
    try {
        const statsRef = doc(db, 'voice_stats', `${guildId}_${userId}`);
        // incrementを使ってアトミックに加算する
        await setDoc(statsRef, {
            totalStayTime: increment(stayDuration), // ミリ秒単位で加算
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

    // 1. Realtime DBにセッション情報を記録
    const sessionRef = ref(rtdb, `voiceSessions/${guild.id}/${member.id}`);
    const sessionData = {
        channelId: channel.id,
        channelName: channel.name,
        joinedAt: Date.now() // 現在時刻をミリ秒で記録
    };
    await set(sessionRef, sessionData);
    console.log(chalk.green(`🔴 RTDB Session started for ${member.user.tag} in ${channel.name}`));
    
    // 2. [既存機能] ログチャンネルにメッセージを送信
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

    // 1. Realtime DBからセッション情報を取得
    const sessionRef = ref(rtdb, `voiceSessions/${guild.id}/${member.id}`);
    const sessionSnapshot = await get(sessionRef);
    
    if (sessionSnapshot.exists()) {
        const sessionData = sessionSnapshot.val();
        // 2. 滞在時間を計算
        const stayDuration = Date.now() - sessionData.joinedAt;
        
        // 3. Firestoreの累計滞在時間を更新
        await updateUserStayTime(db, guild.id, member.id, stayDuration);
        
        // 4. Realtime DBのセッション情報を削除
        await remove(sessionRef);
        console.log(chalk.yellow(`🔴 RTDB Session ended for ${member.user.tag}. Duration: ${Math.round(stayDuration / 1000)}s`));
    }

    // 5. [既存機能] ログチャンネルにメッセージを送信
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
        // ボット自身のVC操作は無視
        if (newState.member?.user.bot) return;

        const { db, rtdb } = client;
        if (!db || !rtdb) {
            console.error(chalk.red('❌ Firestore or Realtime DB instance not found'));
            return;
        }

        const oldChannelId = oldState.channelId;
        const newChannelId = newState.channelId;

        try {
            // 参加: 以前のチャンネルがなく、新しいチャンネルがある
            if (!oldChannelId && newChannelId) {
                await handleVoiceJoin(newState, client);
            } 
            // 退出: 以前のチャンネルがあり、新しいチャンネルがない
            else if (oldChannelId && !newChannelId) {
                await handleVoiceLeave(oldState, client);
            } 
            // 移動: 以前と新しいチャンネルが両方あり、IDが異なる
            else if (oldChannelId && newChannelId && oldChannelId !== newChannelId) {
                // 移動は「退出」→「参加」の組み合わせとして処理
                await handleVoiceLeave(oldState, client);
                await handleVoiceJoin(newState, client);

                // [既存機能] 移動ログを別途送信
                const oldLogChannelId = await getLogChannelIdForVc(db, oldState.guild.id, oldState.channelId);
                const newLogChannelId = await getLogChannelIdForVc(db, newState.guild.id, newState.channelId);
                // 新しいチャンネルか、古いチャンネルのログ設定が有効なら送信
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
            // サーバーミュートなどの状態変更はここでは何もしない
        } catch (error) {
            console.error(chalk.red('❌ Error in voice state update handler:'), error);
        }
    },
    shutdown() {
        deleteManager.cleanup();
        console.log(chalk.yellow('🔄 Voice state log module shutdown completed'));
    },
};