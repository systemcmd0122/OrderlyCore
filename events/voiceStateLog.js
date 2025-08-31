const { Events, EmbedBuilder, PermissionsBitField } = require('discord.js');
const chalk = require('chalk');
const { getFirestore, doc, getDoc, setDoc, updateDoc, increment, collection, query, where, orderBy, getDocs } = require('firebase/firestore');
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

// Gemini AIにレベルアップコメントを生成させる関数 (修正済み)
async function generateLevelUpComment(client, user, newLevel, serverName) {
    try {
        const prompt = `あなたはDiscordサーバーの優秀なアシスタントです。以下の指示に従って、ユーザーのレベルアップを祝福するメッセージを**一行で**生成してください。

### 指示
* **役割**: ユーザーの功績を称え、今後の活躍を期待させるような、ユニークでクリエイティブなメッセージを作成します。
* **トーン**: 非常にポジティブで、少し壮大な雰囲気にしてください。
* **必須要素**:
    * ユーザー名: ${user.displayName}
    * 新しいレベル: ${newLevel}
    * サーバー名: ${serverName}
* **厳格な制約**:
    * 生成する文章は**必ず一行**にしてください。
    * **80文字以内**に収めてください。
    * 毎回必ず違うパターンの文章を生成してください。
    * **回答には祝福メッセージのみを含め、それ以外の前置き、解説、リスト、引用符（「」）は絶対に含めないでください。**

### 生成例
* ${serverName}の歴史に名を刻む時が来た！${user.displayName}よ、レベル${newLevel}への到達、誠におめでとう！
* 天晴れ！${user.displayName}の活躍により${serverName}は新たな時代へ。伝説はレベル${newLevel}から始まる！
* ${serverName}に新たな光が灯った！${user.displayName}、レベル${newLevel}への昇格、心より祝福する。`;

        const result = await client.geminiModel.generateContent(prompt);
        // 不要な文字を除去する処理を強化
        const text = result.response.text().trim().replace(/[\n*「」]/g, '').split('。')[0];
        console.log(chalk.magenta(`[Gemini] Generated comment for VC Level Up: ${text}`));
        return text;
    } catch (error) {
        console.error(chalk.red('❌ Gemini APIでのコメント生成に失敗:'), error.message);
        return `**${user.displayName} が新たな境地へ到達しました！**\n絶え間ない努力が実を結び、サーバー内での存在感がさらに増しました。`;
    }
}

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

// levelingSystem.js と同じロール報酬処理関数
async function handleRoleRewards(member, oldLevel, newLevel, settings) {
    const levelingSettings = settings.leveling || {};
    const roleRewards = levelingSettings.roleRewards || [];
    if (roleRewards.length === 0) return;

    const rewardsToGive = roleRewards
        .filter(reward => reward.level > oldLevel && reward.level <= newLevel)
        .sort((a, b) => a.level - b.level);

    if (rewardsToGive.length === 0) return;

    if (!member.guild.members.me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
        console.error(chalk.red(`[Role Reward] Bot does not have Manage Roles permission in ${member.guild.name}.`));
        return;
    }

    let awardedRoles = [];
    for (const reward of rewardsToGive) {
        try {
            const role = member.guild.roles.cache.get(reward.roleId);
            if (!role) {
                console.warn(chalk.yellow(`[Role Reward] Role ID ${reward.roleId} for level ${reward.level} not found.`));
                continue;
            }
            if (role.position >= member.guild.members.me.roles.highest.position) {
                console.warn(chalk.yellow(`[Role Reward] Cannot assign role ${role.name} as it is higher than or equal to the bot's role.`));
                continue;
            }
            if (!member.roles.cache.has(role.id)) {
                await member.roles.add(role);
                awardedRoles.push(role);
                console.log(chalk.green(`[Role Reward] Awarded role "${role.name}" to ${member.user.tag} for reaching level ${reward.level} (VC).`));
            }
        } catch (error) {
            console.error(chalk.red(`[Role Reward] Failed to award role for level ${reward.level} to ${member.user.tag} (VC):`), error);
        }
    }
    return awardedRoles;
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
                const progressBar = `**[** ${'🟦'.repeat(progress)}${'⬛'.repeat(20 - progress)} **]**`;

                const levelUpEmbed = new EmbedBuilder()
                    .setColor(0x00FFFF)
                    .setAuthor({ name: `LEVEL UP! (VC) - ${member.displayName}`, iconURL: member.user.displayAvatarURL() })
                    .setTitle(`《 RANK UP: ${oldLevel}  ➔  ${userData.level} 》`)
                    .setDescription(awesomeComment)
                    .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
                    .addFields(
                        {
                            name: '📊 現在のステータス',
                            value: `**サーバー内順位:** **${rank !== -1 ? `#${rank}` : 'N/A'}**\n**総メッセージ数:** **${userData.messageCount.toLocaleString()}** 回`,
                            inline: false
                        },
                        {
                            name: `🚀 次のレベルまで (Lv. ${userData.level + 1})`,
                            value: `あと **${(requiredXp - userData.xp).toLocaleString()}** XP\n${progressBar} **${userData.xp.toLocaleString()}** / **${requiredXp.toLocaleString()}**`,
                            inline: false
                        }
                    )
                    .setFooter({ text: `ボイスチャンネルでの活動、お疲れ様です！ | ${guild.name}`, iconURL: guild.iconURL() })
                    .setTimestamp();
                
                if (awardedRoles && awardedRoles.length > 0) {
                    levelUpEmbed.addFields({
                        name: '🏆 獲得したロール報酬',
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
        await addVcExpAndLevelUp(client, oldState, stayDuration);
        
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