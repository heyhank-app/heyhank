module.exports = {
  apps: [
    {
      name: "agentplatform",
      script: "server/index.ts",
      cwd: "/opt/agentplatform/web",
      interpreter: process.env.HOME + "/.bun/bin/bun",
      env: {
        NODE_ENV: "production",
        PORT: "3100",
        HOST: "127.0.0.1",
        GEMINI_API_KEY: "REDACTED",
        GOOGLE_API_KEY: "REDACTED",
      },
      max_memory_restart: "1G",
      restart_delay: 3000,
      max_restarts: 10,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      error_file: "/root/.companion/logs/pm2-error.log",
      out_file: "/root/.companion/logs/pm2-out.log",
      merge_logs: true,
    },
  ],
};
