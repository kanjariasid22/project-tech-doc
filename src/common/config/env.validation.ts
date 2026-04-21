const REQUIRED_ENV_VARS = [
  'GEMINI_API_KEY',
  'ELEVENLABS_API_KEY',
  'SLACK_BOT_TOKEN',
  'SLACK_SIGNING_SECRET',
  'SLACK_APP_TOKEN',
  'GITHUB_TOKEN',
] as const;

export function validateEnv(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const missing = REQUIRED_ENV_VARS.filter((key) => !env[key]?.trim());

  if (missing.length > 0) {
    throw new Error(
      [
        'Missing required environment variables:',
        ...missing.map((k) => `  - ${k}`),
        '',
        'Copy .env.example to .env and fill in the values before starting.',
      ].join('\n'),
    );
  }

  return env;
}
