const { SlashCommandBuilder, ChannelType, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { doc, getDoc, setDoc } = require('firebase/firestore');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leveling-config')
        .setDescription('レベリングシステムに関する設定を行います。')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(subcommand =>
            subcommand
                .setName('setup')
                .setDescription('レベルアップ通知を送信するチャンネルを設定します。')
                .addChannelOption(option =>
                    option.setName('channel')
                        .setDescription('通知の送信先チャンネル')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('disable')
                .setDescription('レベルアップ通知機能を無効化します。')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('view')
                .setDescription('現在のレベルアップ通知設定を表示します。')
        ),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const subcommand = interaction.options.getSubcommand();
        const guildId = interaction.guild.id;
        const db = interaction.client.db;
        // サーバー全体の設定を保存するコレクション名を 'guild_settings' に統一
        const settingsRef = doc(db, 'guild_settings', guildId);

        try {
            if (subcommand === 'setup') {
                const channel = interaction.options.getChannel('channel');

                // 既存の設定とマージする形で保存
                await setDoc(settingsRef, {
                    levelUpChannel: channel.id
                }, { merge: true });

                const embed = new EmbedBuilder()
                    .setColor(0x00ff00)
                    .setTitle('✅ 設定完了')
                    .setDescription(`レベルアップ通知の送信先を ${channel} に設定しました。`);
                await interaction.editReply({ embeds: [embed] });

            } else if (subcommand === 'disable') {
                // 既存の設定とマージする形で更新 (nullでフィールドを削除)
                await setDoc(settingsRef, {
                    levelUpChannel: null
                }, { merge: true });

                const embed = new EmbedBuilder()
                    .setColor(0xffcc00)
                    .setTitle('設定解除')
                    .setDescription('レベルアップ通知機能を無効化しました。\n(今後はレベルアップしたチャンネルに通知が送られます)');
                await interaction.editReply({ embeds: [embed] });

            } else if (subcommand === 'view') {
                const docSnap = await getDoc(settingsRef);
                const settings = docSnap.exists() ? docSnap.data() : {};
                const channelId = settings.levelUpChannel;

                const embed = new EmbedBuilder()
                    .setColor(0x5865F2)
                    .setTitle('現在のレベルアップ通知設定');

                if (channelId) {
                    const channel = interaction.guild.channels.cache.get(channelId);
                    embed.setDescription(`レベルアップ通知は ${channel || '不明なチャンネル'} に送信されます。`);
                } else {
                    embed.setDescription('専用の通知チャンネルは設定されていません。\n(レベルアップしたチャンネルに通知が送られます)');
                }
                await interaction.editReply({ embeds: [embed] });
            }
        } catch (error) {
            console.error('leveling-config コマンドエラー:', error);
            await interaction.editReply({ content: '❌ 設定中にエラーが発生しました。' });
        }
    }
};