const { Events, EmbedBuilder, PermissionFlagsBits, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');

/**
 * ロールパネルのボタンが押された際の処理
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {import('discord.js').Client} client
 */
async function handleRoleButton(interaction, client) {
    const customIdParts = interaction.customId.split('|');
    const roleId = customIdParts[0].replace('role_', '');
    const boardId = customIdParts[1] || null;
    const { guild, member } = interaction;

    try {
        // ロールボード情報を取得してパスワード確認
        let requiresPassword = false;
        if (boardId && client.db) {
            try {
                const { getDoc, doc } = require('firebase/firestore');
                const boardDocRef = doc(client.db, 'roleboards', boardId);
                const boardDoc = await getDoc(boardDocRef);
                if (boardDoc.exists() && boardDoc.data().password) {
                    requiresPassword = true;
                }
            } catch (error) {
                console.error('ロールボード情報取得エラー:', error);
            }
        }

        // パスワードが必要な場合、モーダルを表示
        if (requiresPassword) {
            const modal = new ModalBuilder()
                .setCustomId(`password_modal_${boardId}_${roleId}`)
                .setTitle('🔐 パスワード認証');

            const passwordInput = new TextInputBuilder()
                .setCustomId('password_input')
                .setLabel('ロールボードのパスワードを入力してください')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(128);

            const actionRow = new ActionRowBuilder().addComponents(passwordInput);
            modal.addComponents(actionRow);

            return await interaction.showModal(modal);
        }

        // パスワードが不要な場合、通常のロール処理
        await interaction.deferReply({ ephemeral: true });
        await performRoleAction(interaction, roleId, member, guild, client);

    } catch (error) {
        console.error('❌ ロールボタン処理エラー:', error);
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ content: '❌ ロール操作中にエラーが発生しました。権限を確認してください。' }).catch(() => {});
        }
    }
}

/**
 * 実際のロール付与・削除処理
 */
async function performRoleAction(interaction, roleId, member, guild, client) {
    try {
        const role = await guild.roles.fetch(roleId);
        if (!role) {
            return await interaction.editReply({ content: '❌ このロールはサーバーに存在しないため、操作できません。' });
        }

        const botMember = await guild.members.fetch(client.user.id);
        if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
            return await interaction.editReply({ content: '❌ ボットにロールを管理する権限がありません。' });
        }

        if (role.position >= botMember.roles.highest.position) {
            return await interaction.editReply({ content: '❌ このロールはボットより上位のため、操作できません。' });
        }

        const hasRole = member.roles.cache.has(roleId);
        let embed;

        if (hasRole) {
            await member.roles.remove(role);
            embed = new EmbedBuilder()
                .setColor(0xff6b6b)
                .setTitle('🗑️ ロールを削除しました')
                .setDescription(`**${role.name}** ロールをあなたから削除しました。`);
        } else {
            await member.roles.add(role);
            embed = new EmbedBuilder()
                .setColor(0x4caf50)
                .setTitle('✅ ロールを付与しました')
                .setDescription(`**${role.name}** ロールをあなたに付与しました。`);
        }
        
        const userRoleCount = member.roles.cache.filter(r => r.id !== guild.id).size;
        embed.addFields({ name: '📊 現在のロール数', value: `**${userRoleCount}個**` });

        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        console.error('ロール操作エラー:', error);
        await interaction.editReply({ content: '❌ ロール操作中にエラーが発生しました。' }).catch(() => {});
    }
}

module.exports = (client) => {
    client.on(Events.InteractionCreate, async (interaction) => {
        // ボタン処理
        if (interaction.isButton() && interaction.customId.startsWith('role_')) {
            await handleRoleButton(interaction, client);
        }

        // モーダル処理
        if (interaction.isModalSubmit() && interaction.customId.startsWith('password_modal_')) {
            try {
                const customIdParts = interaction.customId.split('_');
                const boardId = customIdParts[2];
                const roleId = customIdParts[3];
                const password = interaction.fields.getTextInputValue('password_input');

                // Firestoreからボードのパスワードを取得
                const { getDoc, doc } = require('firebase/firestore');
                const boardDocRef = doc(client.db, 'roleboards', boardId);
                const boardDoc = await getDoc(boardDocRef);

                if (!boardDoc.exists()) {
                    return await interaction.reply({ 
                        content: '❌ ロールボードが見つかりません。', 
                        ephemeral: true 
                    });
                }

                const storedPassword = boardDoc.data().password;

                if (password !== storedPassword) {
                    return await interaction.reply({ 
                        content: '❌ パスワードが間違っています。', 
                        ephemeral: true 
                    });
                }

                // パスワード認証成功 - ロール処理を実行
                await interaction.deferReply({ ephemeral: true });
                await performRoleAction(interaction, roleId, interaction.member, interaction.guild, client);

            } catch (error) {
                console.error('❌ パスワード認証エラー:', error);
                await interaction.reply({ 
                    content: '❌ パスワード認証中にエラーが発生しました。', 
                    ephemeral: true 
                }).catch(() => {});
            }
        }
    });
};