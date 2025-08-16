const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const os = require('os');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('ボットの応答速度、システム情報、接続状態を詳細に確認します'),
    
    async execute(interaction) {
        // 初回応答時刻を記録
        const startTime = Date.now();
        
        const sent = await interaction.reply({ 
            content: '🏓 Pong! 詳細測定中...', 
            fetchReply: true 
        });

        // 各種遅延の計算
        const endTime = Date.now();
        const roundtripLatency = sent.createdTimestamp - interaction.createdTimestamp;
        const editLatency = endTime - startTime;
        const websocketLatency = Math.round(interaction.client.ws.ping);
        const apiLatency = roundtripLatency - websocketLatency;

        // システム情報の取得
        const uptime = process.uptime();
        const memUsage = process.memoryUsage();
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;

        // 遅延レベルの判定
        function getLatencyLevel(ms) {
            if (ms < 100) return { level: 'excellent', emoji: '🟢', color: 0x00ff00, status: '優秀' };
            if (ms < 200) return { level: 'good', emoji: '🟡', color: 0xffff00, status: '良好' };
            if (ms < 500) return { level: 'fair', emoji: '🟠', color: 0xff9900, status: '普通' };
            return { level: 'poor', emoji: '🔴', color: 0xff0000, status: '遅延' };
        }

        const wsLatencyInfo = getLatencyLevel(websocketLatency);
        const rtLatencyInfo = getLatencyLevel(roundtripLatency);

        // 全体的な接続状態の判定
        const overallLatency = Math.max(websocketLatency, roundtripLatency);
        const overallInfo = getLatencyLevel(overallLatency);

        // 時間フォーマット関数
        function formatUptime(seconds) {
            const days = Math.floor(seconds / 86400);
            const hours = Math.floor((seconds % 86400) / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            const secs = Math.floor(seconds % 60);
            
            let result = '';
            if (days > 0) result += `${days}日 `;
            if (hours > 0) result += `${hours}時間 `;
            if (minutes > 0) result += `${minutes}分 `;
            result += `${secs}秒`;
            
            return result;
        }

        // メモリ使用量フォーマット
        function formatBytes(bytes) {
            const mb = bytes / 1024 / 1024;
            return `${mb.toFixed(1)}MB`;
        }

        // メイン埋め込み
        const embed = new EmbedBuilder()
            .setColor(overallInfo.color)
            .setTitle(`${overallInfo.emoji} Pong! 接続状態: ${overallInfo.status}`)
            .setDescription('🚀 **最新技術搭載Discord Bot** の詳細ステータス')
            .addFields([
                {
                    name: '📡 接続遅延情報',
                    value: [
                        `${wsLatencyInfo.emoji} **WebSocket遅延**: \`${websocketLatency}ms\` (${wsLatencyInfo.status})`,
                        `${rtLatencyInfo.emoji} **往復遅延**: \`${roundtripLatency}ms\` (${rtLatencyInfo.status})`,
                        `⚡ **API遅延**: \`${apiLatency}ms\``,
                        `🔄 **編集遅延**: \`${editLatency}ms\``
                    ].join('\n'),
                    inline: false
                },
                {
                    name: '🖥️ システム情報',
                    value: [
                        `⏰ **稼働時間**: ${formatUptime(uptime)}`,
                        `💾 **メモリ使用量**: ${formatBytes(memUsage.heapUsed)} / ${formatBytes(memUsage.heapTotal)}`,
                        `🖥️ **システムメモリ**: ${formatBytes(usedMem)} / ${formatBytes(totalMem)} (${((usedMem/totalMem)*100).toFixed(1)}%)`,
                        `📊 **CPU アーキテクチャ**: ${os.arch()}`,
                        `💻 **プラットフォーム**: ${os.platform()}`
                    ].join('\n'),
                    inline: false
                },
                {
                    name: '🔧 技術情報',
                    value: [
                        `⚡ **Node.js**: ${process.version}`,
                        `🤖 **Discord.js**: v${require('discord.js').version}`,
                        `🔥 **Firebase**: 接続済み`,
                        `🌐 **サーバー数**: ${interaction.client.guilds.cache.size}`,
                        `👥 **ユーザー数**: ${interaction.client.users.cache.size}`
                    ].join('\n'),
                    inline: false
                }
            ])
            .setFooter({
                text: `実行者: ${interaction.user.tag} | 測定完了時刻`,
                iconURL: interaction.user.displayAvatarURL()
            })
            .setTimestamp();

        // パフォーマンス評価
        let performanceNote = '';
        if (overallLatency < 100) {
            performanceNote = '🚀 **素晴らしい接続状態です！** 全ての機能が高速で動作します。';
        } else if (overallLatency < 200) {
            performanceNote = '✅ **良好な接続状態です。** 快適にご利用いただけます。';
        } else if (overallLatency < 500) {
            performanceNote = '⚠️ **接続にやや遅延があります。** 機能は正常に動作します。';
        } else {
            performanceNote = '🔴 **接続遅延が発生しています。** Discord側の問題の可能性があります。';
        }

        embed.addFields([
            {
                name: '📊 パフォーマンス評価',
                value: performanceNote,
                inline: false
            }
        ]);

        // リアルタイムステータス
        const connectionStatus = interaction.client.ws.status;
        const statusMap = {
            0: '🟢 Ready (準備完了)',
            1: '🟡 Connecting (接続中)',
            2: '🟠 Reconnecting (再接続中)',
            3: '🔴 Idle (待機中)',
            4: '⚫ Nearly (ほぼ切断)',
            5: '❌ Disconnected (切断済み)',
            6: '🔄 Waiting for Guilds (ギルド待機)',
            7: '🔄 Identifying (認証中)',
            8: '🔄 Resuming (再開中)'
        };

        embed.addFields([
            {
                name: '🔌 接続ステータス',
                value: `${statusMap[connectionStatus] || '❓ 不明'} (コード: ${connectionStatus})`,
                inline: true
            },
            {
                name: '🕐 測定日時',
                value: `<t:${Math.floor(Date.now()/1000)}:F>`,
                inline: true
            }
        ]);

        await interaction.editReply({
            content: '',
            embeds: [embed]
        });

        // コンソールログ
        console.log(`🏓 Ping測定完了: WS=${websocketLatency}ms, RT=${roundtripLatency}ms | ユーザー: ${interaction.user.tag}`);
    },
};