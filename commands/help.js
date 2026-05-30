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
        
        interaction.client.commands.forEach(command => {
            if (command.data.name === 'help') return;

            const commandData = {
                name: command.data.name,
                description: command.data.description,
            };

            const name = command.data.name;
            if (name.includes('config') || name.includes('list') || name.includes('board') || name.includes('ticket') || name.includes('automod')) {
                commands.management.push(commandData);
            } else if (name.includes('role')) {
                commands.roles.push(commandData);
            } else if (name.includes('vc')) {
                commands.voice.push(commandData);
            } else {
                commands.general.push(commandData);
            }
        });

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
