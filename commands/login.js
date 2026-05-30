const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const { ref, set } = require('firebase/database');
const { v4: uuidv4 } = require('uuid');
const { createStandardEmbed, COLORS } = require('../src/utils/embedBuilder');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('login')
        .setDescription('Webダッシュボードにログインするためのワンタイムトークンを発行します。'),
    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
            return interaction.reply({
                content: '[ERROR] このコマンドを実行するには「サーバーの管理」権限が必要です。',
                ephemeral: true,
            });
        }

        await interaction.deferReply({ ephemeral: true });

        const token = uuidv4();
        const rtdb = interaction.client.rtdb;
        const tokenRef = ref(rtdb, `authTokens/${token}`);

        const tokenData = {
            userId: interaction.user.id,
            guildId: interaction.guild.id,
            createdAt: Date.now(),
            expiresAt: Date.now() + 300000,
        };

        try {
            await set(tokenRef, tokenData);
            const loginUrl = `${process.env.APP_URL || 'http://localhost:8000'}login`;

            const embed = createStandardEmbed({
                title: '[AUTH] Web Dashboard Login',
                description: '以下のトークンを使用してログインしてください。このトークンは **5分間** 有効です。',
                color: COLORS.PRIMARY,
                fields: [
                    { name: '認証トークン', value: `\`\`\`${token}\`\`\`` },
                    { name: 'ログインURL', value: `[こちらをクリック](${loginUrl})` }
                ],
                footer: { text: '他人と共有しないでください' }
            });

            await interaction.user.send({ embeds: [embed] }).catch(async () => {
                 await interaction.editReply({ content: '[ERROR] DMの送信に失敗しました。受信設定を確認してください。' });
                 return;
            });
            
            await interaction.editReply({ content: '[OK] DMにログイン用トークンを送信しました。' });

        } catch (error) {
            console.error('[ERROR] Login command error:', error);
            await interaction.editReply({ content: '[ERROR] エラーが発生しました。' });
        }
    },
};
