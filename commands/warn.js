const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { collection, addDoc, getDocs, query, where, Timestamp } = require('firebase/firestore');
const { v4: uuidv4 } = require('uuid');

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

                // 完了通知 (実行チャンネル)
                const replyEmbed = new EmbedBuilder()
                    .setColor(0x00ff00)
                    .setTitle('✅ 警告完了')
                    .setDescription(`${targetUser} に警告を与えました。\n**理由:** ${reason}`);
                await interaction.editReply({ embeds: [replyEmbed] });

                // ユーザーへのDM通知
                const dmEmbed = new EmbedBuilder()
                    .setColor(0xffcc00)
                    .setTitle(`⚠️ ${interaction.guild.name} からの警告`)
                    .setDescription(`あなたはサーバー内で警告を受けました。`)
                    .addFields(
                        { name: '理由', value: reason },
                        { name: '実行者', value: moderator.tag }
                    )
                    .setTimestamp();
                
                await targetUser.send({ embeds: [dmEmbed] }).catch(() => {
                    interaction.followUp({ content: '⚠️ ユーザーへのDM送信に失敗しました。', ephemeral: true });
                });

            } catch (error) {
                console.error("警告の追加に失敗:", error);
                await interaction.editReply({ content: '❌ 警告の記録中にエラーが発生しました。' });
            }

        } else if (subcommand === 'history') {
            try {
                const q = query(
                    collection(db, 'warnings'),
                    where('guildId', '==', guildId),
                    where('userId', '==', targetUser.id)
                );
                const querySnapshot = await getDocs(q);

                const embed = new EmbedBuilder()
                    .setColor(0x5865F2)
                    .setTitle(`${targetUser.tag} の警告履歴`)
                    .setThumbnail(targetUser.displayAvatarURL());
                
                if (querySnapshot.empty) {
                    embed.setDescription('このユーザーの警告履歴はありません。');
                } else {
                    const warnings = [];
                    querySnapshot.forEach(doc => warnings.push(doc.data()));
                    
                    // 日付順にソート
                    warnings.sort((a, b) => a.timestamp.toMillis() - b.timestamp.toMillis());

                    embed.setDescription(`**合計 ${warnings.length} 回**の警告を受けています。`);

                    warnings.forEach((warn, index) => {
                        const moderatorTag = interaction.guild.members.cache.get(warn.moderatorId)?.user.tag || '不明なユーザー';
                        embed.addFields({
                            name: `警告 #${index + 1} - ${warn.timestamp.toDate().toLocaleString('ja-JP')}`,
                            value: `**理由:** ${warn.reason}\n**実行者:** ${moderatorTag}`
                        });
                    });
                }
                await interaction.editReply({ embeds: [embed] });
            } catch (error) {
                console.error("警告履歴の取得に失敗:", error);
                await interaction.editReply({ content: '❌ 履歴の取得中にエラーが発生しました。' });
            }
        }
    }
};