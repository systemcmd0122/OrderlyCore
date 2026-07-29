const { SlashCommandBuilder, ChannelType, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { doc, getDoc, setDoc } = require('firebase/firestore');
const chalk = require('chalk');
const { createStandardEmbed, createSuccessEmbed, createErrorEmbed } = require('../src/utils/embedBuilder');

const ACTION_CHOICES = [
    { name: 'ミュート (マイクOFF)', value: 'mute' },
    { name: 'デフン (スピーカーOFF)', value: 'deafen' },
    { name: 'AFKチャンネルに移動', value: 'move' },
    { name: 'VCから切断', value: 'kick' }
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('afk-admin')
        .setDescription('サーバーのAFKシステム設定を管理します（管理者専用）')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(sub =>
            sub.setName('enable')
                .setDescription('AFKシステムを有効にします')
        )
        .addSubcommand(sub =>
            sub.setName('disable')
                .setDescription('AFKシステムを無効にします')
        )
        .addSubcommand(sub =>
            sub.setName('channel')
                .setDescription('AFKチャンネルを設定します（moveアクション時に使用）')
                .addChannelOption(opt =>
                    opt.setName('voice_channel')
                        .setDescription('AFKユーザーを移動先のボイスチャンネル')
                        .addChannelTypes(ChannelType.GuildVoice)
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('log')
                .setDescription('AFKログを送信するテキストチャンネルを設定します')
                .addChannelOption(opt =>
                    opt.setName('text_channel')
                        .setDescription('ログ送信先のテキストチャンネル')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('default-timeout')
                .setDescription('ユーザーが設定していない場合のデフォルト猶予時間を設定します（分）')
                .addIntegerOption(opt =>
                    opt.setName('minutes')
                        .setDescription('デフォルト猶予時間（1〜60分）')
                        .setRequired(true)
                        .setMinValue(1)
                        .setMaxValue(60)
                )
        )
        .addSubcommand(sub =>
            sub.setName('default-action')
                .setDescription('ユーザーが設定していない場合のデフォルトアクションを設定します')
                .addStringOption(opt =>
                    opt.setName('type')
                        .setDescription('デフォルトアクションの種類')
                        .setRequired(true)
                        .addChoices(...ACTION_CHOICES)
                )
        )
        .addSubcommand(sub =>
            sub.setName('status')
                .setDescription('現在のサーバーAFK設定を表示します')
        ),

    async execute(interaction) {
        const db = interaction.client.db;
        const guildId = interaction.guild.id;
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'status') {
            return handleStatus(interaction, db, guildId);
        }

        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const settingsRef = doc(db, 'guild_settings', guildId);
        const settingsSnap = await getDoc(settingsRef);
        const current = settingsSnap.exists() ? settingsSnap.data() : {};
        const afkConfig = current.afk || {};

        switch (subcommand) {
            case 'enable': {
                await setDoc(settingsRef, {
                    afk: { ...afkConfig, enabled: true }
                }, { merge: true });

                console.log(chalk.green(`[AFK-ADMIN] AFK system enabled for ${interaction.guild.name}`));
                return interaction.editReply({
                    embeds: [createSuccessEmbed(
                        'AFKシステム有効化',
                        'AFKシステムを有効にしました。\n\nユーザーは `/afk config` で個別の設定を行い、自動検出や手動AFKが利用できます。'
                    )]
                });
            }
            case 'disable': {
                await setDoc(settingsRef, {
                    afk: { ...afkConfig, enabled: false }
                }, { merge: true });

                console.log(chalk.yellow(`[AFK-ADMIN] AFK system disabled for ${interaction.guild.name}`));
                return interaction.editReply({
                    embeds: [createSuccessEmbed(
                        'AFKシステム無効化',
                        'AFKシステムを無効にしました。自動検出は停止しますが、ユーザーの個別設定は保持されます。'
                    )]
                });
            }
            case 'channel': {
                const channel = interaction.options.getChannel('voice_channel');
                await setDoc(settingsRef, {
                    afk: { ...afkConfig, afkChannelId: channel.id, afkChannelName: channel.name }
                }, { merge: true });

                console.log(chalk.blue(`[AFK-ADMIN] AFK channel set to #${channel.name} for ${interaction.guild.name}`));
                return interaction.editReply({
                    embeds: [createSuccessEmbed(
                        'AFKチャンネル設定',
                        `AFKチャンネルを **${channel.name}** に設定しました。\n\nユーザーのアクションが「move」の場合、ここに移動されます。`
                    )]
                });
            }
            case 'log': {
                const channel = interaction.options.getChannel('text_channel');
                await setDoc(settingsRef, {
                    afk: { ...afkConfig, logChannelId: channel.id }
                }, { merge: true });

                console.log(chalk.blue(`[AFK-ADMIN] AFK log channel set to #${channel.name} for ${interaction.guild.name}`));
                return interaction.editReply({
                    embeds: [createSuccessEmbed(
                        'AFKログチャンネル設定',
                        `AFKログの送信先を ${channel} に設定しました。`
                    )]
                });
            }
            case 'default-timeout': {
                const minutes = interaction.options.getInteger('minutes');
                await setDoc(settingsRef, {
                    afk: { ...afkConfig, defaultTimeout: minutes * 60 }
                }, { merge: true });

                console.log(chalk.blue(`[AFK-ADMIN] Default timeout set to ${minutes}min for ${interaction.guild.name}`));
                return interaction.editReply({
                    embeds: [createSuccessEmbed(
                        'デフォルト猶予時間設定',
                        `デフォルトの猶予時間を **${minutes}分** に設定しました。\n\nユーザーが個別に設定していない場合、この時間が適用されます。`
                    )]
                });
            }
            case 'default-action': {
                const type = interaction.options.getString('type');
                if (type === 'move' && !afkConfig.afkChannelId) {
                    return interaction.editReply({
                        embeds: [createErrorEmbed('設定エラー', '先にAFKチャンネルを設定してください。`/afk-admin channel`')]
                    });
                }

                await setDoc(settingsRef, {
                    afk: { ...afkConfig, defaultAction: type }
                }, { merge: true });

                const actionLabels = {
                    mute: 'ミュート',
                    deafen: 'デフン',
                    move: 'AFKチャンネルに移動',
                    kick: 'VCから切断'
                };

                console.log(chalk.blue(`[AFK-ADMIN] Default action set to ${type} for ${interaction.guild.name}`));
                return interaction.editReply({
                    embeds: [createSuccessEmbed(
                        'デフォルトアクション設定',
                        `デフォルトのアクションを **${actionLabels[type]}** に設定しました。`
                    )]
                });
            }
        }
    }
};

async function handleStatus(interaction, db, guildId) {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    const settingsRef = doc(db, 'guild_settings', guildId);
    const settingsSnap = await getDoc(settingsRef);
    const current = settingsSnap.exists() ? settingsSnap.data() : {};
    const afkConfig = current.afk || {};

    const actionLabels = {
        mute: 'ミュート',
        deafen: 'デフン',
        move: 'AFKチャンネルに移動',
        kick: 'VCから切断'
    };

    const isEnabled = afkConfig.enabled === true;
    const afkChannel = afkConfig.afkChannelId ? `<#${afkConfig.afkChannelId}>` : '未設定';
    const logChannel = afkConfig.logChannelId ? `<#${afkConfig.logChannelId}>` : '未設定';
    const defaultTimeout = afkConfig.defaultTimeout ? `${afkConfig.defaultTimeout / 60}分` : '5分';
    const defaultAction = actionLabels[afkConfig.defaultAction] || 'ミュート';

    const embed = createStandardEmbed({
        color: isEnabled ? 0x00ff9d : 0xff4d4d,
        author: { name: `${interaction.guild.name} のAFK設定`, iconURL: interaction.guild.iconURL() },
        title: '[AFK] サーバー設定',
        fields: [
            {
                name: 'システム状態',
                value: isEnabled ? '✅ 有効' : '❌ 無効',
                inline: true
            },
            {
                name: 'AFKチャンネル',
                value: afkChannel,
                inline: true
            },
            {
                name: 'ログチャンネル',
                value: logChannel,
                inline: true
            },
            {
                name: 'デフォルト猶予時間',
                value: defaultTimeout,
                inline: true
            },
            {
                name: 'デフォルトアクション',
                value: defaultAction,
                inline: true
            }
        ],
        footer: { text: '/afk-admin で設定変更 | /afk config でユーザー個別設定' }
    });

    await interaction.editReply({ embeds: [embed] });
}
