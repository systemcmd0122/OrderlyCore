const { SlashCommandBuilder, ChannelType, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { doc, updateDoc, deleteField } = require('firebase/firestore');
const { FieldPath } = require('firebase/firestore');
const chalk = require('chalk');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unset-vc-log')
        .setDescription('ボイスチャンネルのログ設定を解除します。')
        .addChannelOption(option =>
            option.setName('voice_channel')
                .setDescription('設定を解除するボイスチャンネル')
                .addChannelTypes(ChannelType.GuildVoice)
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    async execute(interaction) {
        // 最初に必ず応答を保留し、タイムアウトを防ぐ
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const voiceChannel = interaction.options.getChannel('voice_channel');
        const guildId = interaction.guild.id;
        const db = interaction.client.db;

        if (!db) {
            return interaction.editReply({ content: '❌ データベースへの接続に失敗しました。' });
        }

        const settingsRef = doc(db, 'guild_settings', guildId);
        const fieldPath = new FieldPath('voiceChannelMappings', voiceChannel.id);
        await updateDoc(settingsRef, {
            [fieldPath]: deleteField()
        });

        // 成功した場合の応答
        await interaction.editReply({
            content: `✅ ボイスチャンネル **${voiceChannel.name}** のログ設定を解除しました。`
        });

        console.log(chalk.yellow(`[SETTINGS] VC Log Unmapped: ${voiceChannel.name} for guild ${interaction.guild.name}`));
    },
};