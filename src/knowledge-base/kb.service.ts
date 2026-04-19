import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { GithubService } from '../github/github.service';
import { DocsGeneratedEvent } from '../events/docs-generated.event';
import { PrFailedEvent } from '../events/pr-failed.event';
import { SlackService } from '../slack/slack.service';

const SEPARATOR = '\n\n---\n';

@Injectable()
export class KbService {
  private readonly logger = new Logger(KbService.name);

  constructor(
    private readonly github: GithubService,
    private readonly slack: SlackService,
    private readonly events: EventEmitter2,
  ) {}

  @OnEvent('docs.generated')
  async handleDocsGenerated(payload: DocsGeneratedEvent): Promise<void> {
    const { prContext, analysis, technicalDoc, userGuide } = payload;
    const { prNumber, repoOwner, repoName, channelId } = prContext;

    try {
      const moduleName = this.toSlug(
        analysis.affectedModules[0] ?? `pr-${prNumber}`,
      );
      const techPath = `docs/technical/${moduleName}.md`;
      const guidePath = `docs/guides/${moduleName}.md`;
      const date = new Date().toISOString().split('T')[0];
      const sectionHeader = `## PR #${prNumber} — ${date}`;

      const [existingTech, existingGuide] = await Promise.all([
        this.github.readFile(repoOwner, repoName, techPath),
        this.github.readFile(repoOwner, repoName, guidePath),
      ]);

      const newTechContent = existingTech
        ? `${existingTech}${SEPARATOR}${sectionHeader}\n${technicalDoc}`
        : technicalDoc;

      const newGuideContent = existingGuide
        ? `${existingGuide}${SEPARATOR}${sectionHeader}\n${userGuide}`
        : userGuide;

      await this.github.commitFiles(
        repoOwner,
        repoName,
        [
          { path: techPath, content: newTechContent },
          { path: guidePath, content: newGuideContent },
        ],
        `docs: update documentation for PR #${prNumber}`,
      );

      this.logger.log(`Docs committed for PR #${prNumber}`);

      await this.slack.postMessage(
        channelId,
        [
          `✅ Documentation updated for PR #${prNumber}`,
          `📁 Technical: /${techPath}`,
          `📖 User Guide: /${guidePath}`,
        ].join('\n'),
      );
    } catch (error: unknown) {
      const reason =
        error instanceof Error ? error.message : 'Unknown KB error';

      this.logger.error(`KB commit failed for PR #${prNumber}: ${reason}`);

      const failed = Object.assign(new PrFailedEvent(), {
        prNumber,
        channelId,
        reason,
      });

      this.events.emit('pr.failed', failed);
    }
  }

  private toSlug(name: string): string {
    return name.toLowerCase().replace(/\s+/g, '-');
  }
}
