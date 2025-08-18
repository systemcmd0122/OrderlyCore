const { Events, EmbedBuilder } = require('discord.js');
const { doc, getDoc, setDoc, increment } = require('firebase/firestore');
const chalk = require('chalk');

// レベルアップに必要なXPを計算する関数
const calculateRequiredXp = (level) => 5 * (level ** 2) + 50 * level + 100;

// ユーザーデータを取得または新規作成する関数
async function getLevelData(db, guildId, userId) {
    const userRef = doc(db, 'levels', `${guildId}_${userId}`);
    const docSnap = await getDoc(userRef);
    if (docSnap.exists()) {
        return docSnap.data();
    }
    // 新規ユーザーデータ
    return {
        guildId,
        userId,
        xp: 0,
        level: 0,
        messageCount: 0,
        lastMessageTimestamp: 0
    };
}

// レベリング処理のメイン関数
async function handleMessage(message, client) {
    if (!message.guild || message.author.bot) return;

    const { guild, author } = message;
    const db = client.db;
    const guildId = guild.id;
    const userId = author.id;
    
    // ユーザーデータを取得
    const userData = await getLevelData(db, guildId, userId);

    // 60秒間のクールダウン
    const now = Date.now();
    if (now - userData.lastMessageTimestamp < 60000) {
        return;
    }

    // XPを付与 (15〜25のランダム)
    const xpGained = Math.floor(Math.random() * 11) + 15;
    userData.xp += xpGained;
    userData.messageCount += 1;
    userData.lastMessageTimestamp = now;
    
    let leveledUp = false;
    let requiredXp = calculateRequiredXp(userData.level);

    // レベルアップ判定
    while (userData.xp >= requiredXp) {
        userData.xp -= requiredXp;
        userData.level += 1;
        leveledUp = true;
        requiredXp = calculateRequiredXp(userData.level);
    }

    // データをFirestoreに保存
    const userRef = doc(db, 'levels', `${guildId}_${userId}`);
    await setDoc(userRef, userData, { merge: true });
    
    console.log(chalk.cyan(`[XP] ${author.tag} gained ${xpGained} XP. Total: ${userData.xp}/${requiredXp}`));


    // レベルアップ通知
    if (leveledUp) {
        const levelUpEmbed = new EmbedBuilder()
            .setColor(0xffd700)
            .setTitle('🎉 レベルアップ！')
            .setDescription(`**${author.displayName}** さんが **レベル ${userData.level}** に到達しました！`)
            .setThumbnail(author.displayAvatarURL())
            .addFields(
                { name: '現在のレベル', value: `${userData.level}`, inline: true },
                { name: '次のレベルまで', value: `${requiredXp - userData.xp} XP`, inline: true }
            )
            .setTimestamp();
        
        try {
            // 設定されたレベルアップ通知チャンネルがあればそこに送信、なければメッセージがあったチャンネルに送信
            const settingsRef = doc(db, 'guild_settings', guild.id);
            const settingsSnap = await getDoc(settingsRef);
            const settings = settingsSnap.exists() ? settingsSnap.data() : {};
            
            const channelId = settings.levelUpChannel || message.channel.id;
            const channel = await client.channels.fetch(channelId);
            
            if (channel && channel.isTextBased()) {
                await channel.send({ content: `<@${userId}>`, embeds: [levelUpEmbed] });
                console.log(chalk.green(`[LEVEL UP] Notified ${author.tag} for reaching level ${userData.level}.`));
            }
        } catch (error) {
            console.error(chalk.red('レベルアップ通知の送信に失敗しました:'), error);
        }
    }
}


module.exports = (client) => {
    client.on(Events.MessageCreate, (message) => handleMessage(message, client));
};