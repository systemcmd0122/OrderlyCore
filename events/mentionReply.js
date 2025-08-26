// systemcmd0122/overseer/overseer-73bfc1e5f235bcccdbf7f2400b84767315a3e964/events/mentionReply.js
const { Events } = require('discord.js');
const chalk = require('chalk');
const { doc, getDoc } = require('firebase/firestore');

// Gemini AIにチャット応答を生成させる関数
async function generateChatResponse(client, message, aiConfig) {
    try {
        const user = message.member.displayName;
        const server = message.guild.name;
        const userMessage = message.content.replace(/<@!?\d+>/g, '').trim();

        // カスタムプロンプトがあればそれを使い、なければデフォルトのプロンプトを使用
        const personalityPrompt = aiConfig.aiPersonalityPrompt || `あなたは「Overseer」という名前の、親しみやすく有能なDiscordアシスタントAIです。ユーザーとの自然な対話をしてください。

# あなたの役割
- ユーザーの発言に対して、フレンドリーかつ的確に返答してください。
- 簡潔で分かりやすい文章を心がけてください。
- ユーザーを助け、サーバーでの体験がより良くなるような応答を目指してください。
- ユーモアを交えた返答も歓迎されます。`;

        const prompt = `${personalityPrompt}

# 対話のコンテキスト
- サーバー名: ${server}
- 発言者: ${user}
- ユーザーからのメッセージ: "${userMessage}"

# あなたの応答:`;

        const result = await client.geminiModel.generateContent(prompt);
        const text = result.response.text();
        console.log(chalk.magenta(`[Gemini Chat] User: ${userMessage} | AI: ${text}`));
        return text;
    } catch (error) {
        console.error(chalk.red('❌ Gemini APIでのチャット応答生成に失敗:'), error.message);
        return 'うーん、ちょっと考えがまとまらないみたいです…。もう一度話しかけてもらえますか？';
    }
}

async function handleMention(message, client) {
    if (!message.guild || message.author.bot) return;

    if (!message.mentions.has(client.user.id)) {
        return;
    }

    try {
        // サーバーのAI設定を取得
        const settingsRef = doc(client.db, 'guild_settings', message.guild.id);
        const docSnap = await getDoc(settingsRef);
        const settings = docSnap.exists() ? docSnap.data() : {};
        const aiConfig = settings.ai || { mentionReplyEnabled: true, aiPersonalityPrompt: '' };
        
        // メンション応答機能が無効化されている場合は処理を中断
        if (!aiConfig.mentionReplyEnabled) {
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