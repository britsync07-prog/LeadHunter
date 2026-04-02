module.exports = {
    apps: [
        {
            name: 'leadhunter-production',
            script: 'src/server.js',
            // --- SCALING NOTE FOR 1000+ USERS ---
            // 'max' instances (Cluster Mode) is great for performance but:
            // 1. SSE (Server-Sent Events) requires sticky sessions on the load balancer.
            // 2. The JobQueue in-memory state is currently per-instance.
            // For production with 1000+ users, we recommend using a single large instance
            // OR implementing Redis for JobQueue/SSE synchronization.
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
                // Set SESSION_SECRET and TRACKING_HMAC_SECRET in the real host env.
            }
        }
    ]
};
