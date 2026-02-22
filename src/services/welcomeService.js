const chalk = require('chalk');

async function generateWelcomeWithGemini(client, member) {
    const { user, guild } = member;
    try {
        const prompt = `あなたはDiscordサーバーの歓迎担当AIです。新しく参加したユーザーを温かく、そしてクリエイティブに歓迎するメッセージを作成してください。

# 指示
- ポジティブで、歓迎の意が伝わるフレンドリーな文章を生成してください。
- 以下の情報を文章に必ず含めてください。
  - ユーザー名: ${user.displayName}
  - サーバー名: ${guild.name}
  - 現在のメンバー数: ${guild.memberCount}
- 生成する文章は必ず**タイトル**と**説明文**の2つの部分に分けてください。
- タイトルは「🎉」や「ようこそ！」などの絵文字を含んだ短いフレーズにしてください。（20文字以内）
- 説明文は、ユーザーへの呼びかけから始まり、サーバーの簡単な紹介や、これから始まる素晴らしい体験への期待感を抱かせるような、少し長めの文章にしてください。（150文字以内）
- 必ずJSON形式で、{"title": "生成したタイトル", "description": "生成した説明文"} の形式で出力してください。`;

        const result = await client.geminiModel.generateContent(prompt);
        const text = result.response.text().replace(/```json|```/g, '').trim();
        return JSON.parse(text);
    } catch (error) {
        console.error('❌ Geminiでのウェルカムメッセージ生成エラー:', error);
        return {
            title: `🎉 ${guild.name}へようこそ！`,
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
