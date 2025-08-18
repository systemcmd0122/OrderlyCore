const { Events, EmbedBuilder } = require('discord.js');
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
        if (!message.guild || message.author?.bot) return;

        const embed = new EmbedBuilder()
            .setColor(0xff6b6b)
            .setTitle('メッセージ削除')
            .setDescription(`**チャンネル:** ${message.channel}\n**送信者:** ${message.author.tag} (${message.author.id})`)
            .addFields({ name: '内容', value: message.content.substring(0, 1024) || '（内容なし）' })
            .setTimestamp();
        await sendLog(client, message.guild, embed);
    });

    // メッセージ編集
    client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
        if (!newMessage.guild || newMessage.author?.bot || oldMessage.content === newMessage.content) return;

        const embed = new EmbedBuilder()
            .setColor(0x3498db)
            .setTitle('メッセージ編集')
            .setDescription(`**チャンネル:** ${newMessage.channel}\n**送信者:** ${newMessage.author.tag}`)
            .addFields(
                { name: '変更前', value: oldMessage.content.substring(0, 1024) || '（内容なし）' },
                { name: '変更後', value: newMessage.content.substring(0, 1024) || '（内容なし）' }
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
            embed.setTitle('ロール剥奪').addFields({ name: '剥奪されたロール', value: `${removedRole.name}` });
        } else { // ロール付与
            const addedRole = newRoles.find(role => !oldRoles.has(role.id));
            embed.setTitle('ロール付与').addFields({ name: '付与されたロール', value: `${addedRole.name}` });
        }
        await sendLog(client, newMember.guild, embed);
    });
};