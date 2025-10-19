const { Events } = require('discord.js');
const chalk = require('chalk');
const { doc, getDoc } = require('firebase/firestore');
const { chromium } = require('playwright');

/**
 * 🔍 PlaywrightでDuckDuckGoを検索し、上位3件を取得
 * @param {string} query - 検索クエリ
 * @returns {Promise<string>} - 検索結果のタイトル＋要約まとめ
 */
async function performWebSearch(query) {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    try {
        await page.goto('https://duckduckgo.com/', { waitUntil: 'domcontentloaded' });

        // 検索入力して送信
        await page.fill('input[name="q"]', query);
        await page.keyboard.press('Enter');

        await page.waitForSelector('.react-results--main', { timeout: 10000 });

        // 上位3件の結果を取得
        const results = await page.$$eval('.react-results--main .result__body', (items) =>
            items.slice(0, 3).map((el) => {
                const title = el.querySelector('.result__title')?.innerText?.trim() || 'タイトル不明';
                const snippet = el.querySelector('.result__snippet')?.innerText?.trim() || '';
                return `${title} - ${snippet}`;
            })
        );

        await browser.close();
        if (results.length === 0) return '（検索結果が見つかりませんでした）';
        return results.join('\n');
    } catch (err) {
        console.error(chalk.red('❌ Playwright検索エラー:'), err);
        await browser.close();
        return '（検索中にエラーが発生しました）';
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

        // 🔎 PlaywrightでWeb検索
        const webResults = await performWebSearch(userMessage);

        const personalityPrompt =
            aiConfig.aiPersonalityPrompt ||
            `あなたは「OrderlyCore」という名前の、親しみやすく有能なDiscordアシスタントAIです。`;

        const prompt = `あなたはDiscordサーバーで活動するAI「OrderlyCore」です。
以下の設定と最新の検索情報を参考に、自然で親しみやすい返答を生成してください。

### ペルソナ
${personalityPrompt}

### 応答ルール
- 会話は自然でフレンドリーに。
- 200文字以内に収めてください。
- 不要な記号や前置きは不要です。
- 返答はメッセージ本文のみ。

### 会話情報
- サーバー名: ${server}
- 発言者: ${user}
- ユーザーのメッセージ: "${userMessage}"

### 最新のウェブ検索結果
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
