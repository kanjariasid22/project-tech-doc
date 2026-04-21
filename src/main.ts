import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

const BANNER = `
╭──────────────────────────────────────────────────────╮
│                                                      │
│   project-tech-doc                                   │
│   Auto-generated docs from PRs via voice interview   │
│                                                      │
╰──────────────────────────────────────────────────────╯
`;

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  process.stdout.write(BANNER);

  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  const port = parseInt(process.env.PORT ?? '3000', 10) || 3000;
  await app.listen(port);

  logger.log(`Ready — listening on http://localhost:${port}`);
  logger.log('Pipeline: Slack → GitHub → Analysis → Voice → Generation → KB');
  logger.log('Trigger in Slack: `document #PR-<number> <github-pr-url>`');
}

void bootstrap();
