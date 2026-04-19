import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { App } from '@slack/bolt';
import { PrReceivedEvent } from '../events/pr-received.event';

const TRIGGER_PATTERN =
  /^document\s+#PR-(\d+)\s+(https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/\d+)\s*$/i;

const INVALID_FORMAT_MSG =
  'Invalid format. Use: document #PR-<number> <github-pr-url>';

@Injectable()
export class SlackService implements OnModuleInit {
  private readonly logger = new Logger(SlackService.name);
  private app: App;

  constructor(
    private readonly config: ConfigService,
    private readonly events: EventEmitter2,
  ) {}

  onModuleInit() {
    this.app = new App({
      token: this.config.getOrThrow<string>('SLACK_BOT_TOKEN'),
      signingSecret: this.config.getOrThrow<string>('SLACK_SIGNING_SECRET'),
      socketMode: true,
      appToken: this.config.getOrThrow<string>('SLACK_APP_TOKEN'),
    });

    this.registerMessageHandler();

    void this.app.start().then(() => {
      this.logger.log('Slack app connected via Socket Mode');
    });
  }

  private registerMessageHandler() {
    this.app.message(async ({ message, say }) => {
      if (message.subtype !== undefined) return;

      const msg = message as {
        text?: string;
        user?: string;
        channel: string;
      };

      const text = (msg.text ?? '').trim();
      const match = TRIGGER_PATTERN.exec(text);

      if (!match) {
        await say(INVALID_FORMAT_MSG);
        return;
      }

      const [, rawNumber, prUrl, repoOwner, repoName] = match;
      const prNumber = parseInt(rawNumber, 10);

      const event = Object.assign(new PrReceivedEvent(), {
        prNumber,
        prUrl,
        repoOwner,
        repoName,
        triggeredBy: msg.user ?? 'unknown',
        channelId: msg.channel,
      });

      this.events.emit('pr.received', event);

      await say(`Got it! Analyzing PR #${prNumber} — I'll follow up shortly.`);
    });
  }
}
