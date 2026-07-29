const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const { createStandardEmbed, COLORS } = require('../src/utils/embedBuilder');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('welcome-config')
        .setDescription('ウェルカム設定を管理します（Webダッシュボード推奨）'),
    
    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
            return await interaction.reply({ content: '[ERROR] 権限が不足しています。', ephemeral: true });
        }
        
        const loginUrl = `${process.env.APP_URL || 'http://localhost:8000'}/dashboard`;
        const embed = createStandardEmbed({
            title: '[WEB] ダッシュボードへ',
            description: 'ウェルカムメッセージ等の設定は、Webダッシュボードから行えます。',
            color: COLORS.PRIMARY,
            fields: [
                { name: 'アクセス方法', value: '`/login` コマンドでログインしてください。' },
                { name: 'URL', value: `[ダッシュボード](${loginUrl})` }
            ]
        });

        await interaction.reply({ embeds: [embed], ephemeral: true });
    },
};
