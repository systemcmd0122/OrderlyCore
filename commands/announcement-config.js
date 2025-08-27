const { SlashCommandBuilder, ChannelType, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { doc, setDoc, getDoc } = require('firebase/firestore');

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
                // チャンネルを設定
                await setDoc(settingsRef, {
                    announcementChannelId: channel.id
                }, { merge: true });

                const embed = new EmbedBuilder()
                    .setColor(0x00ff00)
                    .setTitle('✅ 設定完了')
                    .setDescription(`ボットからのお知らせを ${channel} で受信するように設定しました。`);
                await interaction.editReply({ embeds: [embed] });

            } else {
                // チャンネル設定を解除
                await setDoc(settingsRef, {
                    announcementChannelId: null
                }, { merge: true });

                const embed = new EmbedBuilder()
                    .setColor(0xffcc00)
                    .setTitle('設定解除')
                    .setDescription('ボットからのお知らせ受信を無効にしました。');
                await interaction.editReply({ embeds: [embed] });
            }
        } catch (error) {
            console.error('announcement-config コマンドエラー:', error);
            await interaction.editReply({ content: '❌ 設定中にエラーが発生しました。' });
        }
    }
};