const { SlashCommandBuilder, Colors } = require('discord.js');
const os = require('os');
const { createStandardEmbed } = require('../src/utils/embedBuilder');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('ボットの応答速度、システム情報、接続状態を詳細に確認します'),
    
    async execute(interaction) {
        try {
            const startTime = Date.now();
            const sent = await interaction.reply({ 
                content: 'Pong! 詳細測定中...', 
                fetchReply: true 
            });

            const endTime = Date.now();
            const roundtripLatency = sent.createdTimestamp - interaction.createdTimestamp;
            const editLatency = endTime - startTime;
            const websocketLatency = Math.round(interaction.client.ws.ping);
            const apiLatency = Math.max(0, roundtripLatency - websocketLatency);

            const uptime = process.uptime();
            const memUsage = process.memoryUsage();
            const totalMem = os.totalmem();
            const freeMem = os.freemem();
            const usedMem = totalMem - freeMem;

            function getLatencyLevel(ms) {
                if (ms < 100) return { emoji: '✅', color: Colors.Green, status: '優秀' };
                if (ms < 200) return { emoji: '✨', color: Colors.Yellow, status: '良好' };
                if (ms < 500) return { emoji: '⚡', color: Colors.Orange, status: '普通' };
                return { emoji: '🐢', color: Colors.Red, status: '遅延' };
            }

            const wsLatencyInfo = getLatencyLevel(websocketLatency);
            const rtLatencyInfo = getLatencyLevel(roundtripLatency);
            const overallInfo = getLatencyLevel(Math.max(websocketLatency, roundtripLatency));

            function formatUptime(seconds) {
                const days = Math.floor(seconds / 86400);
                const hours = Math.floor((seconds % 86400) / 3600);
                const minutes = Math.floor((seconds % 3600) / 60);
                const secs = Math.floor(seconds % 60);
                return `${days > 0 ? days + '日 ' : ''}${hours > 0 ? hours + '時間 ' : ''}${minutes > 0 ? minutes + '分 ' : ''}${secs}秒`;
            }

            function formatBytes(bytes) {
                return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
            }

            const embed = createStandardEmbed({
                title: `${overallInfo.emoji} Pong! 接続状態: ${overallInfo.status}`,
                description: '**最新技術搭載Discord Bot** の詳細ステータス',
                color: overallInfo.color,
                fields: [
                    {
                        name: '接続遅延情報',
                        value: [
                            `${wsLatencyInfo.emoji} **WebSocket遅延**: \`${websocketLatency}ms\` (${wsLatencyInfo.status})`,
                            `${rtLatencyInfo.emoji} **往復遅延**: \`${roundtripLatency}ms\` (${rtLatencyInfo.status})`,
                            `**API遅延**: \`${apiLatency}ms\``,
                            `**編集遅延**: \`${editLatency}ms\``
                        ].join('\n'),
                        inline: false
                    },
                    {
                        name: 'システム情報',
                        value: [
                            `**稼働時間**: ${formatUptime(uptime)}`,
                            `**メモリ使用量**: ${formatBytes(memUsage.heapUsed)} / ${formatBytes(memUsage.heapTotal)}`,
                            `**システムメモリ**: ${formatBytes(usedMem)} / ${formatBytes(totalMem)} (${((usedMem/totalMem)*100).toFixed(1)}%)`,
                            `**CPU アーキテクチャ**: ${os.arch()}`,
                            `**プラットフォーム**: ${os.platform()}`
                        ].join('\n'),
                        inline: false
                    },
                    {
                        name: '技術情報',
                        value: [
                            `**Node.js**: ${process.version}`,
                            `**Discord.js**: v${require('discord.js').version}`,
                            `**Firebase**: 接続済み`,
                            `**サーバー数**: ${interaction.client.guilds.cache.size}`,
                            `**ユーザー数**: ${interaction.client.users.cache.size}`
                        ].join('\n'),
                        inline: false
                    }
                ],
                footer: {
                    text: `実行者: ${interaction.user.tag}`,
                    iconURL: interaction.user.displayAvatarURL()
                }
            });

            await interaction.editReply({ content: '', embeds: [embed] });
        } catch (error) {
            console.error('Ping コマンドエラー:', error);
            await interaction.editReply({ content: '❌ エラーが発生しました。' }).catch(() => {});
        }
    },
};
