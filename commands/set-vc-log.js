const { SlashCommandBuilder, ChannelType, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { doc, setDoc } = require('firebase/firestore');
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
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    async execute(interaction) {
        // 最初に必ず応答を保留し、タイムアウトを防ぐ
        // もしこの時点で失敗した場合、エラーは即座にinteractionCreate.jsに送られる
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const voiceChannel = interaction.options.getChannel('voice_channel');
        const textChannel = interaction.options.getChannel('text_channel');
        const guildId = interaction.guild.id;
        const db = interaction.client.db;

        if (!db) {
            return interaction.editReply({ content: '❌ データベースへの接続に失敗しました。' });
        }

        const settingsRef = doc(db, 'guild_settings', guildId);
        await setDoc(settingsRef, {
            voiceChannelMappings: {
                [voiceChannel.id]: textChannel.id
            }
        }, { merge: true });

        // 成功した場合の応答
        await interaction.editReply({
            content: `✅ ボイスチャンネル **${voiceChannel.name}** のログを ${textChannel} に送信するように設定しました。`
        });
        
        console.log(chalk.blue(`[SETTINGS] VC Log Mapped: ${voiceChannel.name} -> #${textChannel.name} for guild ${interaction.guild.name}`));
    },
};