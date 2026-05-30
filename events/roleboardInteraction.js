const { Events, PermissionFlagsBits, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const { createStandardEmbed, COLORS, createSuccessEmbed } = require('../src/utils/embedBuilder');

async function handleRoleButton(interaction, client) {
    const customIdParts = interaction.customId.split('|');
    const roleId = customIdParts[0].replace('role_', '');
    const boardId = customIdParts[1] || null;
    const { guild, member } = interaction;

    try {
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
                console.error('❌ ロールボード取得失敗:', error);
            }
        }

        if (requiresPassword) {
            const modal = new ModalBuilder()
                .setCustomId(`password_modal_${boardId}_${roleId}`)
                .setTitle('[AUTH] パスワード認証');

            const passwordInput = new TextInputBuilder()
                .setCustomId('password_input')
                .setLabel('パスワードを入力してください')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(128);

            const actionRow = new ActionRowBuilder().addComponents(passwordInput);
            modal.addComponents(actionRow);

            return await interaction.showModal(modal);
        }

        await interaction.deferReply({ ephemeral: true });
        await performRoleAction(interaction, roleId, member, guild, client);

    } catch (error) {
        console.error('❌ ロールボタン処理失敗:', error);
    }
}

async function performRoleAction(interaction, roleId, member, guild, client) {
    try {
        const role = await guild.roles.fetch(roleId);
        if (!role) {
            return await interaction.editReply({ content: '❌ ロールが見つかりません。' });
        }

        const botMember = await guild.members.fetch(client.user.id);
        if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
            return await interaction.editReply({ content: '❌ 権限が不足しています。' });
        }

        if (role.position >= botMember.roles.highest.position) {
            return await interaction.editReply({ content: '❌ 権限外のロールです。' });
        }

        const hasRole = member.roles.cache.has(roleId);
        let embed;

        if (hasRole) {
            await member.roles.remove(role);
            embed = createStandardEmbed({
                title: '✅ ロール削除',
                description: `**${role.name}** を削除しました。`,
                color: COLORS.ERROR
            });
        } else {
            await member.roles.add(role);
            embed = createSuccessEmbed('ロール付与', `**${role.name}** を付与しました。`);
        }
        
        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        console.error('❌ ロール操作失敗:', error);
        await interaction.editReply({ content: '❌ 操作中にエラーが発生しました。' }).catch(() => {});
    }
}

module.exports = (client) => {
    client.on(Events.InteractionCreate, async (interaction) => {
        if (interaction.isButton() && interaction.customId.startsWith('role_')) {
            await handleRoleButton(interaction, client);
        }

        if (interaction.isModalSubmit() && interaction.customId.startsWith('password_modal_')) {
            try {
                const customIdParts = interaction.customId.split('_');
                const boardId = customIdParts[2];
                const roleId = customIdParts[3];
                const password = interaction.fields.getTextInputValue('password_input');

                const { getDoc, doc } = require('firebase/firestore');
                const boardDocRef = doc(client.db, 'roleboards', boardId);
                const boardDoc = await getDoc(boardDocRef);

                if (!boardDoc.exists()) {
                    return await interaction.reply({ content: '❌ ボードが見つかりません。', ephemeral: true });
                }

                if (password !== boardDoc.data().password) {
                    return await interaction.reply({ content: '❌ パスワードが違います。', ephemeral: true });
                }

                await interaction.deferReply({ ephemeral: true });
                await performRoleAction(interaction, roleId, interaction.member, interaction.guild, client);

            } catch (error) {
                console.error('❌ パスワード認証失敗:', error);
            }
        }
    });
};
