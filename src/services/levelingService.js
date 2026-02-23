const { PermissionsBitField } = require('discord.js');
const { doc, getDoc, setDoc, collection, query, where, orderBy, getDocs } = require('firebase/firestore');
const chalk = require('chalk');

const calculateRequiredXp = (level) => 5 * (level ** 2) + 50 * level + 100;

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
    * **絶対に絵文字を使用しないでください。**`;

        const result = await client.geminiModel.generateContent(prompt);
        const rawText = result.response.text().trim();
        // 改行、アスタリスク、カギカッコを除去し、最初の文章のみを取得
        const text = rawText.replace(/[\n*「」]/g, '').split(/[。！？!?. \n]/)[0];
        return text || `**${user.displayName} が新たな境地へ到達しました！**`;
    } catch (error) {
        console.error(chalk.red('[ERROR] Gemini APIでのコメント生成に失敗:'), error.message);
        return `**${user.displayName} が新たな境地へ到達しました！**`;
    }
}

async function getLevelData(db, guildId, userId) {
    const userRef = doc(db, 'levels', `${guildId}_${userId}`);
    const docSnap = await getDoc(userRef);
    if (docSnap.exists()) {
        const data = docSnap.data();
        return {
            level: 0,
            xp: 0,
            messageCount: 0,
            lastMessageTimestamp: 0,
            ...data
        };
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

async function getRank(db, guildId, userId) {
    try {
        const usersRef = collection(db, 'levels');
        const q = query(usersRef, where('guildId', '==', guildId), orderBy('level', 'desc'), orderBy('xp', 'desc'));
        const snapshot = await getDocs(q);
        let rank = -1;
        snapshot.docs.forEach((doc, index) => {
            if (doc.data().userId === userId) {
                rank = index + 1;
            }
        });
        return rank;
    } catch (error) {
        console.error('Error getting rank:', error);
        return -1;
    }
}

async function handleRoleRewards(member, oldLevel, newLevel, settings) {
    const levelingSettings = settings.leveling || {};
    const roleRewards = levelingSettings.roleRewards || [];
    if (roleRewards.length === 0) return;

    const rewardsToGive = roleRewards
        .filter(reward => reward.level > oldLevel && reward.level <= newLevel)
        .sort((a, b) => a.level - b.level);

    if (rewardsToGive.length === 0) return;

    if (!member.guild.members.me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
        console.error(chalk.red(`[Role Reward] Bot does not have Manage Roles permission.`));
        return;
    }

    let awardedRoles = [];
    for (const reward of rewardsToGive) {
        try {
            const role = member.guild.roles.cache.get(reward.roleId);
            if (!role) continue;
            if (role.position >= member.guild.members.me.roles.highest.position) continue;

            if (!member.roles.cache.has(role.id)) {
                await member.roles.add(role);
                awardedRoles.push(role);
            }
        } catch (error) {
            console.error(chalk.red(`[Role Reward] Failed to award role:`), error);
        }
    }
    return awardedRoles;
}

module.exports = {
    calculateRequiredXp,
    generateLevelUpComment,
    getLevelData,
    getRank,
    handleRoleRewards
};
