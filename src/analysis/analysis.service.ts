import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { GoogleGenAI } from '@google/genai';
import type { AnalysisResult } from '../common/interfaces/analysis-result.interface';
import type { PRContext } from '../common/interfaces/pr-context.interface';
import { PrAnalyzedEvent } from '../events/pr-analyzed.event';
import { PrFailedEvent } from '../events/pr-failed.event';

const MODEL = 'gemini-3-flash-preview';

const SYSTEM_PROMPT = `You are a technical documentation assistant. Analyze the given PR diff and context. Return a JSON object with:
- summary: one paragraph explaining what this PR does
- why: one paragraph inferring why this change was made
- affectedModules: string[] of affected module/feature names
- questions: string[] of 3-5 targeted questions to ask the developer to fill gaps in understanding
Return only valid JSON, no markdown, no preamble.`;

@Injectable()
export class AnalysisService {
  private readonly logger = new Logger(AnalysisService.name);
  private readonly ai: GoogleGenAI;

  constructor(
    private readonly config: ConfigService,
    private readonly events: EventEmitter2,
  ) {
    this.ai = new GoogleGenAI({
      apiKey: this.config.getOrThrow<string>('GEMINI_API_KEY'),
    });
  }

  @OnEvent('pr.ingested')
  async handlePrIngested(prContext: PRContext): Promise<void> {
    await this.analyzePR(prContext);
  }

  async analyzePR(prContext: PRContext): Promise<void> {
    const { prNumber, channelId } = prContext;

    try {
      const response = await this.ai.models.generateContent({
        model: MODEL,
        contents: this.buildUserMessage(prContext),
        config: {
          systemInstruction: SYSTEM_PROMPT,
          responseMimeType: 'application/json',
        },
      });

      const rawText = response.text ?? '';
      const analysis = JSON.parse(rawText) as AnalysisResult;

      const event = Object.assign(new PrAnalyzedEvent(), {
        prContext,
        analysis,
      });

      this.events.emit('pr.analyzed', event);
      this.logger.log(`Analysis complete for PR #${prNumber}`);
    } catch (error: unknown) {
      const reason =
        error instanceof Error ? error.message : 'Unknown analysis error';

      this.logger.error(`Failed to analyze PR #${prNumber}: ${reason}`);

      const failed = Object.assign(new PrFailedEvent(), {
        prNumber,
        channelId,
        reason,
      });

      this.events.emit('pr.failed', failed);
    }
  }

  private buildUserMessage(ctx: PRContext): string {
    const commits = ctx.commits
      .map((c) => `- ${c.sha.slice(0, 7)} ${c.message} (${c.author})`)
      .join('\n');

    const files = ctx.files
      .map(
        (f) =>
          `### ${f.filename} [${f.status}] +${f.additions} -${f.deletions}\n${f.patch}`,
      )
      .join('\n\n');

    return [
      `PR #${ctx.prNumber}: ${ctx.title}`,
      `Repo: ${ctx.repoOwner}/${ctx.repoName}`,
      `Author: ${ctx.author}`,
      `Base: ${ctx.baseBranch} ← Head: ${ctx.headBranch}`,
      `Created: ${ctx.createdAt}`,
      '',
      '## Description',
      ctx.description || '(none)',
      '',
      '## Commits',
      commits,
      '',
      '## Diff',
      files,
    ].join('\n');
  }
}
