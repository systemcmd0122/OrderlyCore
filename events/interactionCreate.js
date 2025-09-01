// systemcmd0122/orderlycore/OrderlyCore-0952a29494b13fadb3d53fc470ecdb1ede3f7840/events/interactionCreate.js
module.exports = {
    name: 'interactionCreate',
    async execute(interaction, client) {
        if (interaction.isButton()) return;
        
        if (!interaction.isChatInputCommand() && !interaction.isAutocomplete() && !interaction.isModalSubmit()) return;

        if (interaction.isChatInputCommand()) {
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
                // ★★★★★【ここから修正】★★★★★
                // ephemeralメッセージの送信方法を修正
                const errorMessage = {
                    content: '⚠️ コマンドの実行中にエラーが発生しました。しばらく時間をおいてから再度お試しください。',
                    ephemeral: true
                };
                // ★★★★★【ここまで修正】★★★★★
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

        if (interaction.isModalSubmit()) {
            // 他のモーダル処理が必要な場合はここに追加
        }
    }
};