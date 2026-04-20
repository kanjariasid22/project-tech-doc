import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { GoogleGenAI } from '@google/genai';
import type { PRContext } from '../common/interfaces/pr-context.interface';
import { DocsGeneratedEvent } from '../events/docs-generated.event';
import { PrFailedEvent } from '../events/pr-failed.event';
import { VoiceCompletedEvent } from '../events/voice-completed.event';

const MODEL = 'gemini-2.5-flash';

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
  private readonly ai: GoogleGenAI;

  constructor(
    private readonly config: ConfigService,
    private readonly events: EventEmitter2,
  ) {
    this.ai = new GoogleGenAI({
      apiKey: this.config.getOrThrow<string>('GEMINI_API_KEY'),
    });
  }

  @OnEvent('voice.completed')
  async handleVoiceCompleted(payload: VoiceCompletedEvent): Promise<void> {
    const { prContext, analysis, transcript } = payload;
    const { prNumber, channelId } = prContext;

    try {
      const [technicalDoc, userGuide] = await Promise.all([
        this.callGemini(
          TECH_DOC_SYSTEM,
          this.buildTechDocMessage(prContext, analysis, transcript),
        ),
        this.callGemini(
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

  private async callGemini(
    systemInstruction: string,
    userMessage: string,
  ): Promise<string> {
    const response = await this.ai.models.generateContent({
      model: MODEL,
      contents: userMessage,
      config: { systemInstruction },
    });

    return response.text ?? '';
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
