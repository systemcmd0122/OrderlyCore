const { EmbedBuilder, PermissionFlagsBits, InteractionResponseFlags } = require('discord.js');
const { doc, getDoc } = require('firebase/firestore');

module.exports = {
    name: 'interactionCreate',
    async execute(interaction, client) {
        // 対応するインタラクションタイプでなければ早期リターン
        if (!interaction.isChatInputCommand() && !interaction.isAutocomplete() && !interaction.isModalSubmit() && !interaction.isButton()) return;

        // --- 1. スラッシュコマンドの処理 ---
        if (interaction.isChatInputCommand()) {
            const command = client.commands.get(interaction.commandName);
            if (!command) {
                console.error(`❌ 未知のコマンド: ${interaction.commandName}`);
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({
                        content: `❌ コマンド「${interaction.commandName}」が見つかりません。`,
                        flags: InteractionResponseFlags.Ephemeral
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
                    flags: InteractionResponseFlags.Ephemeral
                };
                try {
                    if (interaction.replied || interaction.deferred) {
                        await interaction.followUp(errorMessage);
                    } else {
                        await interaction.reply(errorMessage);
                    }
                } catch (responseError) {
                    console.error('❌ エラーレスポンス送信失敗:', responseError);
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

        // --- 3. モーダル送信の処理 ---
        if (interaction.isModalSubmit()) {
            if (interaction.customId === 'feedback_modal') {
                try {
                    const command = client.commands.get('feedback');
                    if (command) await command.execute(interaction);
                } catch (error) {
                    console.error('❌ フィードバックモーダル処理エラー:', error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ 
                            content: 'フィードバックの送信中にエラーが発生しました。', 
                            flags: InteractionResponseFlags.Ephemeral 
                        }).catch(() => {});
                    }
                }
            }
            return;
        }

        // --- 4. ボタンインタラクションの処理 ---
        if (interaction.isButton()) {
            // ロールパネルのボタンのみを処理
            if (interaction.customId.startsWith('role_')) {
                try {
                    await interaction.deferReply({ flags: InteractionResponseFlags.Ephemeral });
                    await handleRoleButton(interaction, client);
                } catch (error) {
                    console.error('❌ ロールボタン処理エラー:', error);
                    try {
                        if (interaction.deferred) {
                            await interaction.editReply({ content: '❌ ロール操作中にエラーが発生しました。' });
                        } else {
                            await interaction.reply({ 
                                content: '❌ ロール操作中にエラーが発生しました。', 
                                flags: InteractionResponseFlags.Ephemeral 
                            });
                        }
                    } catch (responseError) {
                        console.error('❌ ロールエラーレスポンス送信失敗:', responseError);
                    }
                }
            }
            // その他のボタン（チケット等）は専用ハンドラで処理される
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

    try {
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
    } catch (error) {
        console.error('❌ ロール操作エラー:', error);
        await interaction.editReply({ content: '❌ ロール操作中にエラーが発生しました。権限を確認してください。' });
    }
}