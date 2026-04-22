import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { GoogleGenAI } from '@google/genai';
import type { AnalysisResult } from '../common/interfaces/analysis-result.interface';
import type { PRContext } from '../common/interfaces/pr-context.interface';
import { deriveModuleName } from '../common/utils/module-name';
import { DocsGeneratedEvent } from '../events/docs-generated.event';
import { PrFailedEvent } from '../events/pr-failed.event';
import { VoiceCompletedEvent } from '../events/voice-completed.event';
import { GithubService } from '../github/github.service';

const MODEL = 'gemini-3-flash-preview';

const TECH_DOC_NEW_SYSTEM = `You are a technical documentation writer. Given a
PR diff, analysis, and developer interview transcript, write a thorough
technical documentation page in markdown. Include these sections: Overview,
What Changed, Why It Changed, Affected Modules, API/Interface Changes (if
any), Developer Notes. Be precise and use technical language. Return only
markdown, no preamble.`;

const TECH_DOC_MERGE_SYSTEM = `You are a technical documentation editor. You
will be given an existing technical doc plus a PR's diff, analysis, and
developer interview transcript. Produce an UPDATED full version of the doc
that integrates the PR's change — revise outdated statements, remove
superseded behavior, and keep the doc coherent as a single living document
(not a changelog). Preserve accurate prior content that is still correct.
Do not add a "## PR #N" changelog section. Return only the full updated
markdown, no preamble.`;

const USER_GUIDE_NEW_SYSTEM = `You are a product documentation writer. Given
a PR diff, analysis, and developer interview transcript, write a clear
user-facing guide in markdown. Include these sections: What This Feature
Does, How To Use It, Important Notes. Use plain non-technical language.
Return only markdown, no preamble.`;

const USER_GUIDE_MERGE_SYSTEM = `You are a product documentation editor. You
will be given an existing user guide plus a PR's diff, analysis, and
developer interview transcript. Produce an UPDATED full version of the guide
that integrates the PR's change — revise outdated instructions and keep the
guide coherent as a single living document (not a changelog). Preserve
accurate prior content that is still correct. Do not add a "## PR #N"
changelog section. Use plain non-technical language. Return only markdown,
no preamble.`;

@Injectable()
export class GenerationService {
  private readonly logger = new Logger(GenerationService.name);
  private readonly ai: GoogleGenAI;

  constructor(
    private readonly config: ConfigService,
    private readonly events: EventEmitter2,
    private readonly github: GithubService,
  ) {
    this.ai = new GoogleGenAI({
      apiKey: this.config.getOrThrow<string>('GEMINI_API_KEY'),
    });
  }

  @OnEvent('voice.completed')
  async handleVoiceCompleted(payload: VoiceCompletedEvent): Promise<void> {
    const { prContext, analysis, transcript } = payload;
    const { prNumber, channelId, repoOwner, repoName } = prContext;

    try {
      const moduleName = deriveModuleName(analysis.affectedModules, prNumber);
      const techPath = `docs/technical/${moduleName}.md`;
      const guidePath = `docs/guides/${moduleName}.md`;

      const [existingTech, existingGuide] = await Promise.all([
        this.github.readFile(repoOwner, repoName, techPath),
        this.github.readFile(repoOwner, repoName, guidePath),
      ]);

      const [technicalDoc, userGuide] = await Promise.all([
        this.callGemini(
          existingTech ? TECH_DOC_MERGE_SYSTEM : TECH_DOC_NEW_SYSTEM,
          this.buildTechDocMessage(
            prContext,
            analysis,
            transcript,
            existingTech,
          ),
        ),
        this.callGemini(
          existingGuide ? USER_GUIDE_MERGE_SYSTEM : USER_GUIDE_NEW_SYSTEM,
          this.buildUserGuideMessage(
            prContext,
            analysis,
            transcript,
            existingGuide,
          ),
        ),
      ]);

      const event = Object.assign(new DocsGeneratedEvent(), {
        prContext,
        analysis,
        technicalDoc,
        userGuide,
        techPath,
        guidePath,
      });

      this.events.emit('docs.generated', event);
      this.logger.log(
        `Docs generated for PR #${prNumber} (${existingTech ? 'merged' : 'new'} tech, ${existingGuide ? 'merged' : 'new'} guide)`,
      );
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
    analysis: AnalysisResult,
    transcript: string,
    existingDoc: string | null,
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

    const sections = [
      `# PR #${ctx.prNumber}: ${ctx.title}`,
      `**Author:** ${ctx.author} | **Repo:** ${ctx.repoOwner}/${ctx.repoName}`,
      `**Base:** ${ctx.baseBranch} ← **Head:** ${ctx.headBranch}`,
      '',
    ];

    if (existingDoc) {
      sections.push(
        '## Existing Technical Doc (to be updated)',
        existingDoc,
        '',
      );
    }

    sections.push(
      '## PR Analysis',
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
    );

    return sections.join('\n');
  }

  private buildUserGuideMessage(
    ctx: PRContext,
    analysis: AnalysisResult,
    transcript: string,
    existingGuide: string | null,
  ): string {
    const sections = [
      `# PR #${ctx.prNumber}: ${ctx.title}`,
      '',
      '## PR Description',
      ctx.description || '(none)',
      '',
    ];

    if (existingGuide) {
      sections.push(
        '## Existing User Guide (to be updated)',
        existingGuide,
        '',
      );
    }

    sections.push(
      '## PR Analysis Summary',
      analysis.summary,
      '',
      '## Developer Interview Transcript',
      transcript,
    );

    return sections.join('\n');
  }
}
