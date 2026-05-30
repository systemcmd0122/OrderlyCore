const chalk = require('chalk');

async function keepAlive() {
    const PING_INTERVAL = 2 * 60 * 1000;
    const appUrl = process.env.APP_URL;

    if (!appUrl) {
        console.warn(chalk.yellow('[WARN] APP_URL is not set. Keep-alive is disabled.'));
        return;
    }

    setInterval(async () => {
        try {
            const url = appUrl.endsWith('/ping') ? appUrl : `${appUrl}/ping`;
            // Use global fetch (Node.js 18+)
            const response = await fetch(url, {
                headers: { 'User-Agent': 'OrderlyCore-Bot/1.0.0' }
            });

            if (response.ok) {
                 console.log(chalk.blueBright(`[Keep-Alive] Ping successful to ${url}.`));
            } else {
                 console.error(chalk.yellow(`[Keep-Alive] Ping failed to ${url}. Status: ${response.status}`));
            }
        } catch (error) {
            console.error(chalk.red(`[Keep-Alive] Error pinging ${appUrl}:`, error.message));
        }
    }, PING_INTERVAL);
}

module.exports = {
    keepAlive
};
