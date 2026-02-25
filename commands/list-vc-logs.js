const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { doc, getDoc } = require('firebase/firestore');
const { createStandardEmbed, COLORS } = require('../src/utils/embedBuilder');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('list-vc-logs')
        .setDescription('設定されているボイスチャンネルのログ設定一覧を表示します。')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    async execute(interaction) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const guildId = interaction.guild.id;
        const db = interaction.client.db;
        if (!db) return interaction.editReply({ content: '[ERROR] データベース接続失敗。' });

        const settingsRef = doc(db, 'guild_settings', guildId);
        const docSnap = await getDoc(settingsRef);

        const embed = createStandardEmbed({
            title: '[VOICE] ログ設定一覧',
            color: COLORS.INFO,
            footer: { text: interaction.guild.name, iconURL: interaction.guild.iconURL() }
        });

        if (docSnap.exists() && docSnap.data().voiceChannelMappings) {
            const mappings = docSnap.data().voiceChannelMappings;
            const description = Object.entries(mappings)
                .map(([vcId, config]) => {
                    // 後方互換性: 古い形式（tcId が直接配置）と新しい形式（オブジェクト）の両方に対応
                    let tcId, silent, deleteAfter;
                    if (typeof config === 'string') {
                        // 古い形式
                        tcId = config;
                        silent = true;
                        deleteAfter = true;
                    } else {
                        // 新しい形式
                        tcId = config.textChannelId;
                        silent = config.silent !== false;
                        deleteAfter = config.deleteAfter !== false;
                    }

                    const options = [];
                    if (silent) options.push('🔇 サイレント');
                    if (deleteAfter) options.push('🗑️ 自動削除');
                    const optionsStr = options.length > 0 ? ` | ${options.join(' | ')}` : '';

                    return `[VC] <#${vcId}> → [LOG] <#${tcId}>${optionsStr}`;
                })
                .join('\n');
            embed.setDescription(description || '設定なし');
        } else {
            embed.setDescription('設定なし');
        }

        await interaction.editReply({ embeds: [embed] });
    },
};
