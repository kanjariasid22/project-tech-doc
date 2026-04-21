import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import type { PRContext } from '../common/interfaces/pr-context.interface';
import type { DocsApprovedEvent } from '../events/docs-approved.event';
import { DocsGeneratedEvent } from '../events/docs-generated.event';
import type { DocsRejectedEvent } from '../events/docs-rejected.event';
import { PrFailedEvent } from '../events/pr-failed.event';
import { GithubService } from '../github/github.service';
import { SlackService } from '../slack/slack.service';

const PREVIEW_TIMEOUT_MS = 30 * 60 * 1_000;

interface PendingCommit {
  prContext: PRContext;
  technicalDoc: string;
  userGuide: string;
  techPath: string;
  guidePath: string;
  timeoutHandle: NodeJS.Timeout;
}

@Injectable()
export class KbService {
  private readonly logger = new Logger(KbService.name);
  private readonly pending = new Map<number, PendingCommit>();

  constructor(
    private readonly github: GithubService,
    private readonly slack: SlackService,
    private readonly events: EventEmitter2,
  ) {}

  @OnEvent('docs.generated')
  async handleDocsGenerated(payload: DocsGeneratedEvent): Promise<void> {
    const { prContext, technicalDoc, userGuide, techPath, guidePath } = payload;
    const { prNumber, channelId, triggeredBy } = prContext;

    try {
      const timeoutHandle = setTimeout(() => {
        void this.expirePending(prNumber);
      }, PREVIEW_TIMEOUT_MS);

      this.pending.set(prNumber, {
        prContext,
        technicalDoc,
        userGuide,
        techPath,
        guidePath,
        timeoutHandle,
      });

      await this.slack.uploadFiles(channelId, [
        {
          filename: `pr-${prNumber}-technical.md`,
          content: technicalDoc,
          title: `Technical doc draft — ${techPath}`,
        },
        {
          filename: `pr-${prNumber}-guide.md`,
          content: userGuide,
          title: `User guide draft — ${guidePath}`,
        },
      ]);

      await this.slack.postApprovalPrompt(
        channelId,
        [
          `<@${triggeredBy}> here's the draft for PR #${prNumber}.`,
          `• \`${techPath}\``,
          `• \`${guidePath}\``,
          `Review the attached files and approve to commit, or reject to discard.`,
        ].join('\n'),
        prNumber,
      );

      this.logger.log(`Preview posted for PR #${prNumber}, awaiting approval`);
    } catch (error: unknown) {
      this.clearPending(prNumber);
      const reason =
        error instanceof Error ? error.message : 'Unknown preview error';
      this.logger.error(`Preview failed for PR #${prNumber}: ${reason}`);

      const failed = Object.assign(new PrFailedEvent(), {
        prNumber,
        channelId,
        reason,
      });
      this.events.emit('pr.failed', failed);
    }
  }

  @OnEvent('docs.approved')
  async handleDocsApproved(payload: DocsApprovedEvent): Promise<void> {
    const { prNumber, channelId, actionedBy } = payload;
    const entry = this.pending.get(prNumber);

    if (!entry) {
      await this.slack.postMessage(
        channelId,
        `No pending draft found for PR #${prNumber} (it may have expired).`,
      );
      return;
    }

    this.clearPending(prNumber);

    try {
      await this.github.commitFiles(
        entry.prContext.repoOwner,
        entry.prContext.repoName,
        [
          { path: entry.techPath, content: entry.technicalDoc },
          { path: entry.guidePath, content: entry.userGuide },
        ],
        `docs: update documentation for PR #${prNumber}`,
      );

      this.logger.log(`Docs committed for PR #${prNumber} by ${actionedBy}`);

      await this.slack.postMessage(
        channelId,
        [
          `✅ Approved by <@${actionedBy}> — committed docs for PR #${prNumber}`,
          `📁 Technical: /${entry.techPath}`,
          `📖 User Guide: /${entry.guidePath}`,
        ].join('\n'),
      );
    } catch (error: unknown) {
      const reason =
        error instanceof Error ? error.message : 'Unknown commit error';
      this.logger.error(`Commit failed for PR #${prNumber}: ${reason}`);

      const failed = Object.assign(new PrFailedEvent(), {
        prNumber,
        channelId,
        reason,
      });
      this.events.emit('pr.failed', failed);
    }
  }

  @OnEvent('docs.rejected')
  async handleDocsRejected(payload: DocsRejectedEvent): Promise<void> {
    const { prNumber, channelId, actionedBy } = payload;
    const entry = this.pending.get(prNumber);

    if (!entry) {
      await this.slack.postMessage(
        channelId,
        `No pending draft found for PR #${prNumber} (it may have expired).`,
      );
      return;
    }

    this.clearPending(prNumber);
    this.logger.log(`Docs rejected for PR #${prNumber} by ${actionedBy}`);

    await this.slack.postMessage(
      channelId,
      `🗑️ Discarded draft for PR #${prNumber} (rejected by <@${actionedBy}>)`,
    );
  }

  private async expirePending(prNumber: number): Promise<void> {
    const entry = this.pending.get(prNumber);
    if (!entry) return;

    const channelId = entry.prContext.channelId;
    this.pending.delete(prNumber);
    this.logger.log(`Preview expired for PR #${prNumber}`);

    await this.slack.postMessage(
      channelId,
      `⌛ Preview expired for PR #${prNumber} — draft discarded.`,
    );
  }

  private clearPending(prNumber: number): void {
    const entry = this.pending.get(prNumber);
    if (!entry) return;
    clearTimeout(entry.timeoutHandle);
    this.pending.delete(prNumber);
  }
}
