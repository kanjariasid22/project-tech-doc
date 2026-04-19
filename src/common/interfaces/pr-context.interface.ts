export interface PRContext {
  prNumber: number;
  title: string;
  description: string;
  author: string;
  baseBranch: string;
  headBranch: string;
  createdAt: string;
  commits: Array<{
    sha: string;
    message: string;
    author: string;
  }>;
  files: Array<{
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    patch: string;
  }>;
  repoOwner: string;
  repoName: string;
  triggeredBy: string;
  channelId: string;
}
