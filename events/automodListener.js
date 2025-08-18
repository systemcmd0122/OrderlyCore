const { Events } = require('discord.js');
const { doc, getDoc } = require('firebase/firestore');

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
                await message.delete();
                const dm = await message.author.send(`⚠️ あなたのメッセージはNGワード「${foundWord}」を含んでいたため削除されました。`);
                setTimeout(() => dm.delete().catch(() => {}), 10000); // 10秒後にDMを削除
                return; // 処罰が重複しないようにリターン
            }
        }

        // 2. 招待リンクチェック
        if (config.blockInvites) {
            const inviteRegex = /(discord\.(gg|io|me|li)|discordapp\.com\/invite)\/[^\s/]+?(?=\b)/;
            if (inviteRegex.test(content)) {
                // 許可されたロールを持っているかなどの例外処理をここに追加可能
                await message.delete();
                const dm = await message.author.send(`⚠️ このサーバーでは招待リンクの投稿は禁止されています。`);
                setTimeout(() => dm.delete().catch(() => {}), 10000);
            }
        }
        
        // 3. 連続投稿チェック (簡易版)
        // (より高度な実装にはキャッシュやユーザーごとの投稿履歴管理が必要です)

    } catch (error) {
        console.error('オートモデレーターの処理中にエラー:', error);
    }
}


module.exports = (client) => {
    client.on(Events.MessageCreate, (message) => handleMessage(message, client));
    client.on(Events.MessageUpdate, (oldMessage, newMessage) => handleMessage(newMessage, client));
};