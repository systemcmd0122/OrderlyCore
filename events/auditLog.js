const { Events, EmbedBuilder, AuditLogEvent } = require('discord.js');
const { doc, getDoc, collection, addDoc, Timestamp } = require('firebase/firestore');

// --- 共通ログ送信関数 ---
async function getLogChannelId(client, guildId) {
    const settingsRef = doc(client.db, 'guild_settings', guildId);
    const docSnap = await getDoc(settingsRef);
    if (docSnap.exists() && docSnap.data().auditLogChannel) {
        return docSnap.data().auditLogChannel;
    }
    return null;
}

// ★★★★★【ここから変更】★★★★★
// Firestoreにログを保存する関数を追加
async function saveLogToFirestore(client, guild, logData) {
    try {
        const logWithDefaults = {
            guildId: guild.id,
            timestamp: Timestamp.now(),
            ...logData
        };
        await addDoc(collection(client.db, 'audit_logs'), logWithDefaults);
    } catch (error) {
        console.error('Firestoreへの監査ログ保存に失敗しました:', error);
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
        console.error('監査ログのチャンネル送信に失敗しました:', error);
    }
}
// ★★★★★【ここまで変更】★★★★★

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
                descriptionText = `**実行者:** ${executor.tag}\n**送信者:** ${author.tag}\n**チャンネル:** ${message.channel}`;
            } else {
                descriptionText = `**送信者:** ${author ? author.tag : '不明なユーザー'}\n**チャンネル:** ${message.channel}`;
            }

            const messageContent = message.content ? message.content.substring(0, 1024) : '（キャッシュ外のため内容を取得できませんでした）';

            const embed = new EmbedBuilder()
                .setColor(0xff6b6b)
                .setTitle('メッセージ削除')
                .setDescription(descriptionText)
                .addFields({ name: 'メッセージ内容', value: `>>> ${messageContent}` })
                .setTimestamp();
            
            if (author) {
                 embed.setThumbnail(author.displayAvatarURL());
            }

            // ★★★★★【ここから変更】★★★★★
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
            // ★★★★★【ここまで変更】★★★★★

        } catch (error) {
            console.error("メッセージ削除ログの処理中にエラー:", error);
        }
    });

    // メッセージ編集
    client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
        if (!newMessage.guild || (newMessage.author && newMessage.author.bot) || oldMessage.content === newMessage.content) return;

        const author = newMessage.author;
        const oldContent = oldMessage.content ? oldMessage.content.substring(0, 1024) : '（内容を取得できませんでした）';
        const newContent = newMessage.content ? newMessage.content.substring(0, 1024) : '（内容を取得できませんでした）';

        const embed = new EmbedBuilder()
            .setColor(0x3498db)
            .setTitle('メッセージ編集')
            .setDescription(`**チャンネル:** ${newMessage.channel}\n**送信者:** ${author.tag}`)
            .addFields(
                { name: '変更前', value: oldContent },
                { name: '変更後', value: newContent }
            )
            .setURL(newMessage.url)
            .setTimestamp();

        // ★★★★★【ここから変更】★★★★★
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
        // ★★★★★【ここまで変更】★★★★★
    });
    
    // メンバーのニックネーム変更
    client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
         if (oldMember.nickname === newMember.nickname) return;

         // ★★★★★【ここから変更】★★★★★
         const fetchedLogs = await newMember.guild.fetchAuditLogs({
            limit: 1,
            type: AuditLogEvent.MemberUpdate,
         });
         const log = fetchedLogs.entries.first();
         let executor = null;
         if (log && log.target.id === newMember.id && (Date.now() - log.createdTimestamp < 5000)) {
             executor = log.executor;
         }
         // ★★★★★【ここまで変更】★★★★★

         const embed = new EmbedBuilder()
            .setColor(0xf1c40f)
            .setTitle('ニックネーム変更')
            // ★★★★★【ここから変更】★★★★★
            .setDescription(`**対象:** ${newMember.user.tag}\n**実行者:** ${executor ? executor.tag : '不明 (本人 or ログなし)'}`)
            // ★★★★★【ここまで変更】★★★★★
            .addFields(
                { name: '変更前', value: oldMember.nickname || '（なし）' },
                { name: '変更後', value: newMember.nickname || '（なし）' }
            )
            .setTimestamp();

        // ★★★★★【ここから変更】★★★★★
        const firestoreData = {
            eventType: 'NicknameUpdate',
            executorId: executor ? executor.id : newMember.id,
            executorTag: executor ? executor.tag : newMember.user.tag,
            targetId: newMember.id,
            targetTag: newMember.user.tag,
            details: {
                before: oldMember.nickname || '（なし）',
                after: newMember.nickname || '（なし）'
            }
        };
        await sendLog(client, newMember.guild, embed, firestoreData);
        // ★★★★★【ここまで変更】★★★★★
    });

     // ロール変更
    client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
        const oldRoles = oldMember.roles.cache;
        const newRoles = newMember.roles.cache;
        if (oldRoles.size === newRoles.size) return;

        // ★★★★★【ここから変更】★★★★★
        const fetchedLogs = await newMember.guild.fetchAuditLogs({
            limit: 1,
            type: AuditLogEvent.MemberRoleUpdate,
        });
        const log = fetchedLogs.entries.first();
        let executor = null;
        if (log && log.target.id === newMember.id && (Date.now() - log.createdTimestamp < 5000)) {
            executor = log.executor;
        }
        // ★★★★★【ここまで変更】★★★★★

        const embed = new EmbedBuilder()
            .setColor(0x9b59b6)
            .setTimestamp()
            // ★★★★★【ここから変更】★★★★★
            .setDescription(`**対象:** ${newMember.user.tag}\n**実行者:** ${executor ? executor.tag : '不明 (ログなし)'}`);
            // ★★★★★【ここまで変更】★★★★★

        let eventType, roleName;
        if (oldRoles.size > newRoles.size) { // ロール剥奪
            const removedRole = oldRoles.find(role => !newRoles.has(role.id));
            if (removedRole) {
                embed.setTitle('ロール剥奪').addFields({ name: '剥奪されたロール', value: `${removedRole.name}` });
                eventType = 'RoleRemove';
                roleName = removedRole.name;
                // ★★★★★【ここから変更】★★★★★
                const firestoreData = { eventType, executorId: executor?.id, executorTag: executor?.tag, targetId: newMember.id, targetTag: newMember.user.tag, details: { roleName } };
                await sendLog(client, newMember.guild, embed, firestoreData);
                // ★★★★★【ここまで変更】★★★★★
            }
        } else { // ロール付与
            const addedRole = newRoles.find(role => !oldRoles.has(role.id));
            if (addedRole) {
                embed.setTitle('ロール付与').addFields({ name: '付与されたロール', value: `${addedRole.name}` });
                eventType = 'RoleAdd';
                roleName = addedRole.name;
                // ★★★★★【ここから変更】★★★★★
                const firestoreData = { eventType, executorId: executor?.id, executorTag: executor?.tag, targetId: newMember.id, targetTag: newMember.user.tag, details: { roleName } };
                await sendLog(client, newMember.guild, embed, firestoreData);
                // ★★★★★【ここまで変更】★★★★★
            }
        }
    });
};