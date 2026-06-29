const { ActivityType } = require('discord.js');
const chalk = require('chalk');
const { startStatusRotation } = require('../src/services/statusService');
const { updateRankboards } = require('../src/services/rankboardService');
const { keepAlive } = require('../src/utils/helpers');

module.exports = {
    name: 'clientReady',
    once: true,
    async execute(client) {
        console.log(chalk.bold.greenBright(`[OK] ${client.user.tag} が起動しました！`));
        
        // Initial setup
        client.user.setActivity('起動中...', { type: ActivityType.Custom });
        client.user.setStatus('online');

        // Start services
        keepAlive();
        startStatusRotation(client);
        
        // Rankboard updates
        setTimeout(() => updateRankboards(client), 10000);
        setInterval(() => updateRankboards(client), 5 * 60 * 1000);

        console.log(chalk.green('[OK] Bot services initialized.'));
    }
};
