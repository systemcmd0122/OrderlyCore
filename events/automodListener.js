const { Events } = require('discord.js');
const { doc, getDoc } = require('firebase/firestore');
const { createStandardEmbed, COLORS } = require('../src/utils/embedBuilder');

async function handleMessage(message, client) {
    if (!message.guild || message.author.bot) return;

    const guildId = message.guild.id;
    const db = client.db;
    const settingsRef = doc(db, 'guild_settings', guildId);

    try {
        const docSnap = await getDoc(settingsRef);
        if (!docSnap.exists() || !docSnap.data().automod) return;

        const config = docSnap.data().automod;
        const content = message.content.toLowerCase();

        // 1. NGワードチェック
        if (config.ngWords && config.ngWords.length > 0) {
            const foundWord = config.ngWords.find(word => content.includes(word.toLowerCase()));
            if (foundWord) {
                await message.delete().catch(() => {});
                const embed = createStandardEmbed({
                    title: '[AUTOMOD] メッセージ削除',
                    description: `不適切な単語が含まれていたため、メッセージを削除しました。`,
                    color: COLORS.ERROR,
                    footer: { text: `対象サーバー: ${message.guild.name}` }
                });
                const dm = await message.author.send({ embeds: [embed] }).catch(() => null);
                if (dm) setTimeout(() => dm.delete().catch(() => {}), 30000);
                return;
            }
        }

        // 2. 招待リンクチェック
        if (config.blockInvites) {
            const inviteRegex = /(discord\.(gg|io|me|li)|discordapp\.com\/invite)\/[^\s/]+?(?=\b)/;
            if (inviteRegex.test(content)) {
                await message.delete().catch(() => {});
                const embed = createStandardEmbed({
                    title: '[AUTOMOD] 招待リンク禁止',
                    description: `このサーバーでは招待リンクの投稿は禁止されています。`,
                    color: COLORS.ERROR,
                    footer: { text: `対象サーバー: ${message.guild.name}` }
                });
                const dm = await message.author.send({ embeds: [embed] }).catch(() => null);
                if (dm) setTimeout(() => dm.delete().catch(() => {}), 30000);
            }
        }

    } catch (error) {
        console.error('[ERROR] オートモデレーターの処理失敗:', error);
    }
}

module.exports = (client) => {
    client.on(Events.MessageCreate, (message) => handleMessage(message, client));
    client.on(Events.MessageUpdate, (oldMessage, newMessage) => handleMessage(newMessage, client));
};
