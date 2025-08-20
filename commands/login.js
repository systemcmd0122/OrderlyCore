const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } = require('discord.js');
const { ref, set } = require('firebase/database');
const { v4: uuidv4 } = require('uuid');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('login')
        .setDescription('Webダッシュボードにログインするためのワンタイムトークンを発行します。'),
    async execute(interaction) {
        // サーバー管理者のみが実行可能
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
            return interaction.reply({
                content: '❌ このコマンドを実行するには「サーバーの管理」権限が必要です。',
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
            expiresAt: Date.now() + 300000, // 5分間有効
        };

        try {
            await set(tokenRef, tokenData);

            const loginUrl = `${process.env.APP_URL || 'http://localhost:8000'}login`;

            const embed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle('🔑 Webダッシュボード ログイン')
                .setDescription('以下のトークンをWebサイトで入力してログインしてください。このトークンは **5分間** のみ有効です。')
                .addFields(
                    { name: '認証トークン', value: `\`\`\`${token}\`\`\`` },
                    { name: 'ログインページ', value: `[こちらをクリック](${loginUrl})` }
                )
                .setFooter({ text: 'このメッセージはあなたにのみ表示されています。トークンを他人と共有しないでください。' })
                .setTimestamp();

            await interaction.user.send({ embeds: [embed] }).catch(async () => {
                 await interaction.editReply({
                    content: '❌ あなたのDMにメッセージを送信できませんでした。DMの受信設定を確認してください。',
                });
                 // DM送信失敗時はトークンを削除
                 await remove(tokenRef);
                 return;
            });
            
            await interaction.editReply({
                content: '✅ あなたのDMにログイン用のトークンを送信しました。確認してください。',
            });

        } catch (error) {
            console.error('Login command error:', error);
            await interaction.editReply({
                content: '❌ ログインセッションの作成中にエラーが発生しました。',
            });
        }
    },
};