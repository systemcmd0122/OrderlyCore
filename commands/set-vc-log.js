const { SlashCommandBuilder, ChannelType, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { doc, getDoc, setDoc } = require('firebase/firestore');
const chalk = require('chalk');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('set-vc-log')
        .setDescription('特定のボイスチャンネルのログを送信するテキストチャンネルを設定します。')
        .addChannelOption(option =>
            option.setName('voice_channel')
                .setDescription('ログを記録したいボイスチャンネル')
                .addChannelTypes(ChannelType.GuildVoice)
                .setRequired(true))
        .addChannelOption(option =>
            option.setName('text_channel')
                .setDescription('ログを送信するテキストチャンネル')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true))
        .addBooleanOption(option =>
            option.setName('silent')
                .setDescription('ログメッセージをサイレントで送信するか（デフォルト: true）')
                .setRequired(false))
        .addBooleanOption(option =>
            option.setName('delete_after')
                .setDescription('ログメッセージを送信後に自動削除するか（デフォルト: true）')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    async execute(interaction) {
        // 最初に必ず応答を保留し、タイムアウトを防ぐ
        // もしこの時点で失敗した場合、エラーは即座にinteractionCreate.jsに送られる
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const voiceChannel = interaction.options.getChannel('voice_channel');
        const textChannel = interaction.options.getChannel('text_channel');
        const silent = interaction.options.getBoolean('silent') ?? true;
        const deleteAfter = interaction.options.getBoolean('delete_after') ?? true;
        const guildId = interaction.guild.id;
        const db = interaction.client.db;

        if (!db) {
            return interaction.editReply({ content: '[ERROR] データベースへの接続に失敗しました。' });
        }

        const settingsRef = doc(db, 'guild_settings', guildId);
        const settingsSnap = await getDoc(settingsRef);
        const existingMappings = settingsSnap.exists() ? (settingsSnap.data().voiceChannelMappings || {}) : {};
        await setDoc(settingsRef, {
            voiceChannelMappings: {
                ...existingMappings,
                [voiceChannel.id]: {
                    textChannelId: textChannel.id,
                    silent: silent,
                    deleteAfter: deleteAfter
                }
            }
        }, { merge: true });

        const options = [];
        if (!silent) options.push('通常送信');
        if (!deleteAfter) options.push('手動削除');
        const optionsStr = options.length > 0 ? ` (${options.join(', ')})` : ' (サイレント送信, 自動削除)';

        // 成功した場合の応答
        await interaction.editReply({
            content: `[OK] ボイスチャンネル **${voiceChannel.name}** のログを ${textChannel} に送信するように設定しました。${optionsStr}`
        });

        console.log(chalk.blue(`[SETTINGS] VC Log Mapped: ${voiceChannel.name} -> #${textChannel.name} (silent: ${silent}, delete: ${deleteAfter}) for guild ${interaction.guild.name}`));
    },
};