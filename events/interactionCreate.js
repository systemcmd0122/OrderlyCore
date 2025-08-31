// systemcmd0122/overseer/overseer-0bf111bc7d4cbe93c0063e5af9df0630e3d9374e/events/interactionCreate.js
const { InteractionResponseFlags } = require('discord.js');

module.exports = {
    name: 'interactionCreate',
    async execute(interaction, client) {
        // ボタンインタラクションは専用ハンドラに任せるため、ここでは処理しない
        if (interaction.isButton()) return;
        
        // 対応するインタラクションタイプでなければ早期リターン
        if (!interaction.isChatInputCommand() && !interaction.isAutocomplete() && !interaction.isModalSubmit()) return;

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
            // feedbackモーダルはコマンド側で処理(awaitModalSubmit)されるため、ここでは何もしない
            // 他のモーダル処理が必要な場合はここに追加
        }
    }
};