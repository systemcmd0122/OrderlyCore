const { SlashCommandBuilder, Colors, EmbedBuilder } = require('discord.js');
const { getUserLimitInfo, getGlobalLimitInfo } = require('../src/services/aiLimitService');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ai-limit')
        .setDescription('AIのレート制限情報を確認します')
        .addSubcommand(subcommand =>
            subcommand
                .setName('me')
                .setDescription('自分のレート制限情報を表示します')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('global')
                .setDescription('サーバー全体のレート制限情報を表示します')
        ),

    async execute(interaction) {
        try {
            const subcommand = interaction.options.getSubcommand();

            if (subcommand === 'me') {
                await showUserLimit(interaction);
            } else if (subcommand === 'global') {
                await showGlobalLimit(interaction);
            }
        } catch (error) {
            console.error(`[AI Limit Command] Error:`, error);
            await interaction.reply({
                content: '[ERROR] レート制限情報の取得に失敗しました。',
                ephemeral: true
            }).catch(() => { });
        }
    }
};

/**
 * ユーザーのレート制限情報を表示
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function showUserLimit(interaction) {
    try {
        await interaction.deferReply();

        const limitInfo = await getUserLimitInfo(interaction.client.rtdb, interaction.user.id);

        if (!limitInfo) {
            return await interaction.editReply({
                content: '[INFO] あなたはまだAIを使用していません。'
            });
        }

        const embed = new EmbedBuilder()
            .setColor(Colors.Blurple)
            .setTitle(`📊 ${interaction.user.username} のAIレート制限情報`)
            .addFields(
                {
                    name: '📈 リクエスト統計',
                    value: [
                        `**総リクエスト**: ${limitInfo.totalRequests || 0}`,
                        `**成功**: ${limitInfo.successRequests || 0}`,
                        `**失敗**: ${limitInfo.failedRequests || 0}`,
                        `**成功率**: ${limitInfo.totalRequests > 0 ? Math.round((limitInfo.successRequests / limitInfo.totalRequests) * 1000) / 10 : 0}%`
                    ].join('\n'),
                    inline: false
                },
                {
                    name: '⚠️ レート制限情報',
                    value: [
                        `**制限回数**: ${limitInfo.rateLimitedCount || 0}`,
                        `**最後の制限**: ${limitInfo.lastRateLimitTime ? new Date(limitInfo.lastRateLimitTime).toLocaleString('ja-JP') : 'なし'}`
                    ].join('\n'),
                    inline: false
                },
                {
                    name: '⏱️ タイムスタンプ',
                    value: [
                        `**最後のリクエスト**: ${limitInfo.lastRequestTime ? new Date(limitInfo.lastRequestTime).toLocaleString('ja-JP') : 'なし'}`,
                        `**最終更新**: ${new Date(limitInfo.updatedAt).toLocaleString('ja-JP')}`
                    ].join('\n'),
                    inline: false
                }
            )
            .setFooter({ text: '情報は分単位で更新されます' })
            .setTimestamp();

        // ステータス判定
        if (limitInfo.rateLimitedCount > 5) {
            embed.addFields({
                name: '⚠️ 警告',
                value: 'レート制限に複数回到達しています。しばらく時間をおいてからお使いください。',
                inline: false
            });
        }

        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        console.error(`[AI Limit Command] Error showing user limit:`, error);
        await interaction.editReply({
            content: '[ERROR] 情報の取得に失敗しました。'
        });
    }
}

/**
 * グローバルレート制限情報を表示
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function showGlobalLimit(interaction) {
    try {
        await interaction.deferReply();

        const globalInfo = await getGlobalLimitInfo(interaction.client.rtdb);

        if (!globalInfo) {
            return await interaction.editReply({
                content: '[INFO] レート制限情報がまだ記録されていません。'
            });
        }

        const embed = new EmbedBuilder()
            .setColor(Colors.Gold)
            .setTitle('🌍 AIレート制限 グローバル情報')
            .addFields(
                {
                    name: '👥 ユーザー統計',
                    value: [
                        `**AI使用ユーザー数**: ${globalInfo.totalUsers}`,
                        `**総リクエスト数**: ${globalInfo.totalRequests}`,
                        `**成功リクエスト**: ${globalInfo.totalSuccess}`,
                        `**失敗リクエスト**: ${globalInfo.totalFailed}`
                    ].join('\n'),
                    inline: false
                },
                {
                    name: '📊 リクエスト成功率',
                    value: `**${globalInfo.successRate}%**`,
                    inline: true
                },
                {
                    name: '⚠️ 制限発生回数',
                    value: `**${globalInfo.totalRateLimited}回**`,
                    inline: true
                }
            );

        // 最近レート制限を受けたユーザーを表示
        if (globalInfo.recentlyLimited.length > 0) {
            const recentlyLimitedText = globalInfo.recentlyLimited
                .map((item, index) => `${index + 1}. <@${item.userId}> - ${item.timeDiffMinutes}分前`)
                .join('\n');

            embed.addFields({
                name: '🔴 最近レート制限を受けたユーザー (直近1時間)',
                value: recentlyLimitedText || 'なし',
                inline: false
            });
        }

        embed
            .setFooter({ text: 'サーバー全体のAI利用統計です' })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        console.error(`[AI Limit Command] Error showing global limit:`, error);
        await interaction.editReply({
            content: '[ERROR] グローバル情報の取得に失敗しました。'
        });
    }
}
