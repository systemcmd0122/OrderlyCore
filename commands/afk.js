const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { doc, getDoc, setDoc } = require('firebase/firestore');
const { ref, set, get, remove } = require('firebase/database');
const chalk = require('chalk');
const { createStandardEmbed, createSuccessEmbed, createErrorEmbed, createInfoEmbed } = require('../src/utils/embedBuilder');

const ACTION_CHOICES = [
    { name: 'ミュート (マイクOFF)', value: 'mute' },
    { name: 'デフン (スピーカーOFF)', value: 'deafen' },
    { name: 'AFKチャンネルに移動', value: 'move' },
    { name: 'VCから切断', value: 'kick' }
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('afk')
        .setDescription('VCのAFK（不在）設定を管理します')
        .addSubcommand(sub =>
            sub.setName('set')
                .setDescription('自分をAFKに設定します')
                .addStringOption(opt =>
                    opt.setName('message')
                        .setDescription('AFKメッセージ（例: ちょっと離席）')
                        .setRequired(false)
                        .setMaxLength(100)
                )
        )
        .addSubcommand(sub =>
            sub.setName('remove')
                .setDescription('AFK状態を解除します')
        )
        .addSubcommand(sub =>
            sub.setName('status')
                .setDescription('自分のAFK設定を確認します')
        )
        .addSubcommandGroup(group =>
            group.setName('config')
                .setDescription('AFKの詳細設定を変更します')
                .addSubcommand(sub =>
                    sub.setName('auto-detect')
                        .setDescription('自動AFK検出のON/OFFを設定します')
                        .addBooleanOption(opt =>
                            opt.setName('enabled')
                                .setDescription('ONにしますか？')
                                .setRequired(true)
                        )
                )
                .addSubcommand(sub =>
                    sub.setName('timeout')
                        .setDescription('AFK検出の猶予時間を設定します（分）')
                        .addIntegerOption(opt =>
                            opt.setName('minutes')
                                .setDescription('猶予時間（1〜60分）')
                                .setRequired(true)
                                .setMinValue(1)
                                .setMaxValue(60)
                        )
                )
                .addSubcommand(sub =>
                    sub.setName('action')
                        .setDescription('AFK検出時のアクションを設定します')
                        .addStringOption(opt =>
                            opt.setName('type')
                                .setDescription('アクションの種類')
                                .setRequired(true)
                                .addChoices(...ACTION_CHOICES)
                        )
                )
                .addSubcommand(sub =>
                    sub.setName('afk-message')
                        .setDescription('AFK時のメッセージを設定します')
                        .addStringOption(opt =>
                            opt.setName('message')
                                .setDescription('AFKメッセージ（「default」でリセット）')
                                .setRequired(true)
                                .setMaxLength(100)
                        )
                )
        ),

    async execute(interaction) {
        const { db, rtdb } = interaction.client;
        const guildId = interaction.guild.id;
        const userId = interaction.user.id;
        const subcommand = interaction.options.getSubcommand();
        const subcommandGroup = interaction.options.getSubcommandgroup(false);

        if (subcommandGroup === 'config') {
            return handleConfig(interaction, db, rtdb, guildId, userId, subcommand);
        }

        switch (subcommand) {
            case 'set':
                return handleSet(interaction, db, rtdb, guildId, userId);
            case 'remove':
                return handleRemove(interaction, db, rtdb, guildId, userId);
            case 'status':
                return handleStatus(interaction, db, rtdb, guildId, userId);
        }
    }
};

