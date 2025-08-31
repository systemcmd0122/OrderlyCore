// systemcmd0122/overseer/overseer-0bf111bc7d4cbe93c0063e5af9df0630e3d9374e/events/roleboardInteraction.js
const { Events, EmbedBuilder, PermissionFlagsBits, InteractionResponseFlags } = require('discord.js');

/**
 * ロールパネルのボタンが押された際の処理
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {import('discord.js').Client} client
 */
async function handleRoleButton(interaction, client) {
    const roleId = interaction.customId.split('_')[1];
    const { guild, member } = interaction;

    try {
        // Ephemeral（一時的）な応答を保留する
        await interaction.deferReply({ flags: InteractionResponseFlags.Ephemeral });

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
        console.error('❌ ロールボタン処理エラー:', error);
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ content: '❌ ロール操作中にエラーが発生しました。権限を確認してください。' }).catch(() => {});
        }
    }
}

module.exports = (client) => {
    client.on(Events.InteractionCreate, async (interaction) => {
        if (!interaction.isButton() || !interaction.customId.startsWith('role_')) {
            return;
        }
        await handleRoleButton(interaction, client);
    });
};