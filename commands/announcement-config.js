const { SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const { doc, setDoc } = require('firebase/firestore');
const { createSuccessEmbed, createStandardEmbed, COLORS } = require('../src/utils/embedBuilder');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('announcement-config')
        .setDescription('ボット全体のお知らせを受信するチャンネルを設定します。')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('お知らせを受信するテキストチャンネル（指定なしで無効化）')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(false)
        ),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const channel = interaction.options.getChannel('channel');
        const guildId = interaction.guild.id;
        const db = interaction.client.db;
        const settingsRef = doc(db, 'guild_settings', guildId);

        try {
            if (channel) {
                await setDoc(settingsRef, { announcementChannelId: channel.id }, { merge: true });
                const embed = createSuccessEmbed('設定完了', `お知らせを ${channel} で受信するように設定しました。`);
                await interaction.editReply({ embeds: [embed] });
            } else {
                await setDoc(settingsRef, { announcementChannelId: null }, { merge: true });
                const embed = createStandardEmbed({
                    title: '[OK] 設定解除',
                    description: 'お知らせ受信を無効にしました。',
                    color: COLORS.WARNING
                });
                await interaction.editReply({ embeds: [embed] });
            }
        } catch (error) {
            console.error('[ERROR] announcement-config error:', error);
            await interaction.editReply({ content: '[ERROR] 設定に失敗しました。' });
        }
    }
};
