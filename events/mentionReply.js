const { Events } = require('discord.js');
const chalk = require('chalk');
const { doc, getDoc } = require('firebase/firestore');

/**
 * Gemini AIにチャット応答を生成させる関数
 * @param {import('discord.js').Client} client - Discordクライアント
 * @param {import('discord.js').Message} message - ユーザーからのメッセージ
 * @param {object} aiConfig - AI設定オブジェクト
 * @returns {Promise<string>} - 生成された応答テキスト
 */
async function generateChatResponse(client, message, aiConfig) {
    try {
        const user = message.member.displayName;
        const server = message.guild.name;
        const userMessage = message.content.replace(/<@!?\d+>/g, '').trim();

        if (!userMessage) {
            return 'こんにちは！何か御用でしょうか？';
        }

        const personalityPrompt = aiConfig.aiPersonalityPrompt || `あなたは「OrderlyCore」という名前の、親しみやすく有能なDiscordアシスタントAIです。ユーザーとの自然な対話をしてください。

# あなたの役割
- ユーザーの発言に対して、フレンドリーかつ的確に返答してください。
- 簡潔で分かりやすい文章を心がけてください。
- ユーザーを助け、サーバーでの体験がより良くなるような応答を目指してください。
- ユーモアを交えた返答も歓迎されます。`;

        const prompt = `あなたはDiscordサーバーで活動するAIです。以下の【ペルソナ設定】と【厳格なルール】に完璧に従って、ユーザーのメッセージに応答してください。

### ペルソナ設定
${personalityPrompt}

### 厳格なルール
- あなた自身の名前は「OrderlyCore」です。一人称はペルソナ設定に従ってください。
- 回答は自然な日本語の会話口調で、親しみやすくしてください。
- ユーザーへの敬称は「さん」付けを基本としますが、ペルソナ設定に別指示があればそちらを優先してください。
- 回答は**200文字以内**の簡潔な文章にまとめてください。
- **回答には、あなたの応答メッセージのみを含めてください。** 前置きや解説、余計な記号（例: 「」、「」, *）は絶対に使用しないでください。

### 対話のコンテキスト
- サーバー名: ${server}
- 発言者: ${user}
- ユーザーからのメッセージ: "${userMessage}"

### あなたの応答:`;

        const result = await client.geminiModel.generateContent(prompt);
        const text = result.response.text().trim().replace(/```/g, '');

        console.log(chalk.magenta(`[Gemini Chat] User: ${userMessage} | AI: ${text}`));
        return text;
    } catch (error) {
        console.error(chalk.red('❌ Gemini APIでのチャット応答生成に失敗:'), error.message);
        return 'うーん、ちょっと考えがまとまらないみたいです…。もう一度話しかけてもらえますか？';
    }
}

/**
 * メンションを処理するメイン関数
 * @param {import('discord.js').Message} message
 * @param {import('discord.js').Client} client
 */
async function handleMention(message, client) {
    if (!message.guild || message.author.bot) return;

    if (message.mentions.everyone) {
        return;
    }

    if (!message.mentions.has(client.user.id)) {
        return;
    }

    try {
        const settingsRef = doc(client.db, 'guild_settings', message.guild.id);
        const docSnap = await getDoc(settingsRef);
        const settings = docSnap.exists() ? docSnap.data() : {};
        const aiConfig = settings.ai || { mentionReplyEnabled: true, aiPersonalityPrompt: '' };

        if (aiConfig.mentionReplyEnabled === false) {
            return;
        }

        await message.channel.sendTyping();

        const replyText = await generateChatResponse(client, message, aiConfig);

        await message.reply({
            content: replyText,
            allowedMentions: {
                repliedUser: false
            }
        });

    } catch (error) {
        console.error(chalk.red('❌ メンション応答処理中にエラーが発生しました:'), error);
        try {
            await message.reply({
                content: 'ごめんなさい、応答中に予期せぬエラーが発生してしまいました。',
                allowedMentions: { repliedUser: false }
            });
        } catch (replyError) {
            console.error(chalk.red('❌ エラーメッセージの送信にも失敗しました:'), replyError);
        }
    }
}

module.exports = (client) => {
    client.on(Events.MessageCreate, (message) => handleMention(message, client));
};