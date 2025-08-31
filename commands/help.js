const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('利用可能な全てのコマンドの一覧を表示します。'),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: false });

        const commands = {
            management: [],
            roles: [],
            voice: [],
            general: []
        };
        
        const commandsPath = path.join(__dirname); // Get current 'commands' directory
        const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

        for (const file of commandFiles) {
            // help.js自身は除外
            if (file === 'help.js') continue;

            const filePath = path.join(commandsPath, file);
            try {
                const command = require(filePath);
                if ('data' in command && 'execute' in command) {
                    const commandData = {
                        name: command.data.name,
                        description: command.data.description,
                    };

                    // コマンド名に基づいてカテゴリ分け
                    if (command.data.name.includes('config') || command.data.name.includes('list') || command.data.name.includes('board') || command.data.name.includes('ticket') || command.data.name.includes('automod')) {
                        commands.management.push(commandData);
                    } else if (command.data.name.includes('role')) {
                        commands.roles.push(commandData);
                    } else if (command.data.name.includes('vc')) {
                        commands.voice.push(commandData);
                    } else {
                        commands.general.push(commandData);
                    }
                }
            } catch (error) {
                console.error(`コマンドファイル ${file} の読み込みに失敗しました:`, error);
            }
        }

        const helpEmbed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('🤖 OrderlyCore コマンドヘルプ')
            .setDescription('`/` を入力すると、各コマンドの詳細な説明が表示されます。')
            .setThumbnail(interaction.client.user.displayAvatarURL())
            .addFields(
                { 
                    name: '⚙️ サーバー管理',
                    value: commands.management.map(cmd => `> </${cmd.name}:${interaction.client.application.id}>: ${cmd.description}`).join('\n') || 'コマンドなし',
                    inline: false 
                },
                { 
                    name: '🎭 ロール管理',
                    value: commands.roles.map(cmd => `> </${cmd.name}:${interaction.client.application.id}>: ${cmd.description}`).join('\n') || 'コマンドなし',
                    inline: false 
                },
                { 
                    name: '🔊 ボイスチャンネル',
                    value: commands.voice.map(cmd => `> </${cmd.name}:${interaction.client.application.id}>: ${cmd.description}`).join('\n') || 'コマンドなし',
                    inline: false 
                },
                { 
                    name: '🔧 一般',
                    // 自分自身（helpコマンド）を手動で追加
                    value: [
                        ...commands.general.map(cmd => `> </${cmd.name}:${interaction.client.application.id}>: ${cmd.description}`),
                        `> </help:${interaction.client.application.id}>: このヘルプメッセージを表示します。`
                    ].join('\n') || 'コマンドなし',
                    inline: false 
                }
            )
            .setFooter({ text: `${interaction.guild.name} | Bot Version: ${require('../package.json').version}`, iconURL: interaction.guild.iconURL() })
            .setTimestamp();
            
        await interaction.editReply({ embeds: [helpEmbed] });
    },
};