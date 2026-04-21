import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { App } from '@slack/bolt';
import type { PRContext } from '../common/interfaces/pr-context.interface';
import { DocsApprovedEvent } from '../events/docs-approved.event';
import { DocsRejectedEvent } from '../events/docs-rejected.event';
import type { VoiceCompletedEvent } from '../events/voice-completed.event';
import { PrFailedEvent } from '../events/pr-failed.event';
import { PrReceivedEvent } from '../events/pr-received.event';

const TRIGGER_PATTERN =
  /^document\s+#PR-(\d+)\s+<?((https?:\/\/github\.com\/([^/]+)\/([^/>]+)\/pull\/\d+))>?\s*$/i;

const INVALID_FORMAT_MSG =
  'Invalid format. Use: `document #PR-<number> <github-pr-url>`';

const APPROVE_ACTION = 'approve_docs';
const REJECT_ACTION = 'reject_docs';

export interface FileUpload {
  filename: string;
  content: string;
  title?: string;
}

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

    this.registerHandlers();

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

  async uploadFiles(channelId: string, files: FileUpload[]): Promise<void> {
    try {
      await this.app.client.files.uploadV2({
        channel_id: channelId,
        file_uploads: files.map((f) => ({
          filename: f.filename,
          content: f.content,
          title: f.title ?? f.filename,
        })),
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to upload Slack files: ${msg}`);
    }
  }

  async postApprovalPrompt(
    channelId: string,
    text: string,
    prNumber: number,
  ): Promise<void> {
    try {
      await this.app.client.chat.postMessage({
        channel: channelId,
        text,
        blocks: [
          {
            type: 'section',
            text: { type: 'mrkdwn', text },
          },
          {
            type: 'actions',
            block_id: `approval_${prNumber}`,
            elements: [
              {
                type: 'button',
                action_id: APPROVE_ACTION,
                style: 'primary',
                text: { type: 'plain_text', text: 'Approve & Commit' },
                value: String(prNumber),
              },
              {
                type: 'button',
                action_id: REJECT_ACTION,
                style: 'danger',
                text: { type: 'plain_text', text: 'Reject' },
                value: String(prNumber),
              },
            ],
          },
        ],
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to post approval prompt: ${msg}`);
    }
  }

  @OnEvent('pr.ingested')
  async handlePrIngestedProgress(ctx: PRContext): Promise<void> {
    await this.postMessage(
      ctx.channelId,
      [
        `📥 Fetched PR #${ctx.prNumber} — *${ctx.title}*`,
        `• ${ctx.files.length} file(s), ${ctx.commits.length} commit(s)`,
        `• Author: ${ctx.author}`,
        `Analyzing the diff now…`,
      ].join('\n'),
    );
  }

  @OnEvent('voice.completed')
  async handleVoiceCompletedProgress(
    payload: VoiceCompletedEvent,
  ): Promise<void> {
    await this.postMessage(
      payload.prContext.channelId,
      `📝 Got your answers — writing the docs now…`,
    );
  }

  @OnEvent('pr.failed')
  async handlePrFailed(payload: PrFailedEvent): Promise<void> {
    await this.postMessage(
      payload.channelId,
      `❌ Failed to process PR #${payload.prNumber}: ${payload.reason}`,
    );
  }

  private registerHandlers() {
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

      await say(
        `👋 Got it! Working on PR #${prNumber} — I'll post updates here.`,
      );
    });

    this.app.action(APPROVE_ACTION, async ({ ack, body, action }) => {
      await ack();
      this.emitDecision(APPROVE_ACTION, body, action);
    });

    this.app.action(REJECT_ACTION, async ({ ack, body, action }) => {
      await ack();
      this.emitDecision(REJECT_ACTION, body, action);
    });
  }

  private emitDecision(actionId: string, body: unknown, action: unknown): void {
    const channelId = (body as { channel?: { id?: string } })?.channel?.id;
    const actionedBy = (body as { user?: { id?: string } })?.user?.id;
    const value = (action as { value?: string })?.value;

    if (!channelId || !actionedBy || !value) {
      this.logger.error(
        `Missing fields on ${actionId} payload (channel/user/value)`,
      );
      return;
    }

    const prNumber = parseInt(value, 10);
    if (Number.isNaN(prNumber)) {
      this.logger.error(`Invalid prNumber in ${actionId} payload: ${value}`);
      return;
    }

    if (actionId === APPROVE_ACTION) {
      const event = Object.assign(new DocsApprovedEvent(), {
        prNumber,
        channelId,
        actionedBy,
      });
      this.events.emit('docs.approved', event);
    } else {
      const event = Object.assign(new DocsRejectedEvent(), {
        prNumber,
        channelId,
        actionedBy,
      });
      this.events.emit('docs.rejected', event);
    }
  }
}
