import { Module } from '@nestjs/common';
import { GithubModule } from '../github/github.module';
import { GenerationService } from './generation.service';

@Module({
  imports: [GithubModule],
  providers: [GenerationService],
  exports: [GenerationService],
})
export class GenerationModule {}
