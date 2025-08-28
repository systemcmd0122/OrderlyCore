const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { doc, getDoc } = require('firebase/firestore');

module.exports = {
    name: 'interactionCreate',
    async execute(interaction, client) {
        // 対応するインタラクションタイプでなければ早期リターン
        // ★ 変更点: Buttonの処理を一旦削除（ticketSystem.jsに集約するため）
        if (!interaction.isChatInputCommand() && !interaction.isAutocomplete() && !interaction.isModalSubmit() && !interaction.isButton()) return;


        // --- 1. スラッシュコマンドの処理 ---
        if (interaction.isChatInputCommand()) {
            // ★ 変更点: feedbackコマンドはモーダルを出すため、ここの処理から除外
            if (interaction.commandName === 'feedback') {
                 const command = client.commands.get(interaction.commandName);
                 if (command) await command.execute(interaction);
                 return;
            }
            const command = client.commands.get(interaction.commandName);
            if (!command) {
                console.error(`❌ 未知のコマンド: ${interaction.commandName}`);
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({
                        content: `❌ コマンド「${interaction.commandName}」が見つかりません。`,
                        ephemeral: true
                    }).catch(() => {});
                }
                return;
            }

            try {
                console.log(`🎯 コマンド実行: /${interaction.commandName} | ユーザー: ${interaction.user.tag} | サーバー: ${interaction.guild?.name || 'DM'}`);
                await command.execute(interaction);
            } catch (error) {
                console.error(`❌ コマンド実行エラー (${interaction.commandName}):`, error);
                const errorMessage = {
                    content: '⚠️ コマンドの実行中にエラーが発生しました。しばらく時間をおいてから再度お試しください。',
                    ephemeral: true
                };
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp(errorMessage).catch(console.error);
                } else {
                    await interaction.reply(errorMessage).catch(console.error);
                }
            }
            return;
        }

        // --- 2. オートコンプリートの処理 ---
        if (interaction.isAutocomplete()) {
            const command = client.commands.get(interaction.commandName);
            if (!command || !command.autocomplete) return;

            try {
                await command.autocomplete(interaction);
            } catch (error) {
                console.error(`❌ オートコンプリートエラー (${interaction.commandName}):`, error);
            }
            return;
        }

        // --- 3. モーダル送信の処理 (フィードバック用) ---
        if (interaction.isModalSubmit()) {
            if (interaction.customId === 'feedback_modal') {
                 const command = client.commands.get('feedback');
                 if(command) await command.execute(interaction);
            }
            return;
        }

        // --- 4. ボタンインタラクションの処理 (ロールパネル用) ---
        if (interaction.isButton()) {
            // ★ 変更点: チケット関連はticketSystem.jsに任せ、ここではロールパネルのみを処理
            if (interaction.customId.startsWith('role_')) {
                await interaction.deferReply({ ephemeral: true });
                try {
                    await handleRoleButton(interaction, client);
                } catch (error) {
                     console.error('❌ ロールボタン処理エラー:', error);
                     await interaction.editReply({ content: '❌ ロール操作中にエラーが発生しました。', ephemeral: true }).catch(console.error);
                }
            }
            // 他のボタン（チケットなど）はそれぞれの専用ハンドラで処理される
        }
    }
};

/**
 * ロールパネルのボタンが押された際の処理
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {import('discord.js').Client} client
 */
async function handleRoleButton(interaction, client) {
    const roleId = interaction.customId.split('_')[1];
    const { guild, member } = interaction;

    const role = guild.roles.cache.get(roleId);
    if (!role) {
        return await interaction.editReply({ content: '❌ このロールはサーバーに存在しないため、操作できません。' });
    }

    const botMember = guild.members.me;
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
}