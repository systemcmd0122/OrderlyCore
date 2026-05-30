const { Events, AuditLogEvent } = require('discord.js');
const { doc, getDoc, collection, addDoc, Timestamp } = require('firebase/firestore');
const { createStandardEmbed, COLORS } = require('../src/utils/embedBuilder');

// --- 共通ログ送信関数 ---
async function getLogChannelId(client, guildId) {
    const settingsRef = doc(client.db, 'guild_settings', guildId);
    const docSnap = await getDoc(settingsRef);
    if (docSnap.exists() && docSnap.data().auditLogChannel) {
        return docSnap.data().auditLogChannel;
    }
    return null;
}

// Firestoreにログを保存
async function saveLogToFirestore(client, guild, logData) {
    try {
        const logWithDefaults = {
            guildId: guild.id,
            timestamp: Timestamp.now(),
            ...logData
        };
        await addDoc(collection(client.db, 'audit_logs'), logWithDefaults);
    } catch (error) {
        console.error('[ERROR] Firestoreへの監査ログ保存に失敗しました:', error);
    }
}

async function sendLog(client, guild, embed, firestoreData) {
    // 1. Firestoreに保存
    await saveLogToFirestore(client, guild, firestoreData);

    // 2. チャンネルに通知
    try {
        const logChannelId = await getLogChannelId(client, guild.id);
        if (logChannelId) {
            const logChannel = await client.channels.fetch(logChannelId);
            if (logChannel && logChannel.isTextBased()) {
                await logChannel.send({ embeds: [embed] });
            }
        }
    } catch (error) {
        console.error('[ERROR] 監査ログのチャンネル送信に失敗しました:', error);
    }
}

