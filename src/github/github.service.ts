import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Octokit } from '@octokit/rest';
import { PRContext } from '../common/interfaces/pr-context.interface';
import { PrFailedEvent } from '../events/pr-failed.event';
import { PrReceivedEvent } from '../events/pr-received.event';

export interface FileCommit {
  path: string;
  content: string;
}

@Injectable()
export class GithubService {
  private readonly logger = new Logger(GithubService.name);
  private readonly octokit: Octokit;

  constructor(
    private readonly config: ConfigService,
    private readonly events: EventEmitter2,
  ) {
    this.octokit = new Octokit({
      auth: this.config.getOrThrow<string>('GITHUB_TOKEN'),
    });
  }

  @OnEvent('pr.received')
  async handlePrReceived(payload: PrReceivedEvent): Promise<void> {
    await this.ingestPR(payload);
  }

  async ingestPR(payload: PrReceivedEvent): Promise<void> {
    const { prNumber, repoOwner, repoName, triggeredBy, channelId } = payload;

    try {
      const [prResponse, commitsResponse, filesResponse] = await Promise.all([
        this.octokit.pulls.get({
          owner: repoOwner,
          repo: repoName,
          pull_number: prNumber,
        }),
        this.octokit.pulls.listCommits({
          owner: repoOwner,
          repo: repoName,
          pull_number: prNumber,
        }),
        this.octokit.pulls.listFiles({
          owner: repoOwner,
          repo: repoName,
          pull_number: prNumber,
        }),
      ]);

      const pr = prResponse.data;

      const context: PRContext = {
        prNumber,
        title: pr.title,
        description: pr.body ?? '',
        author: pr.user?.login ?? 'unknown',
        baseBranch: pr.base.ref,
        headBranch: pr.head.ref,
        createdAt: pr.created_at,
        commits: commitsResponse.data.map((c) => ({
          sha: c.sha,
          message: c.commit.message,
          author: c.commit.author?.name ?? 'unknown',
        })),
        files: filesResponse.data.map((f) => ({
          filename: f.filename,
          status: f.status,
          additions: f.additions,
          deletions: f.deletions,
          patch: f.patch ?? '',
        })),
        repoOwner,
        repoName,
        triggeredBy,
        channelId,
      };

      this.events.emit('pr.ingested', context);
      this.logger.log(`Ingested PR #${prNumber} from ${repoOwner}/${repoName}`);
    } catch (error: unknown) {
      const reason =
        error instanceof Error ? error.message : 'Unknown GitHub API error';

      this.logger.error(`Failed to ingest PR #${prNumber}: ${reason}`);

      const failed = Object.assign(new PrFailedEvent(), {
        prNumber,
        channelId,
        reason,
      });

      this.events.emit('pr.failed', failed);
    }
  }

  async readFile(
    owner: string,
    repo: string,
    path: string,
  ): Promise<string | null> {
    try {
      const { data } = await this.octokit.repos.getContent({
        owner,
        repo,
        path,
      });
      if (Array.isArray(data) || data.type !== 'file') return null;
      return Buffer.from(data.content, 'base64').toString('utf-8');
    } catch {
      return null;
    }
  }

  async commitFiles(
    owner: string,
    repo: string,
    files: FileCommit[],
    message: string,
  ): Promise<void> {
    const { data: repoData } = await this.octokit.repos.get({ owner, repo });
    const branch = repoData.default_branch;

    const { data: refData } = await this.octokit.git.getRef({
      owner,
      repo,
      ref: `heads/${branch}`,
    });
    const latestSha = refData.object.sha;

    const { data: commitData } = await this.octokit.git.getCommit({
      owner,
      repo,
      commit_sha: latestSha,
    });

    const blobs = await Promise.all(
      files.map((f) =>
        this.octokit.git.createBlob({
          owner,
          repo,
          content: Buffer.from(f.content).toString('base64'),
          encoding: 'base64',
        }),
      ),
    );

    const { data: treeData } = await this.octokit.git.createTree({
      owner,
      repo,
      base_tree: commitData.tree.sha,
      tree: files.map((f, i) => ({
        path: f.path,
        mode: '100644' as const,
        type: 'blob' as const,
        sha: blobs[i].data.sha,
      })),
    });

    const { data: newCommit } = await this.octokit.git.createCommit({
      owner,
      repo,
      message,
      tree: treeData.sha,
      parents: [latestSha],
    });

    await this.octokit.git.updateRef({
      owner,
      repo,
      ref: `heads/${branch}`,
      sha: newCommit.sha,
    });

    this.logger.log(`Committed ${files.length} file(s): ${message}`);
  }
}
