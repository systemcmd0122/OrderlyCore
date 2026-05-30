const { SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const { doc, getDoc, setDoc } = require('firebase/firestore');
const chalk = require('chalk');
const { createStandardEmbed, createSuccessEmbed, COLORS } = require('../src/utils/embedBuilder');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rankboard')
        .setDescription('リアルタイムランキングボードを管理します。')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(subcommand =>
            subcommand
                .setName('setup')
                .setDescription('ランキングボードを設置するチャンネルを設定します。')
                .addChannelOption(option =>
                    option.setName('channel')
                        .setDescription('ランキングボードを設置するチャンネル')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('disable')
                .setDescription('ランキングボードを無効化します。')
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

                if (!channel.permissionsFor(interaction.client.user).has([PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ViewChannel])) {
                    return await interaction.editReply({ content: `❌ ${channel} でメッセージを送信・編集する権限がありません。` });
                }

                const initialEmbed = createStandardEmbed({
                    title: `[RANKING] ${interaction.guild.name}`,
                    description: 'ランキングデータを集計中です。しばらくお待ちください...',
                    color: COLORS.PRIMARY,
                    footer: { text: 'システムにより定期的に自動更新されます' }
                });

                const rankBoardMessage = await channel.send({ embeds: [initialEmbed] });

                await setDoc(settingsRef, {
                    rankBoard: {
                        channelId: channel.id,
                        messageId: rankBoardMessage.id
                    }
                }, { merge: true });

                const successEmbed = createSuccessEmbed(
                    '設定完了',
                    `ランキングボードを ${channel} に設置しました。\nデータは数分以内に更新されます。`
                );
                await interaction.editReply({ embeds: [successEmbed] });

                console.log(chalk.blue(`[Rankboard] Setup in guild ${interaction.guild.name} (#${channel.name})`));

            } else if (subcommand === 'disable') {
                const docSnap = await getDoc(settingsRef);
                const settings = docSnap.exists() ? docSnap.data() : {};

                if (settings.rankBoard && settings.rankBoard.channelId && settings.rankBoard.messageId) {
                    try {
                        const oldChannel = await interaction.client.channels.fetch(settings.rankBoard.channelId);
                        const oldMessage = await oldChannel.messages.fetch(settings.rankBoard.messageId);
                        await oldMessage.delete();
                    } catch (error) {
                        console.warn(chalk.yellow('[Rankboard] Could not delete old rankboard message.'));
                    }
                }

                await setDoc(settingsRef, {
                    rankBoard: null
                }, { merge: true });

                const embed = createStandardEmbed({
                    title: '✅ 設定解除',
                    description: 'ランキングボードを無効化しました。',
                    color: COLORS.WARNING
                });
                await interaction.editReply({ embeds: [embed] });
                console.log(chalk.yellow(`[Rankboard] Disabled in guild ${interaction.guild.name}`));
            }
        } catch (error) {
            console.error('❌ rankboard コマンドエラー:', error);
            await interaction.editReply({ content: '❌ 設定中にエラーが発生しました。' });
        }
    }
};
