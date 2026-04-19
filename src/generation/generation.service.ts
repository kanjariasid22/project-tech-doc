import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import Anthropic from '@anthropic-ai/sdk';
import { PRContext } from '../common/interfaces/pr-context.interface';
import { DocsGeneratedEvent } from '../events/docs-generated.event';
import { PrFailedEvent } from '../events/pr-failed.event';
import { VoiceCompletedEvent } from '../events/voice-completed.event';

const MODEL = 'claude-sonnet-4-20250514';

const TECH_DOC_SYSTEM = `You are a technical documentation writer. Given a PR
diff, analysis, and developer interview transcript, write a thorough technical
documentation page in markdown. Include these sections: Overview, What Changed,
Why It Changed, Affected Modules, API/Interface Changes (if any), Developer
Notes. Be precise and use technical language. Return only markdown, no
preamble.`;

const USER_GUIDE_SYSTEM = `You are a product documentation writer. Given a PR
diff, analysis, and developer interview transcript, write a clear user-facing
guide in markdown. Include these sections: What This Feature Does, How To Use
It, Important Notes. Use plain non-technical language. Return only markdown,
no preamble.`;

@Injectable()
export class GenerationService {
  private readonly logger = new Logger(GenerationService.name);
  private readonly client: Anthropic;

  constructor(
    private readonly config: ConfigService,
    private readonly events: EventEmitter2,
  ) {
    this.client = new Anthropic({
      apiKey: this.config.getOrThrow<string>('ANTHROPIC_API_KEY'),
    });
  }

  @OnEvent('voice.completed')
  async handleVoiceCompleted(payload: VoiceCompletedEvent): Promise<void> {
    const { prContext, analysis, transcript } = payload;
    const { prNumber, channelId } = prContext;

    try {
      const [technicalDoc, userGuide] = await Promise.all([
        this.callClaude(
          TECH_DOC_SYSTEM,
          this.buildTechDocMessage(prContext, analysis, transcript),
        ),
        this.callClaude(
          USER_GUIDE_SYSTEM,
          this.buildUserGuideMessage(prContext, analysis, transcript),
        ),
      ]);

      const event = Object.assign(new DocsGeneratedEvent(), {
        prContext,
        analysis,
        technicalDoc,
        userGuide,
      });

      this.events.emit('docs.generated', event);
      this.logger.log(`Docs generated for PR #${prNumber}`);
    } catch (error: unknown) {
      const reason =
        error instanceof Error ? error.message : 'Unknown generation error';

      this.logger.error(`Doc generation failed for PR #${prNumber}: ${reason}`);

      const failed = Object.assign(new PrFailedEvent(), {
        prNumber,
        channelId,
        reason,
      });

      this.events.emit('pr.failed', failed);
    }
  }

  private async callClaude(
    system: string,
    userMessage: string,
  ): Promise<string> {
    const response = await this.client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system,
      messages: [{ role: 'user', content: userMessage }],
    });

    const block = response.content[0];
    return block.type === 'text' ? block.text : '';
  }

  private buildTechDocMessage(
    ctx: PRContext,
    analysis: { summary: string; why: string; affectedModules: string[] },
    transcript: string,
  ): string {
    const files = ctx.files
      .map(
        (f) =>
          `### ${f.filename} [${f.status}] +${f.additions} -${f.deletions}\n${f.patch}`,
      )
      .join('\n\n');

    const commits = ctx.commits
      .map((c) => `- ${c.sha.slice(0, 7)} ${c.message}`)
      .join('\n');

    return [
      `# PR #${ctx.prNumber}: ${ctx.title}`,
      `**Author:** ${ctx.author} | **Repo:** ${ctx.repoOwner}/${ctx.repoName}`,
      `**Base:** ${ctx.baseBranch} ← **Head:** ${ctx.headBranch}`,
      '',
      '## Analysis',
      `**Summary:** ${analysis.summary}`,
      `**Why:** ${analysis.why}`,
      `**Affected Modules:** ${analysis.affectedModules.join(', ')}`,
      '',
      '## Commits',
      commits,
      '',
      '## Diff',
      files,
      '',
      '## Developer Interview Transcript',
      transcript,
    ].join('\n');
  }

  private buildUserGuideMessage(
    ctx: PRContext,
    analysis: { summary: string },
    transcript: string,
  ): string {
    return [
      `# PR #${ctx.prNumber}: ${ctx.title}`,
      '',
      '## PR Description',
      ctx.description || '(none)',
      '',
      '## Analysis Summary',
      analysis.summary,
      '',
      '## Developer Interview Transcript',
      transcript,
    ].join('\n');
  }
}
