const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('welcome-config')
        .setDescription('ウェルカム設定を管理します（Webダッシュボード推奨）'),
    
    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
            return await interaction.reply({
                content: '❌ この機能を使用するには「サーバー管理」権限が必要です。',
                ephemeral: true
            });
        }
        
        const loginUrl = `${process.env.APP_URL || 'http://localhost:8000'}/dashboard`;

        const embed = new EmbedBuilder()
            .setColor(0x3498db)
            .setTitle('🖥️ ウェルカム設定はWebダッシュボードへ')
            .setDescription(
                '現在、ウェルカムメッセージや参加・退出に関するすべての設定は、Webダッシュボードから行うことを推奨しています。\n\n' +
                'より直感的で詳細なカスタマイズが可能です。'
            )
            .addFields(
                { name: 'ダッシュボードへのアクセス方法', value: '`/login` コマンドを実行し、発行されたトークンを使ってログインしてください。' },
                { name: 'ダッシュボード URL', value: `[こちらをクリック](${loginUrl})` }
            )
            .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });
    },
};