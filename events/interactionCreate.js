const chalk = require('chalk');
const { doc, getDoc } = require('firebase/firestore');

// In-memory cache to prevent excessive DB reads
const globalCache = {
    maintenance: { data: null, lastFetch: 0 },
    blacklist: { data: null, lastFetch: 0 },
    guildSettings: new Map() // guildId -> { data, lastFetch }
};

const CACHE_TTL = 60 * 1000; // 1 minute

async function getCachedDoc(db, collection, id, cacheObj) {
    const now = Date.now();
    if (cacheObj.data && (now - cacheObj.lastFetch < CACHE_TTL)) {
        return cacheObj.data;
    }
    try {
        const snap = await getDoc(doc(db, collection, id));
        cacheObj.data = snap.exists() ? snap.data() : null;
        cacheObj.lastFetch = now;
        return cacheObj.data;
    } catch (err) {
        console.error(chalk.red(`[CACHE ERROR] Failed to fetch ${collection}/${id}:`), err);
        return cacheObj.data; // Return stale data on error
    }
}

module.exports = {
    name: 'interactionCreate',
    async execute(interaction, client) {
        if (interaction.isButton()) return;
        
        if (!interaction.isChatInputCommand() && !interaction.isAutocomplete() && !interaction.isModalSubmit()) return;

        // 1. Global Checks (Maintenance & Blacklist)
        const maintenanceData = await getCachedDoc(client.db, 'bot_settings', 'maintenance', globalCache.maintenance);
        const blacklistData = await getCachedDoc(client.db, 'bot_settings', 'blacklist', globalCache.blacklist);

        // Blacklist check
        if (blacklistData && blacklistData.users?.includes(interaction.user.id)) {
            const message = { content: '[ERR] あなたはボットの使用を制限されています。', ephemeral: true };
            return interaction.isAutocomplete() ? null : interaction.reply(message);
        }

        // Maintenance mode check (Bypass for Bot Owners)
        if (maintenanceData && maintenanceData.enabled) {
            // Get bot owners from application
            if (!client.application.owner) await client.application.fetch();
            const owners = client.application.owner.members 
                ? client.application.owner.members.map(m => m.id) 
                : [client.application.owner.id];
            
            if (!owners.includes(interaction.user.id)) {
                const reason = maintenanceData.reason || '現在メンテナンス中です。';
                const message = { content: `[INFO] ${reason}`, ephemeral: true };
                return interaction.isAutocomplete() ? null : interaction.reply(message);
            }
        }

        if (interaction.isChatInputCommand()) {
            // 2. Guild-specific Command Check
            if (interaction.guildId) {
                if (!globalCache.guildSettings.has(interaction.guildId)) {
                    globalCache.guildSettings.set(interaction.guildId, { data: null, lastFetch: 0 });
                }
                const guildSettings = await getCachedDoc(
                    client.db, 
                    'guild_settings', 
                    interaction.guildId, 
                    globalCache.guildSettings.get(interaction.guildId)
                );

                if (guildSettings && guildSettings.disabledCommands?.includes(interaction.commandName)) {
                    return interaction.reply({
                        content: `[INFO] このコマンド「${interaction.commandName}」はこのサーバーで無効化されています。`,
                        ephemeral: true
                    });
                }
            }

            const command = client.commands.get(interaction.commandName);
            if (!command) {
                console.error(chalk.red(`[ERROR] Unknown command: ${interaction.commandName}`));
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({
                        content: `[ERROR] コマンド「${interaction.commandName}」が見つかりません。`,
                        ephemeral: true
                    }).catch(() => {});
                }
                return;
            }

            try {
                console.log(chalk.cyan(`[INFO] Command Execution: /${interaction.commandName} | User: ${interaction.user.tag} | Guild: ${interaction.guild?.name || 'DM'}`));
                await command.execute(interaction);
            } catch (error) {
                console.error(chalk.red(`[ERROR] Command Execution Error (${interaction.commandName}):`), error);
                
                const errorMessage = {
                    content: '[WARN] コマンドの実行中にエラーが発生しました。しばらく時間をおいてから再度お試しください。',
                    ephemeral: true
                };

                try {
                    if (interaction.replied || interaction.deferred) {
                        await interaction.followUp(errorMessage);
                    } else {
                        await interaction.reply(errorMessage);
                    }
                } catch (responseError) {
                    console.error(chalk.red('[ERROR] Failed to send error response:'), responseError);
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
                console.error(chalk.red(`[ERROR] Autocomplete Error (${interaction.commandName}):`), error);
            }
            return;
        }

        if (interaction.isModalSubmit()) {
            // Add modal submit handling here if needed
        }
    }
};