async function handleSet(interaction, db, rtdb, guildId, userId) {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    const member = interaction.member;
    const voiceChannel = member.voice.channel;

    if (!voiceChannel) {
        return interaction.editReply({
            embeds: [createErrorEmbed('AFK設定失敗', 'ボイスチャンネルに参加している必要があります。')]
        });
    }

    const afkMessage = interaction.options.getString('message') || 'AFK中';
    const settingsRef = doc(db, 'guild_settings', guildId);
    const settingsSnap = await getDoc(settingsRef);
    const guildSettings = settingsSnap.exists() ? settingsSnap.data() : {};

    if (guildSettings.afk && guildSettings.afk.enabled === false) {
        return interaction.editReply({
            embeds: [createErrorEmbed('AFKシステム無効', 'このサーバーではAFKシステムが無効化されています。')]
        });
    }

    const userSettings = await getUserAfkSettings(db, guildId, userId);
    const action = userSettings.action;

    const previousState = {
        serverMute: member.voice.serverMute || false,
        serverDeaf: member.voice.serverDeaf || false
    };

    const afkRef = ref(rtdb, `afkTracking/${guildId}/${userId}`);
    await set(afkRef, {
        isAfk: true,
        manual: true,
        afkSince: Date.now(),
        afkMessage,
        channelId: voiceChannel.id,
        channelName: voiceChannel.name,
        action,
        previousState
    });

    const appliedActions = [];
    try {
        if (action === 'mute') {
            if (!previousState.serverMute) {
                await member.voice.setMute(true).catch(() => null);
                appliedActions.push('ミュート');
            } else {
                appliedActions.push('ミュート（既にミュート済み）');
            }
        } else if (action === 'deafen') {
            if (!previousState.serverMute) {
                await member.voice.setMute(true).catch(() => null);
            }
            if (!previousState.serverDeaf) {
                await member.voice.setDeaf(true).catch(() => null);
            }
            appliedActions.push('デフン');
        } else if (action === 'move') {
            const afkChannelId = guildSettings.afk?.afkChannelId;
            if (afkChannelId) {
                await member.voice.setChannel(afkChannelId).catch(() => null);
                appliedActions.push('AFKチャンネルに移動');
            } else {
                if (!previousState.serverMute) {
                    await member.voice.setMute(true).catch(() => null);
                }
                appliedActions.push('ミュート（AFKチャンネル未設定のため）');
            }
        } else if (action === 'kick') {
            await member.voice.disconnect('AFK').catch(() => null);
            appliedActions.push('VCから切断');
        }
    } catch (err) {
        console.error(chalk.red('[AFK] Error applying AFK action:'), err);
    }

    console.log(chalk.cyan(`[AFK] ${interaction.user.tag} manually set as AFK in ${voiceChannel.name} (action: ${action}): "${afkMessage}"`));

    if (action === 'kick') {
        await interaction.editReply({
            embeds: [createSuccessEmbed(
                'AFK設定完了',
                `**${voiceChannel.name}** でAFKに設定しました。\n**メッセージ:** ${afkMessage}\n**アクション:** VCから切断`
            )]
        }).catch(() => null);
        return;
    }

    await interaction.editReply({
        embeds: [createSuccessEmbed(
            'AFK設定完了',
            `**${voiceChannel.name}** でAFKに設定しました。\n**メッセージ:** ${afkMessage}\n**アクション:** ${appliedActions.join(', ')}`
        )]
    });
}

async function handleRemove(interaction, db, rtdb, guildId, userId) {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    const afkRef = ref(rtdb, `afkTracking/${guildId}/${userId}`);
    const snapshot = await get(afkRef);

    if (!snapshot.exists() || !snapshot.val().isAfk) {
        return interaction.editReply({
            embeds: [createInfoEmbed('AFK解除', '現在AFK状態ではありません。')]
        });
    }

    const afkData = snapshot.val();
    const duration = Date.now() - afkData.afkSince;
    const previousState = afkData.previousState || {};

    await remove(afkRef);

    const member = interaction.member;
    const revertedActions = [];
    if (member.voice.channel) {
        try {
            if (member.voice.serverMute && !previousState.serverMute) {
                await member.voice.setMute(false).catch(() => null);
                revertedActions.push('ミュート解除');
            }
            if (member.voice.serverDeaf && !previousState.serverDeaf) {
                await member.voice.setDeaf(false).catch(() => null);
                revertedActions.push('デフン解除');
            }
        } catch (err) {
            console.error(chalk.red('[AFK] Error resetting voice state on AFK remove:'), err);
        }
    }

    const durationStr = formatDuration(duration);
    console.log(chalk.green(`[AFK] ${interaction.user.tag} removed AFK (was AFK for ${durationStr})`));

    const revertText = revertedActions.length > 0 ? `\n**解除:** ${revertedActions.join(', ')}` : '';
    await interaction.editReply({
        embeds: [createSuccessEmbed(
            'AFK解除',
            `AFK状態を解除しました。\n**AFK時間:** ${durationStr}${revertText}`
        )]
    });
}

async function handleStatus(interaction, db, rtdb, guildId, userId) {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    const userSettings = await getUserAfkSettings(db, guildId, userId);
    const afkRef = ref(rtdb, `afkTracking/${guildId}/${userId}`);
    const afkSnapshot = await get(afkRef);
    const afkData = afkSnapshot.exists() ? afkSnapshot.val() : null;

    const actionLabels = {
        mute: 'ミュート',
        deafen: 'デフン',
        move: 'AFKチャンネルに移動',
        kick: 'VCから切断'
    };

    const fields = [
        {
            name: '自動検出',
            value: userSettings.autoDetect ? '✅ 有効' : '❌ 無効',
            inline: true
        },
        {
            name: '猶予時間',
            value: `${userSettings.timeout / 60}分`,
            inline: true
        },
        {
            name: 'アクション',
            value: actionLabels[userSettings.action] || userSettings.action,
            inline: true
        },
        {
            name: 'AFKメッセージ',
            value: userSettings.afkMessage || 'AFK中',
            inline: true
        }
    ];

    if (afkData && afkData.isAfk) {
        const duration = Date.now() - afkData.afkSince;
        fields.push({
            name: '現在の状態',
            value: `🔴 AFK中\n**開始:** <t:${Math.floor(afkData.afkSince / 1000)}:R>\n**経過:** ${formatDuration(duration)}\n**メッセージ:** ${afkData.afkMessage || 'なし'}`,
            inline: false
        });
    } else {
        fields.push({
            name: '現在の状態',
            value: '🟢 アクティブ',
            inline: false
        });
    }

    const embed = createStandardEmbed({
        color: afkData?.isAfk ? 0xffcc00 : 0x00f2ff,
        author: { name: `${interaction.user.displayName} のAFK設定`, iconURL: interaction.user.displayAvatarURL() },
        title: '[AFK] 設定状況',
        fields,
        footer: { text: `${interaction.guild.name} | /afk config で設定変更` }
    });

    await interaction.editReply({ embeds: [embed] });
}

