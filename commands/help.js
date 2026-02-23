const { SlashCommandBuilder } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
const { createStandardEmbed, COLORS } = require('../src/utils/embedBuilder');

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
        
        const commandsPath = __dirname;
        const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

        for (const file of commandFiles) {
            if (file === 'help.js') continue;

            const filePath = path.join(commandsPath, file);
            try {
                const command = require(filePath);
                if ('data' in command && 'execute' in command) {
                    const commandData = {
                        name: command.data.name,
                        description: command.data.description,
                    };

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
                console.error(`[ERROR] コマンドファイル ${file} の読み込みに失敗しました:`, error);
            }
        }

        const helpEmbed = createStandardEmbed({
            title: '[HELP] OrderlyCore コマンド一覧',
            description: 'スラッシュコマンドを使用して、ボットの様々な機能を呼び出すことができます。',
            color: COLORS.PRIMARY,
            thumbnail: interaction.client.user.displayAvatarURL(),
            fields: [
                { 
                    name: '[ADMIN] サーバー管理',
                    value: commands.management.map(cmd => `> </${cmd.name}:${interaction.client.application.id}>: ${cmd.description}`).join('\n') || 'コマンドなし',
                    inline: false 
                },
                { 
                    name: '[ROLE] ロール管理',
                    value: commands.roles.map(cmd => `> </${cmd.name}:${interaction.client.application.id}>: ${cmd.description}`).join('\n') || 'コマンドなし',
                    inline: false 
                },
                { 
                    name: '[VOICE] ボイスチャンネル',
                    value: commands.voice.map(cmd => `> </${cmd.name}:${interaction.client.application.id}>: ${cmd.description}`).join('\n') || 'コマンドなし',
                    inline: false 
                },
                { 
                    name: '[INFO] 一般',
                    value: [
                        ...commands.general.map(cmd => `> </${cmd.name}:${interaction.client.application.id}>: ${cmd.description}`),
                        `> </help:${interaction.client.application.id}>: ヘルプを表示します。`
                    ].join('\n') || 'コマンドなし',
                    inline: false 
                }
            ],
            footer: {
                text: `${interaction.guild.name} | System Version: ${require('../package.json').version}`,
                iconURL: interaction.guild.iconURL()
            }
        });
            
        await interaction.editReply({ embeds: [helpEmbed] });
    },
};
