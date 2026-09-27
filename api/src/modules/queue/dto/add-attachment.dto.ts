import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

// Cloudinary upload itself is done client-side / by another endpoint — this just records the
// resulting URL against a queue item.
export class AddAttachmentDto {
  @ApiProperty()
  @IsString()
  fileUrl: string;

  @ApiProperty()
  @IsString()
  fileName: string;
}