// --- イベントリスナー ---
module.exports = (client) => {
    // メッセージ削除
    client.on(Events.MessageDelete, async (message) => {
        if (!message.guild || (message.author && message.author.bot)) return;

        await new Promise(resolve => setTimeout(resolve, 1000));

        try {
            const fetchedLogs = await message.guild.fetchAuditLogs({
                limit: 1,
                type: AuditLogEvent.MessageDelete,
            });
            const deleteLog = fetchedLogs.entries.first();

            let author = message.author;
            let executor = null;
            let descriptionText = '';

            if (deleteLog && (Date.now() - deleteLog.createdTimestamp < 5000)) {
                if (deleteLog.extra.channel.id === message.channel.id) {
                    executor = deleteLog.executor;
                    author = deleteLog.target;
                }
            }

            if (executor && author && executor.id !== author.id) {
                descriptionText = `実行者: ${executor.tag}\n送信者: ${author.tag}\nチャンネル: ${message.channel}`;
            } else {
                descriptionText = `送信者: ${author ? author.tag : '不明'}\nチャンネル: ${message.channel}`;
            }

            const messageContent = message.content ? message.content.substring(0, 1024) : '(取得不可)';

            const embed = createStandardEmbed({
                title: '[LOG] メッセージ削除',
                description: descriptionText,
                color: COLORS.ERROR,
                fields: [{ name: '内容', value: `>>> ${messageContent}` }],
                thumbnail: author ? author.displayAvatarURL() : null
            });

            const firestoreData = {
                eventType: 'MessageDelete',
                executorId: executor ? executor.id : (author ? author.id : null),
                executorTag: executor ? executor.tag : (author ? author.tag : '不明'),
                targetId: author ? author.id : null,
                targetTag: author ? author.tag : '不明',
                details: {
                    channelId: message.channel.id,
                    channelName: message.channel.name,
                    content: messageContent,
                }
            };
            await sendLog(client, message.guild, embed, firestoreData);

        } catch (error) {
            console.error("[ERROR] メッセージ削除ログの処理失敗:", error);
        }
    });

    // メッセージ編集
    client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
        if (!newMessage.guild || (newMessage.author && newMessage.author.bot) || oldMessage.content === newMessage.content) return;

        const author = newMessage.author;
        const oldContent = oldMessage.content ? oldMessage.content.substring(0, 1024) : '(取得不可)';
        const newContent = newMessage.content ? newMessage.content.substring(0, 1024) : '(取得不可)';

        const embed = createStandardEmbed({
            title: '[LOG] メッセージ編集',
            description: `チャンネル: ${newMessage.channel}\n送信者: ${author.tag}`,
            color: COLORS.INFO,
            fields: [
                { name: '変更前', value: oldContent },
                { name: '変更後', value: newContent }
            ],
            thumbnail: author.displayAvatarURL()
        }).setURL(newMessage.url);

        const firestoreData = {
            eventType: 'MessageUpdate',
            executorId: author.id,
            executorTag: author.tag,
            targetId: author.id,
            targetTag: author.tag,
            details: {
                channelId: newMessage.channel.id,
                channelName: newMessage.channel.name,
                messageUrl: newMessage.url,
                before: oldContent,
                after: newContent
            }
        };
        await sendLog(client, newMessage.guild, embed, firestoreData);
    });
    
    // ニックネーム変更
    client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
         if (oldMember.nickname === newMember.nickname) return;

         const fetchedLogs = await newMember.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberUpdate });
         const log = fetchedLogs.entries.first();
         let executor = null;
         if (log && log.target.id === newMember.id && (Date.now() - log.createdTimestamp < 5000)) {
             executor = log.executor;
         }

         const embed = createStandardEmbed({
            title: '[LOG] ニックネーム変更',
            description: `対象: ${newMember.user.tag}\n実行者: ${executor ? executor.tag : '本人/不明'}`,
            color: COLORS.WARNING,
            fields: [
                { name: '前', value: oldMember.nickname || '(なし)', inline: true },
                { name: '後', value: newMember.nickname || '(なし)', inline: true }
            ],
            thumbnail: newMember.user.displayAvatarURL()
         });

        const firestoreData = {
            eventType: 'NicknameUpdate',
            executorId: executor ? executor.id : newMember.id,
            executorTag: executor ? executor.tag : newMember.user.tag,
            targetId: newMember.id,
            targetTag: newMember.user.tag,
            details: {
                before: oldMember.nickname || '(なし)',
                after: newMember.nickname || '(なし)'
            }
        };
        await sendLog(client, newMember.guild, embed, firestoreData);
    });

     // ロール変更
    client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
        const oldRoles = oldMember.roles.cache;
        const newRoles = newMember.roles.cache;
        if (oldRoles.size === newRoles.size) return;

        const fetchedLogs = await newMember.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberRoleUpdate });
        const log = fetchedLogs.entries.first();
        let executor = null;
        if (log && log.target.id === newMember.id && (Date.now() - log.createdTimestamp < 5000)) {
            executor = log.executor;
        }

        let eventType, roleName, embedTitle, embedColor;
        if (oldRoles.size > newRoles.size) {
            const removedRole = oldRoles.find(role => !newRoles.has(role.id));
            if (removedRole) {
                embedTitle = '[LOG] ロール剥奪';
                embedColor = COLORS.ERROR;
                eventType = 'RoleRemove';
                roleName = removedRole.name;
            }
        } else {
            const addedRole = newRoles.find(role => !oldRoles.has(role.id));
            if (addedRole) {
                embedTitle = '[LOG] ロール付与';
                embedColor = COLORS.SUCCESS;
                eventType = 'RoleAdd';
                roleName = addedRole.name;
            }
        }

        if (eventType) {
            const embed = createStandardEmbed({
                title: embedTitle,
                description: `対象: ${newMember.user.tag}\n実行者: ${executor ? executor.tag : '不明'}`,
                color: embedColor,
                fields: [{ name: 'ロール名', value: roleName }],
                thumbnail: newMember.user.displayAvatarURL()
            });

            const firestoreData = { 
                eventType, 
                executorId: executor?.id, 
                executorTag: executor?.tag, 
                targetId: newMember.id, 
                targetTag: newMember.user.tag, 
                details: { roleName } 
            };
            await sendLog(client, newMember.guild, embed, firestoreData);
        }
    });
};
