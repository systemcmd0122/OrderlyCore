const chalk = require('chalk');
const { recordSuccessRequest, recordFailedRequest, isRateLimitError } = require('./aiLimitService');

async function generateWelcomeWithGemini(client, member) {
    const { user, guild } = member;
    try {
        const prompt = `あなたはDiscordサーバーのプロフェッショナルな歓迎担当AIです。新しく参加したユーザーに対する、洗練された歓迎メッセージを作成してください。

# 指示
- 誠実で、かつ歓迎の意が伝わる丁寧な文章を生成してください。
- 以下の情報を文章に必ず含めてください。
  - ユーザー名: ${user.displayName}
  - サーバー名: ${guild.name}
  - 現在のメンバー数: ${guild.memberCount}
- 生成する文章は必ず「タイトル」と「説明文」の2つの部分で構成してください。
- タイトルは「Welcome to our community」などの短いフレーズにしてください（20文字以内）。
- **絶対に絵文字（UTF-8文字、特殊記号、デコレーション等すべて）を使用しないでください。**
- 説明文は、ユーザーへの敬意を表した呼びかけから始め、サーバーのコンセプトに基づいた期待感を抱かせる内容にしてください（150文字以内）。
- 必ずJSON形式で、{"title": "生成したタイトル", "description": "生成した説明文"} の形式で出力してください。`;

        const result = await client.geminiModel.generateContent(prompt);
        let text = result.response.text().trim();
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) text = jsonMatch[0];

        // 成功時にレート制限情報を記録
        await recordSuccessRequest(client.rtdb, user.id).catch(() => { });

        return JSON.parse(text);
    } catch (error) {
        console.error('[ERROR] Geminiでのウェルカムメッセージ生成エラー:', error);

        // 失敗時にレート制限情報を記録
        const isRateLimit = isRateLimitError(error);
        if (isRateLimit) {
            console.warn(chalk.yellow('[AI Limit] Rate limit reached for user:'), user.id);
        }
        await recordFailedRequest(client.rtdb, user.id, isRateLimit).catch(() => { });

        return {
            title: `Welcome to ${guild.name}!`,
            description: `**${user.displayName}**さん、サーバーへのご参加ありがとうございます！これから一緒に楽しみましょう！`
        };
    }
}

function replacePlaceholders(text, member, rulesChannelId) {
    const { user, guild } = member;
    const rulesChannel = rulesChannelId ? `<#${rulesChannelId}>` : 'ルールチャンネル';

    return text
        .replace(/{user.name}/g, user.username)
        .replace(/{user.tag}/g, user.tag)
        .replace(/{user.displayName}/g, user.displayName)
        .replace(/{user.mention}/g, `<@${user.id}>`)
        .replace(/{server.name}/g, guild.name)
        .replace(/{server.memberCount}/g, guild.memberCount.toLocaleString())
        .replace(/{rulesChannel}/g, rulesChannel);
}

module.exports = {
    generateWelcomeWithGemini,
    replacePlaceholders
};
