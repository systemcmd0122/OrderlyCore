// systemcmd0122/overseer/overseer-394ca3129fcc24030a0ae314b6b57cd13daba62c/events/levelingSystem.js
const { Events, EmbedBuilder } = require('discord.js');
const { doc, getDoc, setDoc, updateDoc, increment, collection, query, where, orderBy, getDocs } = require('firebase/firestore');
const chalk = require('chalk');

// レベルアップに必要なXPを計算する関数
const calculateRequiredXp = (level) => 5 * (level ** 2) + 50 * level + 100;

// Gemini AIにレベルアップコメントを生成させる関数
async function generateLevelUpComment(client, user, newLevel, serverName) {
    try {
        const prompt = `あなたはDiscordサーバーの優秀なアシスタントAIです。ユーザーのレベルアップを、その人の功績を称え、今後の活躍を期待するような、ユニークでクリエイティブなメッセージで祝福してください。

# 指示
- 非常にポジティブで、少しだけ壮大な雰囲気の文章を生成してください。
- 以下の情報を文章に必ず含めてください。
  - ユーザー名: ${user.displayName}
  - 新しいレベル: ${newLevel}
  - サーバー名: ${serverName}
- 生成する文章は必ず一行で、80文字以内に収めてください。
- 毎回必ず違うパターンの文章を生成してください。

# 生成例
- 「${serverName}の歴史に名を刻む時が来た！${user.displayName}よ、レベル${newLevel}への到達、誠におめでとう！」
- 「天晴れ！${user.displayName}の活躍により${serverName}は新たな時代へ。伝説はレベル${newLevel}から始まる！」
- 「${serverName}に新たな光が灯った！${user.displayName}、レベル${newLevel}への昇格、心より祝福する。」`;

        const result = await client.geminiModel.generateContent(prompt);
        const text = result.response.text().trim().replace(/\n/g, ''); // 改行を削除
        console.log(chalk.magenta(`[Gemini] Generated comment: ${text}`));
        return text;
    } catch (error) {
        console.error(chalk.red('❌ Gemini APIでのコメント生成に失敗:'), error.message);
        // APIエラー時のフォールバックメッセージ
        return `**<@${user.id}> が新たな境地へ到達しました！**\n絶え間ない努力が実を結び、サーバー内での存在感がさらに増しました。`;
    }
}


// ユーザーデータを取得または新規作成する関数
async function getLevelData(db, guildId, userId) {
    const userRef = doc(db, 'levels', `${guildId}_${userId}`);
    const docSnap = await getDoc(userRef);
    if (docSnap.exists()) {
        const data = docSnap.data();
        if (typeof data.level === 'undefined') {
            data.level = 0;
        }
        return data;
    }
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
    
    const userData = await getLevelData(db, guildId, userId);

    const now = Date.now();
    if (now - (userData.lastMessageTimestamp || 0) < 60000) {
        return;
    }

    const xpGained = Math.floor(Math.random() * 11) + 15;
    
    const userRef = doc(db, 'levels', `${guildId}_${userId}`);
    await setDoc(userRef, {
        xp: increment(xpGained),
        messageCount: increment(1),
        lastMessageTimestamp: now,
        guildId: guildId,
        userId: userId,
        level: userData.level
    }, { merge: true });

    const updatedUserData = await getLevelData(db, guildId, userId);
    
    console.log(chalk.cyan(`[XP] ${author.tag} gained ${xpGained} XP. Total: ${updatedUserData.xp}/${calculateRequiredXp(updatedUserData.level)}`));
    
    let leveledUp = false;
    let oldLevel = updatedUserData.level;
    let currentLevel = updatedUserData.level;
    let requiredXp = calculateRequiredXp(currentLevel);

    while (updatedUserData.xp >= requiredXp) {
        updatedUserData.xp -= requiredXp;
        currentLevel += 1;
        leveledUp = true;
        requiredXp = calculateRequiredXp(currentLevel);
    }

    if (leveledUp) {
        await updateDoc(userRef, {
            level: currentLevel,
            xp: updatedUserData.xp
        });

        console.log(chalk.green(`[LEVEL UP] ${author.tag} reached level ${currentLevel}!`));

        const awesomeComment = await generateLevelUpComment(client, author, currentLevel, guild.name);

        const usersRef = collection(db, 'levels');
        const q = query(usersRef, where('guildId', '==', guildId), orderBy('level', 'desc'), orderBy('xp', 'desc'));
        const snapshot = await getDocs(q);
        let rank = -1;
        snapshot.docs.forEach((doc, index) => {
            if (doc.data().userId === userId) {
                rank = index + 1;
            }
        });
        
        const progress = requiredXp > 0 ? Math.floor((updatedUserData.xp / requiredXp) * 20) : 0;
        const progressBar = `**[** ${'🟦'.repeat(progress)}${'⬛'.repeat(20 - progress)} **]**`;

        const levelUpEmbed = new EmbedBuilder()
            .setColor(0x00FFFF)
            .setAuthor({ name: `LEVEL UP! - ${author.displayName}`, iconURL: author.displayAvatarURL() })
            .setTitle(`《 RANK UP: ${oldLevel}  ➔  ${currentLevel} 》`)
            .setDescription(awesomeComment)
            .setThumbnail(author.displayAvatarURL({ dynamic: true, size: 256 }))
            // ===== ▼▼▼▼▼ 修正箇所 ▼▼▼▼▼ =====
            // .setImage('https://i.imgur.com/2d9UPgJ.gif') // この行を削除またはコメントアウト
            // ===== ▲▲▲▲▲ 修正ここまで ▲▲▲▲▲ =====
            .addFields(
                {
                    name: '📊 現在のステータス',
                    value: `**サーバー内順位:** **${rank !== -1 ? `#${rank}` : 'N/A'}**\n**総メッセージ数:** **${updatedUserData.messageCount.toLocaleString()}** 回`,
                    inline: false
                },
                {
                    name: `🚀 次のレベルまで (Lv. ${currentLevel + 1})`,
                    value: `あと **${(requiredXp - updatedUserData.xp).toLocaleString()}** XP\n${progressBar} **${updatedUserData.xp.toLocaleString()}** / **${requiredXp.toLocaleString()}**`,
                    inline: false
                }
            )
            .setFooter({ text: `偉業達成おめでとうございます！ | ${guild.name}`, iconURL: guild.iconURL() })
            .setTimestamp();
        
        try {
            const settingsRef = doc(db, 'guild_settings', guild.id);
            const settingsSnap = await getDoc(settingsRef);
            const settings = settingsSnap.exists() ? settingsSnap.data() : {};
            
            let targetChannel;
            if (settings.levelUpChannel) {
                targetChannel = await client.channels.fetch(settings.levelUpChannel).catch(() => null);
            }
            if (!targetChannel) {
                targetChannel = message.channel;
            }

            if (targetChannel && targetChannel.isTextBased()) {
                await targetChannel.send({ content: `||<@${userId}>||`, embeds: [levelUpEmbed] });
            }
        } catch (error) {
            console.error(chalk.red('レベルアップ通知の送信に失敗しました:'), error);
        }
    }
}


module.exports = (client) => {
    client.on(Events.MessageCreate, (message) => handleMessage(message, client));
};