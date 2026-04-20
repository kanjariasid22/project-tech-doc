import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { App } from '@slack/bolt';
import { PrFailedEvent } from '../events/pr-failed.event';
import { PrReceivedEvent } from '../events/pr-received.event';

const TRIGGER_PATTERN =
  /^document\s+#PR-(\d+)\s+<?((https?:\/\/github\.com\/([^/]+)\/([^/>]+)\/pull\/\d+))>?\s*$/i;

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

  async postMessage(channelId: string, text: string): Promise<void> {
    try {
      await this.app.client.chat.postMessage({ channel: channelId, text });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to post Slack message: ${msg}`);
    }
  }

  @OnEvent('pr.failed')
  async handlePrFailed(payload: PrFailedEvent): Promise<void> {
    await this.postMessage(
      payload.channelId,
      `Failed to process PR #${payload.prNumber}: ${payload.reason}`,
    );
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

      const [, rawNumber, prUrl, , repoOwner, repoName] = match;
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
