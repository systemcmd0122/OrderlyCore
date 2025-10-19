const { Events } = require('discord.js');
const chalk = require('chalk');
const { doc, getDoc } = require('firebase/firestore');
const fetch = require('node-fetch');

/**
 * 🔍 無料のDuckDuckGo検索APIで最新情報を取得
 * @param {string} query - 検索クエリ
 * @returns {Promise<string>} - 検索結果のサマリー
 */
async function performWebSearch(query) {
    try {
        const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1`;
        const res = await fetch(url);
        const data = await res.json();

        // 直接の要約があればそれを使う
        if (data.AbstractText) {
            return data.AbstractText;
        }

        // 関連トピックから抜粋を作る
        if (data.RelatedTopics && data.RelatedTopics.length > 0) {
            const summaries = data.RelatedTopics.slice(0, 3)
                .map((t, i) => `${i + 1}. ${t.Text}`)
                .join('\n');
            return summaries || '（検索結果なし）';
        }

        return '（該当する情報が見つかりませんでした）';
    } catch (err) {
        console.error(chalk.red('❌ DuckDuckGo検索エラー:'), err);
        return '（検索エラーが発生しました）';
    }
}

/**
 * 💬 Gemini AI にチャット応答を生成させる関数
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').Message} message
 * @param {object} aiConfig
 */
async function generateChatResponse(client, message, aiConfig) {
    try {
        const user = message.member.displayName;
        const server = message.guild.name;
        const userMessage = message.content.replace(/<@!?\d+>/g, '').trim();

        if (!userMessage) {
            return 'こんにちは！何か御用でしょうか？';
        }

        // 🔎 無料Web検索
        const webResults = await performWebSearch(userMessage);

        const personalityPrompt = aiConfig.aiPersonalityPrompt || `あなたは「OrderlyCore」という名前の、親しみやすく有能なDiscordアシスタントAIです。`;

        const prompt = `あなたはDiscordサーバーで活動するAI「OrderlyCore」です。
以下の設定と最新情報を参考に、自然で簡潔な返答を生成してください。

### ペルソナ
${personalityPrompt}

### ルール
- 会話は親しみやすく200文字以内。
- 余計な記号や説明文は不要。
- 回答はユーザーへの返答のみ。

### 会話コンテキスト
- サーバー名: ${server}
- 発言者: ${user}
- ユーザーのメッセージ: "${userMessage}"

### DuckDuckGoから取得した最新情報
${webResults}

### あなたの応答:`;

        const result = await client.geminiModel.generateContent(prompt);
        const text = result.response.text().trim().replace(/```/g, '');

        console.log(chalk.magenta(`[Gemini Chat] User: ${userMessage} | AI: ${text}`));
        return text;
    } catch (error) {
        console.error(chalk.red('❌ Gemini APIでの応答生成失敗:'), error);
        return 'うーん、ちょっと考えがまとまらないみたいです…。もう一度話しかけてもらえますか？';
    }
}

/**
 * 👋 メンション応答メイン関数
 * @param {import('discord.js').Message} message
 * @param {import('discord.js').Client} client
 */
async function handleMention(message, client) {
    if (!message.guild || message.author.bot) return;
    if (message.mentions.everyone) return;
    if (!message.mentions.has(client.user.id)) return;

    try {
        const settingsRef = doc(client.db, 'guild_settings', message.guild.id);
        const docSnap = await getDoc(settingsRef);
        const settings = docSnap.exists() ? docSnap.data() : {};
        const aiConfig = settings.ai || { mentionReplyEnabled: true, aiPersonalityPrompt: '' };

        if (aiConfig.mentionReplyEnabled === false) return;

        await message.channel.sendTyping();
        const replyText = await generateChatResponse(client, message, aiConfig);

        await message.reply({
            content: replyText,
            allowedMentions: { repliedUser: false }
        });
    } catch (error) {
        console.error(chalk.red('❌ メンション応答処理中にエラー:'), error);
        try {
            await message.reply({
                content: 'ごめんなさい、応答中にエラーが発生してしまいました。',
                allowedMentions: { repliedUser: false }
            });
        } catch (replyError) {
            console.error(chalk.red('❌ エラーメッセージ送信にも失敗:'), replyError);
        }
    }
}

module.exports = (client) => {
    client.on(Events.MessageCreate, (message) => handleMention(message, client));
};
