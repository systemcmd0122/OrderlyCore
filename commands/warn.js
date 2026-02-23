const { SlashCommandBuilder, PermissionFlagsBits, Timestamp } = require('discord.js');
const { collection, addDoc, getDocs, query, where } = require('firebase/firestore');
const { v4: uuidv4 } = require('uuid');
const { createStandardEmbed, createSuccessEmbed, COLORS } = require('../src/utils/embedBuilder');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('warn')
        .setDescription('ユーザーに警告を与え、履歴を管理します。')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('ユーザーに警告を与えます。')
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('警告するユーザー')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('reason')
                        .setDescription('警告の理由')
                        .setRequired(true))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('history')
                .setDescription('ユーザーの警告履歴を表示します。')
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('履歴を表示するユーザー')
                        .setRequired(true))
        ),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        const subcommand = interaction.options.getSubcommand();
        const targetUser = interaction.options.getUser('user');
        const db = interaction.client.db;
        const guildId = interaction.guild.id;

        if (subcommand === 'add') {
            const reason = interaction.options.getString('reason');
            const moderator = interaction.user;

            try {
                const warnId = uuidv4();
                await addDoc(collection(db, 'warnings'), {
                    warnId,
                    guildId,
                    userId: targetUser.id,
                    moderatorId: moderator.id,
                    reason,
                    timestamp: Timestamp.now()
                });

                const replyEmbed = createSuccessEmbed('警告完了', `${targetUser} に警告を与えました。\n**理由:** ${reason}`);
                await interaction.editReply({ embeds: [replyEmbed] });

                const dmEmbed = createStandardEmbed({
                    title: `[WARN] ${interaction.guild.name} からの警告`,
                    description: `サーバー内で警告を受けました。`,
                    color: COLORS.WARNING,
                    fields: [
                        { name: '理由', value: reason },
                        { name: '実行者', value: moderator.tag }
                    ]
                });

                await targetUser.send({ embeds: [dmEmbed] }).catch(() => null);

            } catch (error) {
                console.error('[ERROR] 警告の追加失敗:', error);
                await interaction.editReply({ content: '[ERROR] 記録に失敗しました。' });
            }

        } else if (subcommand === 'history') {
            try {
                const q = query(collection(db, 'warnings'), where('guildId', '==', guildId), where('userId', '==', targetUser.id));
                const querySnapshot = await getDocs(q);

                const embed = createStandardEmbed({
                    title: `[HISTORY] ${targetUser.tag}`,
                    color: COLORS.INFO,
                    thumbnail: targetUser.displayAvatarURL()
                });
                
                if (querySnapshot.empty) {
                    embed.setDescription('履歴はありません。');
                } else {
                    const warnings = querySnapshot.docs.map(doc => doc.data())
                        .sort((a, b) => a.timestamp.toMillis() - b.timestamp.toMillis());

                    embed.setDescription(`合計 **${warnings.length}** 回の警告を受けています。`);
                    warnings.forEach((warn, index) => {
                        const modTag = interaction.guild.members.cache.get(warn.moderatorId)?.user.tag || 'Unknown';
                        embed.addFields({
                            name: `#${index + 1} - ${warn.timestamp.toDate().toLocaleString('ja-JP')}`,
                            value: `理由: ${warn.reason}\n実行者: ${modTag}`
                        });
                    });
                }
                await interaction.editReply({ embeds: [embed] });
            } catch (error) {
                console.error('[ERROR] 警告履歴取得失敗:', error);
                await interaction.editReply({ content: '[ERROR] 取得に失敗しました。' });
            }
        }
    }
};
