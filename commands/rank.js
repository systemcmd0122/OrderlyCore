const { SlashCommandBuilder } = require('discord.js');
const { getLevelData, getRank, calculateRequiredXp } = require('../src/services/levelingService');
const { createStandardEmbed } = require('../src/utils/embedBuilder');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rank')
        .setDescription('レベルやXP、ランキングを表示します。')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('特定のユーザーのランクを表示します（省略時は自分）')),

    async execute(interaction) {
        await interaction.deferReply();

        const targetUser = interaction.options.getUser('user') || interaction.user;
        const db = interaction.client.db;
        const guildId = interaction.guild.id;

        try {
            const userData = await getLevelData(db, guildId, targetUser.id);
            const rank = await getRank(db, guildId, targetUser.id);
            const requiredXp = calculateRequiredXp(userData.level);

            let progress = 0;
            let progressPercentage = 0;
            if (requiredXp > 0) {
                progressPercentage = Math.min((userData.xp / requiredXp) * 100, 100);
                progress = Math.min(Math.floor((userData.xp / requiredXp) * 10), 10);
            }
            const progressBar = '`' + '#'.repeat(progress) + '-'.repeat(10 - progress) + '`';

            const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
            const displayName = member ? member.displayName : targetUser.username;
            const avatarColor = member ? member.displayHexColor : '#5865F2';

            const embed = createStandardEmbed({
                title: `[Ranking] ${displayName} のランク`,
                color: avatarColor,
                thumbnail: targetUser.displayAvatarURL({ dynamic: true, size: 256 }),
                fields: [
                    { name: 'レベル', value: `**Lv.${userData.level}**`, inline: true },
                    { name: '順位', value: rank !== -1 ? `**#${rank}**` : '計測中...', inline: true },
                    { name: '総メッセージ数', value: `**${(userData.messageCount || 0).toLocaleString()}** 回`, inline: true },
                    { name: '経験値 (XP)', value: `**${Math.floor(userData.xp).toLocaleString()}** / ${requiredXp.toLocaleString()} XP`, inline: false },
                    { name: '次のレベルへの進捗', value: `${progressBar} **${progressPercentage.toFixed(1)}%**`, inline: false }
                ],
                footer: { text: interaction.guild.name, iconURL: interaction.guild.iconURL() }
            });
            
            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('❌ ランクコマンドの実行エラー:', error);
            await interaction.editReply({ content: '❌ ランク情報の取得中にエラーが発生しました。' });
        }
    }
};
