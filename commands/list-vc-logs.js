const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const { doc, getDoc } = require('firebase/firestore');
const chalk = require('chalk');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('list-vc-logs')
        .setDescription('設定されているボイスチャンネルのログ設定一覧を表示します。')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    async execute(interaction) {
        // 最初に必ず応答を保留し、タイムアウトを防ぐ
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const guildId = interaction.guild.id;
        const db = interaction.client.db;

        if (!db) {
            return interaction.editReply({ content: '❌ データベースへの接続に失敗しました。' });
        }

        const settingsRef = doc(db, 'guild_settings', guildId);
        const docSnap = await getDoc(settingsRef);

        const embed = new EmbedBuilder()
            .setTitle('🔊 ボイスチャンネルログ設定一覧')
            .setColor(0x5865F2)
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL() })
            .setTimestamp();

        if (docSnap.exists() && docSnap.data().voiceChannelMappings) {
            const mappings = docSnap.data().voiceChannelMappings;
            const description = Object.entries(mappings)
                .map(([vcId, tcId]) => `🎤 <#${vcId}>  ➔  ✍️ <#${tcId}>`)
                .join('\n');
            
            if (description) {
                embed.setDescription(description);
            } else {
                embed.setDescription('ログ設定はまだありません。\n`/set-vc-log` コマンドで設定してください。');
            }
        } else {
            embed.setDescription('ログ設定はまだありません。\n`/set-vc-log` コマンドで設定してください。');
        }

        // 成功した場合の応答
        await interaction.editReply({ embeds: [embed] });
    },
};