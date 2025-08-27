// systemcmd0122/overseer/overseer-af267ce1d661f675c497b5c195d79df6613865e9/events/levelingSystem.js
const { Events, EmbedBuilder, PermissionsBitField } = require('discord.js'); // PermissionsBitField を追加
const { doc, getDoc, setDoc, collection, query, where, orderBy, getDocs } = require('firebase/firestore');
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
        const text = result.response.text().trim().replace(/\n/g, '');
        console.log(chalk.magenta(`[Gemini] Generated comment: ${text}`));
        return text;
    } catch (error) {
        console.error(chalk.red('❌ Gemini APIでのコメント生成に失敗:'), error.message);
        return `**${user.displayName} が新たな境地へ到達しました！**\n絶え間ない努力が実を結び、サーバー内での存在感がさらに増しました。`;
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

// ★★★★★【ここから追加】★★★★★
// ロール報酬を処理する関数
async function handleRoleRewards(member, oldLevel, newLevel, settings) {
    const levelingSettings = settings.leveling || {};
    const roleRewards = levelingSettings.roleRewards || [];
    if (roleRewards.length === 0) return;

    // 付与すべきロールを特定
    const rewardsToGive = roleRewards
        .filter(reward => reward.level > oldLevel && reward.level <= newLevel)
        .sort((a, b) => a.level - b.level);

    if (rewardsToGive.length === 0) return;

    // ボットの権限チェック
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

            // ロール階層チェック
            if (role.position >= member.guild.members.me.roles.highest.position) {
                console.warn(chalk.yellow(`[Role Reward] Cannot assign role ${role.name} as it is higher than or equal to the bot's role.`));
                continue;
            }

            if (!member.roles.cache.has(role.id)) {
                await member.roles.add(role);
                awardedRoles.push(role);
                console.log(chalk.green(`[Role Reward] Awarded role "${role.name}" to ${member.user.tag} for reaching level ${reward.level}.`));
            }
        } catch (error) {
            console.error(chalk.red(`[Role Reward] Failed to award role for level ${reward.level} to ${member.user.tag}:`), error);
        }
    }
    return awardedRoles;
}
// ★★★★★【ここまで追加】★★★★★


// レベリング処理のメイン関数
async function handleMessage(message, client) {
    if (!message.guild || message.author.bot) return;

    const { guild, author, member } = message; // member を追加
    const db = client.db;
    const guildId = guild.id;
    const userId = author.id;
    
    const userData = await getLevelData(db, guildId, userId);

    const now = Date.now();
    if (now - (userData.lastMessageTimestamp || 0) < 60000) {
        return;
    }

    const xpGained = Math.floor(Math.random() * 11) + 15;
    userData.xp += xpGained;
    userData.messageCount += 1;
    userData.lastMessageTimestamp = now;

    console.log(chalk.cyan(`[XP] ${author.tag} gained ${xpGained} XP. New Total (pre-calc): ${userData.xp}`));

    let leveledUp = false;
    const oldLevel = userData.level;
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
        console.log(chalk.green(`[LEVEL UP] ${author.tag} reached level ${userData.level}!`));
        
        const settingsRef = doc(db, 'guild_settings', guild.id);
        const settingsSnap = await getDoc(settingsRef);
        const settings = settingsSnap.exists() ? settingsSnap.data() : {};
        
        // ★★★★★【ここから変更】★★★★★
        // ロール報酬処理
        const awardedRoles = await handleRoleRewards(member, oldLevel, userData.level, settings);
        // ★★★★★【ここまで変更】★★★★★

        if (settings.levelUpChannel) {
            const targetChannel = await client.channels.fetch(settings.levelUpChannel).catch(() => null);
            
            if (targetChannel && targetChannel.isTextBased()) {
                const awesomeComment = await generateLevelUpComment(client, author, userData.level, guild.name);

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
                    .setAuthor({ name: `LEVEL UP! - ${author.displayName}`, iconURL: author.displayAvatarURL() })
                    .setTitle(`《 RANK UP: ${oldLevel}  ➔  ${userData.level} 》`)
                    .setDescription(awesomeComment)
                    .setThumbnail(author.displayAvatarURL({ dynamic: true, size: 256 }))
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
                    .setFooter({ text: `偉業達成おめでとうございます！ | ${guild.name}`, iconURL: guild.iconURL() })
                    .setTimestamp();
                
                // ★★★★★【ここから追加】★★★★★
                if (awardedRoles && awardedRoles.length > 0) {
                    levelUpEmbed.addFields({
                        name: '🏆 獲得したロール報酬',
                        value: awardedRoles.map(r => r.toString()).join('\n'),
                        inline: false
                    });
                }
                // ★★★★★【ここまで追加】★★★★★

                try {
                    await targetChannel.send({ embeds: [levelUpEmbed] });
                } catch (error) {
                    console.error(chalk.red('レベルアップ通知の送信に失敗しました:'), error);
                }
            }
        }
    }
}


module.exports = (client) => {
    client.on(Events.MessageCreate, (message) => handleMessage(message, client));
};