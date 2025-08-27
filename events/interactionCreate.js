const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { doc, getDoc } = require('firebase/firestore');

module.exports = {
    name: 'interactionCreate',
    async execute(interaction, client) {
        // 対応するインタラクションタイプでなければ早期リターン
        if (!interaction.isChatInputCommand() && !interaction.isAutocomplete() && !interaction.isButton()) return;

        // --- 1. スラッシュコマンドの処理 ---
        if (interaction.isChatInputCommand()) {
            const command = client.commands.get(interaction.commandName);
            if (!command) {
                console.error(`❌ 未知のコマンド: ${interaction.commandName}`);
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({
                        content: `❌ コマンド「${interaction.commandName}」が見つかりません。`,
                        ephemeral: true
                    }).catch(() => {}); // エラー時は握りつぶす
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

        // --- 3. ボタンインタラクションの処理 ---
        if (interaction.isButton()) {
            // 先に応答を保留し、タイムアウト(Unknown Interaction)を防ぐ
            await interaction.deferReply({ ephemeral: true });

            try {
                // ロールパネル用のボタンか判定
                if (interaction.customId.startsWith('role_')) {
                    await handleRoleButton(interaction, client);
                }
                // (他のボタン処理はここに 'else if' を追加)

            } catch (error) {
                console.error('❌ ボタンインタラクション処理中の包括的なエラー:', error);
                const errorEmbed = new EmbedBuilder()
                    .setColor(0xff0000)
                    .setTitle('❌ システムエラー')
                    .setDescription('予期しないエラーが発生しました。しばらく時間をおいてから再度お試しください。')
                    .addFields({ name: 'エラーコード', value: error.code || 'N/A' });
                
                // deferReply後なので、必ずeditReplyで応答
                await interaction.editReply({ embeds: [errorEmbed], ephemeral: true }).catch(console.error);
            }
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
    const { guild, member, user } = interaction;

    // --- 安全性チェック ---
    const role = guild.roles.cache.get(roleId);
    if (!role) {
        return await interaction.editReply({ content: '❌ このロールはサーバーに存在しないため、操作できません。' });
    }

    const botMember = guild.members.me;
    if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
        return await interaction.editReply({ content: '❌ ボットにロールを管理する権限がありません。サーバー管理者にご連絡ください。' });
    }

    if (role.position >= botMember.roles.highest.position) {
        return await interaction.editReply({ content: '❌ このロールはボットより上位のため、操作できません。' });
    }

    // --- ロール付与・削除処理 ---
    const hasRole = member.roles.cache.has(roleId);
    let embed;

    if (hasRole) {
        await member.roles.remove(role);
        embed = new EmbedBuilder()
            .setColor(0xff6b6b)
            .setTitle('🗑️ ロールを削除しました')
            .setDescription(`**${role.name}** ロールをあなたから削除しました。`);
        console.log(`🔄 ロール削除: ${member.user.tag} から ${role.name} を削除`);
    } else {
        await member.roles.add(role);
        embed = new EmbedBuilder()
            .setColor(0x4caf50)
            .setTitle('✅ ロールを付与しました')
            .setDescription(`**${role.name}** ロールをあなたに付与しました。`);
        console.log(`🔄 ロール付与: ${member.user.tag} に ${role.name} を付与`);
    }
    
    // 現在のロール数を表示
    const userRoleCount = member.roles.cache.filter(r => r.id !== guild.id).size;
    embed.addFields([
        {
            name: '📊 現在の状況',
            value: `あなたが持っているロール数: **${userRoleCount}個**`,
            inline: false
        }
    ]);

    await interaction.editReply({ embeds: [embed] });
}