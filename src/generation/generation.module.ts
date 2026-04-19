import { Module } from '@nestjs/common';
import { GenerationService } from './generation.service';

@Module({
  providers: [GenerationService],
  exports: [GenerationService],
})
export class GenerationModule {}
