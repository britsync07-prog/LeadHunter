module.exports = {
    apps: [
        {
            name: 'leadhunter-backend',
            script: 'src/server.js',
            instances: 1, 
            exec_mode: 'fork',
            autorestart: true,
            watch: false,
            max_memory_restart: '2G',
            env: {
                NODE_ENV: 'production',
                HOST: '0.0.0.0',
                PORT: 3000,
                LOG_LEVEL: 'info',
                PUBLIC_URL: 'https://leadhunter.uk'
            }
        },
        {
            name: 'leadhunter-next-frontend',
            cwd: './frontend-next',
            script: 'node_modules/next/dist/bin/next',
            args: 'start -p 3001',
            instances: 1,
            exec_mode: 'fork',
            autorestart: true,
            watch: false,
            max_memory_restart: '1G',
            env: {
                NODE_ENV: 'production',
                PORT: 3001
            }
        }
    ]
};
