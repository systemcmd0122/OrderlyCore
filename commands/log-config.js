const { SlashCommandBuilder, ChannelType, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { doc, getDoc, setDoc } = require('firebase/firestore');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('log-config')
        .setDescription('監査ログに関する設定を行います。')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(subcommand =>
            subcommand
                .setName('setup')
                .setDescription('監査ログを送信するチャンネルを設定します。')
                .addChannelOption(option =>
                    option.setName('channel')
                        .setDescription('ログの送信先チャンネル')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('disable')
                .setDescription('監査ログ機能を無効化します。')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('view')
                .setDescription('現在の監査ログ設定を表示します。')
        ),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const subcommand = interaction.options.getSubcommand();
        const guildId = interaction.guild.id;
        const db = interaction.client.db;
        const settingsRef = doc(db, 'guild_settings', guildId);

        try {
            if (subcommand === 'setup') {
                const channel = interaction.options.getChannel('channel');

                await setDoc(settingsRef, {
                    auditLogChannel: channel.id
                }, { merge: true });

                const embed = new EmbedBuilder()
                    .setColor(0x00ff00)
                    .setTitle('✅ 設定完了')
                    .setDescription(`監査ログの送信先を ${channel} に設定しました。`);
                await interaction.editReply({ embeds: [embed] });

            } else if (subcommand === 'disable') {
                await setDoc(settingsRef, {
                    auditLogChannel: null
                }, { merge: true });

                const embed = new EmbedBuilder()
                    .setColor(0xffcc00)
                    .setTitle('設定解除')
                    .setDescription('監査ログ機能を無効化しました。');
                await interaction.editReply({ embeds: [embed] });

            } else if (subcommand === 'view') {
                const docSnap = await getDoc(settingsRef);
                const settings = docSnap.exists() ? docSnap.data() : {};
                const channelId = settings.auditLogChannel;

                const embed = new EmbedBuilder()
                    .setColor(0x5865F2)
                    .setTitle('現在の監査ログ設定');

                if (channelId) {
                    const channel = interaction.guild.channels.cache.get(channelId);
                    embed.setDescription(`ログは ${channel || '不明なチャンネル'} に送信されます。`);
                } else {
                    embed.setDescription('監査ログは現在無効です。');
                }
                await interaction.editReply({ embeds: [embed] });
            }
        } catch (error) {
            console.error('log-config コマンドエラー:', error);
            await interaction.editReply({ content: '❌ 設定中にエラーが発生しました。' });
        }
    }
};