const chalk = require('chalk');

const requiredEnvVars = [
    'DISCORD_TOKEN',
    'CLIENT_ID',
    'FIREBASE_API_KEY',
    'FIREBASE_AUTH_DOMAIN',
    'FIREBASE_DATABASE_URL',
    'FIREBASE_PROJECT_ID',
    'FIREBASE_STORAGE_BUCKET',
    'FIREBASE_MESSAGING_SENDER_ID',
    'FIREBASE_APP_ID',
    'GOOGLE_API_KEY',
    'SESSION_SECRET',
    'ADMIN_PASSWORD'
];

function validateEnv() {
    const missing = requiredEnvVars.filter(envVar => !process.env[envVar]);

    if (missing.length > 0) {
        console.error(chalk.red('[ERROR] Missing required environment variables:'));
        missing.forEach(envVar => console.error(chalk.red(`   - ${envVar}`)));
        process.exit(1);
    }

    console.log(chalk.green('[OK] Environment variables validated successfully.'));
}

module.exports = {
    validateEnv,
    PORT: process.env.PORT || 8000,
    FRONTEND_URL: process.env.FRONTEND_URL,
    NODE_ENV: process.env.NODE_ENV || 'development',
    APP_URL: process.env.APP_URL
};
