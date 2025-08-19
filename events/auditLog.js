const { Events, EmbedBuilder, AuditLogEvent } = require('discord.js');
const { doc, getDoc } = require('firebase/firestore');

// --- 共通ログ送信関数 ---
async function getLogChannelId(client, guildId) {
    const settingsRef = doc(client.db, 'guild_settings', guildId);
    const docSnap = await getDoc(settingsRef);
    if (docSnap.exists() && docSnap.data().auditLogChannel) {
        return docSnap.data().auditLogChannel;
    }
    return null;
}

async function sendLog(client, guild, embed) {
    try {
        const logChannelId = await getLogChannelId(client, guild.id);
        if (logChannelId) {
            const logChannel = await client.channels.fetch(logChannelId);
            if (logChannel && logChannel.isTextBased()) {
                await logChannel.send({ embeds: [embed] });
            }
        }
    } catch (error) {
        console.error('監査ログの送信に失敗しました:', error);
    }
}

// --- イベントリスナー ---
module.exports = (client) => {
    // メッセージ削除
    client.on(Events.MessageDelete, async (message) => {
        if (!message.guild) return;
        // ボット自身のメッセージは無視
        if (message.author && message.author.bot) return;

        // 監査ログが記録されるのを少し待機
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

            // 監査ログから実行者と対象者（メッセージの作者）を特定
            if (deleteLog && (Date.now() - deleteLog.createdTimestamp < 5000)) {
                // ログの対象が削除されたメッセージのチャンネルと一致するか確認
                if (deleteLog.extra.channel.id === message.channel.id) {
                    executor = deleteLog.executor;
                    author = deleteLog.target;
                }
            }

            // 自己削除か、他者による削除かを判断
            if (executor && author && executor.id !== author.id) {
                descriptionText = `**実行者:** ${executor.tag}\n**送信者:** ${author.tag}\n**チャンネル:** ${message.channel}`;
            } else {
                descriptionText = `**送信者:** ${author ? author.tag : '不明なユーザー'}\n**チャンネル:** ${message.channel}`;
            }

            // メッセージ内容はキャッシュにある場合のみ取得
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

            await sendLog(client, message.guild, embed);

        } catch (error) {
            console.error("メッセージ削除ログの処理中にエラー:", error);
        }
    });

    // メッセージ編集
    client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
        if (!newMessage.guild || (newMessage.author && newMessage.author.bot) || oldMessage.content === newMessage.content) return;

        const authorTag = newMessage.author ? newMessage.author.tag : '不明なユーザー';
        const oldContent = oldMessage.content ? oldMessage.content.substring(0, 1024) : '（内容を取得できませんでした）';
        const newContent = newMessage.content ? newMessage.content.substring(0, 1024) : '（内容を取得できませんでした）';

        const embed = new EmbedBuilder()
            .setColor(0x3498db)
            .setTitle('メッセージ編集')
            .setDescription(`**チャンネル:** ${newMessage.channel}\n**送信者:** ${authorTag}`)
            .addFields(
                { name: '変更前', value: oldContent },
                { name: '変更後', value: newContent }
            )
            .setURL(newMessage.url)
            .setTimestamp();
        await sendLog(client, newMessage.guild, embed);
    });
    
    // メンバーのニックネーム変更
    client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
         if (oldMember.nickname === newMember.nickname) return;

         const embed = new EmbedBuilder()
            .setColor(0xf1c40f)
            .setTitle('ニックネーム変更')
            .setDescription(`**対象:** ${newMember.user.tag} (${newMember.id})`)
            .addFields(
                { name: '変更前', value: oldMember.nickname || '（なし）' },
                { name: '変更後', value: newMember.nickname || '（なし）' }
            )
            .setTimestamp();
        await sendLog(client, newMember.guild, embed);
    });

     // ロール変更
    client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
        const oldRoles = oldMember.roles.cache;
        const newRoles = newMember.roles.cache;

        if (oldRoles.size === newRoles.size) return;

        const embed = new EmbedBuilder()
            .setColor(0x9b59b6)
            .setTimestamp()
            .setDescription(`**対象:** ${newMember.user.tag} (${newMember.id})`);

        if (oldRoles.size > newRoles.size) { // ロール剥奪
            const removedRole = oldRoles.find(role => !newRoles.has(role.id));
            if (removedRole) {
                embed.setTitle('ロール剥奪').addFields({ name: '剥奪されたロール', value: `${removedRole.name}` });
                await sendLog(client, newMember.guild, embed);
            }
        } else { // ロール付与
            const addedRole = newRoles.find(role => !oldRoles.has(role.id));
            if (addedRole) {
                embed.setTitle('ロール付与').addFields({ name: '付与されたロール', value: `${addedRole.name}` });
                await sendLog(client, newMember.guild, embed);
            }
        }
    });
};