async function handleConfig(interaction, db, rtdb, guildId, userId, subcommand) {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    const settingsRef = doc(db, 'guild_settings', guildId);
    const settingsSnap = await getDoc(settingsRef);
    const guildSettings = settingsSnap.exists() ? settingsSnap.data() : {};

    if (guildSettings.afk && guildSettings.afk.enabled === false) {
        return interaction.editReply({
            embeds: [createErrorEmbed('AFKシステム無効', 'このサーバーではAFKシステムが無効化されています。管理者にお問い合わせください。')]
        });
    }

    const currentSettings = await getUserAfkSettings(db, guildId, userId);
    let updateData = {};

    switch (subcommand) {
        case 'auto-detect': {
            const enabled = interaction.options.getBoolean('enabled');
            updateData.autoDetect = enabled;
            break;
        }
        case 'timeout': {
            const minutes = interaction.options.getInteger('minutes');
            updateData.timeout = minutes * 60;
            break;
        }
        case 'action': {
            const type = interaction.options.getString('type');
            if (type === 'move' && guildSettings.afk && !guildSettings.afk.afkChannelId) {
                return interaction.editReply({
                    embeds: [createErrorEmbed('設定エラー', 'AFKチャンネルがまだ設定されていません。管理者に `/afk-admin channel` の設定をお願いしてください。')]
                });
            }
            updateData.action = type;
            break;
        }
        case 'afk-message': {
            const message = interaction.options.getString('message');
            updateData.afkMessage = message === 'default' ? 'AFK中' : message;
            break;
        }
    }

    const merged = { ...updateData, guildId, userId };
    const userSettingsRef = doc(db, 'afk_settings', `${guildId}_${userId}`);
    await setDoc(userSettingsRef, merged, { merge: true });

    const actionLabels = {
        mute: 'ミュート',
        deafen: 'デフン',
        move: 'AFKチャンネルに移動',
        kick: 'VCから切断'
    };

    const configLabels = {
        'auto-detect': `自動検出: ${updateData.autoDetect ? 'ON' : 'OFF'}`,
        'timeout': `猶予時間: ${updateData.timeout / 60}分`,
        'action': `アクション: ${actionLabels[updateData.action]}`,
        'afk-message': `AFKメッセージ: ${updateData.afkMessage}`
    };

    console.log(chalk.blue(`[AFK] ${interaction.user.tag} updated AFK config: ${configLabels[subcommand]}`));

    await interaction.editReply({
        embeds: [createSuccessEmbed(
            '設定更新完了',
            `AFK設定を更新しました。\n\n**変更内容:** ${configLabels[subcommand]}\n\n**現在の設定:**\n` +
            `- 自動検出: ${merged.autoDetect ? '✅' : '❌'}\n` +
            `- 猶予時間: ${merged.timeout / 60}分\n` +
            `- アクション: ${actionLabels[merged.action] || merged.action}\n` +
            `- AFKメッセージ: ${merged.afkMessage || 'AFK中'}`
        )]
    });
}

async function getUserAfkSettings(db, guildId, userId) {
    const defaults = {
        autoDetect: false,
        timeout: 300,
        action: 'mute',
        afkMessage: 'AFK中'
    };

    try {
        const userRef = doc(db, 'afk_settings', `${guildId}_${userId}`);
        const snap = await getDoc(userRef);
        if (snap.exists()) {
            return { ...defaults, ...snap.data() };
        }
    } catch (err) {
        console.error(chalk.red('[AFK] Error reading user AFK settings:'), err);
    }

    return defaults;
}

function formatDuration(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) return `${hours}時間${minutes}分${seconds}秒`;
    if (minutes > 0) return `${minutes}分${seconds}秒`;
    return `${seconds}秒`;
}

module.exports.getUserAfkSettings = getUserAfkSettings;
module.exports.formatDuration = formatDuration;
