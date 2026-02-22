const chalk = require('chalk');

module.exports = {
    name: 'interactionCreate',
    async execute(interaction, client) {
        if (interaction.isButton()) return;
        
        if (!interaction.isChatInputCommand() && !interaction.isAutocomplete() && !interaction.isModalSubmit()) return;

        if (interaction.isChatInputCommand()) {
            const command = client.commands.get(interaction.commandName);
            if (!command) {
                console.error(chalk.red(`❌ Unknown command: ${interaction.commandName}`));
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({
                        content: `❌ コマンド「${interaction.commandName}」が見つかりません。`,
                        ephemeral: true
                    }).catch(() => {});
                }
                return;
            }

            try {
                console.log(chalk.cyan(`🎯 Command Execution: /${interaction.commandName} | User: ${interaction.user.tag} | Guild: ${interaction.guild?.name || 'DM'}`));
                await command.execute(interaction);
            } catch (error) {
                console.error(chalk.red(`❌ Command Execution Error (${interaction.commandName}):`), error);
                
                const errorMessage = {
                    content: '⚠️ コマンドの実行中にエラーが発生しました。しばらく時間をおいてから再度お試しください。',
                    ephemeral: true
                };

                try {
                    if (interaction.replied || interaction.deferred) {
                        await interaction.followUp(errorMessage);
                    } else {
                        await interaction.reply(errorMessage);
                    }
                } catch (responseError) {
                    console.error(chalk.red('❌ Failed to send error response:'), responseError);
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
                console.error(chalk.red(`❌ Autocomplete Error (${interaction.commandName}):`), error);
            }
            return;
        }

        if (interaction.isModalSubmit()) {
            // Add modal submit handling here if needed
        }
    }
};
